import { HyperFormula } from 'hyperformula';
import { describe, expect, it } from 'vitest';
import { TCOEngine } from '../../src/engine/tcoEngine';
import { buildReproducibleSheet, isFormula } from '../../src/services/reproducibleSheet';
import { carbon, item, offer, project, risk, rng } from './fixtures';

/**
 * Test « DAF » : la feuille de formules exportée, évaluée par un moteur de tableur INDÉPENDANT (HyperFormula),
 * retrouve exactement les chiffres du moteur TrueTCO.
 */
const evaluate = (p: Parameters<typeof buildReproducibleSheet>[0], o: Parameters<typeof buildReproducibleSheet>[1]) => {
  const s = buildReproducibleSheet(p, o);
  const hf = HyperFormula.buildFromArray(s.grid.map((r) => r.map((c) => (isFormula(c) ? `=${c.f}` : c))), { licenseKey: 'gpl-v3' });
  const at = (k: keyof typeof s.kpi) => Number(hf.getCellValue({ sheet: 0, row: s.kpi[k].row, col: s.kpi[k].col }));
  return { s, at, hf };
};
const close = (a: number, b: number) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(1e-6 * Math.max(1, Math.abs(b)));

describe('Feuille de formules reproductible vs moteur', () => {
  it("CHAQUE valeur en cache égale l'évaluation de sa formule par le tableur indépendant (cas complet)", () => {
    const o = offer({ items: [item('acquisition', 10), item('energie_consommables', 5, { recurring: true }), item('maintenance_reparations', 3, { recurring: true }), item('remplacement_pannes', 5, { occ: [2, 3] }), item('valeur_residuelle', 4)], risks: [risk(0.3, 20)], carbons: [carbon('fabrication', 2), carbon('utilisation_annuelle', 6), carbon('fin_de_vie', 1)] });
    const { s, hf } = evaluate(project({ inflationRate: 0.02, energyInflationRate: 0.04, modelAssumptions: { maintenanceWearRate: 0.03, failureAgingStartYear: 1, failureAgingRate: 0.08, carbonPriceGrowthRate: 0.05 } }), o);
    let n = 0;
    s.grid.forEach((row, r) => row.forEach((c, col) => {
      if (!isFormula(c)) return;
      n++;
      const v = Number(hf.getCellValue({ sheet: 0, row: r, col }));
      expect(Math.abs(v - c.v), `(${r},${col}) ${c.f}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(v)));
    }));
    expect(n).toBeGreaterThan(40);
  });

  it("valeur d'or : cas 1 → 1 991,35988 (Python) et 2 180 nominal", () => {
    const o = offer({ items: [item('acquisition', 1000), item('energie_consommables', 100, { recurring: true }), item('maintenance_reparations', 50, { recurring: true }), item('fin_de_vie_recyclage', 30), item('valeur_residuelle', -200)], risks: [risk(0.5, 600)], carbons: [carbon('utilisation_annuelle', 6)] });
    const { at } = evaluate(project(), o);
    expect(at('lcc')).toBeCloseTo(1991.35988, 5);
    expect(at('tcoNominal')).toBeCloseTo(2180, 9);
    expect(at('lccDirect')).toBeCloseTo(1245.304282, 5);
  });

  it('les formules sont VIVANTES : modifier une hypothèse recalcule (taux 10 % → 0 %)', () => {
    const o = offer({ items: [item('acquisition', 1000), item('energie_consommables', 100, { recurring: true })] });
    const { s, hf, at } = evaluate(project({ horizonYears: 3 }), o);
    const before = at('lcc');
    hf.setCellContents({ sheet: 0, row: 4, col: 1 }, 0);           // B5 = taux d'actualisation
    expect(Number(hf.getCellValue({ sheet: 0, row: s.kpi.lcc.row, col: s.kpi.lcc.col }))).toBeCloseTo(1300, 9);
    expect(before).toBeLessThan(1300);
  });

  it('aucune cellule en erreur sur un cas complet', () => {
    const o = offer({ items: [item('acquisition', 10), item('remplacement_pannes', 5, { occ: [2] }), item('risques_operationnels', 9)], risks: [risk(0.3, 20)], carbons: [carbon('fabrication', 2), carbon('fin_de_vie', 1)] });
    const { s, hf } = evaluate(project(), o);
    for (let r = 0; r < s.grid.length; r++) for (let c = 0; c < (s.grid[r]?.length ?? 0); c++) {
      const v = hf.getCellValue({ sheet: 0, row: r, col: c });
      expect(typeof v === 'object' && v !== null && 'type' in (v as object), `erreur en (${r},${c}) : ${JSON.stringify(v)}`).toBe(false);
    }
  });

  const R = rng(777);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const cases = Array.from({ length: 120 }, () => {
    const N = 1 + Math.floor(R() * 10);
    const p = project({ horizonYears: N as never, discountRate: R() * 0.15, inflationRate: R() * 0.06, energyInflationRate: R() * 0.1, carbonPricePerTonne: R() * 300,
      modelAssumptions: { maintenanceWearRate: R() * 0.06, failureAgingStartYear: Math.floor(R() * 5), failureAgingRate: R() * 0.15, carbonPriceGrowthRate: R() * 0.08 } });
    const cats = ['acquisition', 'logistique_douanes', 'installation_mise_en_service', 'energie_consommables', 'maintenance_reparations', 'remplacement_pannes', 'couts_administratifs_conformite', 'fin_de_vie_recyclage', 'valeur_residuelle', 'risques_operationnels'] as const;
    const items = Array.from({ length: 1 + Math.floor(R() * 8) }, () => {
      const cat = pick([...cats]);
      const recurring = ['energie_consommables', 'maintenance_reparations', 'remplacement_pannes', 'couts_administratifs_conformite'].includes(cat) && R() < 0.6;
      const occ = !recurring && R() < 0.3 ? [Math.floor(R() * (N + 1))] : undefined;
      return item(cat, Math.round(R() * 50000) / 10 * (R() < 0.1 ? -1 : 1), { recurring, occ });
    });
    const o = offer({ items, unitPrice: 100, quantity: 1 + Math.floor(R() * 5), risks: R() < 0.5 ? [risk(R() * 1.3, Math.round(R() * 20000))] : [],
      carbons: Array.from({ length: Math.floor(R() * 3) }, () => carbon(pick(['fabrication', 'transport', 'utilisation_annuelle', 'fin_de_vie'] as const), Math.round(R() * 800) / 10)) });
    return { p, o };
  });
  it.each(cases.map((c, i) => [i, c] as const))('cas aléatoire %i : tableur = moteur', (_i, { p, o }) => {
    const e = TCOEngine.calculateOfferTCO(p, o).exact;
    const { at } = evaluate(p, o);
    close(at('tcoNominal'), e.totalComprehensiveTCO);
    close(at('lcc'), e.lifecycleCostLCC);
    close(at('tcoDirect'), e.economicTCONominal);
    close(at('lccDirect'), e.lifecycleCostDirect);
    close(at('riskNominal'), e.riskExpositionTotal);
    close(at('carbonNominal'), e.monetizedCarbonTotal);
  });

  it.each(cases.slice(0, 40).map((c, i) => [i, c] as const))('cas aléatoire %i : valeurs en cache = formules', (_i, { p, o }) => {
    const { s, hf } = evaluate(p, o);
    s.grid.forEach((row, r) => row.forEach((c, col) => { if (isFormula(c)) close(Number(hf.getCellValue({ sheet: 0, row: r, col })), c.v); }));
  });
});
