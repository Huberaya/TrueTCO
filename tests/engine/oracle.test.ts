import { describe, expect, it } from 'vitest';
import { TCOEngine } from '../../src/engine/tcoEngine';
import { carbon, deepFreeze, item, offer, project, risk, rng } from './fixtures';
import { reference } from './reference';

const close = (a: number, b: number, tol = 1e-6) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(b)));

describe('Valeurs d\'or (calculées indépendamment en Python, pas par le moteur)', () => {
  // Cas 1 : N=3, r=10 %, pas d'inflation. Acquisition 1000 ; énergie 100/an ; maintenance 50/an ; fin de vie 30 ; résiduel 200 ;
  // carbone 6 t en usage à 100 €/t ; risque p=0,5 × 600.
  const p = project();
  const o = offer({ items: [item('acquisition', 1000), item('energie_consommables', 100, { recurring: true }), item('maintenance_reparations', 50, { recurring: true }),
    item('fin_de_vie_recyclage', 30), item('valeur_residuelle', -200)], risks: [risk(0.5, 600)], carbons: [carbon('utilisation_annuelle', 6)] });
  const r = TCOEngine.calculateOfferTCO(p, o);

  it('TCO nominal économique, risque, carbone et total', () => {
    expect(r.exact.economicTCONominal).toBeCloseTo(1280, 9);
    expect(r.exact.riskExpositionTotal).toBeCloseTo(300, 9);
    expect(r.exact.monetizedCarbonTotal).toBeCloseTo(600, 9);
    expect(r.exact.totalComprehensiveTCO).toBeCloseTo(2180, 9);
  });
  it('coût complet ACTUALISÉ = 1 991,359880 (et non 1 991,28 : erreur de calcul mental écartée par l\'oracle)', () => {
    expect(r.exact.lifecycleCostLCC).toBeCloseTo(1991.35988, 5);
    expect(r.exact.lifecycleCostDirect).toBeCloseTo(1245.304282, 5);
    expect(r.exact.lifecycleCostLCCExCarbon).toBeCloseTo(1493.989482, 5);
  });
  it('RÉGRESSION v1 : le LCC inclut le carbone (écart avec « hors carbone » = valeur actualisée du carbone 497,370398)', () => {
    expect(r.exact.lifecycleCostLCC - r.exact.lifecycleCostLCCExCarbon).toBeCloseTo(497.370398, 5);
  });
  it('flux annuels : [1000, 450, 450, 280]', () => {
    expect(r.cashFlowsByYear.map((c) => c.nominalCost)).toEqual([1000, 450, 450, 280]);
    expect(r.cashFlowsByYear[3].cumulativeDiscountedCost).toBeCloseTo(r.exact.lifecycleCostLCC, 9);
  });
  it('champs arrondis cohérents avec les valeurs exactes (± 0,5 €)', () => {
    expect(Math.abs(r.lifecycleCostLCC - r.exact.lifecycleCostLCC)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.totalComprehensiveTCO - r.exact.totalComprehensiveTCO)).toBeLessThanOrEqual(0.5);
  });

  it('cas 2 — inflation, usure de la maintenance, vieillissement des remplacements (N=5, r=6 %)', () => {
    const p2 = project({ horizonYears: 5, discountRate: 0.06, inflationRate: 0.02, energyInflationRate: 0.04,
      modelAssumptions: { maintenanceWearRate: 0.03, failureAgingStartYear: 3, failureAgingRate: 0.08, carbonPriceGrowthRate: 0 } });
    const o2 = offer({ items: [item('energie_consommables', 1000, { recurring: true }), item('maintenance_reparations', 400, { recurring: true }), item('remplacement_pannes', 300, { recurring: true })] });
    const r2 = TCOEngine.calculateOfferTCO(p2, o2);
    const expected = [0, 1700.0, 1766.24, 1834.8496, 1931.38208, 2031.474559];
    r2.cashFlowsByYear.forEach((cf, t) => expect(cf.nominalCost).toBeCloseTo(expected[t], 5));
    expect(r2.exact.totalComprehensiveTCO).toBeCloseTo(9263.946239, 5);
    expect(r2.exact.lifecycleCostLCC).toBeCloseTo(7764.167477, 5);
  });

  it('cas 3 — carbone par phase avec prix croissant de 5 %/an (N=4)', () => {
    const p3 = project({ horizonYears: 4, discountRate: 0, modelAssumptions: { carbonPriceGrowthRate: 0.05 } as never });
    const o3 = offer({ items: [item('acquisition', 1)], carbons: [carbon('fabrication', 3), carbon('utilisation_annuelle', 8), carbon('fin_de_vie', 2)] });
    const r3 = TCOEngine.calculateOfferTCO(p3, o3);
    [300, 210, 220.5, 231.525, 486.2025].forEach((v, t) => expect(r3.cashFlowsByYear[t].carbonCostNominal).toBeCloseTo(v, 6));
    expect(r3.exact.monetizedCarbonTotal).toBeCloseTo(1448.2275, 6);
  });
});

describe('Conventions et cas limites', () => {
  it('taux nul : le coût actualisé égale le coût nominal (pas de division par zéro)', () => {
    const r = TCOEngine.calculateOfferTCO(project({ discountRate: 0 }), offer({ items: [item('acquisition', 500), item('maintenance_reparations', 20, { recurring: true })], risks: [risk(0.2, 100)] }));
    expect(r.exact.lifecycleCostLCC).toBeCloseTo(r.exact.totalComprehensiveTCO, 9);
  });

  it('RÉGRESSION : un taux d\'actualisation de 0 % est respecté (l\'ancien « || 0,05 » le remplaçait)', () => {
    const r = TCOEngine.calculateOfferTCO(project({ discountRate: 0 }), offer({ items: [item('acquisition', 100), item('energie_consommables', 10, { recurring: true })] }));
    expect(r.discountRateUsed).toBe(0);
    expect(r.exact.lifecycleCostLCC).toBeCloseTo(130, 9);
  });

  it('valeur résiduelle : le signe saisi est neutralisé, c\'est toujours un crédit', () => {
    const base = [item('acquisition', 1000)];
    const a = TCOEngine.calculateOfferTCO(project(), offer({ items: [...base, item('valeur_residuelle', 200)] }));
    const b = TCOEngine.calculateOfferTCO(project(), offer({ items: [...base, item('valeur_residuelle', -200)] }));
    expect(a.exact.economicTCONominal).toBeCloseTo(800, 9);
    expect(b.exact.economicTCONominal).toBeCloseTo(800, 9);
  });

  it('poste ponctuel daté : appliqué à chaque année listée, indexé sur l\'inflation, sans avertissement de date', () => {
    const p = project({ horizonYears: 5, inflationRate: 0.1, discountRate: 0 });
    const r = TCOEngine.calculateOfferTCO(p, offer({ items: [item('remplacement_pannes', 100, { occ: [2, 4] })] }));
    expect(r.cashFlowsByYear[2].nominalCost).toBeCloseTo(110, 9);
    expect(r.cashFlowsByYear[4].nominalCost).toBeCloseTo(133.1, 9);
    expect(r.warnings.map((w) => w.code)).not.toContain('TIMING_UNSPECIFIED');
  });

  it('poste ponctuel SANS année : placé en année 1 ET signalé', () => {
    const r = TCOEngine.calculateOfferTCO(project(), offer({ items: [item('remplacement_pannes', 100)] }));
    expect(r.cashFlowsByYear[1].nominalCost).toBeCloseTo(100, 9);
    expect(r.warnings.map((w) => w.code)).toContain('TIMING_UNSPECIFIED');
  });

  it('catégories « risques_operationnels » / « externalite_carbone » : ignorées (double comptage) et signalées', () => {
    const r = TCOEngine.calculateOfferTCO(project(), offer({ items: [item('acquisition', 100), item('risques_operationnels', 999), item('externalite_carbone', 999)] }));
    expect(r.exact.totalComprehensiveTCO).toBeCloseTo(100, 9);
    expect(r.warnings.filter((w) => w.code === 'IGNORED_CATEGORY')).toHaveLength(2);
  });

  it('unité « €/an » sur un poste non récurrent : compté une fois, signalé (jamais converti en silence)', () => {
    const it = item('maintenance_reparations', 100, { unit: '€/an' });
    const r = TCOEngine.calculateOfferTCO(project({ discountRate: 0 }), offer({ items: [it] }));
    expect(r.exact.totalComprehensiveTCO).toBeCloseTo(100, 9);
    expect(r.warnings.map((w) => w.code)).toContain('UNIT_RECURRENCE_MISMATCH');
  });

  it('émissions « par unité et par an » : × quantité × horizon', () => {
    const c = { ...carbon('utilisation_annuelle', 0), totalLifecycleEmissions: 0 as number, emissionsPerUnitTonneCO2e: { ...carbon('utilisation_annuelle', 0).emissionsPerUnitTonneCO2e!, value: 2, unit: 'tCO2e/unité/an' } };
    const r = TCOEngine.calculateOfferTCO(project({ horizonYears: 5, discountRate: 0 }), offer({ quantity: 10, items: [item('acquisition', 1)], carbons: [c] }));
    expect(r.totalLifecycleCO2eTonnes).toBeCloseTo(100, 6);
  });

  it('total carbone déclaré incohérent avec le recalcul : signalé', () => {
    const c = { ...carbon('fabrication', 50), emissionsPerUnitTonneCO2e: { ...carbon('fabrication', 1).emissionsPerUnitTonneCO2e!, value: 1, unit: 'tCO2e' } };
    const r = TCOEngine.calculateOfferTCO(project(), offer({ quantity: 10, items: [item('acquisition', 1)], carbons: [c] }));
    expect(r.warnings.map((w) => w.code)).toContain('CARBON_TOTAL_MISMATCH');
  });

  it('prix du devis utilisé si aucun poste « acquisition » — et signalé', () => {
    const r = TCOEngine.calculateOfferTCO(project(), offer({ unitPrice: 250, quantity: 4, items: [item('maintenance_reparations', 10, { recurring: true })] }));
    expect(r.acquisitionTotal).toBe(1000);
    expect(r.warnings.map((w) => w.code)).toContain('ACQUISITION_FROM_QUOTE');
  });

  it('durée de vie < horizon : signalée (aucun rachat n\'est inventé)', () => {
    const r = TCOEngine.calculateOfferTCO(project({ horizonYears: 5 }), offer({ lifespan: 3, items: [item('acquisition', 100)] }));
    expect(r.warnings.map((w) => w.code)).toContain('LIFESPAN_SHORTER_THAN_HORIZON');
    expect(r.exact.totalComprehensiveTCO).toBeCloseTo(100, 9);
  });

  it('probabilité hors [0 ; 1] : bornée et signalée', () => {
    const r = TCOEngine.calculateOfferTCO(project(), offer({ items: [item('acquisition', 1)], risks: [risk(1.5, 100)] }));
    expect(r.exact.riskExpositionTotal).toBeCloseTo(100, 9);
    expect(r.warnings.map((w) => w.code)).toContain('RISK_PROBABILITY_CLAMPED');
  });

  it('paramètre de projet manquant : valeur de repli SIGNALÉE (pas de défaut silencieux)', () => {
    const r = TCOEngine.calculateOfferTCO({ ...project(), inflationRate: undefined as never }, offer({ items: [item('acquisition', 1)] }));
    expect(r.warnings.map((w) => w.code)).toContain('MISSING_PROJECT_PARAMETER');
  });

  it('aucune offre : résultat nul sans exception', () => {
    expect(TCOEngine.calculateOfferTCO(project(), null).totalComprehensiveTCO).toBe(0);
  });

  it('RÉGRESSION : les entrées ne sont jamais modifiées (la v1 écrivait totalLifecycleEmissions)', () => {
    const p = deepFreeze(project());
    const a = deepFreeze(offer({ items: [item('acquisition', 100), item('maintenance_reparations', 10, { recurring: true })], carbons: [carbon('utilisation_annuelle', 5)], risks: [risk(0.1, 50)] }));
    const b = deepFreeze(offer({ items: [item('acquisition', 200)] }));
    expect(() => { TCOEngine.calculateOfferTCO(p, a); TCOEngine.calculateBreakEven(TCOEngine.calculateOfferTCO(p, a), TCOEngine.calculateOfferTCO(p, b)); TCOEngine.calculateSensitivity(p, a, b); TCOEngine.calculateScenarios(p, [a, b]); TCOEngine.calculateRobustness(p, a, b, { draws: 50 }); }).not.toThrow();
  });

  it('RÉGRESSION : plus d\'« intervalle de confiance à 90 % » inventé ; fourchette fondée sur les scénarios', () => {
    const r = TCOEngine.calculateOfferTCO(project({ inflationRate: 0.02, energyInflationRate: 0.04 }), offer({ items: [item('acquisition', 1000), item('energie_consommables', 100, { recurring: true })], carbons: [carbon('utilisation_annuelle', 10)] }));
    expect(r.uncertaintyRange).toEqual(expect.objectContaining({ basis: 'scenarios' }));
    expect(JSON.stringify(r.uncertaintyRange)).not.toMatch(/confidenceInterval/);
    expect(r.uncertaintyRange.minTCO).toBeLessThanOrEqual(r.totalComprehensiveTCO);
    expect(r.uncertaintyRange.maxTCO).toBeGreaterThanOrEqual(r.totalComprehensiveTCO);
    expect(r.uncertaintyRange.maxTCO).toBeGreaterThan(r.uncertaintyRange.minTCO);
  });

  it('qualité des données pondérée par le poids financier (une petite donnée fiable ne masque pas une grosse donnée douteuse)', () => {
    const r = TCOEngine.calculateOfferTCO(project(), offer({ items: [item('acquisition', 100000, { conf: 10 }), item('maintenance_reparations', 10, { conf: 100 })] }));
    expect(r.dataQualityScore).toBeLessThan(15);
    expect(TCOEngine.calculateOfferTCO(project(), offer()).dataQualityScore).toBe(0); // aucune donnée => 0, plus de « 75 » par défaut
  });
});

describe('Test différentiel : moteur vs implémentation de référence indépendante (300 cas aléatoires)', () => {
  const R = rng(1234);
  const pick = <T,>(a: T[]) => a[Math.floor(R() * a.length)];
  const cases = Array.from({ length: 300 }, () => {
    const N = 1 + Math.floor(R() * 10);
    const p = project({ horizonYears: N as never, discountRate: R() * 0.15, inflationRate: R() * 0.06, energyInflationRate: R() * 0.1, carbonPricePerTonne: R() * 300,
      modelAssumptions: { maintenanceWearRate: R() * 0.06, failureAgingStartYear: Math.floor(R() * 5), failureAgingRate: R() * 0.15, carbonPriceGrowthRate: R() * 0.08 } });
    const cats = ['acquisition', 'logistique_douanes', 'installation_mise_en_service', 'energie_consommables', 'maintenance_reparations', 'remplacement_pannes', 'couts_administratifs_conformite', 'fin_de_vie_recyclage', 'valeur_residuelle'] as const;
    const items = Array.from({ length: 1 + Math.floor(R() * 8) }, () => {
      const cat = pick([...cats]);
      const recurring = ['energie_consommables', 'maintenance_reparations', 'remplacement_pannes', 'couts_administratifs_conformite'].includes(cat) && R() < 0.6;
      const occ = !recurring && R() < 0.3 && ['remplacement_pannes', 'maintenance_reparations', 'energie_consommables', 'couts_administratifs_conformite'].includes(cat) ? [1 + Math.floor(R() * N)] : undefined;
      return item(cat, Math.round(R() * 50000) / 10, { recurring, occ });
    });
    const o = offer({ items, unitPrice: 100, quantity: 1 + Math.floor(R() * 5),
      risks: R() < 0.5 ? [risk(R(), Math.round(R() * 20000))] : [],
      carbons: Array.from({ length: Math.floor(R() * 3) }, () => carbon(pick(['fabrication', 'transport', 'utilisation_annuelle', 'fin_de_vie'] as const), Math.round(R() * 800) / 10)) });
    return { p, o };
  });

  it.each(cases.map((c, i) => [i, c] as const))('cas %i', (_i, { p, o }) => {
    const e = TCOEngine.calculateOfferTCO(p, o);
    const ref = reference(p, o);
    close(e.exact.totalComprehensiveTCO, ref.nominal);
    close(e.exact.economicTCONominal, ref.economic);
    close(e.exact.riskExpositionTotal, ref.risk);
    close(e.exact.monetizedCarbonTotal, ref.carbon);
    close(e.exact.lifecycleCostLCC, ref.npv);
    close(e.exact.lifecycleCostDirect, ref.npvDirect);
    close(e.exact.lifecycleCostLCCExCarbon, ref.npvExCarbon);
    e.cashFlowsByYear.forEach((cf, t) => close(cf.nominalCost, ref.flows[t]));
  });
});

describe('Propriétés mathématiques', () => {
  const R = rng(99);
  const randOffer = () => offer({ items: [item('acquisition', 100 + R() * 1000), item('energie_consommables', R() * 200, { recurring: true }), item('maintenance_reparations', R() * 100, { recurring: true }), item('fin_de_vie_recyclage', R() * 50)],
    risks: [risk(R(), R() * 1000)], carbons: [carbon('utilisation_annuelle', R() * 50), carbon('fabrication', R() * 20)] });
  const p = project({ horizonYears: 6 as never, discountRate: 0.07, inflationRate: 0.02, energyInflationRate: 0.03 });

  it('homogénéité : multiplier tous les montants par k multiplie tous les totaux par k', () => {
    for (let i = 0; i < 25; i++) {
      const o = randOffer(); const k = 0.5 + R() * 5;
      const scaled = { ...o, apparentUnitPrice: { ...o.apparentUnitPrice, value: o.apparentUnitPrice.value * k }, costItems: o.costItems.map((c) => ({ ...c, amount: { ...c.amount, value: c.amount.value * k } })),
        riskItems: o.riskItems.map((r) => ({ ...r, financialImpact: { ...r.financialImpact, value: r.financialImpact.value * k } })) };
      const a = TCOEngine.calculateOfferTCO(p, o), b = TCOEngine.calculateOfferTCO({ ...p, carbonPricePerTonne: p.carbonPricePerTonne * k }, scaled);
      close(b.exact.lifecycleCostLCC, a.exact.lifecycleCostLCC * k, 1e-9);
      close(b.exact.totalComprehensiveTCO, a.exact.totalComprehensiveTCO * k, 1e-9);
    }
  });

  it("l'ordre des postes ne change pas le résultat", () => {
    for (let i = 0; i < 25; i++) {
      const o = randOffer(); const shuffled = { ...o, costItems: [...o.costItems].reverse() };
      close(TCOEngine.calculateOfferTCO(p, shuffled).exact.lifecycleCostLCC, TCOEngine.calculateOfferTCO(p, o).exact.lifecycleCostLCC, 1e-12);
    }
  });

  it('additivité : LCC complet = direct + VA(risque) + VA(carbone)', () => {
    for (let i = 0; i < 25; i++) {
      const o = randOffer(); const e = TCOEngine.calculateOfferTCO(p, o);
      const pv = (k: 'risk' | 'carbon') => e.cashFlowsByYear.reduce((s, c) => s + c.components![k] * c.discountFactor, 0);
      close(e.exact.lifecycleCostLCC, e.exact.lifecycleCostDirect + pv('risk') + pv('carbon'), 1e-5);
    }
  });

  it('un taux plus élevé ne peut qu\'abaisser le coût actualisé de flux positifs', () => {
    for (let i = 0; i < 25; i++) {
      const o = offer({ items: [item('acquisition', 100 + R() * 500), item('energie_consommables', R() * 200, { recurring: true }), item('maintenance_reparations', R() * 80, { recurring: true })], carbons: [carbon('utilisation_annuelle', R() * 30)] });
      const l = [0, 0.03, 0.08, 0.15].map((r) => TCOEngine.calculateOfferTCO(project({ horizonYears: 6 as never, discountRate: r }), o).exact.lifecycleCostLCC);
      for (let k = 1; k < l.length; k++) expect(l[k]).toBeLessThanOrEqual(l[k - 1] + 1e-9);
    }
  });

  it('le cumul actualisé de la dernière année égale le LCC ; les composantes somment au flux annuel', () => {
    const e = TCOEngine.calculateOfferTCO(p, randOffer());
    close(e.cashFlowsByYear.at(-1)!.cumulativeDiscountedCost, e.exact.lifecycleCostLCC, 1e-12);
    for (const c of e.cashFlowsByYear) close(Object.values(c.components!).reduce((s, x) => s + x, 0), c.nominalCost, 1e-12);
  });
});
