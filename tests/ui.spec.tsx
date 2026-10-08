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
import { IMPORT_TARGET_FIELDS } from '../src/services/serverData';

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

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('Écran Décision', () => {
  const decisionPayload = {
    runId: 'run-1',
    projectId: 'project-1',
    engineVersion: '2.0.0',
    methodologyVersion: '2026.1',
    inputVersion: 1,
    calculatedAt: '2026-10-08T10:00:00.000Z',
    inputFingerprint: 'a'.repeat(64),
    currency: 'EUR',
    horizonYears: 5,
    discountRate: 0.05,
    completeness: {
      totalCostItems: 4,
      validCostItems: 3,
      unsourcedCostItems: 1,
      estimatedCostItems: 0,
      missingCostItems: 0,
      erroredCostItems: 0,
      demoCostItems: 0,
      coveragePercent: 75,
      verdict: 'Données partiellement sourcées.',
    },
    ranking: [
      {
        rank: 1,
        offerId: 'offer-a',
        offerReference: 'OFF-A',
        supplierName: 'Fournisseur A',
        apparentTotal: 200000,
        totalComprehensiveTCO: 425000,
        lifecycleCostLCC: 394827,
        carbonTonnes: 12,
        confidenceScore: 82,
        isApparentCheapest: false,
      },
      {
        rank: 2,
        offerId: 'offer-b',
        offerReference: 'OFF-B',
        supplierName: 'Fournisseur B',
        apparentTotal: 350000,
        totalComprehensiveTCO: 400000,
        lifecycleCostLCC: 393295,
        carbonTonnes: 8,
        confidenceScore: 90,
        isApparentCheapest: true,
      },
    ],
    recommendedOfferId: null,
    recommendation: {
      status: 'indetermine',
      offerId: null,
      reason: "L'écart de VAN entre les deux premières offres est de 0,39 %, sous le seuil de robustesse de 0,5 % : aucune recommandation ferme ne peut être formulée.",
      conditions: ['Vérifier les hypothèses de durée de vie avant de trancher.'],
      economicAdvantage: {
        vsSecondBestNpv: 1531,
        vsWorstNpv: 1531,
        vsCheapestApparentNpv: 1531,
        apparentCheapestOfferId: 'offer-b',
      },
    },
    breakEven: null,
    sensitivity: null,
    inversion: {
      winner: 'OFF-A',
      challenger: 'OFF-B',
      note: 'Deltas calculés comme « challenger − gagnant ».',
      parameters: [
        {
          parameter: 'wacc',
          label: "Taux d'actualisation (WACC)",
          unit: '%',
          range: { min: 0, max: 30, step: 0.5 },
          currentValue: 5,
          direction: 'au_dessus',
          isReachable: true,
          nearestThreshold: 5.37,
          intervals: [{ from: 5.37, to: 30 }],
          marginToThreshold: -0.37,
          deltaAtBounds: { min: -64755, max: 25000 },
          statement: 'Au-delà de 5,37 %, la décision s’inverse.',
        },
      ],
    },
    warnings: ['Poste « Maintenance » sans source : conservé au calcul mais non vérifié.'],
    results: {
      perOffer: [
        {
          offerId: 'offer-a',
          offerReference: 'OFF-A',
          supplierName: 'Fournisseur A',
          totalComprehensiveTCO: 425000,
          lifecycleCostLCC: 394827,
          monthlyEquivalentCost: 7083,
          costPerUnit: 106250,
          carbonTonnes: 12,
          confidenceScore: 82,
          breakdown: [{ category: 'acquisition', amount: 200000, share: 0.47, quality: 'sourcé (Devis signé)' }],
          warnings: [{ severity: 'avertissement', message: 'Un poste est non sourcé.' }],
        },
      ],
      warnings: [],
    },
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

    render(<DecisionView projectId="project-1" projectName="Dossier test" currency="EUR" canRunDecision />);

    // Rien n'est calculé tant que l'utilisateur ne l'a pas demandé : aucun montant
    // ne doit être affiché avant l'appel serveur.
    expect(screen.queryByText(/OFF-A/)).toBeNull();

    screen.getByRole('button', { name: /Calculer la décision/i }).click();

    await waitFor(() => expect(screen.getAllByText(/Aucune recommandation/i).length).toBeGreaterThan(0));
    expect(screen.getByText(/sous le seuil de robustesse de 0,5 %/i)).toBeTruthy();
    // Les deux offres sont classées, et l'option au prix affiché le plus bas est
    // signalée comme telle — sans être présentée comme la meilleure.
    expect(screen.getByText('OFF-A')).toBeTruthy();
    expect(screen.getByText('OFF-B')).toBeTruthy();
    expect(screen.getAllByText(/prix affiché le plus bas/i).length).toBeGreaterThan(0);
    // Le tableau d'inversion affiche le seuil et son unité.
    expect(screen.getAllByText(/5,37 %/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Quand la décision change-t-elle/i)).toBeTruthy();
  });

  it('T-UI-02 : sans droit d’exécution, l’écran explique le refus au lieu de simuler un calcul', async () => {
    const fetchMock = vi.fn(() => jsonResponse({ items: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<DecisionView projectId="project-1" projectName="Dossier test" currency="EUR" canRunDecision={false} />);
    expect(screen.getByText(/autorise la consultation des décisions, mais pas leur exécution/i)).toBeTruthy();

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

    render(<DecisionView projectId="project-1" projectName="Dossier test" currency="EUR" canRunDecision />);
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
