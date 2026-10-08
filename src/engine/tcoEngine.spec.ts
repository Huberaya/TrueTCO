/**
 * TrueTCO — Tests d'intégration du moteur TCO/LCC (exécutables en CI)
 * ---------------------------------------------------------------------------
 * `npm test` exécute cette suite. Elle vérifie :
 *   - les invariants comptables du moteur (Σ flux = totaux affichés) ;
 *   - l'absence de mutation des données d'entrée ;
 *   - la robustesse sur le jeu de données de démonstration (10 offres) ;
 *   - la suite fonctionnelle `runAllTCOEngineTests` (partagée avec l'UI).
 */

import { describe, expect, it } from 'vitest';
import { TCOEngine, TCO_ENGINE_VERSION, METHODOLOGY_EXPORT_MARKER } from './tcoEngine';
import { runAllTCOEngineTests } from './tcoEngine.test';
import { SEED_OFFERS, SEED_PROJECTS } from '../data/seedData';
import { Project, SupplierOffer } from '../types/domain';

describe('Suite fonctionnelle partagée (UI + CI)', () => {
  const report = runAllTCOEngineTests();

  it('ne contient aucun test en échec', () => {
    const failures = report.results.filter((r) => !r.passed).map((r) => `${r.id} — ${r.name} : ${r.actual}`);
    expect(failures, `Tests en échec :\n${failures.join('\n')}`).toEqual([]);
    expect(report.total).toBeGreaterThanOrEqual(13);
  });

  it('expose la version du moteur', () => {
    expect(TCO_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(METHODOLOGY_EXPORT_MARKER).toBe('truetco-methodology');
  });
});

describe('Invariants comptables sur le jeu de données de démonstration', () => {
  const project = SEED_PROJECTS[0];

  it('le jeu de démonstration contient au moins 2 offres et 1 projet', () => {
    expect(SEED_PROJECTS.length).toBeGreaterThan(0);
    expect(SEED_OFFERS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(SEED_OFFERS.map((o) => [o.supplierName, o] as const))(
    'Σ flux nominaux = TCO complet et Σ flux actualisés = LCC (%s)',
    (_name, offer) => {
      const res = TCOEngine.calculateOfferTCO(project, offer as SupplierOffer);
      const sumNominal = res.cashFlowsByYear.reduce((a, c) => a + c.nominalCost, 0);
      const sumDiscounted = res.cashFlowsByYear.reduce((a, c) => a + c.discountedCost, 0);
      const sumEconomicDiscounted = res.cashFlowsByYear.reduce((a, c) => a + (c.economicDiscountedCost ?? 0), 0);

      expect(Math.abs(sumNominal - res.totalComprehensiveTCO)).toBeLessThanOrEqual(2);
      expect(Math.abs(sumDiscounted - res.lifecycleCostLCC)).toBeLessThanOrEqual(2);
      expect(Math.abs(sumEconomicDiscounted - (res.economicLCC ?? 0))).toBeLessThanOrEqual(2);
    }
  );

  it.each(SEED_OFFERS.map((o) => [o.supplierName, o] as const))('le moteur ne mute aucune entrée (%s)', (_name, offer) => {
    const snapshot = JSON.stringify(offer);
    TCOEngine.calculateOfferTCO(project, offer as SupplierOffer);
    expect(JSON.stringify(offer)).toBe(snapshot);
  });

  it('le LCC complet est strictement supérieur au LCC économique lorsqu\'il y a un risque ou du carbone', () => {
    const offer = SEED_OFFERS.find((o) => (o.riskItems?.length ?? 0) > 0 || (o.carbonItems?.length ?? 0) > 0);
    if (!offer) return;
    const res = TCOEngine.calculateOfferTCO(project, offer);
    expect(res.lifecycleCostLCC).toBeGreaterThanOrEqual(res.economicLCC ?? 0);
  });
});

describe('Robustesse et cas limites', () => {
  const project: Project = {
    ...SEED_PROJECTS[0],
    horizonYears: 5,
  } as Project;

  const baseOffer: SupplierOffer = {
    id: 'edge',
    projectId: project.id,
    supplierId: 'sup',
    supplierName: 'Offre de test',
    offerReference: 'EDGE-1',
    isResponsibleCandidate: false,
    apparentUnitPrice: {
      value: 1000,
      unit: '€/unité',
      sourceType: 'verifiee',
      sourceName: 'Devis',
      confidenceLevel: 95,
      lastUpdated: '2026-01-01',
      updatedBy: 'Test automatisé',
    },
    quantity: 10,
    apparentTotal: 10000,
    deliveryLeadTimeWeeks: 4,
    warrantyMonths: 24,
    expectedLifespanYears: 5,
    costItems: [],
    carbonItems: [],
    riskItems: [],
    technicalSuitabilityScore: 80,
  };

  it('gère une offre sans poste de coût en signalant le repli sur le prix facial', () => {
    const res = TCOEngine.calculateOfferTCO(project, baseOffer);
    expect(res.warnings?.some((w) => w.code === 'ACQUISITION_FROM_APPARENT_PRICE')).toBe(true);
    expect(res.acquisitionTotal).toBe(10000);
  });

  it("n'invente aucun résultat sans offre", () => {
    const res = TCOEngine.calculateOfferTCO(project, null);
    expect(res.totalComprehensiveTCO).toBe(0);
    expect(res.isComplete).toBe(false);
    expect(res.warnings?.[0].code).toBe('NO_OFFER');
  });

  it('ignore les occurrences situées au-delà de l\'horizon mais le signale', () => {
    const offer: SupplierOffer = {
      ...baseOffer,
      costItems: [
        {
          id: 'k',
          category: 'maintenance_reparations',
          label: 'Maintenance étendue',
          amount: { value: 10000, unit: '€', sourceType: 'verifiee', sourceName: 'Contrat', confidenceLevel: 95, lastUpdated: '2026-01-01', updatedBy: 'Test' },
          isRecurringYearly: false,
          yearOccurrences: [1, 2, 8],
        },
      ],
    };
    const res = TCOEngine.calculateOfferTCO(project, offer);
    expect(res.warnings?.some((w) => w.code === 'OCCURRENCE_OUT_OF_HORIZON')).toBe(true);
    expect(res.maintenanceRepairsTotal).toBeLessThan(30000);
  });

  it('détecte un risque de double comptage carbone', () => {
    const offer: SupplierOffer = {
      ...baseOffer,
      costItems: [
        {
          id: 'acq',
          category: 'acquisition',
          label: 'Achat',
          amount: { value: 10000, unit: '€', sourceType: 'verifiee', sourceName: 'Devis', confidenceLevel: 95, lastUpdated: '2026-01-01', updatedBy: 'Test' },
          isRecurringYearly: false,
        },
        {
          id: 'co2',
          category: 'externalite_carbone',
          label: 'Taxe carbone interne',
          amount: { value: 5000, unit: '€', sourceType: 'estimee', sourceName: 'Modèle interne', confidenceLevel: 70, lastUpdated: '2026-01-01', updatedBy: 'Test' },
          isRecurringYearly: false,
        },
      ],
      carbonItems: [
        {
          scope: 'Scope 1',
          lifecyclePhase: 'fabrication',
          emissionsPerUnitTonneCO2e: { value: 1, unit: 'tCO2e', sourceType: 'source_externe', sourceName: 'ADEME', confidenceLevel: 90, lastUpdated: '2026-01-01', updatedBy: 'Test' },
          totalLifecycleEmissions: 10,
          emissionFactorSource: 'ADEME',
        },
      ],
    };
    const res = TCOEngine.calculateOfferTCO(project, offer);
    expect(res.warnings?.some((w) => w.code === 'POTENTIAL_CARBON_DOUBLE_COUNT')).toBe(true);
  });

  it('un horizon plus long ne peut pas rendre une offre non rentable rentable au point mort', () => {
    const conv: SupplierOffer = {
      ...baseOffer,
      id: 'conv',
      costItems: [
        { id: 'a', category: 'acquisition', label: 'Achat', amount: { value: 100000, unit: '€', sourceType: 'verifiee', sourceName: 'D', confidenceLevel: 95, lastUpdated: '2026-01-01', updatedBy: 'Test' }, isRecurringYearly: false },
        { id: 'b', category: 'energie_consommables', label: 'Énergie', amount: { value: 20000, unit: '€/an', sourceType: 'verifiee', sourceName: 'D', confidenceLevel: 95, lastUpdated: '2026-01-01', updatedBy: 'Test' }, isRecurringYearly: true },
      ],
    };
    const resp: SupplierOffer = {
      ...conv,
      id: 'resp',
      isResponsibleCandidate: true,
      costItems: [
        { id: 'a', category: 'acquisition', label: 'Achat', amount: { value: 140000, unit: '€', sourceType: 'verifiee', sourceName: 'D', confidenceLevel: 95, lastUpdated: '2026-01-01', updatedBy: 'Test' }, isRecurringYearly: false },
        { id: 'b', category: 'energie_consommables', label: 'Énergie', amount: { value: 5000, unit: '€/an', sourceType: 'verifiee', sourceName: 'D', confidenceLevel: 95, lastUpdated: '2026-01-01', updatedBy: 'Test' }, isRecurringYearly: true },
      ],
    };

    const shortHorizon: Project = { ...project, horizonYears: 2 } as Project;
    const longHorizon: Project = { ...project, horizonYears: 10 } as Project;

    const beShort = TCOEngine.calculateBreakEven(
      TCOEngine.calculateOfferTCO(shortHorizon, conv),
      TCOEngine.calculateOfferTCO(shortHorizon, resp),
      shortHorizon.horizonYears
    );
    const beLong = TCOEngine.calculateBreakEven(
      TCOEngine.calculateOfferTCO(longHorizon, conv),
      TCOEngine.calculateOfferTCO(longHorizon, resp),
      longHorizon.horizonYears
    );

    expect(beShort.hasBreakEven).toBe(false);
    expect(beLong.hasBreakEven).toBe(true);
  });
});
