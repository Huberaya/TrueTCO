import { assertSafeRoleName, Db, DbStatus, Executor, ORG_SETTING, APP_ROLE_DEFAULT, DataError } from './types';

/**
 * TrueTCO — Implémentations du contrat de données
 * ---------------------------------------------------------------------------
 * Les deux adaptateurs partagent volontairement la même séquence
 * d'initialisation de transaction :
 *
 *   BEGIN
 *     SET LOCAL ROLE truetco_app;                                  -- soumis au RLS
 *     SELECT set_config('app.current_organization_id', $1, true);   -- contexte tenant
 *     ... requêtes métier ...
 *   COMMIT
 *
 * `SET LOCAL` garantit que le contexte ne fuit pas vers la transaction suivante
 * lorsqu'une connexion est réutilisée par le pool — c'est la condition pour que
 * l'isolation soit réelle et pas seulement déclarative.
 */

interface AcquireResult {
  query: <T>(text: string, params?: unknown[]) => Promise<T[]>;
  release: () => void;
}

abstract class BaseDb implements Db {
  constructor(
    protected readonly appRole: string | null,
    protected readonly appRoleAssumed: { value: boolean } = { value: false }
  ) {}

  protected abstract acquire(): Promise<AcquireResult>;
  protected abstract driverName(): 'postgres' | 'pglite';

  public async query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
    const conn = await this.acquire();
    try {
      return await conn.query<T>(text, params);
    } finally {
      conn.release();
    }
  }

  public async tx<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return this.runTransaction({ organizationId: null, assumeAppRole: true }, fn);
  }

  public async systemTx<T>(fn: (tx: Executor) => Promise<T>): Promise<T> {
    return this.runTransaction({ organizationId: null, assumeAppRole: false }, fn);
  }

  public async asOrganization<T>(organizationId: string | null, fn: (tx: Executor) => Promise<T>): Promise<T> {
    return this.runTransaction({ organizationId, assumeAppRole: true }, fn);
  }

  private async runTransaction<T>(
    opts: { organizationId: string | null; assumeAppRole: boolean },
    fn: (tx: Executor) => Promise<T>
  ): Promise<T> {
    const conn = await this.acquire();
    const tx: Executor = { query: (text, params) => conn.query(text, params) };

    try {
      await conn.query('BEGIN');

      if (opts.assumeAppRole && this.appRole) {
        // SET LOCAL : le rôle est repris à la fin de la transaction, jamais
        // conservé sur une connexion du pool.
        await conn.query(`SET LOCAL ROLE ${assertSafeRoleName(this.appRole)}`);
        this.appRoleAssumed.value = true;
      }

      if (opts.organizationId !== null) {
        // set_config(..., true) = portée transactionnelle uniquement.
        await conn.query(`SELECT set_config($1, $2, true)`, [ORG_SETTING, opts.organizationId]);
      }

      const result = await fn(tx);
      await conn.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await conn.query('ROLLBACK');
      } catch {
        // La connexion sera libérée ; l'erreur d'origine est plus informative.
      }
      // Une erreur déjà construite par le serveur (HttpError avec statut et code
      // métier, ou DataError) ne doit pas être re-traduite : la traduire
      // masquerait son code (404, 403, 409) derrière un 500 générique.
      if (err instanceof DataError || (typeof (err as any)?.status === 'number' && (err as any)?.code)) {
        throw err;
      }
      throw translateError(err);
    } finally {
      conn.release();
    }
  }

  public abstract status(): Promise<DbStatus>;
  public abstract close(): Promise<void>;

  public async currentUser(): Promise<{ user: string; isTableOwner: boolean }> {
    const rows = await this.query<{ user: string; is_owner: boolean }>(
      `SELECT current_user AS "user",
              EXISTS (
                SELECT 1 FROM pg_tables t
                WHERE t.schemaname = 'public'
                  AND t.tablename = 'organizations'
                  AND t.tableowner = current_user
              ) AS is_owner`
    );
    return { user: rows[0]?.user ?? 'inconnu', isTableOwner: Boolean(rows[0]?.is_owner) };
  }
}

/** Traduit les erreurs PostgreSQL en erreurs métier exploitables par l'API. */
export function translateError(err: unknown): Error {
  if (err instanceof DataError) return err;
  const e = err as { code?: string; message?: string; detail?: string; constraint?: string };

  switch (e?.code) {
    case '23505': // unique_violation
      return new DataError(
        'Un enregistrement identique existe déjà (contrainte d’unicité).',
        'CONFLICT',
        { constraint: e.constraint }
      );
    case '23503': // foreign_key_violation
      return new DataError(
        'Référence invalide : l’élément parent est inexistant ou appartient à une autre organisation.',
        'INVALID_INPUT',
        { constraint: e.constraint }
      );
    case '23514': // check_violation
      return new DataError(e.message ?? 'Valeur refusée par une contrainte de validation.', 'INVALID_INPUT');
    case '42703': // undefined_column
    case '42P01': // undefined_table
    case '42883': // undefined_function
    case '42601': // syntax_error
    case '42804': // datatype_mismatch
      return new DataError(
        "Cette opération n'a pas pu être exécutée : la requête ne correspond pas au schéma de données. " +
          "L'incident a été journalisé côté serveur avec son identifiant de corrélation.",
        'DB_SCHEMA',
        undefined,
        e?.message
      );

    case '42501': {
      // Le code 42501 couvre DEUX cas distincts qu'il ne faut pas confondre :
      //   - une violation de policy RLS (fuite ou écriture inter-organisation) ;
      //   - une exception levée volontairement par un trigger métier
      //     (par exemple l'immutabilité du journal d'audit).
      // Le message d'origine est donc conservé lorsque ce n'est pas RLS : masquer
      // « journal en append-only » par un message de tenant rendrait l'incident
      // impossible à diagnostiquer.
      const raw = e.message ?? '';
      const isPolicyViolation = /row-level security|policy/i.test(raw);
      return new DataError(
        isPolicyViolation
          ? 'Opération refusée : la donnée appartient à une autre organisation ou l’action n’est pas autorisée.'
          : `Opération refusée : ${raw}`,
        'FORBIDDEN'
      );
    }
    case '22003': // numeric_value_out_of_range
      return new DataError('Valeur numérique hors limites.', 'INVALID_INPUT');
    case '22P02': // invalid_text_representation
      return new DataError('Format de valeur invalide (identifiant ou nombre mal formé).', 'INVALID_INPUT');
    case '42P01': // undefined_table
      return new DataError(
        'Schéma incomplet : la migration n’a pas été appliquée sur cette base.',
        'DB_ERROR',
        { hint: 'Exécuter « npm run db:migrate ».' }
      );
    default:
      return new DataError(e?.message ?? 'Erreur de base de données.', 'DB_ERROR');
  }
}

// =============================================================================
// PostgreSQL de production (driver pg, transactions TCP)
// =============================================================================
export class PgDb extends BaseDb {
  private readonly pool: any;

  constructor(connectionString: string, appRole: string | null = APP_ROLE_DEFAULT, private readonly ssl: boolean = true) {
    super(appRole);
    // Import différé : le driver n'est chargé que si une base est configurée.
    const { Pool } = require('pg');
    this.pool = new Pool({
      connectionString,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.TRUETCO_DB_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // Un pool qui émet une erreur sans écouteur tue le processus Node.
    this.pool.on?.('error', (err: Error) => {
      console.error('[TrueTCO][db] Erreur de connexion inattendue du pool :', err.message);
    });
  }

  protected driverName(): 'postgres' {
    return 'postgres';
  }

  protected async acquire(): Promise<AcquireResult> {
    const client = await this.pool.connect();
    return {
      query: async <T>(text: string, params?: unknown[]): Promise<T[]> => {
        const res = await client.query(text, params as any[]);
        return res.rows as T[];
      },
      release: () => client.release(),
    };
  }

  public async status(): Promise<DbStatus> {
    try {
      const [info] = await this.query<{ version: string }>('SELECT version() AS version');
      const { user, isTableOwner } = await this.currentUser();
      return {
        driver: 'postgres',
        connected: true,
        currentUser: user,
        isTableOwner,
        appRoleAssumed: Boolean(this.appRole),
        databaseVersion: info?.version?.split(' ').slice(0, 2).join(' ') ?? null,
      };
    } catch (err) {
      return {
        driver: 'postgres',
        connected: false,
        currentUser: null,
        isTableOwner: false,
        appRoleAssumed: false,
        databaseVersion: null,
        error: (err as Error).message,
      };
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

// =============================================================================
// PostgreSQL de test (PGlite/WASM) — mêmes sémantiques, y compris RLS
// =============================================================================
export class PgliteDb extends BaseDb {
  private constructor(private readonly pg: any, appRole: string | null) {
    super(appRole);
  }

  static async create(appRole: string | null = APP_ROLE_DEFAULT): Promise<PgliteDb> {
    const { PGlite } = await import('@electric-sql/pglite');
    const pg = new PGlite();
    return new PgliteDb(pg, appRole);
  }

  protected driverName(): 'pglite' {
    return 'pglite';
  }

  protected async acquire(): Promise<AcquireResult> {
    // PGlite sérialise les requêtes ; une « transaction » implicite n'existe pas,
    // on réutilise la même instance et on s'appuie sur BEGIN/COMMIT explicites.
    const pg = this.pg;
    return {
      query: async <T>(text: string, params?: unknown[]): Promise<T[]> => {
        // PGlite (comme PostgreSQL) refuse plusieurs instructions dans une
        // requête préparée. Les scripts de migration sont donc exécutés via
        // `exec` (protocole simple), les requêtes paramétrées via `query`.
        if (!params || params.length === 0) {
          const results = await pg.exec(text);
          const last = Array.isArray(results) ? results[results.length - 1] : results;
          return ((last?.rows ?? []) as T[]);
        }
        const res = await pg.query(text, params as any[]);
        return (res.rows ?? []) as T[];
      },
      release: () => undefined,
    };
  }

  public async status(): Promise<DbStatus> {
    try {
      const [info] = await this.query<{ version: string }>('SELECT version() AS version');
      const { user, isTableOwner } = await this.currentUser();
      return {
        driver: 'pglite',
        connected: true,
        currentUser: user,
        isTableOwner,
        appRoleAssumed: Boolean(this.appRole),
        databaseVersion: info?.version?.split(' ').slice(0, 2).join(' ') ?? null,
      };
    } catch (err) {
      return {
        driver: 'pglite',
        connected: false,
        currentUser: null,
        isTableOwner: false,
        appRoleAssumed: false,
        databaseVersion: null,
        error: (err as Error).message,
      };
    }
  }

  public async close(): Promise<void> {
    await this.pg.close();
  }
}

/** Fabrique : PGlite en test, PostgreSQL réel sinon. */
/**
 * Construit la base à partir de l'environnement. Échoue clairement si aucune
 * base n'est configurée : démarrer sans base produirait une application qui
 * perd silencieusement les données de l'utilisateur.
 */
export async function createDbFromEnv(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  const appRole = process.env.TRUETCO_DB_APP_ROLE === '' ? null : process.env.TRUETCO_DB_APP_ROLE ?? APP_ROLE_DEFAULT;

  if (process.env.NODE_ENV === 'test' || process.env.TRUETCO_USE_PGLITE === 'true') {
    return PgliteDb.create(appRole);
  }
  if (!url) {
    throw new Error(
      "Aucune base PostgreSQL configurée. Renseignez DATABASE_URL (production/staging) " +
        'ou TRUETCO_USE_PGLITE=true (tests uniquement).'
    );
  }
  return new PgDb(url, appRole, process.env.TRUETCO_DB_SSL !== 'false');
}
