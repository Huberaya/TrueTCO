import pg from 'pg';
import { HttpError } from './errors';
import type { AuthContext } from './types';

export interface Queryable {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}

/** Abstraction minimale : une transaction, ou rien. Aucune requête hors transaction contextualisée. */
export interface Db {
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export class PgDb implements Db {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, statement_timeout: 15_000 });
  }

  async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const q: Queryable = {
        query: async (text, params) => {
          const r = await client.query(text, params as any[]);
          return { rows: r.rows, rowCount: r.rowCount ?? 0 };
        },
      };
      const out = await fn(q);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

export interface SessionVars {
  orgId?: string;
  newOrgId?: string;
  clerkId?: string;
  verifiedEmail?: string;
  platformAdmin?: boolean;
}

/** Variables de session LOCALES à la transaction : jamais de fuite entre requêtes ni entre connexions poolées. */
export async function setSessionVars(q: Queryable, v: SessionVars): Promise<void> {
  await q.query(
    `SELECT set_config('app.org_id', $1, true),
            set_config('app.new_org_id', $2, true),
            set_config('app.clerk_id', $3, true),
            set_config('app.verified_email', $4, true),
            set_config('app.platform_admin', $5, true)`,
    [v.orgId ?? '', v.newOrgId ?? '', v.clerkId ?? '', v.verifiedEmail ?? '', v.platformAdmin ? 'true' : '']
  );
}

/** Contexte « identité seule » : résolution des appartenances, avant qu'une organisation soit choisie. */
export function withIdentity<T>(
  db: Db,
  identity: { clerkId: string; verifiedEmail?: string },
  fn: (q: Queryable) => Promise<T>
): Promise<T> {
  return db.tx(async (q) => {
    await setSessionVars(q, { clerkId: identity.clerkId, verifiedEmail: identity.verifiedEmail });
    return fn(q);
  });
}

/**
 * Contexte tenant : TOUTE lecture/écriture de données métier passe par ici.
 * L'organisation vient exclusivement de ctx.active, lui-même issu d'un jeton vérifié
 * et des appartenances en base ; jamais d'un header, d'une query ou d'un body.
 */
export function withTenant<T>(db: Db, ctx: AuthContext, fn: (q: Queryable, tenantId: string) => Promise<T>): Promise<T> {
  const active = ctx.active;
  if (!active) throw new HttpError(403, 'no_organization', "Aucune organisation active pour cet utilisateur");
  return db.tx(async (q) => {
    await setSessionVars(q, { orgId: active.organizationId, clerkId: ctx.identity.clerkId });
    return fn(q, active.organizationId);
  });
}

/** Rapporte si la connexion courante peut contourner le RLS (rôle propriétaire / superuser / BYPASSRLS). */
export async function checkRlsEnforced(db: Db): Promise<{ enforced: boolean; role: string }> {
  return db.tx(async (q) => {
    const { rows } = await q.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
    );
    const r = rows[0];
    return { enforced: !!r && !r.rolsuper && !r.rolbypassrls, role: r?.rolname ?? 'unknown' };
  });
}
