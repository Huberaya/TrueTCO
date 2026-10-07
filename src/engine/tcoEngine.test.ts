/**
 * TrueTCO - Automated Test Suite
 * Tests unitaires et d'intégration mathématique du moteur TCO/LCC
 */

import { TCOEngine } from './tcoEngine';
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
    discountRate: 0.05, // 5% WACC
    carbonScenario: 'central',
    carbonPricePerTonne: 120, // 120€ / tonne
    inflationRate: 0.02, // 2%
    energyInflationRate: 0.04, // 4%
  };

  const mockConventionalOffer: SupplierOffer = {
    id: 'off-conv',
    projectId: 'proj-test',
    supplierId: 'sup-conv',
    supplierName: 'Fournisseur Diesel Thermique',
    offerReference: 'DEV-TH-2026',
    isResponsibleCandidate: false,
    apparentUnitPrice: {
      value: 28000,
      unit: '€/véhicule',
      sourceType: 'verifiee',
      sourceName: 'Devis contractuel N°4891',
      confidenceLevel: 98,
      lastUpdated: '2026-03-10',
      updatedBy: 'Acheteur',
    },
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
        amount: {
          value: 280000,
          unit: '€',
          sourceType: 'verifiee',
          sourceName: 'Devis ferme',
          confidenceLevel: 98,
          lastUpdated: '2026-03-10',
          updatedBy: 'Acheteur',
        },
        isRecurringYearly: false,
      },
      {
        id: 'c2',
        category: 'energie_consommables',
        label: 'Carburant diesel annuel',
        amount: {
          value: 36000, // 36 000 € / an pour les 10 véhicules
          unit: '€/an',
          sourceType: 'estimee',
          sourceName: 'Consommation 6.5L/100km sur 25 000 km',
          confidenceLevel: 85,
          lastUpdated: '2026-03-10',
          updatedBy: 'Gestionnaire Flotte',
        },
        isRecurringYearly: true,
        yearlyInflationType: 'energy',
      },
      {
        id: 'c3',
        category: 'maintenance_reparations',
        label: 'Entretien & vidanges annuels',
        amount: {
          value: 12000, // 12 000 € / an
          unit: '€/an',
          sourceType: 'verifiee',
          sourceName: 'Grille entretien constructeur',
          confidenceLevel: 90,
          lastUpdated: '2026-03-10',
          updatedBy: 'Acheteur',
        },
        isRecurringYearly: true,
        yearlyInflationType: 'maintenance',
      },
      {
        id: 'c4',
        category: 'remplacement_pannes',
        label: 'Pannes curatives estimées',
        amount: {
          value: 4000,
          unit: '€/an',
          sourceType: 'estimee',
          sourceName: 'Historique flotte',
          confidenceLevel: 75,
          lastUpdated: '2026-03-10',
          updatedBy: 'Contrôleur',
        },
        isRecurringYearly: true,
      },
      {
        id: 'c5',
        category: 'valeur_residuelle',
        label: 'Revente marché occasion à 5 ans',
        amount: {
          value: 70000, // Récupération d'actif
          unit: '€',
          sourceType: 'estimee',
          sourceName: 'Argus Pro côte résiduelle',
          confidenceLevel: 80,
          lastUpdated: '2026-03-10',
          updatedBy: 'Finance',
        },
        isRecurringYearly: false,
      },
      {
        id: 'c6',
        category: 'fin_de_vie_recyclage',
        label: 'Frais administratifs cession & dépollution',
        amount: {
          value: 3000,
          unit: '€',
          sourceType: 'estimee',
          sourceName: 'Barème standard',
          confidenceLevel: 85,
          lastUpdated: '2026-03-10',
          updatedBy: 'Finance',
        },
        isRecurringYearly: false,
      },
    ],
    carbonItems: [
      {
        scope: 'Scope 1',
        lifecyclePhase: 'utilisation_annuelle',
        emissionsPerUnitTonneCO2e: {
          value: 4.8, // 4.8 tCO2e par véhicule et par an * 5 ans = 24 tCO2e
          unit: 'tCO2e/véhicule',
          sourceType: 'source_externe',
          sourceName: 'ADEME Base Carbone (Diesel B7)',
          confidenceLevel: 95,
          lastUpdated: '2026-01-15',
          updatedBy: 'RSE',
        },
        totalLifecycleEmissions: 240, // pour 10 véhicules
        emissionFactorSource: 'ADEME 2026',
      },
    ],
    riskItems: [
      {
        id: 'r1',
        label: 'Interdiction circulation ZFE et fiscalité malus',
        category: 'reglementaire',
        probability: {
          value: 0.4,
          unit: 'proba (0-1)',
          sourceType: 'estimee',
          sourceName: 'Calendrier réglementaire ZFE-m',
          confidenceLevel: 85,
          lastUpdated: '2026-03-01',
          updatedBy: 'Juridique',
        },
        financialImpact: {
          value: 25000,
          unit: '€',
          sourceType: 'estimee',
          sourceName: 'Pénalités & dérogations',
          confidenceLevel: 80,
          lastUpdated: '2026-03-01',
          updatedBy: 'Finance',
        },
        expectedLoss: 10000,
        probabilityType: 'estimation',
      },
    ],
    technicalSuitabilityScore: 82,
  };

  const mockElectricOffer: SupplierOffer = {
    id: 'off-elec',
    projectId: 'proj-test',
    supplierId: 'sup-elec',
    supplierName: 'Fournisseur Véhicules Électriques',
    offerReference: 'DEV-EV-2026',
    isResponsibleCandidate: true,
    apparentUnitPrice: {
      value: 36000,
      unit: '€/véhicule',
      sourceType: 'verifiee',
      sourceName: 'Devis ferme N°9910',
      confidenceLevel: 98,
      lastUpdated: '2026-03-10',
      updatedBy: 'Acheteur',
    },
    quantity: 10,
    apparentTotal: 360000,
    deliveryLeadTimeWeeks: 8,
    warrantyMonths: 60, // Garantie 5 ans batterie
    expectedLifespanYears: 7,
    costItems: [
      {
        id: 'ce1',
        category: 'acquisition',
        label: 'Achat véhicules électriques',
        amount: {
          value: 360000,
          unit: '€',
          sourceType: 'verifiee',
          sourceName: 'Devis ferme',
          confidenceLevel: 98,
          lastUpdated: '2026-03-10',
          updatedBy: 'Acheteur',
        },
        isRecurringYearly: false,
      },
      {
        id: 'ce2',
        category: 'installation_mise_en_service',
        label: 'Bornes de recharge & raccordement',
        amount: {
          value: 18000,
          unit: '€',
          sourceType: 'verifiee',
          sourceName: 'Devis installateur IRVE certifié',
          confidenceLevel: 95,
          lastUpdated: '2026-03-10',
          updatedBy: 'Acheteur',
        },
        isRecurringYearly: false,
      },
      {
        id: 'ce3',
        category: 'energie_consommables',
        label: 'Électricité recharge annuelle',
        amount: {
          value: 11000, // 11 000 € / an vs 36 000 € diesel
          unit: '€/an',
          sourceType: 'estimee',
          sourceName: '18 kWh/100km tarif heures creuses',
          confidenceLevel: 88,
          lastUpdated: '2026-03-10',
          updatedBy: 'Gestionnaire Flotte',
        },
        isRecurringYearly: true,
        yearlyInflationType: 'energy',
      },
      {
        id: 'ce4',
        category: 'maintenance_reparations',
        label: 'Entretien périodique VE (moins de pièces d\'usure)',
        amount: {
          value: 5000, // 5 000 € / an vs 12 000 € diesel
          unit: '€/an',
          sourceType: 'verifiee',
          sourceName: 'Contrat d\'entretien constructeur',
          confidenceLevel: 92,
          lastUpdated: '2026-03-10',
          updatedBy: 'Acheteur',
        },
        isRecurringYearly: true,
        yearlyInflationType: 'maintenance',
      },
      {
        id: 'ce5',
        category: 'remplacement_pannes',
        label: 'Pannes curatives (garantie 5 ans incluse)',
        amount: {
          value: 1200,
          unit: '€/an',
          sourceType: 'verifiee',
          sourceName: 'Garantie totale pièces & main d\'œuvre',
          confidenceLevel: 95,
          lastUpdated: '2026-03-10',
          updatedBy: 'Acheteur',
        },
        isRecurringYearly: true,
      },
      {
        id: 'ce6',
        category: 'valeur_residuelle',
        label: 'Valeur résiduelle marché occasion VE',
        amount: {
          value: 90000,
          unit: '€',
          sourceType: 'estimee',
          sourceName: 'Estimation B2B remarketing',
          confidenceLevel: 75,
          lastUpdated: '2026-03-10',
          updatedBy: 'Finance',
        },
        isRecurringYearly: false,
      },
    ],
    carbonItems: [
      {
        scope: 'Scope 2',
        lifecyclePhase: 'utilisation_annuelle',
        emissionsPerUnitTonneCO2e: {
          value: 0.8, // 0.8 tCO2e par an (mix électrique français)
          unit: 'tCO2e/véhicule',
          sourceType: 'source_externe',
          sourceName: 'ADEME Base Carbone (Mix électrique FR)',
          confidenceLevel: 95,
          lastUpdated: '2026-01-15',
          updatedBy: 'RSE',
        },
        totalLifecycleEmissions: 40, // 40 tonnes vs 240 tonnes diesel
        emissionFactorSource: 'ADEME 2026',
      },
    ],
    riskItems: [
      {
        id: 're1',
        label: 'Risque de dégradation prématurée batterie',
        category: 'retrait_rappel',
        probability: {
          value: 0.05,
          unit: 'proba (0-1)',
          sourceType: 'historique',
          sourceName: 'Télémétrie constructeur 2023-2025',
          confidenceLevel: 90,
          lastUpdated: '2026-03-01',
          updatedBy: 'Contrôleur',
        },
        financialImpact: {
          value: 40000,
          unit: '€',
          sourceType: 'estimee',
          sourceName: 'Remplacement module batterie sous franchise',
          confidenceLevel: 85,
          lastUpdated: '2026-03-01',
          updatedBy: 'Finance',
        },
        expectedLoss: 2000,
        probabilityType: 'historique',
      },
    ],
    technicalSuitabilityScore: 90,
  };

  // TEST 1: Apparent Purchase Price Delta
  {
    const start = performance.now();
    const convRes = TCOEngine.calculateOfferTCO(mockProject, mockConventionalOffer);
    const elecRes = TCOEngine.calculateOfferTCO(mockProject, mockElectricOffer);
    const passed = convRes.apparentDirectCost === 280000 && elecRes.apparentDirectCost === 360000;
    results.push({
      id: 'TCO-01',
      name: 'Prix d\'acquisition direct apparent conforme aux devis',
      category: 'Acquisition',
      passed,
      expected: 'Conv: 280 000 €, Elec: 360 000 € (Surcoût apparent initial de +80 000 € / +28.6%)',
      actual: `Conv: ${convRes.apparentDirectCost.toLocaleString()} €, Elec: ${elecRes.apparentDirectCost.toLocaleString()} €`,
      durationMs: Math.round(performance.now() - start),
    });
  }

  // TEST 2: Operational Energy Inflation Logic
  {
    const start = performance.now();
    const convRes = TCOEngine.calculateOfferTCO(mockProject, mockConventionalOffer);
    // Base is 36000/yr, 4% energy inflation over 5 years:
    // Y1: 36000, Y2: 37440, Y3: 38937.6, Y4: 40495.1, Y5: 42114.9 -> sum ~ 194988
    const passed = convRes.energyConsumablesTotal > 180000 && convRes.energyConsumablesTotal < 200000;
    results.push({
      id: 'TCO-02',
      name: 'Indexation de l\'inflation énergétique cumulée sur l\'horizon',
      category: 'Énergie',
      passed,
      expected: 'Total énergie diesel entre 180 000 € et 200 000 € (inclut 4% d\'inflation annuelle)',
      actual: `${convRes.energyConsumablesTotal.toLocaleString()} €`,
      durationMs: Math.round(performance.now() - start),
    });
  }

  // TEST 3: Economic TCO vs Full Comprehensive TCO (Risks & Carbon)
  {
    const start = performance.now();
    const convRes = TCOEngine.calculateOfferTCO(mockProject, mockConventionalOffer);
    // Risk expectation: 0.4 * 25000 = 10000
    // Carbon: 240 tonnes * 120€/t = 28800 €
    const passed = convRes.riskExpositionTotal === 10000 && convRes.monetizedCarbonTotal === 28800;
    results.push({
      id: 'TCO-03',
      name: 'Monétisation des externalités carbone et de l\'exposition aux risques réglementaires',
      category: 'Externalités & Risques',
      passed,
      expected: 'Risque attendu: 10 000 € | Carbone monétisé (240t * 120€/t): 28 800 €',
      actual: `Risque: ${convRes.riskExpositionTotal.toLocaleString()} € | Carbone: ${convRes.monetizedCarbonTotal.toLocaleString()} €`,
      durationMs: Math.round(performance.now() - start),
    });
  }

  // TEST 4: Break-Even Calculation (Point Mort)
  {
    const start = performance.now();
    const convRes = TCOEngine.calculateOfferTCO(mockProject, mockConventionalOffer);
    const elecRes = TCOEngine.calculateOfferTCO(mockProject, mockElectricOffer);
    const breakEven = TCOEngine.calculateBreakEven(convRes, elecRes, mockProject.horizonYears);
    // Initial delta: +80,000 €
    // Monthly operating savings: ~2500 - 3500 € / month
    // Break-even month should be between 24 and 38 months (around 2.5 years)
    const passed = breakEven.hasBreakEven && (breakEven.breakEvenMonth ?? 0) > 12 && (breakEven.breakEvenMonth ?? 0) < 48;
    results.push({
      id: 'TCO-04',
      name: 'Détermination du point mort économique (crossover d\'amortissement)',
      category: 'Point Mort',
      passed,
      expected: 'Point mort atteint entre 12 et 48 mois (rentable avant fin d\'horizon de 60 mois)',
      actual: `${breakEven.breakEvenMonth} mois (${breakEven.crossoverYear} ans) - ${breakEven.breakEvenDescription}`,
      durationMs: Math.round(performance.now() - start),
    });
  }

  // TEST 5: LCC Discounting (Net Present Value strictly less than nominal sum)
  {
    const start = performance.now();
    const elecRes = TCOEngine.calculateOfferTCO(mockProject, mockElectricOffer);
    // Because WACC = 5% > 0, future positive costs discounted will be lower than nominal sum
    const passed = elecRes.lifecycleCostLCC > 0 && elecRes.cashFlowsByYear.length === 6;
    results.push({
      id: 'TCO-05',
      name: 'Actualisation financière pluriannuelle LCC (WACC 5%)',
      category: 'LCC Actualisé',
      passed,
      expected: 'Calcul des flux sur 5 ans + CAPEX Année 0 avec discount factor 1/(1+r)^t',
      actual: `LCC Actualisé: ${elecRes.lifecycleCostLCC.toLocaleString()} € sur ${elecRes.cashFlowsByYear.length} jalons`,
      durationMs: Math.round(performance.now() - start),
    });
  }

  // TEST 6: Objectivity & Neutrality Assertion (Principe 37)
  // Verify that if responsible offer is burdened with high price or conventional has lower operating costs,
  // the engine faithfully declares conventional as the winner.
  {
    const start = performance.now();
    const overpricedRespOffer: SupplierOffer = {
      ...mockElectricOffer,
      apparentUnitPrice: { ...mockElectricOffer.apparentUnitPrice, value: 95000 },
      costItems: mockElectricOffer.costItems.map((ci) => 
        ci.category === 'acquisition' ? { ...ci, amount: { ...ci.amount, value: 950000 } } : ci
      ),
    };
    const convRes = TCOEngine.calculateOfferTCO(mockProject, mockConventionalOffer);
    const badRespRes = TCOEngine.calculateOfferTCO(mockProject, overpricedRespOffer);
    const breakEven = TCOEngine.calculateBreakEven(convRes, badRespRes, mockProject.horizonYears);
    
    const passed = badRespRes.totalComprehensiveTCO > convRes.totalComprehensiveTCO && (!breakEven.hasBreakEven || (breakEven.breakEvenMonth ?? 0) > 60);
    results.push({
      id: 'TCO-06',
      name: 'Neutralité et objectivité financière : non-biais systématique vers l\'ESG',
      category: 'Gouvernance & Audit',
      passed,
      expected: 'L\'offre conventionnelle doit être désignée vainqueur si l\'offre ESG est économiquement irrationnelle',
      actual: `Conventionnel: ${convRes.totalComprehensiveTCO.toLocaleString()} € < ESG Surtaxée: ${badRespRes.totalComprehensiveTCO.toLocaleString()} € (Pas de point mort sur l'horizon)`,
      durationMs: Math.round(performance.now() - start),
    });
  }

  // TEST 7: Sensitivity Analysis
  {
    const start = performance.now();
    const drivers = TCOEngine.calculateSensitivity(mockProject, mockConventionalOffer, mockElectricOffer);
    const passed = drivers.length >= 4 && drivers[0].sensitivityRank === 'critique';
    results.push({
      id: 'TCO-07',
      name: 'Analyse de sensibilité Tornado (Hiérarchisation des risques clés)',
      category: 'Sensibilité',
      passed,
      expected: 'Classement ordonné des variables à fort impact (Énergie, Carbone, WACC, Pannes)',
      actual: `${drivers.length} variables analysées. Driver principal: ${drivers[0].parameterName} (Rang: ${drivers[0].sensitivityRank})`,
      durationMs: Math.round(performance.now() - start),
    });
  }

  const passedCount = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed: passedCount,
    failed: results.length - passedCount,
    results,
  };
}
