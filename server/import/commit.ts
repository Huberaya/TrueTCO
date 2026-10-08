/**
 * TrueTCO — Exécution de l'import (transaction unique)
 * ---------------------------------------------------------------------------
 * Principes :
 *   - Le serveur RECALCULE la préparation à partir des lignes stockées : le
 *     navigateur ne peut pas envoyer un « résultat d'analyse » qui contournerait
 *     les règles de validation.
 *   - Rien n'est écrit si un blocage subsiste : l'utilisateur voit la liste des
 *     corrections attendues, et rien n'est importé partiellement.
 *   - Tout est écrit dans UNE transaction : offres, postes de coût, émissions,
 *     risques, lot d'import et entrée d'audit. Une erreur au milieu ne laisse
 *     jamais un dossier à moitié importé.
 *   - La provenance est écrite : `data_source = import_xlsx | import_csv`,
 *     `import_batch_id`, et chaque ligne conserve son numéro d'origine
 *     (traçabilité ligne à ligne, exigence d'audit).
 *   - Une offre dont la référence existe déjà sur le dossier n'est JAMAIS
 *     fusionnée ni écrasée : l'import s'arrête et le dit.
 */

import { Executor, Db } from '../db/types';
import { AuthContext } from '../auth/types';
import { actorFromContext, recordAudit } from '../audit';
import { HttpError, badRequest, notFound } from '../http';
import { normalizeCostCategoryInput } from '../repositories/offers';
import { ImportMode, ImportPreview, PreparedOffer, prepareImport } from './model';

const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);

export interface CommitOptions {
  projectId: string;
  documentId: string;
  batchId: string;
  mode: ImportMode;
  mapping: Record<string, string>;
  excludedRows?: number[];
  categoryOverrides?: Record<string, string>;
  offerReferences?: Record<string, string>;
  defaultCurrency: string;
  allowDuplicateContent?: boolean;
  meta: {
    ipAddress?: string | null;
    userAgent?: string | null;
    correlationId?: string | null;
  };
}

export interface CommitResult {
  batchId: string;
  documentId: string;
  mode: ImportMode;
  createdOffers: { id: string; reference: string; supplierName: string; costItemCount: number; total: number }[];
  createdCostItems: number;
  createdCarbonItems: number;
  createdRiskItems: number;
  skippedRows: number[];
  statusCounts: Record<string, number>;
  dataQualityScore: number;
  warnings: string[];
}

/** Contrôle préalable : blocages du modèle + conflits avec l'existant. */
export async function assertCommittable(
  tx: Executor,
  projectId: string,
  preview: ImportPreview
): Promise<{ conflicts: { reference: string; id: string }[] }> {
  if (!preview.canCommit) {
    const detail = preview.blocking.map((entry) => `[${entry.code}] ${entry.message}`).join(' ');
    throw conflict(
      'IMPORT_BLOCKED',
      `L'import est bloqué : ${preview.blocking.length} point(s) doivent être corrigés avant écriture. ${detail}`,
      { blocking: preview.blocking }
    );
  }

  const references = preview.offers
    .map((offer) => offer.reference)
    .filter((reference): reference is string => Boolean(reference));

  if (references.length === 0) {
    throw badRequest('NO_OFFER_TO_IMPORT', "Aucune offre avec référence à importer.");
  }

  const existing = await tx.query<{ id: string; offer_reference: string }>(
    `SELECT id, offer_reference FROM supplier_offers WHERE project_id = $1 AND offer_reference = ANY($2::text[])`,
    [projectId, references]
  );

  if (existing.length > 0) {
    throw conflict(
      'OFFER_REFERENCE_ALREADY_EXISTS',
      `Référence(s) déjà présente(s) sur ce dossier : ${existing
        .map((offer) => `« ${offer.offer_reference} »`)
        .join(', ')}. ` +
        'Aucune fusion automatique n’est effectuée : renommez la référence dans le fichier, ou supprimez l’offre existante si elle est obsolète.',
      { existing: existing.map((offer) => ({ id: offer.id, reference: offer.offer_reference })) }
    );
  }

  return { conflicts: [] };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export async function commitImport(
  db: Db,
  ctx: AuthContext,
  rawRows: string[][],
  sourceInfo: Pick<
    ImportPreview['source'],
    'fileName' | 'mimeType' | 'sizeBytes' | 'sha256' | 'format' | 'sheetName' | 'availableSheets' | 'delimiter' | 'encoding' | 'encodingGuessed'
  >,
  options: CommitOptions
): Promise<CommitResult> {
  // La préparation est RECALCULÉE ici, côté serveur, à partir des lignes
  // stockées : le navigateur ne peut pas décider du résultat de la validation.
  const preview: ImportPreview = prepareImport(rawRows, {
    mode: options.mode,
    fileName: sourceInfo.fileName,
    mimeType: sourceInfo.mimeType,
    sizeBytes: sourceInfo.sizeBytes,
    sha256: sourceInfo.sha256,
    format: sourceInfo.format,
    sheetName: sourceInfo.sheetName,
    availableSheets: sourceInfo.availableSheets,
    delimiter: sourceInfo.delimiter,
    encoding: sourceInfo.encoding,
    encodingGuessed: sourceInfo.encodingGuessed,
    mapping: options.mapping,
    excludedRows: options.excludedRows,
    categoryOverrides: options.categoryOverrides,
    offerReferences: options.offerReferences,
    defaultCurrency: options.defaultCurrency,
  });

  return db.asOrganization(ctx.organization.id, async (tx) => {
    const project = await tx.query<{ id: string; currency: string }>(
      `SELECT id, currency FROM projects WHERE id = $1`,
      [options.projectId]
    );
    if (project.length === 0) throw notFound("Ce dossier est introuvable dans votre organisation.");

    await assertCommittable(tx, options.projectId, preview);

    const createdOffers: CommitResult['createdOffers'] = [];
    let createdCostItems = 0;
    let createdCarbonItems = 0;
    let createdRiskItems = 0;
    const skippedRows: number[] = [];
    const warnings: string[] = [];

    for (const offer of preview.offers) {
      if (!offer.reference) {
        // Ne devrait pas arriver (blocage amont), garde-fou supplémentaire.
        throw badRequest('OFFER_REFERENCE_REQUIRED', "Une offre sans référence ne peut pas être enregistrée.");
      }

      const apparentTotal = offer.rows.reduce((sum, row) => {
        if (row.status === 'ERROR' || row.status === 'MISSING') return sum;
        const amount = numberOrNull(row.values.amount?.value);
        return amount === null ? sum : sum + amount;
      }, 0);

      const [created] = await tx.query<{ id: string }>(
        `INSERT INTO supplier_offers (
            organization_id, project_id, supplier_name, offer_reference, apparent_total,
            quantity, currency, delivery_lead_time_weeks, warranty_months, expected_lifespan_years,
            data_source, import_batch_id, is_demo
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING id`,
        [
          ctx.organization.id,
          options.projectId,
          offer.supplierName ?? offer.reference,
          offer.reference,
          apparentTotal,
          firstNumber(offer, 'quantity') ?? 1,
          offer.currency ?? options.defaultCurrency,
          firstNumber(offer, 'leadTimeWeeks') ?? 0,
          firstNumber(offer, 'warrantyMonths') ?? 0,
          firstNumber(offer, 'lifespanYears') ?? 0,
          preview.source.format === 'xlsx' ? 'import_xlsx' : 'import_csv',
          options.batchId,
          offer.rows.some((row) => row.status === 'DEMO'),
        ]
      );

      let itemCount = 0;
      for (const row of offer.rows) {
        if (row.status === 'ERROR' || row.status === 'MISSING') {
          skippedRows.push(row.rowNumber);
          continue;
        }
        const amount = numberOrNull(row.values.amount?.value);
        if (amount === null) {
          skippedRows.push(row.rowNumber);
          continue;
        }

        // Libellé tel que l'utilisateur l'avait écrit (« opex »), conservé pour
        // pouvoir vérifier qu'aucune catégorie n'a été inventée.
        const declaredCategory =
          textOrNull(row.values.category?.raw) ?? textOrNull(row.values.category?.value) ?? 'autre';
        const normalization = normalizeCostCategoryInput(textOrNull(row.values.category?.value) ?? declaredCategory);
        const category = normalization?.category ?? 'autre';

        const qualityStatus = mapQualityStatus(row.status);
        const sourceName = textOrNull(row.values.sourceName?.value);
        const confidence = numberOrNull(row.values.confidence?.value);
        const declaredConfidence =
          confidence === null ? defaultConfidenceFor(row.status) : Math.max(0, Math.min(100, Math.round(confidence)));

        await tx.query(
          `INSERT INTO cost_items (
              organization_id, offer_id, category, label, amount, currency, quantity, unit_price,
              quality_status, source_name, source_type, confidence_level, is_recurring_yearly,
              yearly_inflation_type, year_occurrences, calculation_formula, explanation_notes, is_demo,
              declared_category, source_row_number, is_imported
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
          [
            ctx.organization.id,
            created.id,
            category,
            textOrNull(row.values.label?.value) ?? `Ligne ${row.rowNumber} du fichier importé`,
            amount,
            (textOrNull(row.values.currency?.value) ?? offer.currency ?? options.defaultCurrency).slice(0, 3).toUpperCase(),
            numberOrNull(row.values.quantity?.value),
            numberOrNull(row.values.unitPrice?.value),
            qualityStatus,
            sourceName,
            sourceTypeFor(row.status, sourceName),
            declaredConfidence,
            row.values.recurring?.value === true,
            inflationTypeOf(row.values.inflationType?.value),
            parseYearOccurrences(row.values.yearOccurrences?.value),
            textOrNull(row.values.notes?.value),
            `Importé du fichier « ${preview.source.fileName} », ligne ${row.rowNumber} (empreinte du fichier : ${preview.source.sha256.slice(0, 12)}…).`,
            row.status === 'DEMO',
            declaredCategory,
            // Traçabilité : la ligne exacte du fichier d'origine d'où vient ce montant.
            row.rowNumber,
            true,
          ]
        );
        itemCount += 1;
        createdCostItems += 1;
      }

      createdOffers.push({
        id: created.id,
        reference: offer.reference,
        supplierName: offer.supplierName ?? offer.reference,
        costItemCount: itemCount,
        total: apparentTotal,
      });

      if (options.mode === 'carbon' || offersHasCarbon(offer)) {
        createdCarbonItems += await insertCarbonItems(tx, ctx.organization.id, created.id, offer, preview.source.fileName);
      }
      if (options.mode === 'risks' || offerHasRisks(offer)) {
        createdRiskItems += await insertRiskItems(tx, ctx.organization.id, created.id, offer);
      }

      warnings.push(...offer.warnings.map((warning) => `${offer.reference} : ${warning}`));
    }

    await tx.query(
      `UPDATE import_batches
          SET status = 'committed',
              column_mapping = $2,
              row_count = $3,
              imported_offers = $4,
              error_count = $5,
              committed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [
        options.batchId,
        JSON.stringify(options.mapping),
        preview.summary.totalRows,
        createdOffers.length,
        preview.summary.statusCounts.ERROR,
      ]
    );

    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'import.committed',
      entityType: 'import_batch',
      entityId: options.batchId,
      projectId: options.projectId,
      newValue: JSON.stringify({
        mode: options.mode,
        documentId: options.documentId,
        fileName: preview.source.fileName,
        sha256: preview.source.sha256,
        offers: createdOffers,
        createdCostItems,
        createdCarbonItems,
        createdRiskItems,
        skippedRows,
        dataQualityScore: preview.dataQuality.score,
        statusCounts: preview.summary.statusCounts,
      }),
      ...options.meta,
    });

    return {
      batchId: options.batchId,
      documentId: options.documentId,
      mode: options.mode,
      createdOffers,
      createdCostItems,
      createdCarbonItems,
      createdRiskItems,
      skippedRows,
      statusCounts: preview.summary.statusCounts,
      dataQualityScore: preview.dataQuality.score,
      warnings,
    };
  });
}

function firstNumber(offer: PreparedOffer, fieldKey: string): number | null {
  for (const row of offer.rows) {
    const value = numberOrNull(row.values[fieldKey]?.value);
    if (value !== null) return value;
  }
  return null;
}

function offersHasCarbon(offer: PreparedOffer): boolean {
  return offer.rows.some((row) => numberOrNull(row.values.carbonTonnes?.value) !== null);
}

function offerHasRisks(offer: PreparedOffer): boolean {
  return offer.rows.some(
    (row) => numberOrNull(row.values.riskImpact?.value) !== null && numberOrNull(row.values.riskProbability?.value) !== null
  );
}

/** Traduction d'un statut de ligne vers le statut de qualité stocké (vocabulaire unique). */
export function mapQualityStatus(status: ImportPreview['rows'][number]['status']): string {
  switch (status) {
    case 'VALID':
      return 'valid';
    case 'WARNING':
      return 'warning';
    case 'ERROR':
      return 'error';
    case 'MISSING':
      return 'missing';
    case 'UNSOURCED':
      return 'unsourced';
    case 'ESTIMATED':
      return 'estimated';
    case 'DEMO':
      return 'demo';
    default:
      return 'unsourced';
  }
}

function sourceTypeFor(status: string, sourceName: string | null): string {
  if (!sourceName) return 'manquante';
  if (status === 'DEMO') return 'demo';
  if (status === 'ESTIMATED') return 'estimee';
  return 'utilisateur';
}

/** Confiance par défaut, DÉRIVÉE du statut, jamais arbitraire et jamais affichée comme vérifiée. */
export function defaultConfidenceFor(status: string): number {
  switch (status) {
    case 'VALID':
      return 70;
    case 'WARNING':
      return 50;
    case 'ESTIMATED':
      return 30;
    case 'DEMO':
      return 10;
    case 'UNSOURCED':
    case 'MISSING':
    case 'ERROR':
    default:
      return 0;
  }
}

function inflationTypeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const token = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (['energy', 'energie', 'energie (indexation energie)'].includes(token)) return 'energy';
  if (['general', 'generale', 'inflation generale', 'indexation generale'].includes(token)) return 'general';
  if (['none', 'aucune', 'aucun', 'non', 'fixe'].includes(token)) return 'none';
  return null;
}

function parseYearOccurrences(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    const years = raw.filter((value): value is number => typeof value === 'number' && Number.isInteger(value));
    return years.length > 0 ? years : null;
  }
  if (typeof raw !== 'string') return null;
  const years = raw
    .split(/[,;/|]/)
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  return years.length > 0 ? years : null;
}

async function insertCarbonItems(
  tx: Executor,
  organizationId: string,
  offerId: string,
  offer: PreparedOffer,
  fileName: string
): Promise<number> {
  let count = 0;
  for (const row of offer.rows) {
    if (row.status === 'ERROR' || row.status === 'MISSING') continue;
    const tonnes = numberOrNull(row.values.carbonTonnes?.value);
    if (tonnes === null) continue;

    const factorSource = textOrNull(row.values.carbonFactorSource?.value);
    await tx.query(
      `INSERT INTO carbon_items (
          organization_id, offer_id, scope, lifecycle_phase, total_lifecycle_emissions,
          emission_factor_source, factor_verified, quality_status, confidence_level, is_demo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        organizationId,
        offerId,
        textOrNull(row.values.carbonScope?.value) ?? 'non déclaré',
        textOrNull(row.values.carbonLifecyclePhase?.value) ?? 'non déclarée',
        tonnes,
        factorSource,
        // Un facteur n'est JAMAIS marqué vérifié sans référence à une source : la
        // vérification viendra de la bibliothèque de facteurs versionnée.
        false,
        mapQualityStatus(row.status),
        defaultConfidenceFor(row.status),
        row.status === 'DEMO',
      ]
    );
    count += 1;
  }
  return count;
}

async function insertRiskItems(
  tx: Executor,
  organizationId: string,
  offerId: string,
  offer: PreparedOffer
): Promise<number> {
  let count = 0;
  for (const row of offer.rows) {
    if (row.status === 'ERROR' || row.status === 'MISSING') continue;
    const impact = numberOrNull(row.values.riskImpact?.value);
    const probability = numberOrNull(row.values.riskProbability?.value);
    if (impact === null || probability === null) continue;

    const probabilityFraction = probability > 1 ? probability / 100 : probability;
    if (!(probabilityFraction >= 0 && probabilityFraction <= 1)) continue;

    await tx.query(
      `INSERT INTO risk_items (
          organization_id, offer_id, description, category, probability, financial_impact,
          probability_type, mitigation_notes, confidence_level, is_demo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        organizationId,
        offerId,
        textOrNull(row.values.riskDescription?.value) ?? textOrNull(row.values.label?.value) ?? `Risque ligne ${row.rowNumber}`,
        textOrNull(row.values.riskCategory?.value),
        probabilityFraction,
        impact,
        'expert_judgement',
        textOrNull(row.values.notes?.value),
        defaultConfidenceFor(row.status),
        row.status === 'DEMO',
      ]
    );
    count += 1;
  }
  return count;
}
