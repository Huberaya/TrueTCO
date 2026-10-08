/**
 * TrueTCO — Lecture du journal d'audit.
 * Écriture : serveur uniquement (voir `server/audit.ts`). Aucune route ne permet
 * à un client de créer, modifier ou supprimer une entrée du journal.
 */
import { Db } from '../db/types';
import { AuthContext } from '../auth/types';

export interface AuditLogRow {
  id: string;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  justification: string | null;
  correlation_id: string | null;
  previous_hash: string | null;
  entry_hash: string;
  is_demo: boolean;
}

export async function listAuditLogs(
  db: Db,
  ctx: AuthContext,
  page: { limit: number; offset: number },
  filters: { projectId?: string | null; action?: string | null; entityType?: string | null } = {}
): Promise<{ items: AuditLogRow[]; total: number }> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const items = await tx.query<AuditLogRow>(
      `SELECT id, occurred_at, actor_id, actor_name, actor_role, action, entity_type, entity_id,
              project_id, field_changed, old_value, new_value, justification, correlation_id,
              previous_hash, entry_hash, is_demo
         FROM audit_logs
        WHERE ($1::uuid IS NULL OR project_id = $1::uuid)
          AND ($2::text IS NULL OR action = $2::text)
          AND ($3::text IS NULL OR entity_type = $3::text)
        ORDER BY id DESC
        LIMIT $4 OFFSET $5`,
      [filters.projectId ?? null, filters.action ?? null, filters.entityType ?? null, page.limit, page.offset]
    );
    const [count] = await tx.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM audit_logs
        WHERE ($1::uuid IS NULL OR project_id = $1::uuid)
          AND ($2::text IS NULL OR action = $2::text)
          AND ($3::text IS NULL OR entity_type = $3::text)`,
      [filters.projectId ?? null, filters.action ?? null, filters.entityType ?? null]
    );
    return { items, total: Number(count?.total ?? 0) };
  });
}
