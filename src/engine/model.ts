/**
 * TrueTCO — cœur de calcul (v2). Fonctions pures, sans dépendance à l'interface, aucune mutation des entrées.
 *
 * PRINCIPE : une SEULE source de vérité — la matrice de flux annuels par composante (années 0..N).
 * Tous les totaux (TCO nominal, coût complet actualisé, point mort, sensibilité, scénarios) en dérivent.
 * Spécification complète : docs/METHODOLOGIE-TCO.md
 */
import type { CostBreakdownItem, Project, SupplierOffer } from '../types/domain';

// ───────────────────────────── Hypothèses du modèle (visibles, modifiables, tracées) ─────────────────────────────

export interface ModelAssumptions {
  /** Vieillissement de la maintenance : +x par an (linéaire, à partir de l'année 2). */
  maintenanceWearRate: number;
  /** Année (exclue) à partir de laquelle le coût des remplacements/pannes augmente. */
  failureAgingStartYear: number;
  /** Augmentation annuelle du coût des remplacements/pannes après `failureAgingStartYear`. */
  failureAgingRate: number;
  /** Évolution annuelle du prix du carbone (0 = prix constant). */
  carbonPriceGrowthRate: number;
}

/**
 * Valeurs par défaut du MODÈLE : conventions de modélisation NON SOURCÉES (reprises de la v1 pour la continuité),
 * à confirmer ou remplacer par projet. Elles sont affichées dans l'interface et dans les rapports.
 */
export const DEFAULT_ASSUMPTIONS: Readonly<ModelAssumptions> = Object.freeze({
  maintenanceWearRate: 0.03,
  failureAgingStartYear: 3,
  failureAgingRate: 0.08,
  carbonPriceGrowthRate: 0,
});

export interface Overrides {
  discountRate?: number;
  carbonPricePerTonne?: number;
  inflationRate?: number;
  energyInflationRate?: number;
  /** Multiplie le coût des remplacements / pannes. */
  failureRateMultiplier?: number;
  /** Multiplie le NIVEAU de prix des postes énergie (≠ inflation de l'énergie). */
  energyCostMultiplier?: number;
  maintenanceCostMultiplier?: number;
  purchasePriceMultiplier?: number;
  residualValueMultiplier?: number;
  riskMultiplier?: number;
  emissionsMultiplier?: number;
  assumptions?: Partial<ModelAssumptions>;
}

// ───────────────────────────── Avertissements ─────────────────────────────

export type WarningCode =
  | 'MISSING_PROJECT_PARAMETER'
  | 'NO_COST_ITEMS'
  | 'ACQUISITION_FROM_QUOTE'
  | 'QUANTITY_FROM_PROJECT'
  | 'TOTAL_MISMATCH'
  | 'UNIT_RECURRENCE_MISMATCH'
  | 'TIMING_UNSPECIFIED'
  | 'IGNORED_CATEGORY'
  | 'NEGATIVE_AMOUNT'
  | 'CARBON_PHASE_MISSING'
  | 'CARBON_TOTAL_MISMATCH'
  | 'RISK_PROBABILITY_CLAMPED'
  | 'LIFESPAN_SHORTER_THAN_HORIZON'
  | 'CONFIDENCE_MISSING';

export interface EngineWarning {
  code: WarningCode;
  message: string;
  itemId?: string;
}

// ───────────────────────────── Types internes ─────────────────────────────

export const COMPONENTS = [
  'acquisition', 'logistics', 'installation', 'energy', 'maintenance', 'replacement', 'admin', 'endOfLife', 'salvage', 'risk', 'carbon',
] as const;
export type Component = (typeof COMPONENTS)[number];
/** Composantes du TCO « économique » (hors risque et hors carbone). La valeur résiduelle est un CRÉDIT. */
export const DIRECT_COMPONENTS: readonly Component[] = ['acquisition', 'logistics', 'installation', 'energy', 'maintenance', 'replacement', 'admin', 'endOfLife', 'salvage'];

export interface Params {
  horizon: number;
  discountRate: number;
  carbonPrice: number;
  inflation: number;
  energyInflation: number;
  failureMultiplier: number;
  energyCostMultiplier: number;
  maintenanceCostMultiplier: number;
  purchasePriceMultiplier: number;
  residualValueMultiplier: number;
  riskMultiplier: number;
  emissionsMultiplier: number;
  assumptions: ModelAssumptions;
}

/** Matrice de flux : `flows[composante][t]` pour t = 0..N. `salvage` est stocké en NÉGATIF (crédit). */
export interface FlowMatrix {
  horizon: number;
  flows: Record<Component, number[]>;
  tonnesByYear: number[];
  warnings: EngineWarning[];
  quantity: number;
  apparentDirectCost: number;
}

// ───────────────────────────── Utilitaires ─────────────────────────────

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export const sum = (a: readonly number[]): number => a.reduce((s, x) => s + x, 0);
export const zeros = (n: number): number[] => new Array<number>(n).fill(0);

/** Facteur d'actualisation, convention fin d'année : 1/(1+r)^t. Le cas r = 0 est exact (facteur 1). */
export const discountFactor = (rate: number, t: number): number => (rate === 0 ? 1 : 1 / Math.pow(1 + rate, t));
export const npv = (series: readonly number[], rate: number): number => series.reduce((s, x, t) => s + x * discountFactor(rate, t), 0);

export function resolveParams(project: Project, overrides: Overrides = {}, warnings: EngineWarning[] = []): Params {
  const need = (name: string, v: unknown, override: number | undefined, fallback: number): number => {
    if (finite(override)) return override;
    if (finite(v)) return v;
    warnings.push({ code: 'MISSING_PROJECT_PARAMETER', message: `Paramètre de projet « ${name} » absent ou invalide : valeur ${fallback} utilisée par défaut.` });
    return fallback;
  };
  const rawHorizon = project?.horizonYears;
  const horizon = finite(rawHorizon) && rawHorizon >= 1 ? Math.round(rawHorizon) : 5;
  if (!(finite(rawHorizon) && rawHorizon >= 1)) warnings.push({ code: 'MISSING_PROJECT_PARAMETER', message: "Horizon d'analyse absent ou invalide : 5 ans utilisés par défaut." });
  return {
    horizon,
    discountRate: need("taux d'actualisation", project?.discountRate, overrides.discountRate, 0),
    carbonPrice: need('prix du carbone', project?.carbonPricePerTonne, overrides.carbonPricePerTonne, 0),
    inflation: need("inflation", project?.inflationRate, overrides.inflationRate, 0),
    energyInflation: need("inflation de l'énergie", project?.energyInflationRate, overrides.energyInflationRate, 0),
    failureMultiplier: overrides.failureRateMultiplier ?? 1,
    energyCostMultiplier: overrides.energyCostMultiplier ?? 1,
    maintenanceCostMultiplier: overrides.maintenanceCostMultiplier ?? 1,
    purchasePriceMultiplier: overrides.purchasePriceMultiplier ?? 1,
    residualValueMultiplier: overrides.residualValueMultiplier ?? 1,
    riskMultiplier: overrides.riskMultiplier ?? 1,
    emissionsMultiplier: overrides.emissionsMultiplier ?? 1,
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...(project?.modelAssumptions ?? {}), ...(overrides.assumptions ?? {}) },
  };
}

// ───────────────────────────── Construction des flux ─────────────────────────────

/**
 * Convention de prix : les montants saisis sont exprimés en prix de l'ANNÉE 1 ; un poste récurrent de l'année y
 * est multiplié par (1+i)^(y−1). Les postes ponctuels de l'année 0 ne sont pas indexés. La valeur résiduelle et le
 * coût de fin de vie sont pris tels que saisis, à l'échéance.
 */
export function buildFlows(project: Project, offer: SupplierOffer, params: Params, initialWarnings: EngineWarning[] = []): FlowMatrix {
  const N = params.horizon;
  const warnings: EngineWarning[] = [...initialWarnings];
  const flows = Object.fromEntries(COMPONENTS.map((c) => [c, zeros(N + 1)])) as Record<Component, number[]>;
  const tonnesByYear = zeros(N + 1);

  const rawQty = offer.quantity;
  let quantity = finite(rawQty) && rawQty > 0 ? rawQty : 0;
  if (quantity === 0) {
    quantity = finite(project?.plannedVolume) && project.plannedVolume > 0 ? project.plannedVolume : 1;
    warnings.push({ code: 'QUANTITY_FROM_PROJECT', message: `Quantité de l'offre absente : volume prévu du projet (${quantity}) utilisé.` });
  }
  const unitPrice = offer.apparentUnitPrice?.value ?? (offer.apparentTotal ? offer.apparentTotal / quantity : 0);
  const apparentDirectCost = (finite(unitPrice) ? unitPrice : 0) * quantity;

  const items: readonly CostBreakdownItem[] = offer.costItems ?? [];
  if (items.length === 0) warnings.push({ code: 'NO_COST_ITEMS', message: "L'offre ne contient aucun poste de coût détaillé." });

  const add = (c: Component, t: number, v: number) => { if (t >= 0 && t <= N) flows[c][t] += v; };
  // `fallback` est PARESSEUX : l'avertissement « date non précisée » ne doit être émis que si aucune année n'est fournie.
  const yearsOf = (item: CostBreakdownItem, fallback: () => number[]): number[] => {
    const occ = (item.yearOccurrences ?? []).filter((y) => Number.isInteger(y) && y >= 0 && y <= N);
    return occ.length > 0 ? occ : fallback();
  };
  const allYears = Array.from({ length: N }, (_, k) => k + 1);

  for (const item of items) {
    const raw = item.amount?.value;
    if (!finite(raw)) { warnings.push({ code: 'NEGATIVE_AMOUNT', itemId: item.id, message: `Poste « ${item.label} » : montant non numérique ignoré.` }); continue; }

    // Cohérence unité / récurrence : on SIGNALE, on ne convertit jamais silencieusement.
    const unit = item.amount.unit ?? '';
    const perYearUnit = /\/\s*an\b|par an|annuel/i.test(unit);
    if (perYearUnit && !item.isRecurringYearly) {
      warnings.push({ code: 'UNIT_RECURRENCE_MISMATCH', itemId: item.id, message: `Poste « ${item.label} » : unité « ${unit} » (annuelle) mais poste non récurrent — compté UNE seule fois.` });
    }
    if (!perYearUnit && item.isRecurringYearly && /€\s*$/.test(unit.trim())) {
      warnings.push({ code: 'UNIT_RECURRENCE_MISMATCH', itemId: item.id, message: `Poste « ${item.label} » : récurrent mais unité « ${unit} » sans « /an » — compté chaque année.` });
    }
    if (raw < 0 && item.category !== 'valeur_residuelle') {
      warnings.push({ code: 'NEGATIVE_AMOUNT', itemId: item.id, message: `Poste « ${item.label} » : montant négatif (crédit) pris en compte tel quel.` });
    }

    const recurring = !!item.isRecurringYearly;
    switch (item.category) {
      case 'acquisition':
      case 'logistique_douanes':
      case 'installation_mise_en_service': {
        const comp: Component = item.category === 'acquisition' ? 'acquisition' : item.category === 'logistique_douanes' ? 'logistics' : 'installation';
        const mult = item.category === 'acquisition' ? params.purchasePriceMultiplier : 1;
        for (const t of recurring ? allYears : yearsOf(item, () => [0])) add(comp, t, raw * mult * (t > 1 ? Math.pow(1 + params.inflation, t - 1) : 1));
        break;
      }
      case 'energie_consommables': {
        for (const t of yearsOf(item, () => (recurring ? allYears : [unspecified(item, warnings)]))) add('energy', t, raw * params.energyCostMultiplier * Math.pow(1 + params.energyInflation, Math.max(0, t - 1)));
        break;
      }
      case 'maintenance_reparations': {
        for (const t of yearsOf(item, () => (recurring ? allYears : [unspecified(item, warnings)]))) {
          const wear = 1 + Math.max(0, t - 1) * params.assumptions.maintenanceWearRate;
          add('maintenance', t, raw * params.maintenanceCostMultiplier * Math.pow(1 + params.inflation, Math.max(0, t - 1)) * wear);
        }
        break;
      }
      case 'remplacement_pannes': {
        for (const t of yearsOf(item, () => (recurring ? allYears : [unspecified(item, warnings)]))) {
          const aging = 1 + Math.max(0, t - params.assumptions.failureAgingStartYear) * params.assumptions.failureAgingRate;
          add('replacement', t, raw * params.failureMultiplier * Math.pow(1 + params.inflation, Math.max(0, t - 1)) * aging);
        }
        break;
      }
      case 'couts_administratifs_conformite': {
        for (const t of yearsOf(item, () => (recurring ? allYears : [0]))) add('admin', t, raw * Math.pow(1 + params.inflation, Math.max(0, t - 1)));
        break;
      }
      case 'fin_de_vie_recyclage':
        add('endOfLife', N, raw);
        break;
      case 'valeur_residuelle':
        // Crédit perçu à l'échéance ; le signe saisi (négatif par convention ou positif) est neutralisé : c'est toujours un gain.
        add('salvage', N, -Math.abs(raw) * params.residualValueMultiplier);
        break;
      default:
        // `risques_operationnels` et `externalite_carbone` sont modélisés par les listes de risques et de carbone :
        // un poste de coût de ces catégories serait un DOUBLE COMPTAGE potentiel → ignoré et signalé.
        warnings.push({ code: 'IGNORED_CATEGORY', itemId: item.id, message: `Poste « ${item.label} » (catégorie « ${item.category} ») ignoré : cette dimension est calculée via les listes de risques et de carbone (évite un double comptage).` });
    }
  }

  if (sum(flows.acquisition) === 0 && apparentDirectCost > 0) {
    flows.acquisition[0] += apparentDirectCost * params.purchasePriceMultiplier;
    warnings.push({ code: 'ACQUISITION_FROM_QUOTE', message: "Aucun poste « acquisition » : le prix du devis (prix unitaire × quantité) est utilisé." });
  } else if (apparentDirectCost > 0 && finite(offer.apparentTotal) && Math.abs(sum(flows.acquisition) / (params.purchasePriceMultiplier || 1) - offer.apparentTotal) > Math.max(1, offer.apparentTotal * 0.005)) {
    warnings.push({ code: 'TOTAL_MISMATCH', message: `Total du devis (${Math.round(offer.apparentTotal)}) différent du poste d'acquisition (${Math.round(sum(flows.acquisition) / (params.purchasePriceMultiplier || 1))}).` });
  }

  // Risques : espérance de perte = probabilité (sur l'horizon) × impact, répartie uniformément sur les années 1..N.
  for (const r of offer.riskItems ?? []) {
    const p0 = r.probability?.value;
    const impact = r.financialImpact?.value;
    if (!finite(p0) || !finite(impact)) continue;
    const p = Math.min(Math.max(p0, 0), 1);
    if (p !== p0) warnings.push({ code: 'RISK_PROBABILITY_CLAMPED', itemId: r.id, message: `Risque « ${r.label} » : probabilité ${p0} ramenée dans [0 ; 1].` });
    for (const t of allYears) flows.risk[t] += (p * impact * params.riskMultiplier) / N;
  }

  // Carbone : tonnes par année selon la phase, valorisées au prix de l'année (prix₀ × (1+g)^t).
  for (const c of offer.carbonItems ?? []) {
    const perUnit = c.emissionsPerUnitTonneCO2e?.value;
    const perUnitAnnual = /\/\s*an\b/i.test(c.emissionsPerUnitTonneCO2e?.unit ?? '');
    const absolute = c.emissionsTCO2e?.value;
    const derived = finite(absolute) ? absolute : finite(perUnit) ? perUnit * quantity * (perUnitAnnual ? N : 1) : undefined;
    const explicit = finite(c.totalLifecycleEmissions) && c.totalLifecycleEmissions > 0 ? c.totalLifecycleEmissions : undefined;
    if (explicit !== undefined && derived !== undefined && Math.abs(explicit - derived) > Math.max(1e-9, Math.abs(explicit) * 0.01)) {
      warnings.push({ code: 'CARBON_TOTAL_MISMATCH', itemId: c.id, message: `Carbone « ${c.label ?? c.scope} » : total déclaré (${explicit}) ≠ total recalculé (${derived}) — total déclaré utilisé.` });
    }
    const total = (explicit ?? derived ?? 0) * params.emissionsMultiplier;
    if (!c.lifecyclePhase) warnings.push({ code: 'CARBON_PHASE_MISSING', itemId: c.id, message: `Carbone « ${c.label ?? c.scope} » : phase du cycle de vie absente — émissions placées à l'année 0.` });
    const phase = c.lifecyclePhase ?? 'fabrication';
    if (phase === 'utilisation_annuelle') for (const t of allYears) tonnesByYear[t] += total / N;
    else if (phase === 'fin_de_vie') tonnesByYear[N] += total;
    else tonnesByYear[0] += total; // fabrication, transport
  }
  for (let t = 0; t <= N; t++) flows.carbon[t] = tonnesByYear[t] * params.carbonPrice * Math.pow(1 + params.assumptions.carbonPriceGrowthRate, t);

  if (finite(offer.expectedLifespanYears) && offer.expectedLifespanYears > 0 && offer.expectedLifespanYears < N) {
    warnings.push({ code: 'LIFESPAN_SHORTER_THAN_HORIZON', message: `Durée de vie attendue (${offer.expectedLifespanYears} ans) < horizon (${N} ans) : aucun rachat n'est modélisé automatiquement — ajoutez un poste de remplacement daté si nécessaire.` });
  }
  return { horizon: N, flows, tonnesByYear, warnings, quantity, apparentDirectCost };
}

function unspecified(item: CostBreakdownItem, warnings: EngineWarning[]): number {
  warnings.push({ code: 'TIMING_UNSPECIFIED', itemId: item.id, message: `Poste ponctuel « ${item.label} » sans année précisée (yearOccurrences) : placé en année 1.` });
  return 1;
}

// ───────────────────────────── Agrégats ─────────────────────────────

export interface Aggregates {
  totals: Record<Component, number>;
  /** Flux annuels nominaux par ensemble. */
  directByYear: number[];
  fullByYear: number[];
  exCarbonByYear: number[];
  economicTCONominal: number;
  totalComprehensiveTCO: number;
  lcc: number;           // coût complet actualisé (direct + risque + carbone)
  lccDirect: number;     // direct seul
  lccExCarbon: number;   // direct + risque
}

export function aggregate(m: FlowMatrix, discountRate: number): Aggregates {
  const N = m.horizon;
  const totals = Object.fromEntries(COMPONENTS.map((c) => [c, sum(m.flows[c])])) as Record<Component, number>;
  const at = (comps: readonly Component[]) => Array.from({ length: N + 1 }, (_, t) => comps.reduce((s, c) => s + m.flows[c][t], 0));
  const directByYear = at(DIRECT_COMPONENTS);
  const exCarbonByYear = at([...DIRECT_COMPONENTS, 'risk']);
  const fullByYear = at(COMPONENTS);
  return {
    totals, directByYear, fullByYear, exCarbonByYear,
    economicTCONominal: sum(directByYear),
    totalComprehensiveTCO: sum(fullByYear),
    lcc: npv(fullByYear, discountRate),
    lccDirect: npv(directByYear, discountRate),
    lccExCarbon: npv(exCarbonByYear, discountRate),
  };
}

/** Évaluation complète (flux + agrégats) pour un jeu de paramètres. Utilisée par scénarios, sensibilité et simulation. */
export function evaluate(project: Project, offer: SupplierOffer, overrides: Overrides = {}) {
  const warnings: EngineWarning[] = [];
  const params = resolveParams(project, overrides, warnings);
  const matrix = buildFlows(project, offer, params, warnings);
  return { params, matrix, agg: aggregate(matrix, params.discountRate) };
}
