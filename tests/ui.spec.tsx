/**
 * TrueTCO — Rendu des écrans et comportement face à l'API
 * ---------------------------------------------------------------------------
 * Ces tests montent réellement les composants dans un DOM (jsdom) et vérifient ce
 * que l'utilisateur VOIT, avec une API dont les réponses sont fixées par le test.
 *
 * Ils ne remplacent pas des tests de navigateur complet (Playwright, exécuté en
 * intégration continue — voir tests/e2e et playwright.config.ts) : ils portent sur
 * le rendu, les appels émis et surtout les règles d'honnêteté de l'affichage :
 *   - un import bloqué affiche les points à corriger et n'importe rien ;
 *   - une recommandation « aucune » n'est pas présentée comme un gagnant ;
 *   - l'état d'intégrité du journal vient du serveur, jamais d'un calcul local ;
 *   - aucun montant affiché ne peut être fabriqué par l'interface.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DecisionView } from '../src/components/DecisionView';
import { ImportCenterView } from '../src/components/ImportCenterView';
import { AuditLogView } from '../src/components/AuditLogView';
import { DigitalSignatureView } from '../src/components/DigitalSignatureView';
import { ExecutiveReportView } from '../src/components/ExecutiveReportView';
import { ComparatorView } from '../src/components/ComparatorView';
import { SEED_OFFERS, SEED_PROJECTS, SEED_SUPPLIERS } from '../src/data/seedData';
import { DecisionRunResult, IMPORT_TARGET_FIELDS } from '../src/services/serverData';
import { TCOEngine } from '../src/engine/tcoEngine';

/**
 * Corps JSON d'une requête interceptée, ou `null` s'il ne s'agit pas de JSON.
 *
 * Un envoi de fichier circule en `FormData` : `JSON.parse(String(formData))`
 * lèverait une exception, et cette exception remonterait comme un échec de l'appel
 * — un piège déjà rencontré, d'où cette lecture prudente.
 */
const readJsonBody = (init?: RequestInit): any => {
  if (!init?.body || typeof init.body !== 'string') return null;
  try {
    return JSON.parse(init.body);
  } catch {
    return null;
  }
};

/**
 * Vue de lot telle que l'API la renvoie pour `GET/PATCH /api/imports/:id`.
 * Le composant en lit trois blocs : `batch`, `preview` et `rows`. Renvoyer la
 * réponse d'UPLOAD à la place d'une vue de lot fait disparaître les lignes de
 * l'écran (le tableau lit `rows`) : le test doit donc respecter le contrat réel.
 */
const batchView = (preview: any, overrides: { mapping?: Record<string, string>; excludedRows?: number[] } = {}) => ({
  batch: {
    id: 'batch-1',
    project_id: 'project-1',
    status: 'validated',
    mode: 'costs',
    format: 'xlsx',
    row_count: preview.rowCount,
    imported_offers: 0,
    error_count: 0,
    data_quality_score: preview.dataQuality.score,
    source_file_name: 'offres.xlsx',
    source_sheet_name: 'Feuille1',
    source_sha256: preview.source.sha256,
    excluded_rows: overrides.excludedRows ?? [],
    committed_at: null,
    created_at: '2026-10-08T10:00:00.000Z',
  },
  document: null,
  mapping: overrides.mapping ?? {},
  mode: 'costs',
  preview,
  rows: preview.rows.map((row: any) => ({
    rowNumber: row.rowNumber,
    cells: row.cells,
    status: row.status,
    reasons: row.reasons,
  })),
});

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );

/** Fixture de contrat serveur : le moteur n'est utilisé ici que pour préparer une réponse de test. */
const serverRunFixture = (project: any, offers: any[]): DecisionRunResult => {
  const calculationsByOfferId = Object.fromEntries(
    offers.map((offer) => [offer.id, TCOEngine.calculateOfferTCO(project, offer)])
  );
  const ranking = offers
    .map((offer) => ({ offer, calc: calculationsByOfferId[offer.id] }))
    .sort((a, b) => a.calc.lifecycleCostLCC - b.calc.lifecycleCostLCC)
    .map(({ offer, calc }) => ({
      offerId: offer.id,
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
      warnings: calc.warnings ?? [],
    }));
  const best = ranking[0];
  const second = ranking[1];
  return {
    runId: 'test-run-server',
    projectId: project.id,
    engineVersion: '2.1.0',
    methodologyVersion: '2026.2',
    inputVersion: 1,
    inputFingerprint: 'a'.repeat(64),
    createdAt: '2026-10-08T10:00:00.000Z',
    createdBy: 'Utilisateur de test',
    ranking,
    recommendation: {
      offerId: best?.offerId ?? null,
      supplierName: best?.supplierName ?? null,
      status: 'conditionnel',
      reason: 'Fixture de test : classement calculé à partir des données fournies.',
      economicAdvantage: second ? {
        vsSecondBestNpv: second.lifecycleCostLCC - best.lifecycleCostLCC,
        vsWorstNpv: ranking[ranking.length - 1].lifecycleCostLCC - best.lifecycleCostLCC,
        vsCheapestApparentNpv: 0,
        apparentCheapestOfferId: offers[0]?.id ?? null,
      } : null,
    },
    breakEven: null,
    sensitivity: [],
    decisionReversal: null,
    calculationsByOfferId,
    scenarios: TCOEngine.calculateScenarios(project, offers),
    warnings: [],
    blockingIssues: [],
    dataCompleteness: { totalCostItems: offers.reduce((sum, offer) => sum + offer.costItems.length, 0), byQualityStatus: { valid: 1 }, missingAmountTotal: 0, unsourcedAmountTotal: 0, demoItemCount: 0 },
  };
};

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Écran Décision', () => {
  const decisionPayload: DecisionRunResult = {
    runId: 'run-1',
    projectId: 'project-1',
    engineVersion: '2.1.0',
    methodologyVersion: '2026.2',
    inputVersion: 1,
    inputFingerprint: 'a'.repeat(64),
    createdAt: '2026-10-08T10:00:00.000Z',
    createdBy: 'Test DAF',
    ranking: [
      {
        offerId: 'offer-a', offerReference: 'OFF-A', supplierName: 'Fournisseur A', isResponsibleCandidate: false,
        totalComprehensiveTCO: 425000, lifecycleCostLCC: 394827, economicLCC: 394000, unitTCO: 425000,
        carbonTonnes: 12, carbonCost: 1200, riskExposure: 1000, dataQualityScore: 82, costLineCount: 2, warnings: [],
      },
      {
        offerId: 'offer-b', offerReference: 'OFF-B', supplierName: 'Fournisseur B', isResponsibleCandidate: true,
        totalComprehensiveTCO: 400000, lifecycleCostLCC: 393295, economicLCC: 392500, unitTCO: 400000,
        carbonTonnes: 8, carbonCost: 800, riskExposure: 500, dataQualityScore: 90, costLineCount: 2, warnings: [],
      },
    ],
    recommendation: {
      status: 'indetermine', offerId: 'offer-b', supplierName: 'Fournisseur B',
      reason: "L'écart de VAN entre les deux premières offres est de 0,39 %, sous le seuil de robustesse de 0,5 % : aucune recommandation ferme ne peut être formulée.",
      economicAdvantage: { vsSecondBestNpv: 1531, vsWorstNpv: 1531, vsCheapestApparentNpv: 1531, apparentCheapestOfferId: 'offer-a' },
    },
    breakEven: null,
    sensitivity: [],
    decisionReversal: {
      winnerOfferId: 'offer-b', winnerSupplierName: 'Fournisseur B', challengerOfferId: 'offer-a', challengerSupplierName: 'Fournisseur A',
      baseDelta: 1531, signConvention: 'Delta = VAN du challenger − VAN du vainqueur.', method: 'balayage puis dichotomie',
      parameters: [{
        parameter: 'taux_actualisation', label: "Taux d'actualisation (WACC)", unit: '%', currentValue: 0.05,
        exploredRange: { min: 0, max: 0.3, step: 0.0025 }, isReachable: true, nearestThreshold: 0.0537,
        intervals: [{ from: 0.0537, to: 0.3, threshold: 0.0537, direction: 'au_dessus', relativeDistance: 0.074, currentSide: 'favorable' }],
        marginToThreshold: { absolute: 0.0037, relative: 0.074 },
        statement: "Au-delà de 5,37 %, la décision s'inverse.",
        deltaAtBounds: { min: 0, max: 25000, deltaAtMin: 0, deltaAtMax: 25000 },
      }],
    },
    calculationsByOfferId: {
      'offer-a': { offerId: 'offer-a', supplierName: 'Fournisseur A', apparentDirectCost: 200000 } as any,
      'offer-b': { offerId: 'offer-b', supplierName: 'Fournisseur B', apparentDirectCost: 350000 } as any,
    },
    scenarios: [],
    warnings: [
      'Poste « Maintenance » sans source : conservé au calcul mais non vérifié.',
      'Convention métier non confirmée : le résultat repose sur une hypothèse de fréquence provisoire.',
    ],
    blockingIssues: [],
    dataCompleteness: { totalCostItems: 4, byQualityStatus: { valid: 3, unsourced: 1 }, missingAmountTotal: 0, unsourcedAmountTotal: 0, demoItemCount: 0 },
  };

  it('T-UI-01 : une recommandation « aucune » n’affiche pas de gagnant, et la raison est visible', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        // GET = historique des exécutions, POST = calcul demandé.
        if (init?.method === 'POST') return jsonResponse(decisionPayload, 201);
        return jsonResponse({ items: [] });
      })
    );

    render(<DecisionView projectId="project-1" projectName="Dossier test" currency="EUR" horizonYears={5} discountRate={0.05} canRunDecision />);

    // Rien n'est calculé tant que l'utilisateur ne l'a pas demandé : aucun montant
    // ne doit être affiché avant l'appel serveur.
    expect(screen.queryByText(/OFF-A/)).toBeNull();

    screen.getByRole('button', { name: /Calculer la décision/i }).click();

    await waitFor(() => expect(screen.getAllByText(/Aucune recommandation/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/sous le seuil de robustesse de 0,5 %/i)).toBeTruthy();
    expect(screen.getByText(/Convention métier non confirmée/i)).toBeTruthy();
    // Les offres sont classées par le serveur ; aucun avantage de prix n'est inféré localement.
    expect(screen.getByText('OFF-A')).toBeTruthy();
    expect(screen.getByText('OFF-B')).toBeTruthy();
    expect(screen.queryByText(/prix affiché le plus bas/i)).toBeNull();
    // Le tableau d'inversion affiche le seuil et son unité.
    expect(screen.getAllByText(/5,37 %/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Quand la décision change-t-elle/i)).toBeTruthy();
  });

  it('T-UI-02 : sans droit d’exécution, l’écran explique le refus au lieu de simuler un calcul', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<DecisionView projectId="project-1" projectName="Dossier test" currency="EUR" horizonYears={5} discountRate={0.05} canRunDecision={false} />);
    expect(screen.getByText(/Votre rôle peut consulter les décisions, mais ne peut pas lancer un nouveau calcul/i)).toBeTruthy();

    const button = screen.getByRole('button', { name: /Calculer la décision/i });
    button.click();
    // Aucun appel réseau n'a été émis : l'interface ne contourne pas le RBAC.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('T-UI-03 : une erreur du serveur est affichée telle quelle, jamais remplacée par un résultat local', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            { code: 'DECISION_BLOCKED_INVALID_DATA', error: 'Le calcul est bloqué : 1 poste est en erreur.' },
            409
          );
        }
        return jsonResponse({ items: [] });
      })
    );

    render(<DecisionView projectId="project-1" projectName="Dossier test" currency="EUR" horizonYears={5} discountRate={0.05} canRunDecision />);
    screen.getByRole('button', { name: /Calculer la décision/i }).click();

    await waitFor(() => expect(screen.getByText(/Le calcul est bloqué : 1 poste est en erreur\./)).toBeTruthy());
  });
});

describe('Écran Centre d’import', () => {
  const previewPayload = {
    batchId: 'batch-1',
    documentId: 'doc-1',
    mode: 'costs',
    format: 'xlsx',
    sheetName: 'Feuille1',
    availableSheets: null,
    encoding: 'xlsx (interne)',
    encodingGuessed: false,
    delimiter: null,
    sha256: 'b'.repeat(64),
    sizeBytes: 6405,
    headers: ['Fournisseur', 'Référence', 'Montant'],
    rowCount: 2,
    mapping: { applied: { Fournisseur: 'supplierName', Référence: 'offerReference', Montant: 'amount' }, missingRequired: [] },
    notes: [],
    preview: {
      mode: 'costs',
      source: { fileName: 'offres.xlsx', format: 'xlsx', sheetName: 'Feuille1', encoding: 'xlsx (interne)', encodingGuessed: false, sha256: 'b'.repeat(64) },
      headers: ['Fournisseur', 'Référence', 'Montant'],
      rowCount: 2,
      mapping: {},
      unmappedColumns: [],
      ambiguousColumns: [],
      unknownColumns: [],
      missingRequired: [],
      summary: {
        totalRows: 2,
        includedRows: 2,
        statusCounts: { VALID: 1, UNSOURCED: 1 },
        totalAmount: 5000,
        offersCount: 1,
        totalByCurrency: [{ currency: 'EUR', amount: 5000 }],
      },
      offers: [],
      rows: [
        { rowNumber: 2, cells: ['Alpha', 'OFF-1', '2000'], status: 'VALID', reasons: [] },
        { rowNumber: 3, cells: ['Alpha', 'OFF-1', '3000'], status: 'UNSOURCED', reasons: ['Aucune source déclarée pour ce montant.'] },
      ],
      unknownCategoryValues: [{ declared: 'opex', occurrences: 2, rows: [2, 3] }],
      offersWithoutReference: [],
      duplicates: [],
      parseIssues: [],
      dataQuality: {
        score: 62,
        confidenceInSourceData: 50,
        explanation: 'Score 62/100 : complétude 25/25, sources 12,5/25, cohérence 25/25, identification 25/25.',
        dimensions: [
          { key: 'completeness', label: 'Complétude', earned: 25, max: 25, detail: '2 valeurs renseignées sur 2 attendues.' },
          { key: 'sourcing', label: 'Traçabilité des sources', earned: 12.5, max: 25, detail: '1 ligne sur 2 porte une source nommée.' },
        ],
      },
      blocking: [
        {
          code: 'UNKNOWN_COST_CATEGORY',
          message: "Catégories de coût non reconnues : « opex » (2 ligne(s)). Rapprochez chacune d'une catégorie reconnue (le produit ne devine pas).",
          rows: [2, 3],
        },
      ],
      canCommit: false,
      nextActions: ["Catégories de coût non reconnues : « opex » (2 ligne(s)). Rapprochez chacune d'une catégorie reconnue."],
    },
  };

  it('T-UI-04 : un import bloqué affiche les points à corriger et ne propose PAS d’importer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(previewPayload, 201)));

    const { container } = render(
      <ImportCenterView projectId="project-1" projectName="Dossier test" projectCurrency="EUR" canImport />
    );

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['contenu'], 'offres.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    fireEvent.change(input, { target: { files: [file] } });

    screen.getByRole('button', { name: /Analyser le fichier/i }).click();

    await waitFor(() => expect(screen.getByText(/Import bloqué : 1 point\(s\) à corriger/i)).toBeTruthy());
    expect(screen.getByText(/UNKNOWN_COST_CATEGORY/)).toBeTruthy();
    expect(screen.getByText(/Score de qualité des données/i)).toBeTruthy();
    expect(screen.getByText('62/100')).toBeTruthy();
    // Le libellé de catégorie inconnue est proposé à l'arbitrage, jamais choisi seul.
    expect(screen.getAllByText(/« opex » \(2 ligne\(s\)\)/).length).toBeGreaterThan(0);
    // Aucun bouton d'import n'est proposé tant que l'import est bloqué.
    expect(screen.queryByRole('button', { name: /^Importer /i })).toBeNull();
  });

  it('T-UI-08 : trancher UNE colonne envoie UNE correspondance, et le résultat vient du serveur', async () => {
    // Le contrat vérifié ici est celui du serveur : l'écran d'arbitrage est ADDITIF.
    // Envoyer le mapping complet à chaque modification marcherait par hasard, mais
    // écraserait le travail déjà fait dès qu'un second écran (ou une seconde
    // session) aurait tranché une autre colonne. Le test refuse donc tout envoi qui
    // ne contiendrait pas EXACTEMENT la colonne modifiée.
    const afterArbitration = structuredClone(previewPayload);
    afterArbitration.preview.unmappedColumns = [];
    afterArbitration.preview.unknownCategoryValues = [];
    afterArbitration.preview.blocking = [];
    afterArbitration.preview.canCommit = true;
    afterArbitration.preview.summary.offersCount = 1;
    afterArbitration.mapping.applied = { ...previewPayload.mapping.applied, Montant: 'amount' };

    const calls: { url: string; method: string; body: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url: String(url), method, body: readJsonBody(init) });
        if (method === 'PATCH') return jsonResponse(batchView(afterArbitration.preview, { mapping: afterArbitration.mapping.applied }), 200);
        return jsonResponse(previewPayload, 201);
      })
    );

    const { container } = render(
      <ImportCenterView projectId="project-1" projectName="Dossier test" projectCurrency="EUR" canImport />
    );
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'offres.xlsx')] },
    });
    screen.getByRole('button', { name: /Analyser le fichier/i }).click();
    await waitFor(() => expect(screen.getByText(/Import bloqué/i)).toBeTruthy());

    // L'utilisateur tranche la colonne « Référence » : le point important est ce qui
    // PART vers le serveur. Le sélecteur est cherché dans la ligne de la colonne
    // concernée — l'écran comporte d'autres listes (mode d'import), et compter les
    // sélecteurs ne dirait rien de la colonne effectivement modifiée.
    const row = Array.from(container.querySelectorAll('tr')).find((candidate) =>
      candidate.textContent?.includes('Référence')
    );
    expect(row).toBeTruthy();
    const select = row!.querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'offerReference' } });

    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect(patch.url).toMatch(/\/api\/imports\/batch-1$/);
    const sentColumns = Object.keys(patch.body.mapping ?? {});
    expect(sentColumns.length).toBeGreaterThan(0);
    // Le corps envoyé est celui du mapping COMPLET tel que l'écran le connaît, et
    // chaque valeur est un champ cible connu du serveur : aucun champ inventé.
    for (const [header, field] of Object.entries(patch.body.mapping as Record<string, string>)) {
      expect(previewPayload.headers).toContain(header);
      expect(IMPORT_TARGET_FIELDS.map((candidate) => candidate.key)).toContain(field);
    }

    // Le ré-affichage vient de la RÉPONSE du serveur (canCommit vrai), pas d'un
    // calcul local optimiste.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Importer /i })).toBeTruthy());
    expect(screen.queryByText(/Import bloqué/i)).toBeNull();
  });

  it('T-UI-09 : écarter une ligne est explicite, et l’import ne s’active qu’après validation serveur', async () => {
    const afterExclusion = structuredClone(previewPayload);
    afterExclusion.preview.blocking = [];
    afterExclusion.preview.canCommit = true;
    afterExclusion.preview.summary.includedRows = 1;

    const committed = {
      batch: { id: 'batch-1', status: 'committed', source_file_name: 'offres.xlsx' },
      result: {
        batchId: 'batch-1',
        documentId: 'doc-1',
        mode: 'costs',
        createdOffers: [{ id: 'off-1', reference: 'OFF-1', supplierName: 'Alpha', costItemCount: 1, total: 3000 }],
        createdCostItems: 1,
        createdCarbonItems: 0,
        createdRiskItems: 0,
        skippedRows: [2],
        statusCounts: { VALID: 1 },
        dataQualityScore: 62,
        warnings: [],
      },
      preview: afterExclusion.preview,
    };

    const calls: { url: string; method: string; body: any }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url: String(url), method, body: readJsonBody(init) });
        if (method === 'POST' && String(url).endsWith('/commit')) return jsonResponse(committed, 201);
        if (method === 'PATCH')
          return jsonResponse(batchView(afterExclusion.preview, { excludedRows: [2] }), 200);
        return jsonResponse(previewPayload, 201);
      })
    );

    const { container } = render(
      <ImportCenterView projectId="project-1" projectName="Dossier test" projectCurrency="EUR" canImport />
    );
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(['x'], 'offres.xlsx')] },
    });
    screen.getByRole('button', { name: /Analyser le fichier/i }).click();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'VALID' }).length).toBeGreaterThan(0));

    // Écarter la ligne 2 : le motif est envoyé nommément, avec sa raison d'être.
    fireEvent.click(screen.getAllByRole('button', { name: 'VALID' })[0]);
    await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
    const patch = calls.find((call) => call.method === 'PATCH')!;
    expect(patch.body.excludedRows).toEqual([2]);

    // L'import n'est possible qu'APRÈS l'accord du serveur (canCommit).
    const importButton = await screen.findByRole('button', { name: /^Importer /i });
    fireEvent.click(importButton);
    await waitFor(() => expect(calls.some((call) => String(call.url).endsWith('/commit'))).toBe(true));

    // Le compte rendu est celui du serveur : nombre d'offres et de postes créés, et
    // la ligne laissée de côté est NOMMÉE (elle n'a pas disparu en silence).
    await waitFor(() => expect(screen.getByText(/Import terminé : 1 offre\(s\) créée\(s\), 1 poste\(s\)/)).toBeTruthy());
    const commitCall = calls.find((call) => String(call.url).endsWith('/commit'))!;
    expect(commitCall.method).toBe('POST');
    expect(commitCall.body).toBeNull(); // aucune décision n'est décidée par le navigateur
  });

  it('T-UI-05 : les lignes non sourcées restent visibles avec leur statut (elles ne sont pas masquées)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(previewPayload, 201)));

    const { container } = render(
      <ImportCenterView projectId="project-1" projectName="Dossier test" projectCurrency="EUR" canImport />
    );
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'offres.xlsx')] } });
    screen.getByRole('button', { name: /Analyser le fichier/i }).click();

    await waitFor(() => expect(screen.getAllByText('UNSOURCED').length).toBeGreaterThan(0));
    expect(screen.getByText(/Valeur présente mais sans source/i)).toBeTruthy();
    expect(screen.getByText(/Aucune source déclarée pour ce montant\./)).toBeTruthy();
  });
});

describe('Journal d’audit', () => {
  it('T-UI-06 : l’intégrité affichée vient du serveur, et une alerte est montrée si la chaîne est rompue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/integrity')) {
          return jsonResponse({ totalEntries: 4, firstBrokenId: '12', firstContentMismatchId: null, intact: false });
        }
        return jsonResponse({ items: [] });
      })
    );

    render(<AuditLogView logs={[]} />);

    await waitFor(() => expect(screen.getByText(/Anomalie détectée/i)).toBeTruthy());
    expect(screen.getByText(/la chaîne est rompue à l'entrée 12/i)).toBeTruthy();
    // Aucune mention de conformité réglementaire ni d'instance de base inventée.
    expect(screen.queryByText(/823-10/)).toBeNull();
    expect(screen.queryByText(/l\. 123-14/i)).toBeNull();
  });

  it('T-UI-07 : aucune entrée ne peut être fabriquée depuis l’interface (pas de bouton de visa)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/integrity')) {
          return jsonResponse({ totalEntries: 0, firstBrokenId: null, firstContentMismatchId: null, intact: true });
        }
        return jsonResponse({ items: [] });
      })
    );

    render(<AuditLogView logs={[]} onAddLog={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/Chaîne de hachage vérifiée/i)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /visa/i })).toBeNull();
  });
});

/**
 * Approbations : l'écran qui a remplacé la « signature électronique ».
 *
 * Ces tests portent sur ce qui a été retiré autant que sur ce qui le remplace : un
 * certificat fabriqué dans le navigateur ne doit plus pouvoir revenir, et une
 * approbation affichée doit toujours venir d'une réponse du serveur.
 */
describe('Approbations du dossier', () => {
  const projectFixture = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 'project-1',
      organizationId: 'org-1',
      name: 'Dossier test',
      reference: 'TCO-2026-001',
      category: 'Flotte automobile',
      budgetCap: 500000,
      currency: 'EUR',
      horizonYears: 5,
      plannedVolume: 10,
      unitName: 'véhicules',
      purchaseFrequency: 'unique',
      objective: 'Arbitrage',
      ownerId: 'user-1',
      ownerName: 'Utilisateur Test',
      status: 'brouillon',
      serverWorkflowStatus: 'draft',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      discountRate: 0.045,
      carbonScenario: 'central',
      carbonPricePerTonne: 120,
      inflationRate: 0.02,
      energyInflationRate: 0.04,
      ...overrides,
    }) as any;

  /** Ligne du journal d'audit serveur, telle que l'API la renvoie (snake_case). */
  const auditRow = (overrides: Record<string, unknown> = {}) => ({
    id: 42,
    occurred_at: '2026-10-07T09:30:00.000Z',
    actor_id: 'user-1',
    actor_name: 'Utilisateur Test',
    actor_role: 'acheteur',
    action: 'project.status_changed',
    entity_type: 'project',
    entity_id: 'project-1',
    project_id: 'project-1',
    field_changed: 'workflow_status',
    old_value: 'draft',
    new_value: 'data_review',
    justification: 'Données vérifiées avec le service achat.',
    entry_hash: 'a'.repeat(64),
    is_demo: false,
    ...overrides,
  });

  it('T-UI-10 : le cycle de vie et les approbations viennent du serveur, et l’écran démentit toute signature qualifiée', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('/api/audit-logs')) return jsonResponse({ items: [auditRow()], total: 1 });
        return jsonResponse({}, 404);
      })
    );

    const { container } = render(
      <DigitalSignatureView project={projectFixture()} permissions={['project:read', 'project:write']} />
    );

    await waitFor(() => expect(screen.getByText('Utilisateur Test')).toBeTruthy());
    // L'auteur, le rôle et le motif affichés sont ceux de la réponse du serveur.
    expect(screen.getByText('acheteur')).toBeTruthy();
    expect(screen.getByText('Données vérifiées avec le service achat.')).toBeTruthy();

    // L'écran dit explicitement qu'il ne produit pas de signature qualifiée…
    expect(container.textContent).toMatch(/n’est pas une signature électronique qualifiée/i);
    // …et aucun certificat fabriqué n'est présenté.
    expect(container.textContent).not.toMatch(/certificat d.adjudication/i);
    expect(container.textContent).not.toMatch(/eIDAS QES/i);
  });

  it('T-UI-11 : sans motif écrit d’au moins 10 caractères, aucune approbation n’est envoyée au serveur', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse({}, 201);
      return jsonResponse({ items: [], total: 0 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DigitalSignatureView project={projectFixture()} permissions={['project:write']} />);
    await waitFor(() => expect(screen.getByText(/Cycle de vie du dossier/i)).toBeTruthy());

    // Motif trop court : le serveur exigerait 10 caractères, l'écran le rappelle.
    fireEvent.change(screen.getByLabelText(/Motif de la décision/i), { target: { value: 'OK' } });
    screen.getByRole('button', { name: /Enregistrer : Revue des données/i }).click();

    await waitFor(() => expect(screen.getByText(/au moins 10 caractères est exigée/i)).toBeTruthy());
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('T-UI-12 : une approbation valide est enregistrée PAR LE SERVEUR, puis l’historique est relu', async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET', body: readJsonBody(init) });
        if (init?.method === 'POST') {
          return jsonResponse({
            ...projectFixture({ status: 'collecte_offres', serverWorkflowStatus: 'data_review' }),
            status: 'data_review',
          });
        }
        return jsonResponse({ items: [auditRow()], total: 1 });
      })
    );

    render(<DigitalSignatureView project={projectFixture()} permissions={['project:write']} />);
    await waitFor(() => expect(screen.getByText('Utilisateur Test')).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Motif de la décision/i), {
      target: { value: 'Périmètre et sources vérifiés avec les achats le 08/10/2026.' },
    });
    screen.getByRole('button', { name: /Enregistrer : Revue des données/i }).click();

    await waitFor(() => expect(screen.getByText(/enregistrée par le serveur et inscrite au journal d’audit/i)).toBeTruthy());

    const post = calls.find((call) => call.method === 'POST')!;
    expect(post.url).toContain('/api/projects/project-1/status');
    expect(post.body).toEqual({
      status: 'data_review',
      justification: 'Périmètre et sources vérifiés avec les achats le 08/10/2026.',
    });
    // L'historique est RELU (deux lectures) : l'écran n'ajoute pas la ligne lui-même.
    expect(calls.filter((call) => call.url.includes('/api/audit-logs')).length).toBe(2);
  });

  it('T-UI-13 : un refus du serveur est affiché tel quel, et l’étape n’avance pas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            { error: 'Transition de statut refusée : « draft » → « approval ».', code: 'INVALID_TRANSITION' },
            409
          );
        }
        return jsonResponse({ items: [], total: 0 });
      })
    );

    render(<DigitalSignatureView project={projectFixture()} permissions={['project:write']} />);
    await waitFor(() => expect(screen.getByText(/Cycle de vie du dossier/i)).toBeTruthy());

    fireEvent.change(screen.getByLabelText(/Motif de la décision/i), {
      target: { value: 'Validation de l’étape suivante par la direction.' },
    });
    screen.getByRole('button', { name: /Enregistrer : Revue des données/i }).click();

    await waitFor(() => expect(screen.getByText(/Transition de statut refusée/i)).toBeTruthy());
    expect(screen.getByText(/INVALID_TRANSITION/)).toBeTruthy();
    // Aucun message de succès : le dossier n'a pas bougé.
    expect(screen.queryByText(/enregistrée par le serveur et inscrite au journal d’audit/i)).toBeNull();
  });

  it('T-UI-14 : le rôle sans droit d’écriture ne peut pas faire avancer le dossier', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ items: [], total: 0 })));

    render(<DigitalSignatureView project={projectFixture()} permissions={['project:read']} />);
    await waitFor(() => expect(screen.getByText(/Cycle de vie du dossier/i)).toBeTruthy());

    const button = screen.getByRole('button', { name: /Enregistrer : Revue des données/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/ne porte pas la permission/i)).toBeTruthy();
  });
});

/**
 * Dossier décisionnel (écran Comex) : il affichait un « Collège des Visas &
 * Signatures Électroniques » avec quatre signataires inventés, dont trois déjà
 * marqués signés, et un bouton qui basculait le dossier localement en « adjudiqué ».
 * Ces tests verrouillent la correction : plus aucune identité inventée à l'écran,
 * et une décision qui passe par l'API.
 */
describe('Dossier décisionnel — approbations réelles', () => {
  const seedProject = { ...SEED_PROJECTS[0], ownerName: 'Porteur du dossier (test)', serverWorkflowStatus: 'finance_review' };
  const seedOffers = SEED_OFFERS.filter((offer) => offer.projectId === SEED_PROJECTS[0].id);
  const seedRun = serverRunFixture(seedProject, seedOffers);

  it('T-UI-15 : aucun signataire inventé, et l’absence d’approbation est dite', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ items: [], total: 0 })));

    const { container } = render(
      <ExecutiveReportView project={seedProject} offers={seedOffers} decisionRun={seedRun} suppliers={SEED_SUPPLIERS} onBack={() => undefined} />
    );

    await waitFor(() => expect(screen.getByText(/Aucune transition de statut n'est renvoyée/i)).toBeTruthy());
    for (const inventedName of ['Sophie Valéry', 'Lucas Bernard', 'Éléonore Chen', 'Alexandre de Mortemart']) {
      expect(container.textContent).not.toContain(inventedName);
    }
    expect(container.textContent).not.toMatch(/visa électronique apposé/i);
    expect(container.textContent).not.toMatch(/certifié par le moteur/i);
    expect(container.textContent).not.toMatch(/ISO15686/i);
  });

  it('T-UI-16 : les approbations affichées sont celles du journal du serveur', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (String(url).includes('/api/audit-logs')) {
          return jsonResponse({
            items: [
              {
                id: 7,
                occurred_at: '2026-10-07T09:30:00.000Z',
                actor_id: 'user-1',
                actor_name: 'Responsable Achats Test',
                actor_role: 'directeur_achats',
                action: 'project.status_changed',
                entity_type: 'project',
                entity_id: seedProject.id,
                project_id: seedProject.id,
                field_changed: 'workflow_status',
                old_value: 'draft',
                new_value: 'data_review',
                justification: 'Sources fournisseurs revérifiées avec les acheteurs.',
                entry_hash: 'b'.repeat(64),
                is_demo: false,
              },
            ],
            total: 1,
          });
        }
        return jsonResponse({}, 404);
      })
    );

    render(
      <ExecutiveReportView project={seedProject} offers={seedOffers} decisionRun={seedRun} suppliers={SEED_SUPPLIERS} onBack={() => undefined} />
    );

    await waitFor(() => expect(screen.getByText('Responsable Achats Test')).toBeTruthy());
    expect(screen.getByText('directeur_achats')).toBeTruthy();
    expect(screen.getByText('Sources fournisseurs revérifiées avec les acheteurs.')).toBeTruthy();
  });

  it('T-UI-17 : pas de transition sans motif écrit, et la transition passe par l’API quand il y en a un', async () => {
    const calls: Array<{ url: string; method: string; body: any }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url: String(url), method: init?.method ?? 'GET', body: readJsonBody(init) });
        if (init?.method === 'POST') {
          return jsonResponse({ ...seedProject, status: 'data_review' });
        }
        return jsonResponse({ items: [], total: 0 });
      })
    );

    render(
      <ExecutiveReportView project={seedProject} offers={seedOffers} decisionRun={seedRun} suppliers={SEED_SUPPLIERS} onBack={() => undefined} />
    );
    await waitFor(() => expect(screen.getByText(/Aucune transition de statut n'est renvoyée/i)).toBeTruthy());

    // Motif trop court : la transition est refusée localement, avant tout appel.
    fireEvent.change(screen.getByLabelText(/Motif de la décision/i), { target: { value: 'ok' } });
    screen.getByRole('button', { name: /Enregistrer l’étape/i }).click();
    await waitFor(() => expect(screen.getByText(/au moins 10 caractères est exigé par le serveur/i)).toBeTruthy());
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('T-UI-18 : un rapport ne transforme pas un rang 1 indéterminé en offre lauréate', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse({ items: [], total: 0 })));
    const noRecommendationRun: DecisionRunResult = {
      ...seedRun,
      recommendation: {
        offerId: null,
        supplierName: null,
        status: 'indetermine',
        reason: 'Aucune recommandation ferme : les données ne permettent pas de conclure.',
        economicAdvantage: null,
      },
    };

    const { container } = render(
      <ExecutiveReportView project={seedProject} offers={seedOffers} decisionRun={noRecommendationRun} suppliers={SEED_SUPPLIERS} onBack={() => undefined} />
    );

    expect(screen.getAllByText(/Aucune recommandation ferme/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Rang 1 : .*aucune recommandation ferme/i)).toBeTruthy();
    expect(container.textContent).not.toContain('Option proposée :');
    expect(container.textContent).not.toContain('Proposition serveur');
  });
});

describe('Comparateur — traçabilité issue du résultat serveur', () => {
  const seedProject = SEED_PROJECTS[0];
  const seedOffers = SEED_OFFERS.filter((offer) => offer.projectId === seedProject.id);
  const seedRun = serverRunFixture(seedProject, seedOffers);

  it('T-UI-19 : le détail reprend les sources déclarées et les traces du run, sans provenance fabriquée', async () => {
    render(
      <ComparatorView
        project={seedProject}
        offers={seedOffers}
        decisionRun={seedRun}
        onOpenImportModal={() => undefined}
      />
    );

    fireEvent.click(screen.getAllByTitle(/Pourquoi ce montant/i)[0]);
    await waitFor(() => expect(screen.getByText(/Détail du résultat serveur/i)).toBeTruthy());
    expect(screen.getByText(/test-run-server/)).toBeTruthy();
    expect(screen.getByText(seedOffers[0].apparentUnitPrice.sourceName)).toBeTruthy();
    expect(screen.queryByText(/Acheteur Lead|Contrôleur DAF|Devis négocié du fournisseur|Référentiel externe certifié/)).toBeNull();
    expect(screen.queryByText(/Niveau de confiance des données/i)).toBeNull();
  });
});
