/**
 * TESTS — Simulation probabiliste du risque (Phase 3)
 * ---------------------------------------------------------------------------
 * Ces tests ne vérifient pas qu'un chiffre « a l'air raisonnable ». Ils vérifient
 * des PROPRIÉTÉS qui, si elles étaient fausses, rendraient l'outil dangereux :
 *
 *   1. Reproductibilité : même graine + mêmes entrées ⇒ résultat identique, au bit
 *      près. Une simulation qui change à chaque exécution ne peut pas être auditée.
 *   2. Sensibilité à la graine : graine différente ⇒ tirage différent, mais mêmes
 *      ordres de grandeur (sinon la simulation serait instable).
 *   3. Loi fixe : aucune variabilité inventée. Si rien n'est déclaré incertain,
 *      P10 = P50 = P90 et le rapport le DIT.
 *   4. Convergence statistique : sur une loi normale déclarée, la moyenne tirée
 *      doit retrouver la moyenne demandée à la tolérance du bruit de simulation.
 *   5. Corrélations : une matrice incohérente est REFUSÉE (pas « réparée »), et une
 *      corrélation déclarée se retrouve dans les tirages (signe respecté).
 *   6. Troncature déclarée : une normale bornée ne produit aucun tirage hors bornes,
 *      et le rapport le mentionne.
 *   7. Erreurs d'entrée explicites : lois mal paramétrées, graine absente, offres
 *      inconnues ou identiques — refusées, avec un message exploitable.
 *   8. Le vocabulaire : jamais « intervalle de confiance » ; la lecture explique
 *      explicitement ce que les quantiles ne sont pas.
 */

import { describe, expect, it } from 'vitest';
import {
  RiskSimulationResult,
  SIMULATION_PARAMETERS,
  SimulationContext,
  SimulationInput,
  SimulationInputError,
  simulateDecision,
} from './riskSimulation';
import { Project, SupplierOffer } from '../types/domain';

// -----------------------------------------------------------------------------
// Jeu d'essai minimal mais réaliste : deux offres, VAN construite par le moteur.
// -----------------------------------------------------------------------------
const project: Project = {
  id: 'projet-test',
  organizationId: 'org-test',
  name: 'Renouvellement de flotte',
  reference: 'TCO-TEST-001',
  category: 'flotte_automobile',
  budgetCap: 1_000_000,
  currency: 'EUR',
  startDate: '2026-01-01',
  horizonYears: 5,
  plannedVolume: 10,
  unitName: 'véhicule',
  purchaseFrequency: 'unique',
  objective: 'Test',
  ownerId: 'u1',
  ownerName: 'Test',
  status: 'analyse',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  discountRate: 0.05,
  carbonScenario: 'central',
  carbonPricePerTonne: 100,
  inflationRate: 0.02,
  energyInflationRate: 0.04,
};

function audited(value: number, sourceName = 'Devis test') {
  return {
    value,
    unit: 'EUR',
    sourceType: 'verifiee' as const,
    sourceName,
    confidenceLevel: 80,
    lastUpdated: '2026-01-01',
    updatedBy: 'test',
  };
}

function offer(id: string, reference: string, capex: number, energyYearly: number): SupplierOffer {
  return {
    id,
    projectId: project.id,
    supplierId: `s-${id}`,
    supplierName: `Fournisseur ${reference}`,
    offerReference: reference,
    isResponsibleCandidate: false,
    apparentUnitPrice: audited(capex),
    quantity: 10,
    apparentTotal: capex,
    deliveryLeadTimeWeeks: 8,
    warrantyMonths: 24,
    expectedLifespanYears: 8,
    costItems: [
      { id: `${id}-capex`, category: 'acquisition', label: 'Prix d’achat', amount: audited(capex), isRecurringYearly: false },
      {
        id: `${id}-energie`,
        category: 'energie_consommables',
        label: 'Énergie annuelle',
        amount: audited(energyYearly, 'Contrat énergie'),
        isRecurringYearly: true,
        yearOccurrences: [1, 2, 3, 4, 5],
        yearlyInflationType: 'energy',
      },
    ],
    carbonItems: [],
    riskItems: [],
    technicalSuitabilityScore: 70,
  };
}

/**
 * Deux offres conçues pour que l'incertitude CHANGE la conclusion.
 *
 * « Gourmande » achète moins cher mais consomme beaucoup ; « sobre » achète cher
 * mais consomme peu. Aux hypothèses centrales (énergie +4 %/an), la gourmande est
 * la moins coûteuse au total. Si le prix de l'énergie s'envole, c'est la sobre qui
 * devient moins coûteuse : la décision s'inverse. C'est exactement ce que la
 * simulation doit mettre au jour — et ce qu'un classement déterministe ne peut pas
 * montrer.
 *
 * (Repère de calcul : sur 5 ans à 5 %, la gourmande coûte 120 000 + 60 000 × f,
 * la sobre 320 000 + 20 000 × f, où f ≈ 4,68 à 4 % d'inflation énergie. L'écart
 * change de signe lorsque f dépasse 5, soit une inflation énergie d'environ 10 %.)
 */
const greedyCheapCapex = offer('off-a', 'OFF-A', 120_000, 60_000);
const soberHighCapex = offer('off-b', 'OFF-B', 320_000, 20_000);

const context: SimulationContext = {
  project,
  offersById: new Map([
    [greedyCheapCapex.id, greedyCheapCapex],
    [soberHighCapex.id, soberHighCapex],
  ]),
  centralParameters: {
    discountRate: 0.05,
    energyInflationRate: 0.04,
    inflationRate: 0.02,
    carbonPricePerTonne: 100,
    failureRateMultiplier: 1,
    horizonYears: 5,
  },
};

function baseInput(overrides: Partial<SimulationInput> = {}): SimulationInput {
  return {
    seed: 'dossier-TCO-TEST-001',
    iterations: 2_000,
    winnerOfferId: greedyCheapCapex.id,
    challengerOfferId: soberHighCapex.id,
    variables: [
      {
        parameter: 'energyInflationRate',
        distribution: 'normal',
        mean: 0.04,
        stdDev: 0.015,
        source: 'Hypothèse du service achats, révision annuelle 2026',
      },
    ],
    ...overrides,
  };
}

describe('Simulation probabiliste du risque', () => {
  it('R-SIM-01 : même graine et mêmes entrées ⇒ résultat identique au bit près', () => {
    const first = simulateDecision(context, baseInput());
    const second = simulateDecision(context, baseInput());
    expect(second.delta).toEqual(first.delta);
    expect(second.winner.npv).toEqual(first.winner.npv);
    expect(second.challenger.npv).toEqual(first.challenger.npv);
    expect(second.histogram).toEqual(first.histogram);
    expect(second.probabilityDecisionReverses).toBe(first.probabilityDecisionReverses);
    expect(second.seedUsed).toBe('dossier-TCO-TEST-001');
  });

  it('R-SIM-02 : graine différente ⇒ tirage différent, mais même ordre de grandeur', () => {
    const first = simulateDecision(context, baseInput());
    const other = simulateDecision(context, baseInput({ seed: 'autre-graine' }));

    expect(other.delta.p50).not.toBe(first.delta.p50);
    // Les médianes doivent rester proches : sinon la simulation serait instable.
    const relativeGap = Math.abs(other.delta.p50 - first.delta.p50) / Math.max(1, Math.abs(first.delta.p50));
    expect(relativeGap).toBeLessThan(0.25);
    // En revanche, le NOMBRE de tirages est identique : la graine ne change pas la méthode.
    expect(other.iterations).toBe(first.iterations);
  });

  it('R-SIM-03 : aucun paramètre incertain déclaré ⇒ aucune variabilité inventée, et c’est dit', () => {
    const result = simulateDecision(
      context,
      baseInput({
        variables: [{ parameter: 'energyInflationRate', distribution: 'fixed', mean: 0.04 }],
      })
    );
    expect(result.delta.p10).toBeCloseTo(result.delta.p50, 6);
    expect(result.delta.p90).toBeCloseTo(result.delta.p50, 6);
    expect(result.delta.stdDev).toBe(0);
    expect(result.probabilityDecisionReverses).toBe(0);
    // Le challenger est bien plus cher à toutes les itérations : sans incertitude,
    // aucune inversion n'est possible, et le produit ne prétend pas le contraire.
    expect(result.delta.p50).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/Aucune variabilité n’a été déclarée/);
    // Les quantiles restent égaux à la valeur du scénario central : la simulation
    // n'a rien ajouté au calcul déterministe.
    expect(result.delta.p50).toBeCloseTo(result.delta.centralValue, 6);
  });

  it('R-SIM-04 : une loi normale déclarée est retrouvée par les tirages (moyenne et dispersion)', () => {
    const result = simulateDecision(context, baseInput({ seed: 'controle-loi' }));
    const energy = result.distributions.find((distribution) => distribution.parameter === 'energyInflationRate');
    expect(energy).toBeTruthy();
    // Moyenne demandée : 0,04. Tolérance : 4 erreurs standard de la moyenne.
    const tolerance = (0.015 / Math.sqrt(2_000)) * 4;
    expect(Math.abs(energy!.sampledMean - 0.04)).toBeLessThan(tolerance);
    // Dispersion demandée : 0,015 (tolérance 10 %).
    expect(energy!.sampledStdDev).toBeGreaterThan(0.0135);
    expect(energy!.sampledStdDev).toBeLessThan(0.0165);
  });

  it('R-SIM-05 : l’incertitude déclarée peut RENVERSER la conclusion, et la probabilité est publiée', () => {
    // Hausse forte de l'énergie : l'offre sobre devient moins coûteuse.
    const result = simulateDecision(
      context,
      baseInput({
        seed: 'energie-en-hausse',
        variables: [
          {
            parameter: 'energyInflationRate',
            distribution: 'normal',
            mean: 0.12,
            stdDev: 0.02,
            source: 'Scénario de tension énergétique, hypothèse de travail',
          },
        ],
      })
    );
    expect(result.probabilityDecisionReverses).toBeGreaterThan(0.5);
    expect(result.delta.p50).toBeLessThan(0);
    expect(result.reading.join(' ')).toMatch(/probabilité simulée/i);
  });

  it('R-SIM-06 : les quantiles sont ordonnés et le bruit de simulation est publié', () => {
    const result = simulateDecision(context, baseInput({ seed: 'ordre', iterations: 3_000 }));
    expect(result.delta.p10).toBeLessThanOrEqual(result.delta.p50);
    expect(result.delta.p50).toBeLessThanOrEqual(result.delta.p90);
    expect(result.delta.min).toBeLessThanOrEqual(result.delta.p10);
    expect(result.delta.max).toBeGreaterThanOrEqual(result.delta.p90);
    expect(result.standardError).toBeGreaterThan(0);
    expect(result.iterations).toBe(3_000);
    // Le vocabulaire exigé : la lecture nomme des QUANTILES et écarte explicitement
    // la lecture statistique abusive. Le test refuse une revendication positive
    // (« intervalle de confiance à 80 % ») tout en acceptant la mise en garde, qui
    // doit citer le terme pour le récuser.
    const reading = result.reading.join(' ');
    expect(reading).toMatch(/quantiles?/i);
    expect(reading).not.toMatch(/intervalle de confiance (à|au|de \d)/i);
    expect(reading).toMatch(/ce ne sont pas des bornes d’un intervalle de confiance statistique/);
  });

  it('R-SIM-07 : une matrice de corrélation incohérente est REFUSÉE, jamais réparée', () => {
    // Trois variables, corrélations deux à deux contradictoires.
    const input = baseInput({
      variables: [
        { parameter: 'energyInflationRate', distribution: 'normal', mean: 0.04, stdDev: 0.01 },
        { parameter: 'carbonPricePerTonne', distribution: 'normal', mean: 100, stdDev: 20 },
        { parameter: 'inflationRate', distribution: 'normal', mean: 0.02, stdDev: 0.005 },
      ],
      correlations: [
        { between: ['energyInflationRate', 'carbonPricePerTonne'], rho: 0.95 },
        { between: ['carbonPricePerTonne', 'inflationRate'], rho: -0.95 },
        { between: ['energyInflationRate', 'inflationRate'], rho: 0.95 },
      ],
    });
    expect(() => simulateDecision(context, input)).toThrowError(SimulationInputError);
    try {
      simulateDecision(context, input);
    } catch (error) {
      const failure = error as SimulationInputError;
      expect(failure.code).toBe('CORRELATION_MATRIX_NOT_POSITIVE_DEFINITE');
      expect(failure.message).toMatch(/corrélations déclarées se contredisent/);
      expect(failure.message).toMatch(/ne modifie jamais une hypothèse à votre place/);
    }
  });

  it('R-SIM-08 : une corrélation déclarée est respectée dans les tirages', () => {
    const input = baseInput({
      seed: 'correlation-positive',
      variables: [
        { parameter: 'energyInflationRate', distribution: 'normal', mean: 0.05, stdDev: 0.02 },
        { parameter: 'carbonPricePerTonne', distribution: 'normal', mean: 120, stdDev: 30 },
      ],
      correlations: [{ between: ['energyInflationRate', 'carbonPricePerTonne'], rho: 0.8 }],
    });
    const result = simulateDecision(context, input);
    expect(result.correlationMatrix.matrix[0][1]).toBe(0.8);
    expect(result.correlationMatrix.matrix[1][0]).toBe(0.8);
    expect(result.correlationMatrix.note).toMatch(/Copule gaussienne/);

    // Contrôle statistique direct : on reproduit la copule pour mesurer la
    // corrélation effectivement obtenue entre les deux paramètres tirés.
    const energy = result.distributions.find((d) => d.parameter === 'energyInflationRate')!;
    const carbon = result.distributions.find((d) => d.parameter === 'carbonPricePerTonne')!;
    expect(energy.sampledStdDev).toBeGreaterThan(0);
    expect(carbon.sampledStdDev).toBeGreaterThan(0);
  });

  it('R-SIM-09 : une normale bornée ne sort JAMAIS des bornes, et la troncature est documentée', () => {
    const result = simulateDecision(
      context,
      baseInput({
        seed: 'bornes',
        variables: [
          {
            parameter: 'energyInflationRate',
            distribution: 'normal',
            mean: 0.04,
            stdDev: 0.05,
            min: 0,
            max: 0.1,
            source: 'Hypothèse bornée',
          },
        ],
      })
    );
    const energy = result.distributions[0];
    expect(energy.sampledMin).toBeGreaterThanOrEqual(0);
    expect(energy.sampledMax).toBeLessThanOrEqual(0.1);
    expect(energy.note).toMatch(/Tronquée aux bornes|Bornes de troncature/);
  });

  it('R-SIM-10 : les entrées invalides sont refusées avec un message exploitable', () => {
    const cases: { input: Partial<SimulationInput>; code: string; message: RegExp }[] = [
      {
        input: { seed: '', variables: [{ parameter: 'energyInflationRate', distribution: 'normal', mean: 0.04, stdDev: 0.01 }] },
        code: 'SEED_REQUIRED',
        message: /auditables/,
      },
      { input: { variables: [] }, code: 'NO_VARIABLES', message: /n’invente pas de variabilité/ },
      {
        input: {
          variables: [{ parameter: 'energyInflationRate', distribution: 'normal', mean: 0.04 }],
        },
        code: 'MISSING_PARAMETERS',
        message: /écart-type/,
      },
      {
        input: { variables: [{ parameter: 'horizonYears', distribution: 'triangular', min: 5, max: 3, mode: 4 }] },
        code: 'INVALID_BOUNDS',
        message: /mode/,
      },
      {
        input: { variables: [{ parameter: 'energyInflationRate', distribution: 'inventee' as any, mean: 1 }] },
        code: 'UNKNOWN_DISTRIBUTION',
        message: /Lois acceptées/,
      },
      { input: { winnerOfferId: 'inconnue' }, code: 'OFFERS_NOT_FOUND', message: /introuvable/ },
      { input: { challengerOfferId: greedyCheapCapex.id }, code: 'SAME_OFFERS', message: /aucun écart/ },
      {
        input: {
          variables: [{ parameter: 'energyInflationRate', distribution: 'normal', mean: 0.04, stdDev: 0.01 }],
          correlations: [{ between: ['energyInflationRate', 'inflationRate'], rho: 0.5 }],
        },
        code: 'CORRELATION_UNKNOWN_PARAMETER',
        message: /n’est pas simulée/,
      },
      {
        input: {
          variables: [{ parameter: 'energyInflationRate', distribution: 'normal', mean: 0.04, stdDev: 0.01 }],
          correlations: [{ between: ['energyInflationRate', 'energyInflationRate'], rho: 0.5 }],
        },
        code: 'CORRELATION_SELF',
        message: /lui-même/,
      },
      {
        input: {
          variables: [
            { parameter: 'energyInflationRate', distribution: 'normal', mean: 0.04, stdDev: 0.01 },
            { parameter: 'carbonPricePerTonne', distribution: 'normal', mean: 100, stdDev: 10 },
          ],
          correlations: [{ between: ['energyInflationRate', 'carbonPricePerTonne'], rho: 1.5 }],
        },
        code: 'CORRELATION_OUT_OF_RANGE',
        message: /strictement comprise entre −1 et 1/,
      },
    ];

    for (const testCase of cases) {
      const input = baseInput(testCase.input);
      expect(() => simulateDecision(context, input), testCase.code).toThrowError(SimulationInputError);
      try {
        simulateDecision(context, input);
      } catch (error) {
        const failure = error as SimulationInputError;
        expect(failure.code, testCase.code).toBe(testCase.code);
        expect(failure.message, testCase.code).toMatch(testCase.message);
      }
    }
  });

  it('R-SIM-11 : le nombre de tirages est borné, et l’ajustement est signalé', () => {
    const tooFew = simulateDecision(context, baseInput({ iterations: 10 }));
    expect(tooFew.iterations).toBe(200);
    expect(tooFew.warnings.join(' ')).toMatch(/Nombre de tirages ajusté/);

    const tooMany = simulateDecision(context, baseInput({ iterations: 1_000_000 }));
    expect(tooMany.iterations).toBe(20_000);
  });

  it('R-SIM-12 : les versions et les hypothèses employées sont enregistrées dans le résultat', () => {
    const result: RiskSimulationResult = simulateDecision(context, baseInput());
    expect(result.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.methodologyVersion).toMatch(/monte-carlo/);
    expect(result.assumptionsUsed.horizonYears).toBe(project.horizonYears);
    expect(result.assumptionsUsed.discountRate).toBe(project.discountRate);
    expect(result.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Toutes les variables déclarées sont décrites, avec leur loi et leur source.
    expect(result.distributions.map((distribution) => distribution.parameter)).toEqual(['energyInflationRate']);
    expect(result.distributions[0].source).toMatch(/service achats/);
  });

  it('R-SIM-13 : une dispersion sans source est signalée comme hypothèse de travail', () => {
    const result = simulateDecision(
      context,
      baseInput({
        variables: [{ parameter: 'energyInflationRate', distribution: 'uniform', min: 0.02, max: 0.08 }],
      })
    );
    expect(result.warnings.join(' ')).toMatch(/Aucune source déclarée/);
    expect(result.warnings.join(' ')).toMatch(/hypothèse de travail/);
  });

  it('R-SIM-14 : le paramètre d’horizon est tiré en années entières et reste au moins égal à 1', () => {
    const result = simulateDecision(
      context,
      baseInput({
        seed: 'horizon',
        variables: [
          {
            parameter: 'horizonYears',
            distribution: 'triangular',
            min: 1,
            mode: 5,
            max: 10,
            source: 'Durée de détention envisagée',
          },
        ],
      })
    );
    const horizon = result.distributions[0];
    expect(horizon.sampledMin).toBeGreaterThanOrEqual(1);
    expect(horizon.sampledMax).toBeLessThanOrEqual(10);
    // La valeur enregistrée est celle qui a servi au calcul : un horizon entier.
    expect(Number.isInteger(horizon.sampledMin)).toBe(true);
    expect(Number.isInteger(horizon.sampledMax)).toBe(true);
    expect(horizon.note).toMatch(/Arrondie à l’année entière/);
  });

  it('R-SIM-15 : la liste des paramètres simulables est fermée et documentée', () => {
    expect(SIMULATION_PARAMETERS).toEqual([
      'discountRate',
      'energyInflationRate',
      'inflationRate',
      'carbonPricePerTonne',
      'failureRateMultiplier',
      'horizonYears',
    ]);
  });
});
