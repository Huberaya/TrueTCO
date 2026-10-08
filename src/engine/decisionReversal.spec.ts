/**
 * Tests de l'analyse d'inversion de décision.
 *
 * Ces tests ne vérifient pas seulement que « ça tourne » : ils construisent une
 * paire d'offres dont l'inversion est CONNUE par le calcul à la main, puis
 * vérifient que le module retrouve le bon seuil et le bon sens de lecture.
 */

import { describe, expect, it } from 'vitest';
import { analyseDecisionReversal } from './decisionReversal';
import { RECOGNIZED_COST_CATEGORIES, TCOEngine } from './tcoEngine';
import { Project, SupplierOffer, AuditedValue } from '../types/domain';

function value(amount: number, sourceType: AuditedValue<number>['sourceType'] = 'verifiee'): AuditedValue<number> {
  return {
    value: amount,
    unit: '€',
    sourceType,
    sourceName: sourceType === 'verifiee' ? 'Devis ferme test' : 'Hypothèse de test',
    confidenceLevel: sourceType === 'verifiee' ? 95 : 50,
    lastUpdated: '2026-01-01T00:00:00.000Z',
    updatedBy: 'test',
  };
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    organizationId: 'org',
    name: 'Dossier test',
    reference: 'T-1',
    category: 'flotte_automobile',
    budgetCap: 0,
    currency: 'EUR',
    horizonYears: 5,
    plannedVolume: 1,
    unitName: 'véhicules',
    purchaseFrequency: 'unique',
    objective: 'test',
    ownerId: 'u1',
    ownerName: 'Test',
    status: 'analyse',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    discountRate: 0.05,
    carbonScenario: 'central',
    carbonPricePerTonne: 0,
    inflationRate: 0,
    energyInflationRate: 0,
    ...overrides,
  };
}

/** Achat moins cher en amont, plus cher à l'exploitation. */
function offerA(): SupplierOffer {
  return {
    id: 'offer-a',
    projectId: 'p1',
    supplierId: 's1',
    supplierName: 'Fournisseur A (prix bas, exploitation chère)',
    offerReference: 'A',
    isResponsibleCandidate: false,
    apparentUnitPrice: value(200_000),
    quantity: 1,
    apparentTotal: 200_000,
    deliveryLeadTimeWeeks: 4,
    warrantyMonths: 12,
    expectedLifespanYears: 5,
    costItems: [
      { id: 'a1', category: 'acquisition', label: 'Prix', amount: value(200_000), isRecurringYearly: false },
      {
        id: 'a2',
        category: 'energie_consommables',
        label: 'Énergie annuelle',
        amount: value(45_000),
        isRecurringYearly: true,
        yearlyInflationType: 'none',
      },
    ],
    carbonItems: [],
    riskItems: [],
    technicalSuitabilityScore: 90,
  };
}

/** Achat plus cher en amont, exploitation très bon marché. */
function offerB(): SupplierOffer {
  return {
    id: 'offer-b',
    projectId: 'p1',
    supplierId: 's2',
    supplierName: 'Fournisseur B (prix haut, exploitation légère)',
    offerReference: 'B',
    isResponsibleCandidate: true,
    apparentUnitPrice: value(350_000),
    quantity: 1,
    apparentTotal: 350_000,
    deliveryLeadTimeWeeks: 6,
    warrantyMonths: 36,
    expectedLifespanYears: 5,
    costItems: [
      { id: 'b1', category: 'acquisition', label: 'Prix', amount: value(350_000), isRecurringYearly: false },
      {
        id: 'b2',
        category: 'energie_consommables',
        label: 'Énergie annuelle',
        amount: value(10_000),
        isRecurringYearly: true,
        yearlyInflationType: 'none',
      },
    ],
    carbonItems: [],
    riskItems: [],
    technicalSuitabilityScore: 95,
  };
}

describe('Analyse d’inversion de décision', () => {
  it('T-INV-01 : un taux d’actualisation élevé inverse une décision « investir plus, consommer moins »', () => {
    const analysis = analyseDecisionReversal(project(), offerB(), offerA());
    const wacc = analysis.parameters.find((p) => p.parameter === 'taux_actualisation');

    expect(wacc).toBeDefined();
    expect(wacc!.isReachable).toBe(true);
    expect(wacc!.nearestThreshold).not.toBeNull();
    // La décision tient à 5 % puis s'inverse en montant : le seuil doit être au-dessus.
    expect(wacc!.intervals[0].direction).toBe('au_dessus');
    expect(wacc!.nearestThreshold!).toBeGreaterThan(0.05);
    expect(wacc!.nearestThreshold!).toBeLessThan(0.07);
    expect(wacc!.statement).toMatch(/s'inverse à partir de/);

    // Vérification INDÉPENDANTE du seuil annoncé, par le moteur lui-même :
    // juste en dessous du seuil, B reste la moins chère ; juste au-dessus, A passe devant.
    const winner = offerB();
    const challenger = offerA();
    const threshold = wacc!.nearestThreshold!;
    const deltaJustBelow =
      TCOEngine.calculateOfferTCO(project(), challenger, { discountRate: threshold - 0.002 }).lifecycleCostLCC -
      TCOEngine.calculateOfferTCO(project(), winner, { discountRate: threshold - 0.002 }).lifecycleCostLCC;
    const deltaJustAbove =
      TCOEngine.calculateOfferTCO(project(), challenger, { discountRate: threshold + 0.002 }).lifecycleCostLCC -
      TCOEngine.calculateOfferTCO(project(), winner, { discountRate: threshold + 0.002 }).lifecycleCostLCC;

    expect(deltaJustBelow).toBeGreaterThan(0); // la décision tient encore
    expect(deltaJustAbove).toBeLessThan(0); // la décision s'est inversée
    // La marge annoncée correspond exactement à l'écart au seuil.
    expect(wacc!.marginToThreshold!.absolute).toBeCloseTo(threshold - 0.05, 9);
  });

  it('T-INV-02 : les bornes de la plage explorée sont exposées et respectées', () => {
    const analysis = analyseDecisionReversal(project(), offerB(), offerA());
    for (const parameter of analysis.parameters) {
      expect(parameter.exploredRange.max).toBeGreaterThan(parameter.exploredRange.min);
      expect(parameter.exploredRange.step).toBeGreaterThan(0);
      if (parameter.nearestThreshold !== null) {
        // Aucun seuil annoncé hors des bornes déclarées : c'est la règle d'honnêteté.
        expect(parameter.nearestThreshold).toBeGreaterThanOrEqual(parameter.exploredRange.min);
        expect(parameter.nearestThreshold).toBeLessThanOrEqual(parameter.exploredRange.max);
      }
    }
  });

  it('T-INV-03 : un paramètre sans effet sur le classement est annoncé comme tel, pas inventé', () => {
    // Le prix du carbone n'a aucun effet ici : aucune émission n'est déclarée et
    // le prix du carbone du dossier est nul. Le module ne doit PAS annoncer de seuil.
    const analysis = analyseDecisionReversal(project({ carbonPricePerTonne: 0 }), offerB(), offerA());
    const carbon = analysis.parameters.find((p) => p.parameter === 'prix_carbone')!;
    expect(carbon.isReachable).toBe(false);
    expect(carbon.nearestThreshold).toBeNull();
    expect(carbon.statement).toMatch(/Aucune inversion|même VAN/);
  });

  it('T-INV-04 : lorsque la décision tient sur toute la plage, le module le dit explicitement', () => {
    // Offre C strictement moins chère que A partout (aucun scénario ne l'inverse).
    const cheap: SupplierOffer = {
      ...offerA(),
      id: 'offer-c',
      supplierName: 'Fournisseur C',
      costItems: [
        { id: 'c1', category: 'acquisition', label: 'Prix', amount: value(100_000), isRecurringYearly: false },
        {
          id: 'c2',
          category: 'energie_consommables',
          label: 'Énergie annuelle',
          amount: value(1_000),
          isRecurringYearly: true,
          yearlyInflationType: 'none',
        },
      ],
    };
    const analysis = analyseDecisionReversal(project(), cheap, offerA());
    const horizon = analysis.parameters.find((p) => p.parameter === 'horizon')!;
    expect(horizon.deltaAtBounds.deltaAtMin).toBeGreaterThan(0);
    expect(horizon.deltaAtBounds.deltaAtMax).toBeGreaterThan(0);
    expect(horizon.statement).toMatch(/la décision tient sur toute la plage testée/);
  });

  it('T-INV-05 : la convention de signe est écrite noir sur blanc', () => {
    const analysis = analyseDecisionReversal(project(), offerB(), offerA());
    expect(analysis.signConvention).toMatch(/challenger.*gagnante/);
    expect(analysis.baseDelta).toBeGreaterThan(0); // B (gagnante) moins chère que A
    expect(analysis.method).toMatch(/dichotomie/i);
    expect(analysis.method).toMatch(/Aucune extrapolation/);
  });

  it('T-INV-06 : le module n’altère pas les entrées (pureté)', () => {
    const p = project();
    const winner = offerB();
    const challenger = offerA();
    const before = JSON.stringify({ p, winner, challenger });
    analyseDecisionReversal(p, winner, challenger);
    expect(JSON.stringify({ p, winner, challenger })).toBe(before);
  });

  it('T-INV-07 : l’analyse est reproductible (mêmes entrées, mêmes seuils)', () => {
    const first = analyseDecisionReversal(project(), offerB(), offerA());
    const second = analyseDecisionReversal(project(), offerB(), offerA());
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('Vocabulaire des catégories de coût (source unique)', () => {
  it('T-CAT-01 : les alias usuels (français et anglais) sont ramenés à une catégorie canonique', () => {
    const cases: [string, string][] = [
      ['energie', 'energie_consommables'],
      ['energy', 'energie_consommables'],
      ['Consumables', 'energie_consommables'],
      ['transport', 'logistique_douanes'],
      ['freight', 'logistique_douanes'],
      ['douanes', 'logistique_douanes'],
      ['maintenance', 'maintenance_reparations'],
      ['installation', 'installation_mise_en_service'],
      ['commissioning', 'installation_mise_en_service'],
      ['downtime', 'indisponibilite_operationnelle'],
      ['compliance', 'couts_administratifs_conformite'],
      ['carbon', 'externalite_carbone'],
      ['recycling', 'fin_de_vie_recyclage'],
      ['residual_value', 'valeur_residuelle'],
      ['taxes', 'fiscalite_taxes'],
      ['deploiement', 'deploiement'],
    ];

    for (const [declared, expected] of cases) {
      const normalized = TCOEngine.normalizeCostCategory(declared);
      expect(normalized, `alias non reconnu : ${declared}`).toBe(expected);
      // La catégorie normalisée appartient toujours à la liste canonique.
      expect(RECOGNIZED_COST_CATEGORIES).toContain(normalized);
    }
  });

  it('T-CAT-02 : les libellés ambigus ne sont PAS devinés', () => {
    // « opex », « services » et « training » recouvrent plusieurs natures de coût :
    // le moteur ne doit pas trancher à la place de l'utilisateur ; le produit
    // demandera un arbitrage humain.
    expect(TCOEngine.normalizeCostCategory('opex')).toBeNull();
    expect(TCOEngine.normalizeCostCategory('training')).toBeNull();
    expect(TCOEngine.normalizeCostCategory('autres')).toBeNull();
    expect(TCOEngine.normalizeCostCategory('')).toBeNull();
    expect(TCOEngine.normalizeCostCategory(undefined)).toBeNull();
  });
});
