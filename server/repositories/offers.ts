/**
 * TrueTCO — Dépôt « offres fournisseurs » et « postes de coût »
 * ---------------------------------------------------------------------------
 * Une offre et l'ensemble de ses postes de coût sont écrits dans UNE SEULE
 * transaction, avec l'entrée d'audit correspondante. Si un poste est refusé
 * (montant incohérent, catégorie inconnue), rien n'est conservé : il n'existe
 * jamais d'offre partiellement importée dans la base.
 *
 * Aucun résultat de calcul n'est écrit ici : `computed_*` est alimenté par le
 * moteur (Phase 3), jamais par une requête utilisateur.
 */
import { Db } from '../db/types';
import { actorFromContext, recordAudit } from '../audit';
import { AuthContext } from '../auth/types';
import { HttpError, badRequest, notFound } from '../http';

export const QUALITY_STATUSES = ['valid', 'warning', 'estimated', 'unsourced', 'missing', 'error', 'demo'] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

import { RECOGNIZED_COST_CATEGORIES, TCOEngine } from '../../src/engine/tcoEngine';

/**
 * Catégories de coût : LA liste du moteur de calcul, sans duplication.
 *
 * Un vocabulaire unique évite un défaut réel : deux listes divergentes feraient
 * entrer en base des catégories que le moteur ne saurait pas allouer, et le poste
 * serait compté comme « non alloué » — le montant resterait juste, mais l'analyse
 * par nature de coût serait perdue sans que personne ne s'en aperçoive.
 *
 * Les alias (« energie », « transport », « maintenance »…) sont acceptés en
 * entrée et ramenés à la catégorie canonique au moment de l'enregistrement.
 */
export const COST_CATEGORIES = RECOGNIZED_COST_CATEGORIES;

/** Ramène une catégorie déclarée à sa forme canonique, ou signale l'inconnue. */
export function normalizeCostCategoryInput(raw: string): { category: string; wasAlias: boolean } | null {
  const normalized = TCOEngine.normalizeCostCategory(raw);
  if (!normalized) return null;
  return { category: normalized, wasAlias: normalized !== raw.trim().toLowerCase() };
}

export interface CostItemInput {
  /** Catégorie canonique du moteur (celle qui est stockée et utilisée au calcul). */
  category: string;
  /** Libellé tel que fourni par l'appelant, conservé pour la traçabilité. */
  declaredCategory?: string;
  label: string;
  amount: number;
  currency?: string;
  unit?: string;
  quantity?: number | null;
  unitPrice?: number | null;
  qualityStatus?: QualityStatus;
  sourceName?: string | null;
  sourceType?: string;
  confidenceLevel?: number;
  isRecurringYearly?: boolean;
  yearlyInflationType?: 'energy' | 'general' | 'none' | null;
  yearOccurrences?: number[] | null;
  calculationFormula?: string | null;
  explanationNotes?: string | null;
  isDemo?: boolean;
}

export interface OfferInput {
  projectId: string;
  supplierId?: string | null;
  supplierName: string;
  offerReference: string;
  apparentTotal: number;
  quantity?: number;
  currency?: string;
  deliveryLeadTimeWeeks?: number;
  warrantyMonths?: number;
  expectedLifespanYears?: number;
  technicalSuitabilityScore?: number | null;
  isResponsibleCandidate?: boolean;
  dataSource?: 'manual' | 'import_xlsx' | 'import_csv' | 'erp' | 'api';
  isDemo?: boolean;
  costItems: CostItemInput[];
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export async function listOffers(
  db: Db,
  ctx: AuthContext,
  page: { limit: number; offset: number },
  filters: { projectId?: string | null } = {}
): Promise<{ items: any[]; total: number }> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const items = await tx.query(
      `SELECT so.id, so.project_id, so.supplier_id, so.supplier_name, so.offer_reference,
              so.apparent_total, so.currency, so.quantity, so.delivery_lead_time_weeks,
              so.warranty_months, so.expected_lifespan_years, so.technical_suitability_score,
              so.is_responsible_candidate, so.data_source, so.computed_tco_nominal, so.computed_lcc,
              so.computed_carbon_tonnes, so.computed_confidence, so.engine_version, so.computed_at,
              so.is_demo, so.created_at, so.updated_at,
              (SELECT count(*)::int FROM cost_items ci WHERE ci.offer_id = so.id) AS cost_item_count
         FROM supplier_offers so
        WHERE ($1::uuid IS NULL OR so.project_id = $1::uuid)
        ORDER BY so.created_at DESC
        LIMIT $2 OFFSET $3`,
      [filters.projectId ?? null, page.limit, page.offset]
    );
    const [count] = await tx.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM supplier_offers WHERE ($1::uuid IS NULL OR project_id = $1::uuid)`,
      [filters.projectId ?? null]
    );
    return { items, total: Number(count?.total ?? 0) };
  });
}

export async function getOffer(db: Db, ctx: AuthContext, offerId: string) {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const offers = await tx.query<any>('SELECT * FROM supplier_offers WHERE id = $1', [offerId]);
    if (offers.length === 0) return null;
    const items = await tx.query<any>(
      `SELECT * FROM cost_items WHERE offer_id = $1 ORDER BY category, label`,
      [offerId]
    );
    const carbon = await tx.query<any>(
      `SELECT * FROM carbon_items WHERE offer_id = $1 ORDER BY scope, lifecycle_phase`,
      [offerId]
    );
    const risks = await tx.query<any>(
      `SELECT * FROM risk_items WHERE offer_id = $1 ORDER BY probability DESC, description`,
      [offerId]
    );
    return { offer: offers[0], costItems: items, carbonItems: carbon, riskItems: risks };
  });
}

/**
 * Création d'une offre et de ses postes de coût de façon atomique.
 * Toute ligne sans source est marquée UNSOURCED si l'appelant annonce `valid`
 * sans nommer de source : on refuse d'affirmer qu'une donnée est vérifiée quand
 * aucun document ne la soutient.
 */
export async function createOffer(db: Db, ctx: AuthContext, input: OfferInput, meta: RequestMeta) {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const project = await tx.query<{ id: string }>('SELECT id FROM projects WHERE id = $1', [input.projectId]);
    if (project.length === 0) {
      throw notFound("Ce dossier est introuvable dans votre organisation.");
    }

    const [offer] = await tx.query<{ id: string; offer_reference: string }>(
      `INSERT INTO supplier_offers (
          organization_id, project_id, supplier_id, supplier_name, offer_reference, apparent_total,
          quantity, currency, delivery_lead_time_weeks, warranty_months, expected_lifespan_years,
          technical_suitability_score, is_responsible_candidate, data_source, is_demo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id, offer_reference`,
      [
        ctx.organization.id,
        input.projectId,
        input.supplierId ?? null,
        input.supplierName,
        input.offerReference,
        input.apparentTotal,
        input.quantity ?? 1,
        input.currency ?? 'EUR',
        input.deliveryLeadTimeWeeks ?? 0,
        input.warrantyMonths ?? 0,
        input.expectedLifespanYears ?? 0,
        input.technicalSuitabilityScore ?? null,
        input.isResponsibleCandidate ?? false,
        input.dataSource ?? 'manual',
        input.isDemo ?? false,
      ]
    );

    for (const item of input.costItems) {
      const normalization = normalizeCostCategoryInput(item.category);
      if (!normalization) {
        throw badRequest(
          'INVALID_COST_CATEGORY',
          `Catégorie de coût inconnue « ${item.category} ». Catégories autorisées : ${COST_CATEGORIES.join(', ')}. ` +
            'Les libellés usuels (« energie », « transport », « maintenance »…) sont acceptés et ramenés à leur catégorie canonique ; ' +
            "toute autre valeur doit être rapprochée explicitement, jamais devinée."
        );
      }
      const status: QualityStatus =
        item.qualityStatus === 'valid' && !item.sourceName ? 'unsourced' : (item.qualityStatus ?? 'unsourced');

      await tx.query(
        `INSERT INTO cost_items (
            organization_id, offer_id, category, label, amount, currency, unit, quantity, unit_price,
            quality_status, source_name, source_type, confidence_level, is_recurring_yearly,
            yearly_inflation_type, year_occurrences, calculation_formula, explanation_notes, is_demo,
            declared_category
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          ctx.organization.id,
          offer.id,
          // Catégorie canonique du moteur : c'est elle qui garantit l'allocation.
          normalization.category,
          item.label,
          item.amount,
          item.currency ?? input.currency ?? 'EUR',
          item.unit ?? '€',
          item.quantity ?? null,
          item.unitPrice ?? null,
          status,
          item.sourceName ?? null,
          item.sourceType ?? (item.sourceName ? 'document' : 'manquante'),
          item.confidenceLevel ?? (item.sourceName ? 80 : 0),
          item.isRecurringYearly ?? false,
          item.yearlyInflationType ?? null,
          item.yearOccurrences ?? null,
          item.calculationFormula ?? null,
          item.explanationNotes ?? null,
          item.isDemo ?? false,
          item.declaredCategory ?? normalization.category,
        ]
      );
    }

    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'offer.created',
      entityType: 'supplier_offer',
      entityId: offer.id,
      projectId: input.projectId,
      newValue: JSON.stringify({
        offerReference: offer.offer_reference,
        supplierName: input.supplierName,
        apparentTotal: input.apparentTotal,
        costItemCount: input.costItems.length,
      }),
      ...meta,
    });

    return { id: offer.id, offerReference: offer.offer_reference, costItemCount: input.costItems.length };
  });
}

/** Suppression d'un brouillon d'offre (dossier non verrouillé), journalisée. */
export async function deleteOffer(db: Db, ctx: AuthContext, offerId: string, meta: RequestMeta) {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const offers = await tx.query<{ id: string; project_id: string; offer_reference: string; workflow_status: string }>(
      `SELECT so.id, so.project_id, so.offer_reference, p.workflow_status
         FROM supplier_offers so JOIN projects p ON p.id = so.project_id
        WHERE so.id = $1`,
      [offerId]
    );
    if (offers.length === 0) throw notFound('Offre introuvable.');
    if (offers[0].workflow_status === 'locked') {
      throw new HttpError(409, 'PROJECT_LOCKED', 'Ce dossier est verrouillé : une offre ne peut plus être supprimée. Créez une nouvelle version du dossier.');
    }
    await tx.query('DELETE FROM supplier_offers WHERE id = $1', [offerId]);
    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'offer.deleted',
      entityType: 'supplier_offer',
      entityId: offerId,
      projectId: offers[0].project_id,
      oldValue: JSON.stringify({ offerReference: offers[0].offer_reference }),
      ...meta,
    });
    return { id: offerId };
  });
}
