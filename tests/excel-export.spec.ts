import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { SEED_OFFERS, SEED_PROJECTS } from '../src/data/seedData';
import type { SupplierOffer, TCOCalculationResult } from '../src/types/domain';
import type { DecisionRunResult } from '../src/services/serverData';
import { ExcelExportService, ExcelExportValidationError } from '../src/services/excelExportService';

const project = SEED_PROJECTS[0];
const offerA = SEED_OFFERS.find((offer) => offer.id === 'off-vul-diesel')!;
const offerB = SEED_OFFERS.find((offer) => offer.id === 'off-vul-elec')!;

/** Résultats explicitement synthétiques de test — jamais utilisés en production. */
function calculationFor(offerId: string, supplierName: string, base: number): TCOCalculationResult {
  return {
    offerId,
    supplierName,
    isResponsibleCandidate: false,
    apparentDirectCost: base,
    acquisitionTotal: base,
    logisticsTotal: 0,
    installationTotal: 0,
    energyConsumablesTotal: 10,
    maintenanceRepairsTotal: 5,
    replacementDefectsTotal: 0,
    adminComplianceTotal: 2,
    taxesTotal: 3,
    salvageValueTotal: 0,
    endOfLifeRecyclingTotal: 0,
    economicTCONominal: base + 17,
    riskExpositionTotal: 4,
    monetizedCarbonTotal: 6,
    totalComprehensiveTCO: base + 27,
    unitTCO: base / 50,
    discountRateUsed: 0.05,
    cashFlowsByYear: [
      {
        year: 0,
        nominalCost: base,
        discountFactor: 1,
        discountedCost: base,
        cumulativeDiscountedCost: base,
        carbonEmissionsTonnes: 0,
        carbonCostNominal: 0,
      },
    ],
    lifecycleCostLCC: base + 20,
    economicLCC: base + 14,
    dataQualityScore: 80,
    uncertaintyRange: { minTCO: base, maxTCO: base + 30, method: 'envelope_par_type_de_source', isStatisticalConfidenceInterval: false },
    totalLifecycleCO2eTonnes: 0.6,
    costLineTrace: [
      {
        id: `trace-${offerId}`,
        label: `Trace API ${offerId}`,
        declaredCategory: 'energy',
        category: 'energie_consommables',
        amountNominal: 10,
        amountDiscounted: 9,
        occurrences: [1, 3],
        occurrencesPerYear: 2,
        indexation: 'energy',
        sourceName: `Source déclarée ${offerId}`,
        sourceType: 'document',
        confidenceLevel: 75,
        isCredit: false,
      },
    ],
  } as TCOCalculationResult;
}

function runFor(offers: SupplierOffer[], ids: string[] = offers.map((offer) => offer.id)): DecisionRunResult {
  const values = new Map(offers.map((offer, index) => [offer.id, 100_000 + index * 10_000]));
  const calculationsByOfferId = Object.fromEntries(
    offers.map((offer) => [offer.id, calculationFor(offer.id, offer.supplierName, values.get(offer.id)!)]),
  );
  const ranking = ids.map((offerId) => {
    const offer = offers.find((candidate) => candidate.id === offerId)!;
    const calc = calculationsByOfferId[offerId] as TCOCalculationResult;
    return {
      offerId,
      supplierName: offer.supplierName,
      offerReference: offer.offerReference,
      isResponsibleCandidate: offer.isResponsibleCandidate,
      totalComprehensiveTCO: calc.totalComprehensiveTCO,
      lifecycleCostLCC: calc.lifecycleCostLCC,
      economicLCC: calc.economicLCC ?? null,
      unitTCO: calc.unitTCO,
      carbonTonnes: calc.totalLifecycleCO2eTonnes,
      carbonCost: calc.monetizedCarbonTotal,
      riskExposure: calc.riskExpositionTotal,
      dataQualityScore: calc.dataQualityScore,
      costLineCount: calc.costLineTrace?.length ?? 0,
      warnings: [],
    };
  });
  return {
    runId: 'run-test-export',
    projectId: project.id,
    engineVersion: 'engine-test',
    methodologyVersion: 'method-test',
    inputVersion: 7,
    inputFingerprint: 'fingerprint-test-only',
    createdAt: '2026-10-08T10:00:00.000Z',
    createdBy: 'test fixture',
    ranking,
    recommendation: {
      offerId: ids[0] ?? null,
      supplierName: offers.find((offer) => offer.id === ids[0])?.supplierName ?? null,
      status: 'ferme',
      reason: 'Recommandation synthétique de fixture de test.',
      economicAdvantage: null,
    },
    breakEven: null,
    sensitivity: [],
    decisionReversal: null,
    calculationsByOfferId,
    scenarios: [],
    warnings: [
      'Convention métier non confirmée : fixture de test selon une hypothèse de fréquence provisoire.',
    ],
    blockingIssues: [],
    dataCompleteness: { totalCostItems: 2, byQualityStatus: {}, missingAmountTotal: 0, unsourcedAmountTotal: 0, demoItemCount: 0 },
  };
}

function roundTripSheet(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const reopened = XLSX.read(bytes, { type: 'buffer' });
  return XLSX.utils.sheet_to_json(reopened.Sheets[sheetName], { header: 1, defval: null }) as unknown[][];
}

describe('Export Excel — résultats serveur persistés', () => {
  it('conserve l’ordre du classement API, les traces serveur et les détails monétaires déclarés', () => {
    const offers = [offerB, offerA]; // l'ordre local est volontairement différent de celui du serveur
    const run = runFor(offers, [offerA.id, offerB.id]);
    run.calculationsByOfferId[offerA.id] = calculationFor(offerA.id, offerA.supplierName, 111_111);
    run.calculationsByOfferId[offerB.id] = calculationFor(offerB.id, offerB.supplierName, 222_222);
    run.recommendation.offerId = offerA.id;

    const workbook = ExcelExportService.buildFinancialWorkbook(project, offers, run, []);
    const summary = roundTripSheet(workbook, 'Synthèse Décision');
    const rankingHeaderIndex = summary.findIndex((row) => row[0] === 'Rang fourni par l’API');
    expect(summary[rankingHeaderIndex + 1]?.slice(0, 3)).toEqual([1, offerA.supplierName, offerA.offerReference]);
    expect(summary[rankingHeaderIndex + 2]?.slice(0, 3)).toEqual([2, offerB.supplierName, offerB.offerReference]);
    expect(summary[rankingHeaderIndex]?.[6]).toBe('Fiscalité / taxes (€)');
    expect(summary.some((row) => row.some((cell) => /Convention métier non confirmée/.test(String(cell))))).toBe(true);

    const breakdown = roundTripSheet(workbook, 'Décomposition TCO (CBS)');
    const exportedTrace = breakdown.find((row) => row.includes(`Trace API ${offerA.id}`));
    expect(exportedTrace).toBeDefined();
    expect(exportedTrace?.[7]).toBe('Année 1, Année 3');
    expect(exportedTrace?.[8]).toBe(2);
    expect(breakdown.some((row) => row.includes(`Source déclarée ${offerA.id}`))).toBe(true);
    expect(breakdown[1]?.[0]).toMatch(/ne constituent pas une ventilation exhaustive/);
  });

  it('ne transforme pas le rang 1 en recommandation lorsque le statut serveur est indéterminé', () => {
    const offers = [offerA, offerB];
    const run = runFor(offers);
    run.recommendation = {
      offerId: null,
      supplierName: null,
      status: 'indetermine',
      reason: 'Aucune recommandation ferme : fixture de test.',
      economicAdvantage: null,
    };

    const workbook = ExcelExportService.buildFinancialWorkbook(project, offers, run, []);
    const summary = roundTripSheet(workbook, 'Synthèse Décision');
    expect(summary.some((row) => row.includes('Aucune recommandation ferme'))).toBe(true);
    expect(summary.flat().some((cell) => cell === 'Proposition serveur' || cell === 'Gagnant')).toBe(false);
  });

  it('refuse un run périmé au lieu d’exporter ses montants', () => {
    const run = runFor([offerA]);
    run.freshness = {
      dataChangedSinceRun: true,
      engineChangedSinceRun: false,
      engineVersionStored: 'engine-test',
      engineVersionCurrent: 'engine-test',
      currentFingerprint: 'changed',
      storedFingerprint: 'fingerprint-test-only',
      explanation: 'Les données ont changé depuis le calcul.',
    };
    expect(() => ExcelExportService.buildFinancialWorkbook(project, [offerA], run, [])).toThrow(ExcelExportValidationError);
  });

  it('refuse une ligne de classement sans détail au lieu de promouvoir la ligne suivante', () => {
    const run = runFor([offerA, offerB]);
    run.ranking[0].offerId = 'missing-offer-id';
    run.ranking[0].offerReference = 'MISSING';
    run.recommendation = {
      offerId: offerB.id,
      supplierName: offerB.supplierName,
      status: 'conditionnel',
      reason: 'Fixture conditionnelle.',
      economicAdvantage: null,
    };
    expect(() => ExcelExportService.buildFinancialWorkbook(project, [offerA, offerB], run, [])).toThrow(/détails de l’offre/);
  });

  it('refuse une option proposée absente du classement et des détails', () => {
    const run = runFor([offerA]);
    run.recommendation.offerId = 'offer-not-in-run';
    expect(() => ExcelExportService.buildFinancialWorkbook(project, [offerA], run, [])).toThrow(/option proposée/);
  });

  it('refuse un résultat incomplet ou sans qualification de la convention de fréquence', () => {
    const run = runFor([offerA]);
    const completeness = run.dataCompleteness;
    (run as any).dataCompleteness = undefined;
    expect(() => ExcelExportService.buildFinancialWorkbook(project, [offerA], run, [])).toThrow(
      /complétude des données renvoyée par le serveur est absente ou invalide/
    );

    run.dataCompleteness = completeness;
    run.warnings = [];
    expect(() => ExcelExportService.buildFinancialWorkbook(project, [offerA], run, [])).toThrow(
      /ne qualifie pas la convention de fréquence non confirmée/
    );
  });
});
