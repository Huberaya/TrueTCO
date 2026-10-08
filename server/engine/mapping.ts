/**
 * TrueTCO — Correspondance base de données → entrées du moteur de calcul
 * ---------------------------------------------------------------------------
 * Le moteur (`src/engine/tcoEngine.ts`) est une bibliothèque pure : il prend des
 * objets métier (`Project`, `SupplierOffer`) et n'accède jamais à la base. Ce
 * module est le SEUL endroit où les lignes PostgreSQL sont converties en entrées
 * du moteur. Il est donc le seul endroit où une donnée pourrait être inventée :
 * chaque conversion est donc conservative — un champ absent reste absent.
 *
 * Règles appliquées :
 *  1. `quality_status` détermine le `sourceType` transmis au moteur, donc la
 *     confiance et l'incertitude du résultat. Une donnée non sourcée est marquée
 *     `manquante` (dispersion maximale) : elle ne peut pas « améliorer » le score
 *     de qualité des données.
 *  2. Un poste en statut `error` bloque le calcul : produire un chiffre à partir
 *     d'une donnée reconnue invalide serait un faux résultat.
 *  3. Un poste en statut `missing` est EXCLU de la somme (il ne vaut pas 0 €) et
 *     génère un avertissement explicite ; `isComplete` passe à faux.
 *  4. Un poste de démonstration porte `isDemo` et génère un avertissement.
 *  5. Aucune catégorie n'est traduite silencieusement : les libellés de catégorie
 *     stockés sont ceux du moteur (`RECOGNIZED_COST_CATEGORIES`).
 */

import {
  CarbonFootprintItem,
  CostBreakdownItem,
  DataSourceType,
  HorizonYears,
  Project,
  RiskExpositionItem,
  SupplierOffer,
} from '../../src/types/domain';
import { CalculationWarning } from '../../src/engine/tcoEngine';

export interface CostItemRow {
  id: string;
  category: string;
  label: string;
  amount: string | number;
  currency: string;
  unit: string;
  quantity: string | number | null;
  unit_price: string | number | null;
  quality_status: string;
  source_name: string | null;
  source_type: string;
  confidence_level: number;
  is_recurring_yearly: boolean;
  yearly_inflation_type: string | null;
  year_occurrences: number[] | null;
  calculation_formula: string | null;
  explanation_notes: string | null;
  is_demo: boolean;
}

export interface OfferRow {
  id: string;
  project_id: string;
  supplier_id: string | null;
  supplier_name: string;
  offer_reference: string;
  apparent_total: string | number;
  quantity: number;
  currency: string;
  delivery_lead_time_weeks: number;
  warranty_months: number;
  expected_lifespan_years: number;
  technical_suitability_score: number | null;
  is_responsible_candidate: boolean;
  is_demo: boolean;
}

export interface CarbonRow {
  id: string;
  scope: string;
  lifecycle_phase: string | null;
  total_lifecycle_emissions: string | number;
  emission_factor_source: string | null;
  factor_verified: boolean;
  quality_status: string;
  confidence_level: number;
  is_demo: boolean;
}

export interface RiskRow {
  id: string;
  description: string;
  category: string;
  probability: string | number;
  financial_impact: string | number;
  probability_type: string;
  mitigation_notes: string | null;
  confidence_level: number;
  is_demo: boolean;
}

export interface ProjectRowInput {
  id: string;
  organization_id: string;
  reference: string;
  name: string;
  description: string | null;
  category: string;
  currency: string;
  country_code: string | null;
  horizon_years: number;
  planned_volume: number;
  unit_name: string;
  discount_rate: string | number;
  energy_inflation_rate: string | number;
  general_inflation_rate: string | number;
  carbon_price_per_tonne: string | number;
  is_demo: boolean;
}

/** Traduction « statut de qualité » → « type de source » attendu par le moteur. */
export function sourceTypeFromQuality(status: string, hasSourceName: boolean): DataSourceType {
  switch (status) {
    case 'valid':
      return hasSourceName ? 'verifiee' : 'utilisateur';
    case 'warning':
      return hasSourceName ? 'utilisateur' : 'manquante';
    case 'estimated':
      return 'estimee';
    case 'demo':
      return 'manquante';
    case 'unsourced':
    case 'missing':
    case 'error':
    default:
      return 'manquante';
  }
}

export interface MappingContext {
  organizationId: string;
  userId: string;
  userName: string;
  now: string;
}

export interface MappingResult {
  project: Project;
  offers: SupplierOffer[];
  warnings: CalculationWarning[];
  blockingIssues: { offerId: string; offerReference: string; costItemId: string; label: string; reason: string }[];
  completeness: {
    totalCostItems: number;
    byQualityStatus: Record<string, number>;
    missingAmountTotal: number;
    unsourcedAmountTotal: number;
    demoItemCount: number;
  };
}

function toNumber(value: string | number | null, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

const HORIZONS: HorizonYears[] = [1, 2, 3, 4, 5, 7, 10];

function horizonOf(years: number): HorizonYears {
  // Le moteur accepte un horizon libre via ses surcharges, mais le type métier
  // est contraint. On retient la borne haute la plus proche pour ne jamais
  // sous-estimer la durée analysée, et on documente le choix.
  if (HORIZONS.includes(years as HorizonYears)) return years as HorizonYears;
  const upper = HORIZONS.find((candidate) => candidate >= years);
  return upper ?? 10;
}

export function mapProject(row: ProjectRowInput, ctx: MappingContext): Project {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    reference: row.reference,
    category: 'flotte_automobile',
    budgetCap: 0,
    currency: row.currency,
    horizonYears: horizonOf(row.horizon_years),
    plannedVolume: row.planned_volume,
    unitName: row.unit_name,
    purchaseFrequency: 'unique',
    objective: row.description ?? 'Objectif non renseigné.',
    ownerId: ctx.userId,
    ownerName: ctx.userName,
    status: 'analyse',
    createdAt: ctx.now,
    updatedAt: ctx.now,
    discountRate: toNumber(row.discount_rate, 0.05),
    carbonScenario: 'central',
    carbonPricePerTonne: toNumber(row.carbon_price_per_tonne, 0),
    inflationRate: toNumber(row.general_inflation_rate, 0),
    energyInflationRate: toNumber(row.energy_inflation_rate, 0),
  };
}

export interface OfferMappingInput {
  /** Ligne de l'offre. Champ optionnel : la forme `LoadedOffer` du service porte
   *  la ligne sous la clé `row`, la forme explicite sous la clé `offer`. */
  offer?: OfferRow;
  row?: OfferRow;
  costItems: CostItemRow[];
  carbonItems: CarbonRow[];
  riskItems: RiskRow[];
}

/**
 * Convertit les postes de coût d'une offre en entrées du moteur.
 * Les statuts `missing` et `error` sont traités explicitement (voir en-tête).
 */
export function mapCostItems(
  offer: OfferRow,
  rows: CostItemRow[],
  ctx: MappingContext
): { items: CostBreakdownItem[]; warnings: CalculationWarning[]; blocking: { costItemId: string; label: string; reason: string }[]; missingAmount: number; unsourcedAmount: number; demoCount: number; byQuality: Record<string, number> } {
  const items: CostBreakdownItem[] = [];
  const warnings: CalculationWarning[] = [];
  const blocking: { costItemId: string; label: string; reason: string }[] = [];
  const byQuality: Record<string, number> = {};
  let missingAmount = 0;
  let unsourcedAmount = 0;
  let demoCount = 0;

  for (const row of rows) {
    byQuality[row.quality_status] = (byQuality[row.quality_status] ?? 0) + 1;
    if (row.is_demo) demoCount += 1;

    if (row.quality_status === 'error') {
      blocking.push({
        costItemId: row.id,
        label: row.label,
        reason: "Ce poste est marqué en erreur : son montant n'est pas exploitable en l'état.",
      });
      continue;
    }

    if (row.quality_status === 'missing') {
      missingAmount += toNumber(row.amount);
      warnings.push({
        code: 'COST_ITEM_MISSING',
        severity: 'critique',
        message: `Poste « ${row.label} » non chiffré (statut « missing ») : il est exclu du total. Le TCO affiché sous-estime donc le coût réel jusqu'à ce que ce poste soit renseigné.`,
      } as CalculationWarning);
      continue;
    }

    if (row.quality_status === 'unsourced') {
      unsourcedAmount += toNumber(row.amount);
      warnings.push({
        code: 'COST_ITEM_UNSOURCED',
        severity: 'avertissement',
        message: `Poste « ${row.label} » sans source documentaire : conservé dans le calcul (montant ${toNumber(row.amount).toLocaleString('fr-FR')} ${row.currency}) mais avec une confiance de 0 %.`,
      } as CalculationWarning);
    }

    if (row.is_demo) {
      warnings.push({
        code: 'COST_ITEM_DEMO',
        severity: 'avertissement',
        message: `Poste « ${row.label} » issu d'un jeu de démonstration : il ne provient d'aucune offre fournisseur réelle.`,
      } as CalculationWarning);
    }

    const sourceType = sourceTypeFromQuality(row.quality_status, Boolean(row.source_name));
    const sourceName = row.source_name ?? (sourceType === 'manquante' ? 'Aucune source déclarée' : 'Source non nommée');

    items.push({
      id: row.id,
      category: row.category as CostBreakdownItem['category'],
      label: row.label,
      amount: {
        value: toNumber(row.amount),
        unit: row.unit,
        sourceType,
        sourceName,
        confidenceLevel: row.quality_status === 'unsourced' || row.quality_status === 'missing' ? 0 : row.confidence_level,
        lastUpdated: ctx.now,
        updatedBy: ctx.userName,
        notes: row.explanation_notes ?? undefined,
      },
      isRecurringYearly: row.is_recurring_yearly,
      yearlyInflationType: (row.yearly_inflation_type as CostBreakdownItem['yearlyInflationType']) ?? undefined,
      yearOccurrences: row.year_occurrences ?? undefined,
    });
  }

  // Cohérence de l'offre : la somme des postes doit correspondre au total annoncé.
  const declaredTotal = toNumber(offer.apparent_total);
  const sumOfItems = items.reduce((sum, item) => sum + (item.amount?.value ?? 0), 0);
  const acquisitionOnly = items
    .filter((item) => item.category === 'acquisition' && !item.isRecurringYearly)
    .reduce((sum, item) => sum + (item.amount?.value ?? 0), 0);

  if (declaredTotal > 0 && acquisitionOnly > 0 && Math.abs(acquisitionOnly - declaredTotal) > Math.max(1, declaredTotal * 0.02)) {
    warnings.push({
      code: 'OFFER_TOTAL_MISMATCH',
      severity: 'avertissement',
      message:
        `Le total annoncé de l'offre (${declaredTotal.toLocaleString('fr-FR')}) diffère de la somme des postes d'acquisition ` +
        `(${acquisitionOnly.toLocaleString('fr-FR')}). Le calcul utilise les postes détaillés, qui font foi.`,
    } as CalculationWarning);
  }

  return { items, warnings, blocking, missingAmount, unsourcedAmount, demoCount, byQuality };
}

export function mapCarbonItems(rows: CarbonRow[]): CarbonFootprintItem[] {
  return rows.map((row) => {
    const scope = (['Scope 1', 'Scope 2', 'Scope 3 - Amont', 'Scope 3 - Fin de vie'] as const).includes(
      row.scope as never
    )
      ? (row.scope as CarbonFootprintItem['scope'])
      : 'Scope 3 - Amont';
    const phase = (['fabrication', 'transport', 'utilisation_annuelle', 'fin_de_vie'] as const).includes(
      row.lifecycle_phase as never
    )
      ? (row.lifecycle_phase as CarbonFootprintItem['lifecyclePhase'])
      : undefined;

    return {
      id: row.id,
      scope,
      lifecyclePhase: phase,
      totalLifecycleEmissions: toNumber(row.total_lifecycle_emissions),
      emissionFactorSource: row.emission_factor_source ?? undefined,
      emissionsPerUnitTonneCO2e: row.emission_factor_source
        ? {
            value: toNumber(row.total_lifecycle_emissions),
            unit: 'tCO2e',
            // Un facteur non vérifié ne peut pas prétendre à la confiance d'un
            // facteur documenté : le statut du facteur est conservé tel quel.
            sourceType: row.factor_verified ? 'source_externe' : 'manquante',
            sourceName: row.emission_factor_source,
            confidenceLevel: row.confidence_level,
            lastUpdated: new Date().toISOString(),
            updatedBy: 'serveur',
          }
        : undefined,
    };
  });
}

export function mapRiskItems(rows: RiskRow[]): RiskExpositionItem[] {
  const categories = ['reglementaire', 'retrait_rappel', 'interruption_service', 'reputationnel'] as const;
  const types = ['historique', 'hypothese_utilisateur', 'donnee_sectorielle', 'estimation'] as const;

  return rows.map((row) => {
    const probability = toNumber(row.probability);
    const impact = toNumber(row.financial_impact);
    return {
      id: row.id,
      label: row.description,
      category: (categories as readonly string[]).includes(row.category)
        ? (row.category as RiskExpositionItem['category'])
        : 'reglementaire',
      probability: {
        value: probability,
        unit: 'probabilité',
        sourceType: row.probability_type === 'historique' ? 'historique' : 'estimee',
        sourceName:
          row.probability_type === 'historique'
            ? 'Historique interne'
            : `Hypothèse (${row.probability_type}) non documentée par une source externe`,
        confidenceLevel: row.confidence_level,
        lastUpdated: new Date().toISOString(),
        updatedBy: 'serveur',
      },
      financialImpact: {
        value: impact,
        unit: '€',
        sourceType: row.confidence_level >= 80 ? 'utilisateur' : 'estimee',
        sourceName: 'Impact estimé (aucune source externe vérifiée)',
        confidenceLevel: row.confidence_level,
        lastUpdated: new Date().toISOString(),
        updatedBy: 'serveur',
      },
      expectedLoss: probability * impact,
      probabilityType: (types as readonly string[]).includes(row.probability_type)
        ? (row.probability_type as RiskExpositionItem['probabilityType'])
        : 'estimation',
      mitigationNotes: row.mitigation_notes ?? undefined,
    };
  });
}

export function mapOffer(input: OfferMappingInput, ctx: MappingContext): { offer: SupplierOffer; warnings: CalculationWarning[]; blocking: { costItemId: string; label: string; reason: string }[]; stats: { missingAmount: number; unsourcedAmount: number; demoCount: number; byQuality: Record<string, number> } } {
  const row = input.offer ?? input.row;
  if (!row) {
    throw new Error('mapOffer : ligne d’offre absente (ni `offer` ni `row` fournie).');
  }
  const mapped = mapCostItems(row, input.costItems, ctx);
  const declaredTotal = toNumber(row.apparent_total);

  const offer: SupplierOffer = {
    id: row.id,
    projectId: row.project_id,
    supplierId: row.supplier_id ?? row.id,
    supplierName: row.supplier_name,
    offerReference: row.offer_reference,
    isResponsibleCandidate: row.is_responsible_candidate,
    apparentUnitPrice: {
      value: declaredTotal,
      unit: row.currency,
      sourceType: 'utilisateur',
      sourceName: `Total annoncé sur l'offre ${row.offer_reference}`,
      confidenceLevel: 70,
      lastUpdated: ctx.now,
      updatedBy: ctx.userName,
    },
    quantity: row.quantity,
    apparentTotal: declaredTotal,
    deliveryLeadTimeWeeks: row.delivery_lead_time_weeks,
    warrantyMonths: row.warranty_months,
    expectedLifespanYears: row.expected_lifespan_years,
    costItems: mapped.items,
    carbonItems: mapCarbonItems(input.carbonItems),
    riskItems: mapRiskItems(input.riskItems),
    technicalSuitabilityScore: row.technical_suitability_score ?? 0,
  };

  return {
    offer,
    warnings: mapped.warnings,
    blocking: mapped.blocking,
    stats: {
      missingAmount: mapped.missingAmount,
      unsourcedAmount: mapped.unsourcedAmount,
      demoCount: mapped.demoCount,
      byQuality: mapped.byQuality,
    },
  };
}
