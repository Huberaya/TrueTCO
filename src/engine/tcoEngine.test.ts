/**
 * TrueTCO — Suite de tests du moteur TCO/LCC
 * ---------------------------------------------------------------------------
 * v2 : les tests certifiaient auparavant des trivialités (ex. TCO-05 vérifiait
 * seulement que le LCC était > 0, ce qu'un moteur cassé satisfait aussi).
 * Cette suite vérifie désormais des INVARIANTS financiers et des cas limites
 * concrets, exécutables aussi bien dans l'application qu'en CI
 * (`npm test` → src/engine/tcoEngine.spec.ts).
 */

import { TCOEngine, TCO_ENGINE_VERSION } from './tcoEngine';
import { Project, SupplierOffer } from '../types/domain';

export interface TestResultItem {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  expected: string;
  actual: string;
  durationMs: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function runAllTCOEngineTests(): {
  total: number;
  passed: number;
  failed: number;
  results: TestResultItem[];
} {
  const results: TestResultItem[] = [];

  const mockProject: Project = {
    id: 'proj-test',
    organizationId: 'org-test',
    name: 'Projet Test Flotte',
    reference: 'AO-2026-TEST',
    category: 'flotte_automobile',
    budgetCap: 1500000,
    currency: '€',
    horizonYears: 5,
    plannedVolume: 10,
    unitName: 'véhicules',
    purchaseFrequency: 'unique',
    objective: 'Test unitaire de robustesse financière',
    ownerId: 'usr-1',
    ownerName: 'Acheteur Senior',
    status: 'analyse',
    createdAt: '2026-03-01',
    updatedAt: '2026-03-15',
    discountRate: 0.05,
    carbonScenario: 'central',
    carbonPricePerTonne: 120,
    inflationRate: 0.02,
    energyInflationRate: 0.04,
  };

  const audited = (value: number, unit: string, confidenceLevel = 95, sourceType: any = 'verifiee') => ({
    value,
    unit,
    sourceType,
    sourceName: 'Devis contractuel ferme',
    confidenceLevel,
    lastUpdated: '2026-03-10',
    updatedBy: 'Acheteur',
  });

  const mockConventionalOffer: SupplierOffer = {
    id: 'off-conv',
    projectId: 'proj-test',
    supplierId: 'sup-conv',
    supplierName: 'Fournisseur Diesel Thermique',
    offerReference: 'DEV-TH-2026',
    isResponsibleCandidate: false,
    apparentUnitPrice: audited(28000, '€/véhicule', 98),
    quantity: 10,
    apparentTotal: 280000,
    deliveryLeadTimeWeeks: 4,
    warrantyMonths: 24,
    expectedLifespanYears: 5,
    costItems: [
      {
        id: 'c1',
        category: 'acquisition',
        label: 'Achat véhicules neufs',
        amount: audited(280000, '€', 98),
        isRecurringYearly: false,
      },
      {
        id: 'c2',
        category: 'energie_consommables',
        label: 'Carburant diesel annuel',
        amount: audited(36000, '€/an', 85, 'estimee'),
        isRecurringYearly: true,
        yearlyInflationType: 'energy',
      },
      {
        id: 'c3',
        category: 'maintenance_reparations',
        label: 'Entretien & vidanges annuels',
        amount: audited(12000, '€/an', 90),
        isRecurringYearly: true,
        yearlyInflationType: 'maintenance',
      },
    ],
    carbonItems: [
      {
        scope: 'Scope 1',
        lifecyclePhase: 'utilisation_annuelle',
        emissionsPerUnitTonneCO2e: audited(24, 'tCO2e/unité/an', 92, 'source_externe'),
        totalLifecycleEmissions: 240,
        emissionFactorSource: 'ADEME Base Empreinte',
      },
    ],
    riskItems: [
      {
        id: 'r1',
        label: 'Risque réglementaire ZFE',
        category: 'reglementaire',
        probability: audited(0.4, 'probabilité', 80, 'estimation'),
        financialImpact: audited(25000, '€', 80, 'estimation'),
        expectedLoss: 10000,
        probabilityType: 'estimation',
      },
    ],
    technicalSuitabilityScore: 70,
  };

  const mockElectricOffer: SupplierOffer = {
    id: 'off-elec',
    projectId: 'proj-test',
    supplierId: 'sup-elec',
    supplierName: 'Fournisseur Électrique',
    offerReference: 'DEV-EL-2026',
    isResponsibleCandidate: true,
    apparentUnitPrice: audited(36000, '€/véhicule', 98),
    quantity: 10,
    apparentTotal: 360000,
    deliveryLeadTimeWeeks: 8,
    warrantyMonths: 60,
    expectedLifespanYears: 5,
    costItems: [
      {
        id: 'e1',
        category: 'acquisition',
        label: 'Achat véhicules électriques',
        amount: audited(360000, '€', 98),
        isRecurringYearly: false,
      },
      {
        id: 'e2',
        category: 'installation_mise_en_service',
        label: 'Bornes de recharge et raccordement',
        amount: audited(45000, '€', 96),
        isRecurringYearly: false,
      },
      {
        id: 'e3',
        category: 'energie_consommables',
        label: 'Électricité annuelle',
        amount: audited(8000, '€/an', 88, 'estimee'),
        isRecurringYearly: true,
        yearlyInflationType: 'energy',
      },
      {
        id: 'e4',
        category: 'maintenance_reparations',
        label: 'Entretien annuel',
        amount: audited(6000, '€/an', 90),
        isRecurringYearly: true,
        yearlyInflationType: 'maintenance',
      },
      {
        id: 'e5',
        category: 'valeur_residuelle',
        label: 'Valeur de reprise garantie fin de vie',
        amount: audited(-30000, '€', 90),
        isRecurringYearly: false,
      },
    ],
    carbonItems: [
      {
        scope: 'Scope 3 - Amont',
        lifecyclePhase: 'fabrication',
        emissionsPerUnitTonneCO2e: audited(8, 'tCO2e/unité', 94, 'source_externe'),
        totalLifecycleEmissions: 80,
        emissionFactorSource: 'ADEME / ACV constructeur',
      },
      {
        scope: 'Scope 2',
        lifecyclePhase: 'utilisation_annuelle',
        emissionsPerUnitTonneCO2e: audited(1.5, 'tCO2e/unité/an', 92, 'source_externe'),
        totalLifecycleEmissions: 15,
        emissionFactorSource: 'RTE / ADEME',
      },
    ],
    riskItems: [],
    technicalSuitabilityScore: 92,
  };

  const check = (
    id: string,
    name: string,
    category: string,
    fn: () => { passed: boolean; expected: string; actual: string }
  ) => {
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    let outcome: { passed: boolean; expected: string; actual: string };
    try {
      outcome = fn();
    } catch (err: any) {
      outcome = { passed: false, expected: 'Exécution sans erreur', actual: `Exception : ${err?.message ?? err}` };
    }
    results.push({
      id,
      name,
      category,
      passed: outcome.passed,
      expected: outcome.expected,
      actual: outcome.actual,
      durationMs: Math.round(((typeof performance !== 'undefined' ? performance.now() : 0) - start) * 100) / 100,
    });
  };

  const conv = TCOEngine.calculateOfferTCO(mockProject, mockConventionalOffer);
  const elec = TCOEngine.calculateOfferTCO(mockProject, mockElectricOffer);

  // ---------------------------------------------------------------------------
  // TCO-01 — Prix d'acquisition
  // ---------------------------------------------------------------------------
  check('TCO-01', "Prix d'acquisition direct apparent conforme aux devis", 'Acquisition', () => ({
    passed: conv.apparentDirectCost === 280000 && elec.apparentDirectCost === 360000,
    expected: 'Conv: 280 000 €, Élec: 360 000 € (surcoût apparent +80 000 €)',
    actual: `Conv: ${conv.apparentDirectCost.toLocaleString('fr-FR')} €, Élec: ${elec.apparentDirectCost.toLocaleString('fr-FR')} €`,
  }));

  // ---------------------------------------------------------------------------
  // TCO-02 — Indexation énergétique (valeur exacte, pas une fourchette)
  // ---------------------------------------------------------------------------
  check('TCO-02', "Indexation de l'inflation énergétique cumulée sur l'horizon", 'Énergie', () => {
    // 36 000 €/an indexé à 4 % : 1 + 1,04 + 1,0816 + 1,124864 + 1,16985856 = 5,41632256
    const expected = round2(36000 * (1 + 1.04 + 1.04 ** 2 + 1.04 ** 3 + 1.04 ** 4));
    const actual = round2(conv.energyConsumablesTotal);
    return {
      passed: Math.abs(actual - expected) < 1,
      expected: `${expected.toLocaleString('fr-FR')} € (36 000 €/an à +4 %)`,
      actual: `${actual.toLocaleString('fr-FR')} €`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-03 — Risques et carbone
  // ---------------------------------------------------------------------------
  check('TCO-03', "Monétisation des externalités carbone et de l'exposition aux risques", 'Externalités & Risques', () => ({
    passed: conv.riskExpositionTotal === 10000 && conv.monetizedCarbonTotal === 28800,
    expected: 'Risque espéré : 10 000 € | Carbone (240 t × 120 €/t) : 28 800 €',
    actual: `Risque : ${conv.riskExpositionTotal.toLocaleString('fr-FR')} € | Carbone : ${conv.monetizedCarbonTotal.toLocaleString('fr-FR')} €`,
  }));

  // ---------------------------------------------------------------------------
  // TCO-04 — Point mort (méthode actualisée, cohérence avec le LCC)
  // ---------------------------------------------------------------------------
  check('TCO-04', "Détermination du point mort économique (crossover d'amortissement)", 'Point Mort', () => {
    const be = TCOEngine.calculateBreakEven(conv, elec, mockProject.horizonYears);
    const methodOk = be.method === 'discounted_cumulative_crossover';
    const signOk = be.hasBreakEven ? (be.breakEvenMonth ?? -1) >= 0 : (be.finalDiscountedDelta ?? 0) < 0;
    // Dépense Année 0 : acquisition (360 000 − 280 000) + bornes (45 000).
    // La valeur de reprise est un produit encaissé en dernière année, elle ne
    // réduit donc pas la dépense initiale (convention documentée).
    const outlayOk = be.initialOutlayDelta === 80000 + 45000;
    return {
      passed: methodOk && signOk && outlayOk,
      expected: `Méthode actualisée, dépense initiale réelle ${(80000 + 45000).toLocaleString('fr-FR')} €, résultat cohérent avec le signe du delta final`,
      actual: `Méthode: ${be.method} | Dépense initiale: ${(be.initialOutlayDelta ?? 0).toLocaleString('fr-FR')} € | ${
        be.hasBreakEven ? `point mort ${be.breakEvenMonth} mois` : `pas de point mort (écart final ${(be.finalDiscountedDelta ?? 0).toLocaleString('fr-FR')} €)`
      }`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-05 — Actualisation : INVARIANT Σ flux actualisés == LCC
  // ---------------------------------------------------------------------------
  check('TCO-05', 'Actualisation financière : Σ des flux actualisés = LCC (WACC 5 %)', 'LCC Actualisé', () => {
    const sumDiscounted = elec.cashFlowsByYear.reduce((a, c) => a + c.discountedCost, 0);
    const sumNominal = elec.cashFlowsByYear.reduce((a, c) => a + c.nominalCost, 0);
    const lccOk = Math.abs(sumDiscounted - elec.lifecycleCostLCC) <= 2;
    const tcoOk = Math.abs(sumNominal - elec.totalComprehensiveTCO) <= 2;
    const discountedLower = elec.lifecycleCostLCC !== sumNominal;
    return {
      passed: lccOk && tcoOk && discountedLower && elec.cashFlowsByYear.length === mockProject.horizonYears + 1,
      expected: 'Σ flux actualisés = LCC, Σ flux nominaux = TCO complet, périmètres identiques',
      actual: `Σ actualisé ${Math.round(sumDiscounted).toLocaleString('fr-FR')} € vs LCC ${elec.lifecycleCostLCC.toLocaleString('fr-FR')} € | Σ nominal ${Math.round(sumNominal).toLocaleString('fr-FR')} € vs TCO ${elec.totalComprehensiveTCO.toLocaleString('fr-FR')} €`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-06 — Neutralité : l'offre la moins coûteuse en VAN gagne
  // ---------------------------------------------------------------------------
  check('TCO-06', "Neutralité financière : aucune prime systématique à l'ESG", 'Gouvernance & Audit', () => {
    const overpriced: SupplierOffer = {
      ...mockElectricOffer,
      apparentUnitPrice: audited(95000, '€/véhicule', 98),
      costItems: mockElectricOffer.costItems.map((ci) =>
        ci.category === 'acquisition' ? { ...ci, amount: { ...ci.amount, value: 950000 } } : ci
      ),
    };
    const bad = TCOEngine.calculateOfferTCO(mockProject, overpriced);
    const be = TCOEngine.calculateBreakEven(conv, bad, mockProject.horizonYears);
    const conventionalWinsOnNpv = bad.lifecycleCostLCC > conv.lifecycleCostLCC;
    const conventionalWinsOnTco = bad.totalComprehensiveTCO > conv.totalComprehensiveTCO;
    const noBreakeven = !be.hasBreakEven;
    return {
      passed: conventionalWinsOnNpv && conventionalWinsOnTco && noBreakeven,
      expected: "L'offre conventionnelle est désignée meilleure (VAN et TCO) et aucun point mort n'est annoncé",
      actual: `VAN conv ${conv.lifecycleCostLCC.toLocaleString('fr-FR')} € < VAN ESG ${bad.lifecycleCostLCC.toLocaleString('fr-FR')} € | point mort : ${be.hasBreakEven ? be.breakEvenMonth + ' mois' : 'aucun'}`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-07 — Sensibilité : métrique unique et tri décroissant
  // ---------------------------------------------------------------------------
  check('TCO-07', 'Analyse de sensibilité Tornado (métrique unique, tri décroissant)', 'Sensibilité', () => {
    const drivers = TCOEngine.calculateSensitivity(mockProject, mockConventionalOffer, mockElectricOffer);
    const sameMetric = drivers.every((d) => d.metric === 'delta_comprehensive_npv');
    const sorted = drivers.every(
      (d, i) => i === 0 || Math.abs(drivers[i - 1].spreadOnDeltaTCO ?? 0) >= Math.abs(d.spreadOnDeltaTCO ?? 0)
    );
    const includesHorizon = drivers.some((d) => d.category === 'duree_de_vie');
    return {
      passed: drivers.length >= 5 && sameMetric && sorted && includesHorizon,
      expected: '5 drivers minimum, tous mesurés sur Δ VAN complet, triés par amplitude, horizon inclus',
      actual: `${drivers.length} drivers. ${drivers.map((d) => `${d.parameterName.split(' ')[0]}=${d.spreadOnDeltaTCO} €`).join(' | ')}`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-08 — Aucune perte silencieuse de poste de coût
  // ---------------------------------------------------------------------------
  check('TCO-08', 'Aucun poste de coût ignoré silencieusement (catégorie inconnue)', 'Traçabilité', () => {
    const weird: SupplierOffer = {
      ...mockConventionalOffer,
      costItems: [
        ...mockConventionalOffer.costItems,
        {
          id: 'cx',
          category: 'categorie_non_mappee' as any,
          label: 'Poste non mappé',
          amount: audited(500000, '€', 90),
          isRecurringYearly: false,
        },
      ],
    };
    const res = TCOEngine.calculateOfferTCO(mockProject, weird);
    const flagged = (res.warnings ?? []).some((w) => w.code === 'UNRECOGNIZED_COST_CATEGORY');
    return {
      passed: res.unallocatedCostTotal === 500000 && flagged && res.isComplete === false,
      expected: '500 000 € comptés comme coût + avertissement critique + isComplete = false',
      actual: `Non ventilé : ${(res.unallocatedCostTotal ?? 0).toLocaleString('fr-FR')} € | avertissement : ${flagged} | isComplete : ${res.isComplete}`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-09 — Occurrences annuelles honorées (imports ERP / IA)
  // ---------------------------------------------------------------------------
  check('TCO-09', 'Occurrences annuelles honorées (yearOccurrences / annualOccurrenceYears)', 'Intégrité des imports', () => {
    const withOccurrences: SupplierOffer = {
      ...mockConventionalOffer,
      costItems: [
        {
          id: 'occ',
          category: 'maintenance_reparations',
          label: 'Contrat de maintenance 5 ans',
          amount: audited(39000, '€/an', 95),
          isRecurringYearly: false,
          annualOccurrenceYears: [1, 2, 3, 4, 5],
        } as any,
      ],
    };
    const res = TCOEngine.calculateOfferTCO(mockProject, withOccurrences);
    const oneShot = 39000;
    return {
      passed: res.maintenanceRepairsTotal > oneShot * 4,
      expected: `> ${(oneShot * 4).toLocaleString('fr-FR')} € (le poste doit être compté 5 fois, pas une seule)`,
      actual: `${res.maintenanceRepairsTotal.toLocaleString('fr-FR')} €`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-10 — Pureté du moteur (aucune mutation des entrées)
  // ---------------------------------------------------------------------------
  check('TCO-10', "Pureté du moteur : aucune mutation des données d'entrée", 'Intégrité', () => {
    const before = JSON.stringify(mockConventionalOffer);
    TCOEngine.calculateOfferTCO(mockProject, mockConventionalOffer);
    const after = JSON.stringify(mockConventionalOffer);
    return {
      passed: before === after,
      expected: "L'objet offre est identique avant et après calcul",
      actual: before === after ? 'Aucune mutation détectée' : 'MUTATION DÉTECTÉE (effet de bord)',
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-11 — Scénarios relatifs aux hypothèses du projet
  // ---------------------------------------------------------------------------
  check('TCO-11', 'Scénarios relatifs aux hypothèses du projet (jamais de valeurs absolues codées)', 'Scénarios', () => {
    const highCarbon: Project = { ...mockProject, carbonPricePerTonne: 300, discountRate: 0.1 };
    const scenarios = TCOEngine.calculateScenarios(highCarbon, [mockConventionalOffer, mockElectricOffer]);
    const pess = scenarios.find((s) => s.scenarioName === 'Pessimiste')!;
    const cen = scenarios.find((s) => s.scenarioName === 'Central')!;
    const opt = scenarios.find((s) => s.scenarioName === 'Optimiste')!;
    const monotonic =
      pess.parameters.carbonPricePerTonne > cen.parameters.carbonPricePerTonne &&
      cen.parameters.carbonPricePerTonne > opt.parameters.carbonPricePerTonne &&
      pess.parameters.discountRate > cen.parameters.discountRate &&
      cen.parameters.discountRate > opt.parameters.discountRate;
    return {
      passed: monotonic && scenarios.every((s) => s.isRelativeToProjectBase === true),
      expected: 'Pessimiste > Central > Optimiste sur le carbone ET le WACC, quel que soit le projet',
      actual: `Carbone : ${pess.parameters.carbonPricePerTonne} / ${cen.parameters.carbonPricePerTonne} / ${opt.parameters.carbonPricePerTonne} €/t | WACC : ${(pess.parameters.discountRate * 100).toFixed(2)} / ${(cen.parameters.discountRate * 100).toFixed(2)} / ${(opt.parameters.discountRate * 100).toFixed(2)} %`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-12 — Qualité de données pondérée par la matérialité
  // ---------------------------------------------------------------------------
  check('TCO-12', 'Score de confiance pondéré par la matérialité (pas de défaut flatteur)', 'Qualité des données', () => {
    const lowQuality: SupplierOffer = {
      ...mockConventionalOffer,
      apparentUnitPrice: audited(28000, '€/véhicule', 0, 'manquante'),
      carbonItems: [],
      riskItems: [],
      costItems: [
        { id: 'q1', category: 'acquisition', label: 'Montant non sourcé', amount: audited(280000, '€', 0, 'manquante'), isRecurringYearly: false },
        { id: 'q2', category: 'maintenance_reparations', label: 'Devis ferme', amount: audited(12000, '€/an', 100), isRecurringYearly: true },
      ],
    };
    const res = TCOEngine.calculateOfferTCO(mockProject, lowQuality);
    const heavyLineDomination = res.dataQualityScore !== undefined && res.dataQualityScore < 30;
    return {
      passed: heavyLineDomination && (res.dataConfidenceBreakdown?.missingShare ?? 0) > 0.5,
      expected: 'Le poste majoritaire non sourcé fait chuter le score (< 30/100) et est signalé comme manquant',
      actual: `Score : ${res.dataQualityScore}/100 | part de données manquantes : ${((res.dataConfidenceBreakdown?.missingShare ?? 0) * 100).toFixed(0)} %`,
    };
  });

  // ---------------------------------------------------------------------------
  // TCO-13 — Traçabilité ligne à ligne (explicabilité)
  // ---------------------------------------------------------------------------
  check('TCO-13', 'Traçabilité ligne à ligne disponible pour chaque poste (explicabilité)', 'Explicabilité', () => {
    const traced = elec.costLineTrace ?? [];
    const allTraced = traced.length === mockElectricOffer.costItems.length;
    // Les traces portent le montant NOMINAL CUMULÉ de chaque ligne sur
    // l'horizon (indexation incluse). Les lignes de valeur résiduelle sont des
    // crédits : elles se déduisent du TCO. On vérifie donc l'identité
    // Σ coûts − Σ crédits == TCO économique nominal.
    const tracedCosts = traced.filter((t) => !t.isCredit).reduce((a, t) => a + t.amountNominal, 0);
    const tracedCredits = traced.filter((t) => t.isCredit).reduce((a, t) => a + t.amountNominal, 0);
    const coherent = Math.abs(tracedCosts - tracedCredits - elec.economicTCONominal) <= 1;
    const versioned = elec.engineVersion === TCO_ENGINE_VERSION && !!elec.methodology;
    return {
      passed: allTraced && coherent && versioned,
      expected: `1 trace par poste (${mockElectricOffer.costItems.length}), Σ coûts − Σ crédits = TCO économique nominal, version et méthodologie exposées`,
      actual: `${traced.length} traces | Σ coûts − Σ crédits = ${Math.round(tracedCosts - tracedCredits).toLocaleString('fr-FR')} € vs TCO éco ${elec.economicTCONominal.toLocaleString('fr-FR')} € | version : ${elec.engineVersion}`,
    };
  });

  const passedCount = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    results,
  };
}
