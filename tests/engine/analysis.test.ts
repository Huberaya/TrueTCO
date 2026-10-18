import { describe, expect, it } from 'vitest';
import { findCrossing, percentile, triangular } from '../../src/engine/analysis';
import { TCOEngine } from '../../src/engine/tcoEngine';
import { carbon, item, offer, project, risk, rng } from './fixtures';

/** A : 1000 d'investissement + 100/an ; B : 1500 d'investissement, aucun coût d'exploitation. Horizon 10 ans. */
const A = () => offer({ id: 'A', items: [item('acquisition', 1000), item('maintenance_reparations', 100, { recurring: true })] });
const B = () => offer({ id: 'B', items: [item('acquisition', 1500)] });
const P = (r: number) => project({ horizonYears: 10, discountRate: r });
const be = (r: number) => TCOEngine.calculateBreakEven(TCOEngine.calculateOfferTCO(P(r), A()), TCOEngine.calculateOfferTCO(P(r), B()));

describe('Point mort — flux cumulés', () => {
  it("valeurs d'or (Python) : nominal = 60 mois exactement ; actualisé à 10 % = 87,384671 → 88 mois", () => {
    const x = be(0.1);
    expect(x.breakEvenMonthNominal).toBe(60);
    expect(x.breakEvenMonth).toBe(88); // ceil(87.384671)
    expect(x.hasBreakEven).toBe(true);
    expect(x.crossoverYear).toBeCloseTo(7.3, 1);
  });

  it('sans actualisation, les deux bases coïncident', () => {
    const x = be(0);
    expect(x.breakEvenMonth).toBe(60);
    expect(x.breakEvenMonthNominal).toBe(60);
  });

  it("RÉGRESSION v1 : le point mort n'est plus une division linéaire non actualisée (le taux l'influence)", () => {
    expect(be(0.1).breakEvenMonth!).toBeGreaterThan(be(0).breakEvenMonth!);
    expect(be(0.15).breakEvenMonth!).toBeGreaterThan(be(0.1).breakEvenMonth!);
  });

  it("au-delà de l'horizon : pas de croisement, pas d'extrapolation, écart final correct", () => {
    // taux 16 % > r* = 15,098 % : B ne rattrape plus A sur 10 ans
    const x = be(0.16);
    expect(x.hasBreakEven).toBe(false);
    expect(x.breakEvenMonth).toBeNull();
    expect(x.finalAdvantageDiscounted!).toBeLessThan(0); // candidate (B) plus chère en fin d'horizon
    expect(x.breakEvenDescription).toMatch(/Aucun point mort/);
  });

  it('écart final = différence exacte des LCC', () => {
    const a = TCOEngine.calculateOfferTCO(P(0.1), A()), b = TCOEngine.calculateOfferTCO(P(0.1), B());
    expect(be(0.1).finalAdvantageDiscounted).toBeCloseTo(a.exact.lifecycleCostLCC - b.exact.lifecycleCostLCC, 6);
    expect(be(0.1).cumulativeDifference!.at(-1)!.discounted).toBeCloseTo(b.exact.lifecycleCostLCC - a.exact.lifecycleCostLCC, 6);
  });

  it("candidate moins chère dès l'acquisition : point mort immédiat (mois 0)", () => {
    const x = TCOEngine.calculateBreakEven(TCOEngine.calculateOfferTCO(P(0.05), B()), TCOEngine.calculateOfferTCO(P(0.05), A()));
    // référence = B (1500) ; candidate = A (1000 + 100/an) : moins chère au départ
    expect(x.breakEvenMonth).toBe(0);
    expect(x.hasBreakEven).toBe(true);
    expect(x.breakEvenDescription).toMatch(/dès l'acquisition/);
  });

  it("inversion détectée : avantage initial perdu avant la fin de l'horizon", () => {
    const cheapNow = offer({ items: [item('acquisition', 100), item('maintenance_reparations', 100, { recurring: true })] });
    const dearNow = offer({ items: [item('acquisition', 400)] });
    const x = TCOEngine.calculateBreakEven(TCOEngine.calculateOfferTCO(P(0), dearNow), TCOEngine.calculateOfferTCO(P(0), cheapNow));
    expect(x.crossesBackAfterBreakEven).toBe(true);
    expect(x.breakEvenDescription).toMatch(/s'inverse/);
  });

  it('findCrossing : interpolation linéaire exacte et cas limites', () => {
    expect(findCrossing([100, 50, -50]).month).toBeCloseTo(18, 9);      // entre fin d'année 1 et 2, à mi-chemin
    expect(findCrossing([100, 50, 10]).month).toBeNull();
    expect(findCrossing([0, 10]).immediate).toBe(true);
    expect(findCrossing([]).month).toBeNull();
  });

  it('inclut risque et carbone : un risque évité raccourcit le point mort', () => {
    const base = be(0.1).breakEvenMonth!;
    const Ar = offer({ id: 'A', items: [item('acquisition', 1000), item('maintenance_reparations', 100, { recurring: true })], risks: [risk(0.5, 400)] });
    const x = TCOEngine.calculateBreakEven(TCOEngine.calculateOfferTCO(P(0.1), Ar), TCOEngine.calculateOfferTCO(P(0.1), B()));
    expect(x.breakEvenMonth!).toBeLessThan(base);
  });
});

describe('Sensibilité — écart de coût complet actualisé', () => {
  const a = A(), b = B();
  const s = () => TCOEngine.calculateSensitivity(P(0.1), a, b);

  it("seuil de bascule du taux d'actualisation : 15,098414 % (valeur d'or Python)", () => {
    const d = s().find((x) => x.category === 'taux_actualisation')!;
    expect(d.switchingValue).toBeCloseTo(15.098414, 3);
  });

  it("seuil de bascule du prix d'achat candidat : × 1,07630447 à 10 % (valeur d'or Python)", () => {
    const d = s().find((x) => x.category === 'prix_achat')!;
    expect(d.switchingValue).toBeCloseTo(1.07630447, 4);
  });

  it("PROPRIÉTÉ : à la valeur de bascule, les deux offres coûtent exactement autant", () => {
    const sw = s().find((x) => x.category === 'taux_actualisation')!.switchingValue! / 100;
    const la = TCOEngine.calculateOfferTCO({ ...P(0.1), discountRate: sw }, a).exact.lifecycleCostLCC;
    const lb = TCOEngine.calculateOfferTCO({ ...P(0.1), discountRate: sw }, b).exact.lifecycleCostLCC;
    expect(Math.abs(la - lb)).toBeLessThan(1e-6);
  });

  it('« critique » = la décision change de camp dans la plage testée ; sinon classé par poids relatif', () => {
    const drivers = s();
    for (const d of drivers) {
      expect(d.sensitivityRank === 'critique').toBe(!!d.flipsDecision);
      if (d.flipsDecision) {
        const base = 500 - 100 * ((1 - 1.1 ** -10) / 0.1); // Δ de base (candidate − référence) à 10 %
        const lo = base + d.lowValueImpactOnDeltaTCO, hi = base + d.highValueImpactOnDeltaTCO;
        expect(Math.sign(lo) !== Math.sign(base) || Math.sign(hi) !== Math.sign(base)).toBe(true);
      }
    }
  });

  it("le prix d'achat de la candidate (±10 %) peut changer la décision ici ; un paramètre sans effet est « faible »", () => {
    const drivers = s();
    expect(drivers.find((x) => x.category === 'prix_achat')!.flipsDecision).toBe(true);
    const carb = drivers.find((x) => x.category === 'prix_carbone')!;
    expect(carb.lowValueImpactOnDeltaTCO).toBeCloseTo(0, 9);   // aucune émission : sans effet
    expect(carb.sensitivityRank).toBe('faible');
    expect(carb.switchingValue).toBeNull();
  });

  it('triée par amplitude décroissante, plages testées exposées', () => {
    const drivers = s();
    const swing = (d: (typeof drivers)[number]) => Math.abs(d.highValueImpactOnDeltaTCO - d.lowValueImpactOnDeltaTCO);
    for (let i = 1; i < drivers.length; i++) expect(swing(drivers[i - 1])).toBeGreaterThanOrEqual(swing(drivers[i]) - 1e-9);
    const dr = drivers.find((x) => x.category === 'taux_actualisation')!;
    expect(dr.lowValue).toBeCloseTo(8, 9); expect(dr.highValue).toBeCloseTo(12, 9); // ±2 points autour de 10 %
  });

  it("RÉGRESSION v1 : une seule métrique pour tous les paramètres (le « WACC » mélangeait LCC et TCO nominal)", () => {
    // Avec carbone et inflation nulle, varier le taux à ±2 pts doit produire exactement le Δ d'annuité attendu.
    const dr = s().find((x) => x.category === 'taux_actualisation')!;
    const delta = (r: number) => 500 - 100 * ((1 - (1 + r) ** -10) / r);
    expect(dr.lowValueImpactOnDeltaTCO).toBeCloseTo(delta(0.08) - delta(0.1), 6);
    expect(dr.highValueImpactOnDeltaTCO).toBeCloseTo(delta(0.12) - delta(0.1), 6);
  });

  it("déterministe : deux appels donnent le même résultat", () => {
    expect(s()).toEqual(s());
  });
});

describe('Scénarios', () => {
  const offers = [
    offer({ id: 'X', items: [item('acquisition', 1000), item('energie_consommables', 200, { recurring: true }), item('remplacement_pannes', 50, { recurring: true })], carbons: [carbon('utilisation_annuelle', 40)] }),
    offer({ id: 'Y', items: [item('acquisition', 1600), item('energie_consommables', 80, { recurring: true }), item('remplacement_pannes', 20, { recurring: true })], carbons: [carbon('utilisation_annuelle', 15)] }),
  ];
  const proj = project({ horizonYears: 8 as never, inflationRate: 0.02, energyInflationRate: 0.04, carbonPricePerTonne: 120 });

  it('le scénario central est EXACTEMENT le calcul de base', () => {
    const central = TCOEngine.calculateScenarios(proj, offers).find((s) => s.scenarioName === 'Central')!;
    for (const o of offers) {
      const e = TCOEngine.calculateOfferTCO(proj, o);
      expect(central.resultsByOfferId[o.id].discountedLCC).toBeCloseTo(e.exact.lifecycleCostLCC, 9);
      expect(central.resultsByOfferId[o.id].nominalTCO).toBeCloseTo(e.exact.totalComprehensiveTCO, 9);
    }
  });

  it('ordre garanti pessimiste ≥ central ≥ optimiste, même si le projet sort des chocs par défaut', () => {
    for (const p of [proj, { ...proj, inflationRate: 0.09, energyInflationRate: 0.12, carbonPricePerTonne: 400 }, { ...proj, inflationRate: 0, energyInflationRate: 0, carbonPricePerTonne: 10 }]) {
      const [pess, cent, opt] = ['Pessimiste', 'Central', 'Optimiste'].map((n) => TCOEngine.calculateScenarios(p, offers).find((s) => s.scenarioName === n)!);
      for (const o of offers) {
        expect(pess.resultsByOfferId[o.id].discountedLCC).toBeGreaterThanOrEqual(cent.resultsByOfferId[o.id].discountedLCC - 1e-9);
        expect(cent.resultsByOfferId[o.id].discountedLCC).toBeGreaterThanOrEqual(opt.resultsByOfferId[o.id].discountedLCC - 1e-9);
        expect(pess.resultsByOfferId[o.id].nominalTCO).toBeGreaterThanOrEqual(opt.resultsByOfferId[o.id].nominalTCO - 1e-9);
      }
      expect(pess.parameters.carbonPricePerTonne).toBeGreaterThanOrEqual(opt.parameters.carbonPricePerTonne);
    }
  });

  it("le taux d'actualisation n'est pas choqué (identique dans les 3 scénarios) ; chocs par défaut étiquetés non sourcés", () => {
    const sc = TCOEngine.calculateScenarios(proj, offers);
    expect(new Set(sc.map((s) => s.parameters.discountRate)).size).toBe(1);
    expect(sc.map((s) => s.parametersSource)).toEqual(['model_default', 'project', 'model_default']);
  });

  it("le meilleur choix est désigné sur le coût complet ACTUALISÉ (et un seul par scénario)", () => {
    for (const s of TCOEngine.calculateScenarios(proj, offers)) {
      const best = Object.entries(s.resultsByOfferId).filter(([, r]) => r.isBestChoice);
      expect(best).toHaveLength(1);
      expect(best[0][0]).toBe(s.bestOfferId);
      expect(best[0][1].deltaVsBestLCC).toBe(0);
      for (const r of Object.values(s.resultsByOfferId)) expect(r.deltaVsBestLCC).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Robustesse — simulation reproductible', () => {
  const ref = A(), cand = B();
  it('reproductible : même graine, mêmes résultats ; autre graine, autre tirage', () => {
    const r1 = TCOEngine.calculateRobustness(P(0.1), ref, cand, { draws: 400, seed: 7 });
    const r2 = TCOEngine.calculateRobustness(P(0.1), ref, cand, { draws: 400, seed: 7 });
    const r3 = TCOEngine.calculateRobustness(P(0.1), ref, cand, { draws: 400, seed: 8 });
    expect(r1).toEqual(r2);
    expect(r1.deltaLCC.p50).not.toBe(r3.deltaLCC.p50);
  });

  it('cohérence statistique : p10 ≤ p50 ≤ p90, probabilité dans [0 ; 1], hypothèses exposées', () => {
    const r = TCOEngine.calculateRobustness(P(0.1), ref, cand, { draws: 500 });
    expect(r.deltaLCC.p10).toBeLessThanOrEqual(r.deltaLCC.p50);
    expect(r.deltaLCC.p50).toBeLessThanOrEqual(r.deltaLCC.p90);
    expect(r.probabilityCandidateCheaper).toBeGreaterThanOrEqual(0);
    expect(r.probabilityCandidateCheaper).toBeLessThanOrEqual(1);
    expect(r.assumptions.length).toBeGreaterThanOrEqual(8);
    expect(r.note).toMatch(/pas un intervalle de confiance/);
  });

  it('cas décidés : candidate nettement moins chère → probabilité 1 ; nettement plus chère → 0', () => {
    const dear = offer({ items: [item('acquisition', 100000)] }), cheap = offer({ items: [item('acquisition', 10)] });
    expect(TCOEngine.calculateRobustness(P(0.1), dear, cheap, { draws: 200 }).probabilityCandidateCheaper).toBe(1);
    expect(TCOEngine.calculateRobustness(P(0.1), cheap, dear, { draws: 200 }).probabilityCandidateCheaper).toBe(0);
  });

  it("cas limite : probabilité cohérente avec le Δ central (offres proches → ni 0 ni 1)", () => {
    const r = TCOEngine.calculateRobustness(P(0.1), ref, cand, { draws: 1000, seed: 3 });
    expect(r.probabilityCandidateCheaper).toBeGreaterThan(0.05);
    expect(r.probabilityCandidateCheaper).toBeLessThan(0.95);
  });

  it('loi triangulaire : bornée, mode respecté ; percentile interpolé', () => {
    const R = rng(5); let min = Infinity, max = -Infinity, sum = 0; const n = 20000;
    for (let i = 0; i < n; i++) { const v = triangular(R(), 2, 5, 11); min = Math.min(min, v); max = Math.max(max, v); sum += v; }
    expect(min).toBeGreaterThanOrEqual(2); expect(max).toBeLessThanOrEqual(11);
    expect(sum / n).toBeCloseTo((2 + 5 + 11) / 3, 1);      // espérance théorique
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([10, 20], 0.25)).toBe(12.5);
  });
});
