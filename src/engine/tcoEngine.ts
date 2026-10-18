/**
 * TrueTCO — moteur de calcul TCO / LCC, carbone et risques (façade).
 * Couche de calcul indépendante de l'interface. Spécification : docs/METHODOLOGIE-TCO.md
 */
import type { BreakEvenAnalysis, Project, ScenarioResult, SensitivityDriver, SupplierOffer, TCOCalculationResult, YearCashFlow } from '../types/domain';
import * as analysis from './analysis';
import { COMPONENTS, DIRECT_COMPONENTS, type EngineWarning, type Overrides, discountFactor, evaluate, sum } from './model';

export { DEFAULT_ASSUMPTIONS } from './model';
export { SENSITIVITY_RANGES, DEFAULT_SCENARIO_SHOCKS, scenarioParameters } from './analysis';
export type { RobustnessResult } from './analysis';
export type { Overrides } from './model';

const r0 = (x: number) => Math.round(x);

/** Score de qualité des données : moyenne des niveaux de confiance PONDÉRÉE par le poids financier de chaque donnée. */
function dataQuality(offer: SupplierOffer, weightsOf: { cost: (id: string) => number; carbon: number; risk: (i: number) => number }, warnings: EngineWarning[]): number {
  let wSum = 0, cSum = 0, n = 0, plain = 0, missing = false;
  const take = (conf: number | undefined, w: number) => {
    if (typeof conf !== 'number' || !Number.isFinite(conf)) { missing = true; conf = 0; }
    n++; plain += conf; wSum += w; cSum += conf * w;
  };
  for (const ci of offer.costItems ?? []) take(ci.amount?.confidenceLevel, Math.abs(weightsOf.cost(ci.id)));
  for (const c of offer.carbonItems ?? []) take(c.emissionsPerUnitTonneCO2e?.confidenceLevel, weightsOf.carbon / Math.max(1, (offer.carbonItems ?? []).length));
  (offer.riskItems ?? []).forEach((r, i) => { take(r.probability?.confidenceLevel, Math.abs(weightsOf.risk(i))); take(r.financialImpact?.confidenceLevel, Math.abs(weightsOf.risk(i))); });
  if (missing) warnings.push({ code: 'CONFIDENCE_MISSING', message: 'Au moins une donnée sans niveau de confiance : comptée à 0.' });
  if (n === 0) return 0;
  return Math.round(wSum > 0 ? cSum / wSum : plain / n);
}

export class TCOEngine {
  /** TCO complet nominal, coût complet actualisé (LCC), carbone et risques pour une offre. N'altère jamais ses entrées. */
  public static calculateOfferTCO(project: Project, offer?: SupplierOffer | null, overrideParameters?: Overrides): TCOCalculationResult {
    if (!offer) return TCOEngine.empty(project, overrideParameters);
    const { params, matrix, agg } = evaluate(project, offer, overrideParameters);
    const warnings: EngineWarning[] = [...matrix.warnings];
    const N = params.horizon;
    const T = agg.totals;

    const cashFlowsByYear: YearCashFlow[] = [];
    let cumulative = 0;
    for (let t = 0; t <= N; t++) {
      const df = discountFactor(params.discountRate, t);
      const nominal = agg.fullByYear[t];
      cumulative += nominal * df;
      cashFlowsByYear.push({
        year: t, nominalCost: nominal, discountFactor: Number(df.toFixed(6)), discountedCost: nominal * df, cumulativeDiscountedCost: cumulative,
        carbonEmissionsTonnes: matrix.tonnesByYear[t], carbonCostNominal: matrix.flows.carbon[t],
        components: Object.fromEntries(COMPONENTS.map((c) => [c, matrix.flows[c][t]])) as YearCashFlow['components'],
      });
    }

    // Fourchette sur les scénarios (nominal) — pas un intervalle de confiance.
    const tcos = (['Pessimiste', 'Central', 'Optimiste'] as const).map((n) => evaluate(project, offer, { ...overrideParameters, ...analysis.scenarioParameters(project, n) }).agg.totalComprehensiveTCO);

    const costWeight = (id: string) => {
      const it = (offer.costItems ?? []).find((c) => c.id === id);
      return it ? Math.abs(it.amount.value) * (it.isRecurringYearly ? N : 1) : 0;
    };
    const quality = dataQuality(offer, { cost: costWeight, carbon: T.carbon, risk: (i) => { const r = offer.riskItems[i]; return (r?.probability?.value ?? 0) * (r?.financialImpact?.value ?? 0); } }, warnings);
    const totalCO2 = sum(matrix.tonnesByYear);
    const qty = matrix.quantity;

    return {
      offerId: offer.id, supplierName: offer.supplierName, isResponsibleCandidate: offer.isResponsibleCandidate,
      apparentDirectCost: r0(matrix.apparentDirectCost),
      acquisitionTotal: r0(T.acquisition), logisticsTotal: r0(T.logistics), installationTotal: r0(T.installation),
      energyConsumablesTotal: r0(T.energy), maintenanceRepairsTotal: r0(T.maintenance), replacementDefectsTotal: r0(T.replacement),
      adminComplianceTotal: r0(T.admin), salvageValueTotal: r0(-T.salvage), endOfLifeRecyclingTotal: r0(T.endOfLife),
      economicTCONominal: r0(agg.economicTCONominal), riskExpositionTotal: r0(T.risk), monetizedCarbonTotal: r0(T.carbon),
      totalComprehensiveTCO: r0(agg.totalComprehensiveTCO), unitTCO: r0(agg.totalComprehensiveTCO / qty),
      discountRateUsed: params.discountRate, cashFlowsByYear,
      lifecycleCostLCC: r0(agg.lcc), lifecycleCostDirect: r0(agg.lccDirect), lifecycleCostLCCExCarbon: r0(agg.lccExCarbon),
      warnings, dataQualityScore: quality,
      uncertaintyRange: { minTCO: r0(Math.min(...tcos)), maxTCO: r0(Math.max(...tcos)), basis: 'scenarios' },
      totalLifecycleCO2eTonnes: Number(totalCO2.toFixed(1)),
      exact: { economicTCONominal: agg.economicTCONominal, totalComprehensiveTCO: agg.totalComprehensiveTCO, lifecycleCostLCC: agg.lcc, lifecycleCostDirect: agg.lccDirect, lifecycleCostLCCExCarbon: agg.lccExCarbon, monetizedCarbonTotal: T.carbon, riskExpositionTotal: T.risk },
    };
  }

  /** Point mort sur flux cumulés actualisés (principal) et nominaux. Compare deux résultats quelconques. */
  public static calculateBreakEven(reference: TCOCalculationResult, candidate: TCOCalculationResult, _horizonYears?: number): BreakEvenAnalysis {
    return analysis.breakEven(reference, candidate);
  }

  /** Sensibilité sur l'écart de coût complet actualisé (candidate − référence), avec seuils de bascule. */
  public static calculateSensitivity(project: Project, referenceOffer: SupplierOffer, candidateOffer: SupplierOffer): SensitivityDriver[] {
    return analysis.sensitivity(project, referenceOffer, candidateOffer);
  }

  public static calculateScenarios(project: Project, offers: SupplierOffer[]): ScenarioResult[] {
    return analysis.scenarios(project, offers);
  }

  public static calculateRobustness(project: Project, referenceOffer: SupplierOffer, candidateOffer: SupplierOffer, opts?: { draws?: number; seed?: number }) {
    return analysis.robustness(project, referenceOffer, candidateOffer, opts);
  }

  private static empty(project: Project, o?: Overrides): TCOCalculationResult {
    return {
      offerId: '', supplierName: 'Aucune offre', isResponsibleCandidate: false, apparentDirectCost: 0, acquisitionTotal: 0, logisticsTotal: 0,
      installationTotal: 0, energyConsumablesTotal: 0, maintenanceRepairsTotal: 0, replacementDefectsTotal: 0, adminComplianceTotal: 0,
      salvageValueTotal: 0, endOfLifeRecyclingTotal: 0, economicTCONominal: 0, riskExpositionTotal: 0, monetizedCarbonTotal: 0,
      totalComprehensiveTCO: 0, unitTCO: 0, discountRateUsed: o?.discountRate ?? project?.discountRate ?? 0, cashFlowsByYear: [],
      lifecycleCostLCC: 0, lifecycleCostDirect: 0, lifecycleCostLCCExCarbon: 0, warnings: [], dataQualityScore: 0,
      uncertaintyRange: { minTCO: 0, maxTCO: 0, basis: 'scenarios' }, totalLifecycleCO2eTonnes: 0,
      exact: { economicTCONominal: 0, totalComprehensiveTCO: 0, lifecycleCostLCC: 0, lifecycleCostDirect: 0, lifecycleCostLCCExCarbon: 0, monetizedCarbonTotal: 0, riskExpositionTotal: 0 },
    };
  }
}

export { DIRECT_COMPONENTS };
