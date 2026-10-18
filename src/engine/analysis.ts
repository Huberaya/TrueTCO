/**
 * Analyses de décision construites sur le cœur de calcul (model.ts) : point mort, sensibilité, scénarios, robustesse.
 * Métrique de décision unique : le COÛT COMPLET ACTUALISÉ (direct + risques + carbone). Spécification : docs/METHODOLOGIE-TCO.md
 */
import type { BreakEvenAnalysis, Project, ScenarioResult, SensitivityDriver, SupplierOffer, TCOCalculationResult } from '../types/domain';
import { type Overrides, evaluate } from './model';

// ───────────────────────────── Point mort ─────────────────────────────

interface Crossing { month: number | null; immediate: boolean; reverses: boolean }

/**
 * Premier croisement de la différence cumulée (candidate − référence) avec zéro, interpolé linéairement dans l'année.
 * `d[t]` = écart cumulé à la fin de l'année t (t = 0 : investissement initial). Aucune extrapolation au-delà de l'horizon.
 */
export function findCrossing(d: readonly number[]): Crossing {
  if (d.length === 0) return { month: null, immediate: false, reverses: false };
  if (d[0] <= 0) return { month: 0, immediate: true, reverses: d.some((x, i) => i > 0 && x > 0) };
  for (let t = 1; t < d.length; t++) {
    if (d[t] <= 0) {
      const month = 12 * ((t - 1) + d[t - 1] / (d[t - 1] - d[t]));
      return { month, immediate: false, reverses: d.slice(t).some((x) => x > 0) };
    }
  }
  return { month: null, immediate: false, reverses: false };
}

export function breakEven(conv: TCOCalculationResult, cand: TCOCalculationResult): BreakEvenAnalysis {
  const cf = (r: TCOCalculationResult) => r.cashFlowsByYear;
  const H = Math.min(cf(conv).length, cf(cand).length) - 1;
  const cumNominal = (r: TCOCalculationResult) => { let s = 0; return cf(r).slice(0, H + 1).map((y) => (s += y.nominalCost)); };
  const cumDisc = (r: TCOCalculationResult) => cf(r).slice(0, H + 1).map((y) => y.cumulativeDiscountedCost);
  const nA = cumNominal(conv), nB = cumNominal(cand), dA = cumDisc(conv), dB = cumDisc(cand);
  const dNom = nB.map((v, t) => v - nA[t]);
  const dDisc = dB.map((v, t) => v - dA[t]);

  const cD = findCrossing(dDisc);
  const cN = findCrossing(dNom);
  const premium = cand.apparentDirectCost - conv.apparentDirectCost;
  const premiumPct = conv.apparentDirectCost > 0 ? Number(((premium / conv.apparentDirectCost) * 100).toFixed(1)) : 0;

  // Économie d'exploitation mensuelle moyenne : flux des années 1..H (hors investissement initial), nominal.
  const opex = (r: TCOCalculationResult) => cf(r).slice(1, H + 1).reduce((s, y) => s + y.nominalCost, 0);
  const monthlySavings = H > 0 ? (opex(conv) - opex(cand)) / (12 * H) : 0;
  const finalDisc = -(dDisc[H] ?? 0);
  const finalNom = -(dNom[H] ?? 0);
  const eur = (x: number) => `${Math.round(Math.abs(x)).toLocaleString('fr-FR')} €`;

  // Math.max(0, …) évite « -0 » (ceil(0 − ε)) pour un point mort immédiat.
  const monthsUp = (m: number | null) => (m === null ? null : Math.max(0, Math.ceil(m - 1e-9)));
  const month = monthsUp(cD.month);
  let description: string;
  if (cD.immediate) {
    description = `L'offre candidate n'est pas plus chère que la référence dès l'acquisition (coût complet actualisé cumulé : ${eur(dDisc[0] ?? 0)} d'avance).`
      + (cD.reverses ? " Attention : cet avantage s'inverse avant la fin de l'horizon." : '');
  } else if (month !== null) {
    description = `L'offre candidate coûte ${premiumPct > 0 ? '+' : ''}${premiumPct} % à l'achat ; son coût complet cumulé ACTUALISÉ repasse sous celui de la référence au mois ${month} (≈ ${(month / 12).toFixed(1)} an${month >= 24 ? 's' : ''}). Au terme des ${H} ans, l'avantage actualisé est de ${eur(finalDisc)}.`
      + (cD.reverses ? " Attention : l'avantage s'inverse ensuite." : '');
  } else {
    description = `Aucun point mort sur l'horizon de ${H} ans : l'offre candidate reste plus chère de ${eur(finalDisc)} en valeur actualisée au terme de la période (aucune extrapolation au-delà de l'horizon).`;
  }

  return {
    hasBreakEven: cD.month !== null,
    breakEvenMonth: month,
    crossoverYear: month === null ? null : Number((month / 12).toFixed(1)),
    initialPriceDeltaPercent: premiumPct,
    monthlyOperatingSavings: Math.round(monthlySavings),
    breakEvenDescription: description,
    breakEvenMonthNominal: monthsUp(cN.month),
    finalAdvantageDiscounted: finalDisc,
    finalAdvantageNominal: finalNom,
    crossesBackAfterBreakEven: cD.reverses,
    cumulativeDifference: dNom.map((n, year) => ({ year, nominal: n, discounted: dDisc[year] })),
  };
}

// ───────────────────────────── Plages de variation (hypothèses explicites) ─────────────────────────────

/**
 * Plages testées en sensibilité ET tirées en simulation. Ce sont des CONVENTIONS d'analyse, non des mesures :
 * elles sont affichées avec les résultats. `abs` = écart absolu autour de la valeur de base ; `rel` = écart relatif.
 */
export const SENSITIVITY_RANGES = {
  discountRate: { abs: 0.02 },
  energyInflation: { abs: 0.02 },
  inflation: { abs: 0.01 },
  carbonPrice: { rel: 0.5 },
  energyCost: { rel: 0.2 },
  maintenanceCost: { rel: 0.2 },
  failureCost: { rel: 0.5 },
  purchasePriceCandidate: { rel: 0.1 },
  residualValue: { rel: 0.25 },
  riskExposure: { rel: 0.5 },
} as const;

interface DriverDef {
  id: string;
  name: string;
  category: SensitivityDriver['category'];
  unit: string;
  base: number;
  low: number;
  high: number;
  searchMin: number;
  searchMax: number;
  /** Affichage en % (×100) pour les taux. */
  displayScale: number;
  toOverrides: (v: number) => { conv?: Overrides; cand?: Overrides };
  explanation: string;
}

export function driverDefs(project: Project): DriverDef[] {
  const R = SENSITIVITY_RANGES;
  const abs = (b: number, d: number) => ({ low: Math.max(0, b - d), high: b + d });
  const rel = (b: number, d: number) => ({ low: b * (1 - d), high: b * (1 + d) });
  const dr = project.discountRate, ei = project.energyInflationRate, inf = project.inflationRate, cp = project.carbonPricePerTonne;
  return [
    { id: 'discountRate', name: "Taux d'actualisation", category: 'taux_actualisation', unit: '%', base: dr, ...abs(dr, R.discountRate.abs), searchMin: 0, searchMax: 0.3, displayScale: 100,
      toOverrides: (v) => ({ conv: { discountRate: v }, cand: { discountRate: v } }),
      explanation: "Un taux élevé favorise les offres à investissement initial faible ; un taux bas valorise les économies futures." },
    { id: 'energyInflation', name: "Inflation de l'énergie", category: 'energie', unit: '%/an', base: ei, ...abs(ei, R.energyInflation.abs), searchMin: 0, searchMax: 0.2, displayScale: 100,
      toOverrides: (v) => ({ conv: { energyInflationRate: v }, cand: { energyInflationRate: v } }),
      explanation: "Une hausse des prix de l'énergie avantage l'offre la plus sobre." },
    { id: 'energyCost', name: "Niveau de prix de l'énergie", category: 'cout_energie', unit: '× prix saisi', base: 1, ...rel(1, R.energyCost.rel), searchMin: 0.2, searchMax: 4, displayScale: 1,
      toOverrides: (v) => ({ conv: { energyCostMultiplier: v }, cand: { energyCostMultiplier: v } }),
      explanation: "Variation du niveau (et non de la croissance) des coûts d'énergie et consommables des deux offres." },
    { id: 'inflation', name: 'Inflation générale', category: 'inflation', unit: '%/an', base: inf, ...abs(inf, R.inflation.abs), searchMin: 0, searchMax: 0.15, displayScale: 100,
      toOverrides: (v) => ({ conv: { inflationRate: v }, cand: { inflationRate: v } }),
      explanation: "Indexe la maintenance, les remplacements et les coûts administratifs." },
    { id: 'carbonPrice', name: 'Prix du carbone', category: 'prix_carbone', unit: '€/tCO2e', base: cp, ...rel(cp, R.carbonPrice.rel), searchMin: 0, searchMax: Math.max(cp * 6, 600), displayScale: 1,
      toOverrides: (v) => ({ conv: { carbonPricePerTonne: v }, cand: { carbonPricePerTonne: v } }),
      explanation: "Valorisation monétaire des émissions : sans effet si les deux offres émettent autant." },
    { id: 'maintenanceCost', name: 'Coût de maintenance', category: 'cout_maintenance', unit: '× prix saisi', base: 1, ...rel(1, R.maintenanceCost.rel), searchMin: 0.2, searchMax: 4, displayScale: 1,
      toOverrides: (v) => ({ conv: { maintenanceCostMultiplier: v }, cand: { maintenanceCostMultiplier: v } }),
      explanation: "Niveau des coûts de maintenance et réparations des deux offres." },
    { id: 'failureCost', name: 'Coût des pannes et remplacements', category: 'taux_panne', unit: '× prix saisi', base: 1, ...rel(1, R.failureCost.rel), searchMin: 0, searchMax: 5, displayScale: 1,
      toOverrides: (v) => ({ conv: { failureRateMultiplier: v }, cand: { failureRateMultiplier: v } }),
      explanation: "Fragilité opérationnelle : coûts curatifs hors garantie." },
    { id: 'riskExposure', name: 'Exposition aux risques', category: 'exposition_risques', unit: '× estimation', base: 1, ...rel(1, R.riskExposure.rel), searchMin: 0, searchMax: 5, displayScale: 1,
      toOverrides: (v) => ({ conv: { riskMultiplier: v }, cand: { riskMultiplier: v } }),
      explanation: "Probabilité × impact des risques identifiés (réglementaire, interruption, retrait…)." },
    { id: 'residualValue', name: 'Valeur résiduelle', category: 'valeur_residuelle', unit: '× valeur saisie', base: 1, ...rel(1, R.residualValue.rel), searchMin: 0, searchMax: 4, displayScale: 1,
      toOverrides: (v) => ({ conv: { residualValueMultiplier: v }, cand: { residualValueMultiplier: v } }),
      explanation: "Valeur de revente ou de reprise en fin d'horizon." },
    { id: 'purchasePrice', name: "Prix d'achat de l'offre candidate", category: 'prix_achat', unit: '× prix du devis', base: 1, ...rel(1, R.purchasePriceCandidate.rel), searchMin: 0.3, searchMax: 2, displayScale: 1,
      toOverrides: (v) => ({ cand: { purchasePriceMultiplier: v } }),
      explanation: "Marge de négociation sur l'offre candidate : à partir de quel prix devient-elle plus avantageuse ?" },
  ];
}

const sign = (x: number) => (Math.abs(x) < 1e-9 ? 0 : Math.sign(x));

/** Écart de coût complet actualisé (candidate − référence) pour une valeur du paramètre. Négatif = candidate moins chère. */
function deltaLCC(project: Project, conv: SupplierOffer, cand: SupplierOffer, def: DriverDef | null, v?: number): number {
  const o = def && v !== undefined ? def.toOverrides(v) : {};
  return evaluate(project, cand, o.cand ?? {}).agg.lcc - evaluate(project, conv, o.conv ?? {}).agg.lcc;
}

/** Valeur du paramètre annulant l'écart, la plus proche de la valeur de base (balayage puis bissection). */
export function switchingValue(project: Project, conv: SupplierOffer, cand: SupplierOffer, def: DriverDef): number | null {
  const steps = 60;
  const xs = Array.from({ length: steps + 1 }, (_, i) => def.searchMin + ((def.searchMax - def.searchMin) * i) / steps);
  const ys = xs.map((x) => deltaLCC(project, conv, cand, def, x));
  let best: [number, number] | null = null;
  for (let i = 0; i < steps; i++) {
    if (sign(ys[i]) !== sign(ys[i + 1]) && (sign(ys[i]) !== 0 || sign(ys[i + 1]) !== 0)) {
      const mid = (xs[i] + xs[i + 1]) / 2;
      if (!best || Math.abs(mid - def.base) < Math.abs((best[0] + best[1]) / 2 - def.base)) best = [xs[i], xs[i + 1]];
    }
  }
  if (!best) return null;
  let [a, b] = best;
  let fa = deltaLCC(project, conv, cand, def, a);
  for (let k = 0; k < 80; k++) {
    const m = (a + b) / 2;
    const fm = deltaLCC(project, conv, cand, def, m);
    if (sign(fm) === 0 || Math.abs(b - a) < 1e-12) return m;
    if (sign(fa) === sign(fm)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

export function sensitivity(project: Project, conv: SupplierOffer, cand: SupplierOffer): SensitivityDriver[] {
  const base = deltaLCC(project, conv, cand, null);
  const floor = Math.max(1, 0.01 * evaluate(project, conv).agg.lcc);
  const out = driverDefs(project).map((d): SensitivityDriver & { _swing: number } => {
    const lo = deltaLCC(project, conv, cand, d, d.low);
    const hi = deltaLCC(project, conv, cand, d, d.high);
    const swing = Math.abs(hi - lo);
    const flips = sign(base) !== 0 && (sign(lo) !== sign(base) || sign(hi) !== sign(base));
    const ratio = swing / Math.max(Math.abs(base), floor);
    const sv = switchingValue(project, conv, cand, d);
    return {
      parameterName: d.name, category: d.category, baseValue: d.base * d.displayScale, unit: d.unit,
      lowValue: d.low * d.displayScale, highValue: d.high * d.displayScale,
      lowValueImpactOnDeltaTCO: lo - base, highValueImpactOnDeltaTCO: hi - base,
      flipsDecision: flips,
      sensitivityRank: flips ? 'critique' : ratio >= 0.5 ? 'fort' : ratio >= 0.2 ? 'moyen' : 'faible',
      switchingValue: sv === null ? null : sv * d.displayScale,
      explanation: d.explanation, _swing: swing,
    };
  });
  return out.sort((a, b) => b._swing - a._swing).map(({ _swing, ...d }) => d);
}

// ───────────────────────────── Scénarios ─────────────────────────────

/** Chocs par défaut du modèle (conventions NON SOURCÉES). Le taux d'actualisation n'est pas choqué : il relève du financement, pas du contexte macro. */
export const DEFAULT_SCENARIO_SHOCKS = {
  pessimiste: { inflationRate: 0.045, energyInflationRate: 0.08, carbonPricePerTonne: 200, failureRateMultiplier: 1.4 },
  optimiste: { inflationRate: 0.015, energyInflationRate: 0.02, carbonPricePerTonne: 80, failureRateMultiplier: 0.8 },
} as const;

/**
 * Paramètres d'un scénario. Garantie d'ordre : pessimiste ≥ central ≥ optimiste sur chaque paramètre de coût,
 * même si les valeurs du projet sortent de l'intervalle des chocs par défaut.
 */
export function scenarioParameters(project: Project, name: 'Pessimiste' | 'Central' | 'Optimiste') {
  const central = { inflationRate: project.inflationRate, energyInflationRate: project.energyInflationRate, carbonPricePerTonne: project.carbonPricePerTonne, failureRateMultiplier: 1, discountRate: project.discountRate };
  if (name === 'Central') return central;
  const s = name === 'Pessimiste' ? DEFAULT_SCENARIO_SHOCKS.pessimiste : DEFAULT_SCENARIO_SHOCKS.optimiste;
  const pick = name === 'Pessimiste' ? Math.max : Math.min;
  return {
    inflationRate: pick(s.inflationRate, central.inflationRate),
    energyInflationRate: pick(s.energyInflationRate, central.energyInflationRate),
    carbonPricePerTonne: pick(s.carbonPricePerTonne, central.carbonPricePerTonne),
    failureRateMultiplier: s.failureRateMultiplier,
    discountRate: central.discountRate,
  };
}

export function scenarios(project: Project, offers: SupplierOffer[]): ScenarioResult[] {
  return (['Pessimiste', 'Central', 'Optimiste'] as const).map((name) => {
    const parameters = scenarioParameters(project, name);
    const evals = offers.map((o) => ({ id: o.id, ...evaluate(project, o, parameters).agg }));
    const minNominal = Math.min(...evals.map((e) => e.totalComprehensiveTCO));
    const minLcc = Math.min(...evals.map((e) => e.lcc));
    const best = evals.find((e) => e.lcc === minLcc);
    const resultsByOfferId: ScenarioResult['resultsByOfferId'] = {};
    for (const e of evals) {
      resultsByOfferId[e.id] = {
        nominalTCO: e.totalComprehensiveTCO, discountedLCC: e.lcc,
        deltaVsCheapestNominal: e.totalComprehensiveTCO - minNominal, deltaVsBestLCC: e.lcc - minLcc, isBestChoice: e.id === best?.id,
      };
    }
    return { scenarioName: name, parameters, parametersSource: name === 'Central' ? 'project' : 'model_default', bestOfferId: best?.id ?? '', resultsByOfferId };
  });
}

// ───────────────────────────── Robustesse (simulation reproductible) ─────────────────────────────

export interface RobustnessResult {
  draws: number;
  seed: number;
  /** Part des tirages où l'offre candidate a le coût complet actualisé le plus bas. */
  probabilityCandidateCheaper: number;
  deltaLCC: { p10: number; p50: number; p90: number };
  lcc: { reference: { p10: number; p50: number; p90: number }; candidate: { p10: number; p50: number; p90: number } };
  /** Hypothèses de la simulation, à afficher avec le résultat. */
  assumptions: { driver: string; low: number; mode: number; high: number; unit: string }[];
  note: string;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function triangular(u: number, low: number, mode: number, high: number): number {
  if (high <= low) return mode;
  const c = (mode - low) / (high - low);
  return u < c ? low + Math.sqrt(u * (high - low) * (mode - low)) : high - Math.sqrt((1 - u) * (high - low) * (high - mode));
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function robustness(project: Project, conv: SupplierOffer, cand: SupplierOffer, opts: { draws?: number; seed?: number } = {}): RobustnessResult {
  const draws = opts.draws ?? 2000;
  const seed = opts.seed ?? 20260101;
  const rnd = mulberry32(seed);
  const defs = driverDefs(project);
  const deltas: number[] = [], lc: number[] = [], lr: number[] = [];
  let candWins = 0;
  for (let i = 0; i < draws; i++) {
    const oc: Overrides = {}, oa: Overrides = {};
    for (const d of defs) {
      const o = d.toOverrides(triangular(rnd(), d.low, d.base, d.high));
      Object.assign(oc, o.conv ?? {});
      Object.assign(oa, o.cand ?? {});
    }
    const a = evaluate(project, conv, oc).agg.lcc;
    const b = evaluate(project, cand, oa).agg.lcc;
    lr.push(a); lc.push(b); deltas.push(b - a);
    if (b < a) candWins++;
  }
  const q = (arr: number[]) => { const s = [...arr].sort((x, y) => x - y); return { p10: percentile(s, 0.1), p50: percentile(s, 0.5), p90: percentile(s, 0.9) }; };
  return {
    draws, seed, probabilityCandidateCheaper: candWins / draws,
    deltaLCC: q(deltas), lcc: { reference: q(lr), candidate: q(lc) },
    assumptions: defs.map((d) => ({ driver: d.name, low: d.low * d.displayScale, mode: d.base * d.displayScale, high: d.high * d.displayScale, unit: d.unit })),
    note: "Simulation de Monte Carlo : chaque paramètre varie indépendamment (loi triangulaire autour de la valeur de base, plages ci-dessus). Les plages et l'indépendance sont des hypothèses d'analyse, non des mesures : ce n'est pas un intervalle de confiance statistique.",
  };
}
