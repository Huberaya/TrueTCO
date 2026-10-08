/**
 * TrueTCO — Dépôt « projets » (accès PostgreSQL réel, cloisonné par RLS)
 * ---------------------------------------------------------------------------
 * Aucune de ces fonctions ne filtre par `organization_id` « par convention » :
 * le cloisonnement vient des policies RLS appliquées dans la transaction. Le
 * paramètre d'organisation passé à `asOrganization` est l'identifiant issu de la
 * SESSION, jamais du client.
 */

import { Db, Executor } from '../db/types';
import { HttpError } from '../http';
import { actorFromContext, recordAudit } from '../audit';
import { AuthContext } from '../auth/types';

export const PROJECT_STATUSES = ['draft', 'data_review', 'finance_review', 'esg_review', 'approval', 'decision', 'locked'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_SELECT = `id, reference, name, description, category,
              workflow_status AS status, currency, country_code, budget_cap, planned_volume,
              unit_name, horizon_years, discount_rate, energy_inflation_rate,
              general_inflation_rate, carbon_price_per_tonne, version,
              created_at, updated_at, locked_at, is_demo`;

export interface ProjectRow {
  id: string;
  reference: string;
  name: string;
  description: string | null;
  category: string;
  status: ProjectStatus;
  currency: string;
  country_code: string | null;
  budget_cap: string;
  planned_volume: number;
  unit_name: string;
  horizon_years: number;
  discount_rate: string;
  energy_inflation_rate: string;
  general_inflation_rate: string;
  carbon_price_per_tonne: string;
  version: number;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
  is_demo: boolean;
}

export interface CreateProjectInput {
  reference: string;
  name: string;
  description?: string | null;
  category: string;
  currency: string;
  countryCode?: string | null;
}

export async function listProjects(
  db: Db,
  ctx: AuthContext,
  page: { limit: number; offset: number }
): Promise<{ items: ProjectRow[]; total: number }> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const items = await tx.query<ProjectRow>(
      `SELECT ${PROJECT_SELECT} FROM projects ORDER BY created_at DESC, reference LIMIT $1 OFFSET $2`,
      [page.limit, page.offset]
    );
    const [count] = await tx.query<{ total: string }>('SELECT count(*)::text AS total FROM projects');
    return { items, total: Number(count?.total ?? 0) };
  });
}

export async function getProject(db: Db, ctx: AuthContext, projectId: string): Promise<ProjectRow | null> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const rows = await tx.query<ProjectRow>(`SELECT ${PROJECT_SELECT} FROM projects WHERE id = $1`, [projectId]);
    return rows[0] ?? null;
  });
}

export async function createProject(
  db: Db,
  ctx: AuthContext,
  input: CreateProjectInput,
  meta: { ipAddress?: string | null; userAgent?: string | null; correlationId?: string | null }
): Promise<ProjectRow> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const [project] = await tx.query<ProjectRow>(
      `INSERT INTO projects (organization_id, reference, name, description, category, currency, country_code, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${PROJECT_SELECT}`,
      [
        ctx.organization.id,
        input.reference,
        input.name,
        input.description ?? null,
        input.category,
        input.currency,
        input.countryCode ?? null,
        ctx.user.id,
      ]
    );

    await recordAudit(
      tx,
      actorFromContext(ctx),
      ctx.organization.id,
      {
        action: 'project.created',
        entityType: 'project',
        entityId: project.id,
        projectId: project.id,
        newValue: JSON.stringify({ reference: project.reference, name: project.name, category: project.category }),
        ...meta,
      }
    );

    return project;
  });
}

export async function updateProject(
  db: Db,
  ctx: AuthContext,
  projectId: string,
  patch: Partial<Pick<ProjectRow, 'name' | 'description' | 'category' | 'currency' | 'country_code'>>,
  meta: { ipAddress?: string | null; userAgent?: string | null; correlationId?: string | null }
): Promise<ProjectRow | null> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    // Ligne brute : le SELECT * renvoie `workflow_status`, tandis que l'API
    // expose `status` (alias de lecture). Ne pas confondre les deux.
    const current = (await tx.query<any>('SELECT * FROM projects WHERE id = $1', [projectId]))[0];
    if (!current) return null;

    if (current.workflow_status === 'locked') {
      throw new HttpError(
        409,
        'PROJECT_LOCKED',
        'Ce dossier est verrouillé : toute modification crée une nouvelle version (nouveau dossier lié). ' +
          'Le déverrouillage requiert un approbateur.'
      );
    }

    const [updated] = await tx.query<ProjectRow>(
      `UPDATE projects
          SET name = COALESCE($2, name),
              description = COALESCE($3, description),
              category = COALESCE($4, category),
              currency = COALESCE($5, currency),
              country_code = COALESCE($6, country_code)
        WHERE id = $1
        RETURNING ${PROJECT_SELECT}`,
      [projectId, patch.name ?? null, patch.description ?? null, patch.category ?? null, patch.currency ?? null, patch.country_code ?? null]
    );

    // Le journal enregistre CHAMP PAR CHAMP l'ancienne et la nouvelle valeur.
    for (const field of ['name', 'description', 'category', 'currency', 'country_code'] as const) {
      const before = (current as any)[field] ?? null;
      const after = (updated as any)[field] ?? null;
      if (String(before ?? '') !== String(after ?? '')) {
        await recordAudit(
          tx,
          actorFromContext(ctx),
          ctx.organization.id,
          {
            action: 'project.updated',
            entityType: 'project',
            entityId: projectId,
            projectId,
            fieldChanged: field,
            oldValue: before === null ? null : String(before),
            newValue: after === null ? null : String(after),
            ...meta,
          }
        );
      }
    }

    return updated;
  });
}

export const PROJECT_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['data_review'],
  data_review: ['finance_review', 'draft'],
  finance_review: ['esg_review', 'data_review'],
  esg_review: ['approval', 'finance_review'],
  approval: ['decision', 'esg_review'],
  decision: ['locked', 'approval'],
  locked: [],
};

export async function changeProjectStatus(
  db: Db,
  ctx: AuthContext,
  projectId: string,
  target: ProjectStatus,
  justification: string,
  meta: { ipAddress?: string | null; userAgent?: string | null; correlationId?: string | null }
): Promise<ProjectRow | null> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const current = (await tx.query<any>('SELECT * FROM projects WHERE id = $1', [projectId]))[0];
    if (!current) return null;

    const allowed = PROJECT_TRANSITIONS[current.workflow_status as ProjectStatus] ?? [];
    if (!allowed.includes(target)) {
      throw new HttpError(
        409,
        'INVALID_TRANSITION',
        `Transition de statut refusée : « ${current.workflow_status} » → « ${target} ». ` +
          `Transitions autorisées depuis « ${current.workflow_status} » : ${allowed.length ? allowed.join(', ') : 'aucune (dossier verrouillé)'}.`
      );
    }

    const [updated] = await tx.query<ProjectRow>(
      `UPDATE projects
          SET workflow_status = $2::varchar,
              locked_at = CASE WHEN $2::varchar = 'locked' THEN CURRENT_TIMESTAMP ELSE locked_at END,
              locked_by = CASE WHEN $2::varchar = 'locked' THEN $3::uuid ELSE locked_by END
        WHERE id = $1
        RETURNING ${PROJECT_SELECT}`,
      [projectId, target, ctx.user.id]
    );

    await recordAudit(
      tx,
      actorFromContext(ctx),
      ctx.organization.id,
      {
        action: 'project.status_changed',
        entityType: 'project',
        entityId: projectId,
        projectId,
        fieldChanged: 'workflow_status',
        oldValue: current.workflow_status,
        newValue: target,
        justification,
        ...meta,
      }
    );

    return updated;
  });
}
