/**
 * CONTRE-VÉRIFICATION INDÉPENDANTE DU MOTEUR
 * ---------------------------------------------------------------------------
 * `tests/oracle/reference.ts` est une implémentation de référence écrite à partir de la spécification, volontairement naïve,
 * SANS aucun import du moteur. Les valeurs « d'or » ont été calculées à part, en Python. Le test compare les totaux du moteur
 * à cette référence sur des cas aléatoires reproductibles (graine fixe).
 *
 * Périmètre : les postes dont la convention est sans ambiguïté (acquisition, logistique, installation, énergie, administratif,
 * fin de vie, valeur résiduelle, risques, carbone par phase). La maintenance et les remplacements sont exclus : leurs coefficients
 * de vieillissement sont des CONVENTIONS propres à chaque moteur, pas des vérités à comparer.
 */
import { describe, expect, it } from 'vitest';
import { TCOEngine } from '../src/engine/tcoEngine';
import { carbon, item, offer, project, risk, rng } from './oracle/fixtures';
import { reference } from './oracle/reference';

const near = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${what}: moteur ${a} vs référence ${b}`).toBeLessThanOrEqual(1.01); // sorties arrondies à l'euro

describe('Valeurs d\'or (calculées en Python, indépendamment du moteur)', () => {
  const p = project({ horizonYears: 3 as never, discountRate: 0.1, inflationRate: 0, energyInflationRate: 0 });
  const o = offer({ items: [item('acquisition', 1000), item('energie_consommables', 100, { recurring: true }), item('fin_de_vie_recyclage', 30), item('valeur_residuelle', -200)], risks: [risk(0.5, 600)], carbons: [carbon('utilisation_annuelle', 6)] });
  const r = TCOEngine.calculateOfferTCO(p, o);

  it('TCO économique 1 130, risques 300, carbone 600, TCO complet 2 030', () => {
    expect(r.economicTCONominal).toBe(1130);
    expect(r.riskExpositionTotal).toBe(300);
    expect(r.monetizedCarbonTotal).toBe(600);
    expect(r.totalComprehensiveTCO).toBe(2030);
  });
  it('coût complet actualisé 1 867,017 (direct + risques + carbone)', () => {
    near(r.lifecycleCostLCC, 1867.017, 'LCC complet');
  });
});

describe('Test différentiel : moteur vs référence indépendante (300 cas aléatoires)', () => {
  const R = rng(4242);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const cats = ['acquisition', 'logistique_douanes', 'installation_mise_en_service', 'energie_consommables', 'couts_administratifs_conformite', 'fin_de_vie_recyclage', 'valeur_residuelle'] as const;
  const cases = Array.from({ length: 300 }, () => {
    const N = 1 + Math.floor(R() * 10);
    const p = project({ horizonYears: N as never, discountRate: R() * 0.15, inflationRate: R() * 0.06, energyInflationRate: R() * 0.1, carbonPricePerTonne: R() * 300 });
    const items = Array.from({ length: 1 + Math.floor(R() * 6) }, () => {
      const cat = pick([...cats]);
      const recurring = ['energie_consommables', 'couts_administratifs_conformite'].includes(cat) && R() < 0.7;
      return item(cat, Math.round(R() * 50000) / 10, { recurring });
    });
    const o = offer({ items, unitPrice: 100, quantity: 1 + Math.floor(R() * 5), risks: R() < 0.5 ? [risk(R(), Math.round(R() * 20000))] : [],
      carbons: Array.from({ length: Math.floor(R() * 3) }, () => carbon(pick(['fabrication', 'transport', 'utilisation_annuelle', 'fin_de_vie'] as const), Math.round(R() * 800) / 10)) });
    return { p, o };
  });

  it.each(cases.map((c, i) => [i, c] as const))('cas %i', (_i, { p, o }) => {
    const e = TCOEngine.calculateOfferTCO(p, o);
    const ref = reference(p, o);
    near(e.economicTCONominal, ref.economic, 'TCO économique');
    near(e.riskExpositionTotal, ref.risk, 'risques');
    near(e.monetizedCarbonTotal, ref.carbon, 'carbone');
    near(e.totalComprehensiveTCO, ref.nominal, 'TCO complet');
    near(e.lifecycleCostLCC, ref.npv, 'LCC complet');
  });
});
