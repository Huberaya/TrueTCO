import type { Queryable } from './db';
import type { AuthContext } from './types';

export interface AuditEntry {
  projectId?: string | null;
  entity: string;
  field: string;
  oldValue?: unknown;
  newValue?: unknown;
  justification?: string;
  /** 'server' : constat par le serveur. 'client_declared' : contenu saisi par l'utilisateur (identité et date restent serveur). */
  origin?: 'server' | 'client_declared';
}

const str = (v: unknown, max = 2000): string => {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};

/**
 * Écrit une entrée d'audit DANS LA TRANSACTION de la modification.
 * Auteur, rôle, organisation et horodatage sont imposés par le serveur ; aucune route ne permet
 * au client de les fournir. La table est en écriture seule (trigger + absence de droits UPDATE/DELETE).
 */
export async function writeAudit(q: Queryable, ctx: AuthContext, e: AuditEntry): Promise<void> {
  const a = ctx.active;
  if (!a) return;
  await q.query(
    `INSERT INTO audit_logs (organization_id, user_id, user_name, user_role, project_id,
                             entity_name, field_changed, old_value, new_value, justification, origin)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      a.organizationId,
      a.userId,
      a.fullName,
      a.role,
      e.projectId ?? null,
      str(e.entity, 255),
      str(e.field, 255),
      str(e.oldValue),
      str(e.newValue),
      str(e.justification ?? 'Modification enregistrée par le serveur'),
      e.origin ?? 'server',
    ]
  );
}

/** Une entrée par champ réellement modifié (comparaison valeur à valeur). */
export async function auditDiff(
  q: Queryable,
  ctx: AuthContext,
  base: { projectId?: string | null; entity: string; justification?: string },
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: string[]
): Promise<void> {
  if (!before) {
    await writeAudit(q, ctx, { ...base, field: 'Création', oldValue: 'N/A', newValue: after.reference ?? after.name ?? after.id });
    return;
  }
  for (const f of fields) {
    const o = before[f];
    const n = after[f];
    if (String(o ?? '') !== String(n ?? '')) {
      await writeAudit(q, ctx, { ...base, field: f, oldValue: o, newValue: n });
    }
  }
}
