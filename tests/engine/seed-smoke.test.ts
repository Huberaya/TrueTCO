import { describe, expect, it } from 'vitest';
import { TCOEngine } from '../../src/engine/tcoEngine';
import { SEED_OFFERS, SEED_PROJECTS } from '../../src/data/seedData';

/** Le moteur est exécuté sur les projets de démonstration RÉELS de l'application : tout doit rester fini et cohérent. */
describe('Moteur sur les projets de démonstration', () => {
  const finite = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  for (const project of SEED_PROJECTS) {
    const offers = SEED_OFFERS.filter((o) => o.projectId === project.id);
    if (offers.length === 0) continue;
    describe(project.name, () => {
      it('résultats finis et décomposition cohérente pour chaque offre', () => {
        for (const o of offers) {
          const r = TCOEngine.calculateOfferTCO(project, o);
          for (const v of Object.values(r.exact)) expect(finite(v), `${o.supplierName}`).toBe(true);
          expect(r.cashFlowsByYear).toHaveLength(project.horizonYears + 1);
          expect(Math.abs(r.exact.economicTCONominal + r.exact.riskExpositionTotal + r.exact.monetizedCarbonTotal - r.exact.totalComprehensiveTCO)).toBeLessThan(1e-6);
          expect(r.cashFlowsByYear.at(-1)!.cumulativeDiscountedCost).toBeCloseTo(r.exact.lifecycleCostLCC, 6);
        }
      });
      if (offers.length >= 2) {
        it('point mort, sensibilité, scénarios et robustesse sans valeur invalide', () => {
          const [a, b] = offers;
          const be = TCOEngine.calculateBreakEven(TCOEngine.calculateOfferTCO(project, a), TCOEngine.calculateOfferTCO(project, b));
          expect(be.cumulativeDifference!.every((c) => finite(c.nominal) && finite(c.discounted))).toBe(true);
          const sens = TCOEngine.calculateSensitivity(project, a, b);
          expect(sens.length).toBeGreaterThanOrEqual(9);
          expect(sens.every((d) => finite(d.lowValueImpactOnDeltaTCO) && finite(d.highValueImpactOnDeltaTCO))).toBe(true);
          const sc = TCOEngine.calculateScenarios(project, offers);
          expect(sc.every((s) => s.bestOfferId !== '' && Object.values(s.resultsByOfferId).every((r) => finite(r.discountedLCC)))).toBe(true);
          const rb = TCOEngine.calculateRobustness(project, a, b, { draws: 300 });
          expect(rb.probabilityCandidateCheaper).toBeGreaterThanOrEqual(0);
          expect(rb.probabilityCandidateCheaper).toBeLessThanOrEqual(1);
        });
      }
    });
  }
});
