/**
 * PARCOURS RÉEL DE BOUT EN BOUT (HTTP, serveur complet, base PostgreSQL réelle)
 * ---------------------------------------------------------------------------
 * Ces tests pilotent l'application RÉELLE par HTTP : même serveur Express, mêmes
 * routes, mêmes contrôles d'accès, même base PostgreSQL (PGlite/WASM, politiques
 * RLS de production), aucun objet simulé.
 *
 * Raison d'être : les tests de bout en bout Playwright ne peuvent pas être
 * exécutés dans l'environnement de développement initial (téléchargement des
 * navigateurs bloqué par le filtrage réseau — c'est écrit dans TESTING.md). Sans
 * ces tests-ci, le parcours complet n'aurait JAMAIS été exécuté nulle part, et
 * « ça marche » n'aurait reposé sur rien.
 *
 * Ce qui est vérifié ici correspond aux tests de réalité exigés :
 *   A. PME : 3 fournisseurs, import, recommandation, reconnexion, persistance ;
 *   C. donnée manquante détectée, expliquée, jamais inventée ;
 *   D. source non vérifiée ⇒ UNSOURCED, jamais VERIFIED ;
 *   F. reproductibilité exacte (rejeu de la décision depuis l'instantané) ;
 *   + deux sessions distinctes de la même organisation voient les mêmes données ;
 *   + un second organisme ne voit RIEN du premier (cloisonnement sur les routes
 *     réelles, y compris les routes d'import et de décision).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { createApp } from '../server/app';
import { mapOffer } from '../src/engine/mapping';
import { createTestDb } from '../server/db/testing';
import type { Db } from '../server/db/types';

let db: Db;
let server: Server;
let baseUrl: string;

interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

async function api<T = any>(
  method: string,
  path: string,
  options: {
    cookie?: string;
    json?: unknown;
    form?: FormData;
    raw?: string;
    headers?: Record<string, string>;
    /** Simule un client qui omet volontairement l'origine (test du garde-fou CSRF). */
    omitOrigin?: boolean;
  } = {}
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  // Un navigateur joint TOUJOURS l'origine de la page aux requêtes qu'il émet.
  // Le serveur refuse (403, à raison) toute requête mutante authentifiée par
  // cookie sans origine : le test doit donc se comporter comme un client réel, et
  // non se dispenser du contrôle. L'absence d'origine est testée séparément.
  if (!options.omitOrigin && !headers.Origin && options.cookie) headers.Origin = baseUrl;
  // Comme un navigateur : la session circule par le cookie HttpOnly délivré à la
  // connexion. Le jeton n'est JAMAIS renvoyé dans le corps d'une réponse — c'est
  // délibéré (un jeton lisible par du JavaScript est un jeton volable), et ces
  // tests s'y conforment au lieu de contourner le mécanisme.
  if (options.cookie) headers.Cookie = options.cookie;
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.raw !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = options.raw;
  }
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* réponse non JSON conservée telle quelle */
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

/** Fichier CSV d'un import de coûts : trois offres, cas pièges volontaires. */
function csvScenario(): string {
  // - EcoMobility  : complet, mais une valeur SANS source (doit rester UNSOURCED)
  // - AutoFleet    : une ligne sans montant (doit être MISSING, jamais 0 €)
  // - FleetRetrofit: une catégorie inconnue (« Frais de raccordement »)
  const lines = [
    'référence offre;fournisseur;libellé;catégorie;montant;devise;source;récurrent;occurrences par an;confiance',
    // EcoMobility — offre cohérente et sourcée
    'OFF-ECO-2026;EcoMobility SAS;Prix d’achat des véhicules;acquisition;185000;EUR;Devis 2026-114 signé le 12/03/2026;non;;95',
    'OFF-ECO-2026;EcoMobility SAS;Énergie (électricité);énergie;42000;EUR;Contrat cadre EDF OA-2291;oui;5;90',
    'OFF-ECO-2026;EcoMobility SAS;Maintenance préventive;maintenance;18500;EUR;Grille tarifaire 2026;oui;5;80',
    'OFF-ECO-2026;EcoMobility SAS;Formation des conducteurs;formation;6400;EUR;;non;;70',
    // AutoFleet — une ligne sans montant, une ligne en erreur de format
    'OFF-AUT-2026;AutoFleet France;Prix d’achat des véhicules;acquisition;212000;EUR;Devis 2026-008;non;;90',
    'OFF-AUT-2026;AutoFleet France;Énergie (gazole);énergie;;EUR;Relevé carburant 2025;oui;5;75',
    'OFF-AUT-2026;AutoFleet France;Maintenance;maintenance;dix-neuf mille;EUR;Grille tarifaire;oui;5;60',
    'OFF-AUT-2026;AutoFleet France;Assurance flotte;assurance;15600;EUR;Police 2026-4417;oui;5;85',
    // FleetRetrofit — catégorie inconnue
    'OFF-FLE-2026;FleetRetrofit Solution;Rétrofit des véhicules;acquisition;168000;EUR;Devis RF-2026-33;non;;85',
    'OFF-FLE-2026;FleetRetrofit Solution;Énergie (électricité);énergie;38000;EUR;Estimation interne;oui;5;55',
    'OFF-FLE-2026;FleetRetrofit Solution;Maintenance;maintenance;21000;EUR;Contrat FRS-2025;oui;5;80',
    'OFF-FLE-2026;FleetRetrofit Solution;Borne de recharge partagée;frais de raccordement;9500;EUR;Devis raccordement;non;;70',
  ];
  // Séparateur point-virgule + décimales françaises : format de terrain.
  return lines.join('\r\n');
}

/** Extrait le couple « nom=valeur » du cookie de session posé par le serveur. */
function sessionCookieFrom(response: { headers: Headers }): string {
  const raw = typeof (response.headers as any).getSetCookie === 'function'
    ? (response.headers as any).getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
  const session = (raw as string[]).map((value) => value.split(';')[0]).find((value) => value.startsWith('truetco_session='));
  if (!session) throw new Error('Le serveur n’a pas délivré de cookie de session.');
  return session;
}

/** Connexion réelle : renvoie le cookie de session, comme le ferait un navigateur. */
async function login(email: string): Promise<string> {
  const response = await api('POST', '/api/auth/sso/login', { json: { email } });
  expect(response.status).toBe(200);
  return sessionCookieFrom(response);
}

async function uploadCsv(cookie: string, projectId: string, content: string, fileName = 'offres-pme-2026.csv') {
  const form = new FormData();
  form.append('mode', 'costs');
  form.append('file', new Blob([content], { type: 'text/csv' }), fileName);
  return api<{ batchId: string; preview: any; mapping: any }>('POST', `/api/projects/${projectId}/imports`, {
    cookie,
    form,
  });
}

beforeAll(async () => {
  db = await createTestDb({ quiet: true });
  const app = createApp({
    db,
    isProd: false,
    allowDemoAuth: true,
    allowedOrigins: [],
    engineVersion: '2.0.0',
    methodologyVersion: '2026.1',
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db?.close();
});

describe('Parcours PME complet, par HTTP (test de réalité A, C, D, F)', () => {
  const org = {
    slug: 'pme-transports',
    domain: 'pme-transports.example',
    adminEmail: 'direction@pme-transports.example',
  };
  let session = '';
  let session2 = '';
  let projectId = '';

  it('A1 — un nouvel organisme s’inscrit et un administrateur se connecte', async () => {
    const registration = await api('POST', '/api/auth/register', {
      json: {
        organizationName: 'PME Transports Loire',
        slug: org.slug,
        domain: org.domain,
        adminEmail: org.adminEmail,
        adminFullName: 'Camille Rousseau',
      },
    });
    expect(registration.status).toBe(201);

    const response = await api('POST', '/api/auth/sso/login', { json: { email: org.adminEmail } });
    expect(response.status).toBe(200);
    // Le corps ne contient AUCUN jeton : la session est un cookie HttpOnly.
    expect(JSON.stringify(response.body)).not.toMatch(/sess-[a-z0-9]/i);
    expect(response.body.isDemo).toBe(true);
    expect(response.body.warning).toMatch(/démonstration/i);
    session = sessionCookieFrom(response);
  });

  it('A2 — sans session, aucune donnée n’est accessible (échec fermé)', async () => {
    const anonymous = await api('GET', '/api/projects');
    expect(anonymous.status).toBe(401);
    const bounced = await api('GET', '/api/projects', { cookie: 'truetco_session=sess-inventee' });
    expect(bounced.status).toBe(401);
    // Un jeton forgé dans l'en-tête machine est refusé de la même façon.
    const forged = await api('GET', '/api/projects', {
      headers: { Authorization: 'Bearer sess-inventee' },
    });
    expect(forged.status).toBe(401);
  });

  it('A3 — création du dossier d’arbitrage', async () => {
    const created = await api<{
      id: string;
      reference: string;
      status: string;
      horizon_years: number;
      discount_rate: string;
    }>('POST', '/api/projects', {
      cookie: session,
      json: {
        reference: 'TCO-2026-001',
        name: 'Renouvellement de la flotte utilitaire (48 véhicules)',
        description:
          'Arbitrage entre renouvellement classique, rétrofit et mobilité électrique. Données fournisseurs reçues en mars 2026.',
        category: 'Flotte automobile',
        currency: 'EUR',
        countryCode: 'FR',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('draft');
    // Les hypothèses de calcul ont des valeurs par défaut EXPLICITES, modifiables :
    // elles ne sont pas cachées dans le moteur.
    expect(created.body.horizon_years).toBeGreaterThan(0);
    expect(Number(created.body.discount_rate)).toBeGreaterThanOrEqual(0);
    projectId = created.body.id;
  });

  it('C — un fichier dont le montant est illisible est REFUSÉ, et la ligne fautive est désignée', async () => {
    const upload = await uploadCsv(session, projectId, csvScenario());
    expect(upload.status).toBe(201);

    const preview = upload.body.preview;
    // Deux causes d'erreur bien distinctes apparaissent, et elles doivent rester
    // distinctes dans l'affichage :
    //  - « dix-neuf mille » n'est pas un montant (valeur illisible) ;
    //  - « formation », « assurance » et « frais de raccordement » ne sont pas des
    //    catégories de coût connues : le produit demande à un humain de trancher
    //    au lieu de rapprocher à l'aveugle.
    const errorRows = preview.rows.filter((row: any) => row.status === 'ERROR');
    const invalidAmountRows = errorRows.filter((row: any) => /pas un nombre exploitable/i.test(row.reasons.join(' ')));
    expect(invalidAmountRows).toHaveLength(1);
    expect(invalidAmountRows[0].rowNumber).toBe(8);
    const unknownCategoryRows = errorRows.filter((row: any) => /catégorie/i.test(row.reasons.join(' ')));
    expect(unknownCategoryRows.map((row: any) => row.rowNumber)).toEqual([5, 9, 13]);
    expect(preview.canCommit).toBe(false);
    const blockingCodes = preview.blocking.map((entry: any) => entry.code);
    expect(blockingCodes).toContain('INVALID_ROWS');
    // Le montant manquant n'est PAS traité comme un zéro : il bloque aussi.
    expect(blockingCodes).toContain('MISSING_VALUES');
    // La ligne sans montant est MANQUANTE, jamais complétée par 0 €.
    const missingRow = preview.rows.find((row: any) => row.rowNumber === 7);
    expect(missingRow.status).toBe('MISSING');
    expect(missingRow.values.amount.value).toBeNull();
    // Aucun montant n'a été fabriqué : le total annoncé ne retient QUE les lignes
    // exploitables (une ligne en erreur n'est jamais comptée comme un montant).
    const counted = preview.rows
      .filter((row: any) => row.status !== 'ERROR' && typeof row.values.amount?.value === 'number')
      .reduce((sum: number, row: any) => sum + row.values.amount.value, 0);
    expect(preview.summary.totalAmount).toBe(counted);
    const errorAmounts = preview.rows
      .filter((row: any) => row.status === 'ERROR' && typeof row.values.amount?.value === 'number')
      .reduce((sum: number, row: any) => sum + row.values.amount.value, 0);
    expect(errorAmounts).toBeGreaterThan(0); // il y avait bien des montants écartés
    expect(preview.summary.totalAmount).toBeLessThan(counted + errorAmounts);
    expect(preview.nextActions.length).toBeGreaterThan(0);
  });

  it('C2 — la ligne fautive est corrigée puis réimportée : le dossier l’accepte', async () => {
    const corrected = csvScenario().replace('dix-neuf mille', '19200');
    const upload = await uploadCsv(session, projectId, corrected, 'offres-pme-2026-corrige.csv');
    expect(upload.status).toBe(201);

    const preview = upload.body.preview;
    // Seules subsistent les trois catégories à arbitrer : plus aucune valeur
    // illisible, et le montant manquant reste MANQUANT (jamais complété).
    const stillError = preview.rows.filter((row: any) => row.status === 'ERROR');
    expect(stillError.map((row: any) => row.rowNumber)).toEqual([5, 9, 13]);
    expect(preview.rows.filter((row: any) => row.status === 'MISSING')).toHaveLength(1);

    // DEUX réflexes d'honnêteté du produit, vérifiés sur un fichier réel :
    //  1. une colonne non modélisée n'est pas rattachée de force : elle est
    //     signalée et l'import reste bloqué tant qu'un humain ne tranche pas ;
    //  2. une catégorie inconnue est listée, JAMAIS rapprochée par ressemblance.
    const blockingCodes = preview.blocking.map((entry: any) => entry.code);
    expect(blockingCodes).toContain('UNRESOLVED_COLUMNS');
    expect(preview.blocking.find((entry: any) => entry.code === 'UNRESOLVED_COLUMNS').message).toMatch(
      /occurrences par an/
    );
    expect(blockingCodes).toContain('UNKNOWN_COST_CATEGORY');
    const unknownCategories = preview.unknownCategoryValues.map((entry: any) => entry.declared);
    for (const valeur of ['formation', 'assurance', 'frais de raccordement']) {
      expect(unknownCategories).toContain(valeur);
    }
    expect(preview.canCommit).toBe(false);

    // La valeur sans source est signalée comme telle : le produit n'affirme jamais
    // qu'une donnée est vérifiée quand aucun justificatif ne l'accompagne.
    const unsourced = preview.rows.find((row: any) => row.rowNumber === 5);
    expect(unsourced.reasons.join(' ')).toMatch(/Aucune source déclarée/);
    expect(unsourced.values.sourceName.value).toBeNull();

    // Score de qualité : calculé, borné, expliqué par ses quatre composantes.
    const quality = preview.dataQuality;
    expect(quality.score).toBeGreaterThan(0);
    expect(quality.score).toBeLessThanOrEqual(100);
    expect(quality.dimensions).toHaveLength(4);
    // Chaque composante du score est nommée, chiffrée ET justifiée par une phrase :
    // un score de qualité sans explication serait un chiffre décoratif.
    for (const dimension of quality.dimensions) {
      expect(typeof dimension.label).toBe('string');
      expect(typeof dimension.detail).toBe('string');
      expect(dimension.detail.length).toBeGreaterThan(20);
      expect(dimension.max).toBeGreaterThan(0);
      expect(dimension.earned).toBeGreaterThanOrEqual(0);
      expect(dimension.earned).toBeLessThanOrEqual(dimension.max);
    }
    // Le score affiché est bien la somme de ses composantes (arrondie à l'entier,
    // jamais décorée d'un chiffre sans origine).
    const total = quality.dimensions.reduce((sum: number, dimension: any) => sum + dimension.earned, 0);
    expect(quality.score).toBe(Math.round(total));
    expect(quality.explanation.length).toBeGreaterThan(20);

    // Arbitrage humain, explicite et enregistré :
    //  - la colonne non modélisée est IGNÉE nommément ;
    //  - les trois catégories inconnues sont rattachées par une personne, et ce
    //    choix est conservé dans le lot (relu et affiché, pas seulement appliqué).
    const arbitrated = await api<any>('PATCH', `/api/imports/${upload.body.batchId}`, {
      cookie: session,
      json: {
        mapping: { 'occurrences par an': 'ignore' },
        categoryOverrides: {
          formation: 'couts_administratifs_conformite',
          assurance: 'couts_administratifs_conformite',
          'frais de raccordement': 'acquisition',
        },
      },
    });
    expect(arbitrated.status).toBe(200);
    // La fusion du mapping est testée ici : trancher UNE colonne ne doit pas
    // effacer les correspondances déjà établies. Si c'était le cas, toutes les
    // colonnes redeviendraient « non tranchées » et l'analyse serait perdue.
    expect(Object.keys(arbitrated.body.preview.mapping).length).toBeGreaterThanOrEqual(9);
    expect(arbitrated.body.preview.mapping['occurrences par an']).toBe('ignore');
    // Il reste UN blocage, et il est juste : la ligne sans montant n'est pas
    // complétée d'office. Le produit propose deux issues, aucune automatique.
    expect(arbitrated.body.preview.canCommit).toBe(false);
    expect(arbitrated.body.preview.blocking.map((entry: any) => entry.code)).toEqual(['MISSING_VALUES']);
    expect(arbitrated.body.preview.blocking[0].rows).toEqual([7]);

    // Issue choisie par l'utilisateur : écarter EXPLICITEMENT la ligne. Le choix
    // est enregistré, et il est relu (donc auditable).
    const excluded = await api<any>('PATCH', `/api/imports/${upload.body.batchId}`, {
      cookie: session,
      json: { excludedRows: [7] },
    });
    expect(excluded.status).toBe(200);
    expect(excluded.body.preview.canCommit).toBe(true);
    expect(excluded.body.batch.excluded_rows).toEqual([7]);
    // L'arbitrage est CONSERVÉ : on peut le relire après coup (traçabilité).
    expect(arbitrated.body.preview.unknownCategoryValues).toHaveLength(0);
    // Une fois la catégorie tranchée, la ligne apparaît pour ce qu'elle est
    // vraiment : une donnée SANS SOURCE, à confiance nulle.
    const arbitratedRow = arbitrated.body.preview.rows.find((row: any) => row.rowNumber === 5);
    expect(arbitratedRow.status).toBe('UNSOURCED');
    // La confiance DÉCLARÉE par le fournisseur de la donnée (70 %) est conservée
    // telle quelle et reste distincte du statut : « déclaré » n'est pas « vérifié ».
    expect(arbitratedRow.values.confidence?.value).toBe(70);
    const reread = await api<any>('GET', `/api/imports/${upload.body.batchId}`, { cookie: session });
    expect(reread.body.mapping['occurrences par an']).toBe('ignore');
    expect(reread.body.preview.canCommit).toBe(true);

    const committed = await api<{
      result: {
        createdOffers: any[];
        dataQualityScore: number;
        skippedRows: number[];
        documentId: string;
      };
    }>('POST', `/api/imports/${upload.body.batchId}/commit`, { cookie: session });
    expect(committed.status).toBe(201);
    // 3 offres, une par fournisseur, chacune avec ses postes de coût.
    const created = committed.body.result;
    expect(created.createdOffers).toHaveLength(3);
    expect(created.createdOffers.every((offer: any) => offer.costItemCount > 0)).toBe(true);
    expect(created.skippedRows).toEqual([7]); // la ligne écartée est NOMMÉE
    expect(created.dataQualityScore).toBeGreaterThan(0);
    // L'import écrit un document (le fichier d'origine) et le rattache au lot.
    expect(committed.body.result.documentId).toBeTruthy();
  });

  it('D — les données importées conservent leur provenance, ligne à ligne', async () => {
    const offers = await api<{ items: any[] }>('GET', `/api/offers?projectId=${projectId}`, { cookie: session });
    expect(offers.status).toBe(200);
    expect(offers.body.items).toHaveLength(3);

    for (const offer of offers.body.items) {
      expect(offer.data_source).toMatch(/^import_(csv|xlsx)$/);
      expect(offer.import_batch_id).toBeTruthy();
    }

    const eco = offers.body.items.find((offer: any) => offer.offer_reference === 'OFF-ECO-2026');
    const detail = await api<any>('GET', `/api/offers/${eco.id}`, { cookie: session });
    expect(detail.status).toBe(200);
    const lines = detail.body.costItems;

    // Un montant affiché doit pouvoir remonter jusqu'à la cellule d'origine.
    const energy = lines.find((line: any) => /nergie/i.test(line.label));
    expect(energy.source_name).toBe('Contrat cadre EDF OA-2291');
    expect(energy.source_row_number).toBe(3); // ligne 3 du fichier (1 = en-tête)
    expect(energy.is_imported).toBe(true);
    expect(energy.quality_status).toBe('valid');
    expect(energy.confidence_level).toBeGreaterThan(0);

    // Une valeur sans source est marquée « unsourced », avec une confiance nulle :
    // le produit n'affirme jamais qu'une donnée est vérifiée sans justificatif.
    const training = lines.find((line: any) => /Formation/i.test(line.label));
    expect(training.quality_status).toBe('unsourced');
    expect(training.source_name).toBeNull();
    // La confiance DÉCLARÉE dans le fichier (70 %) est conservée telle quelle —
    // c'est une donnée du fichier, pas une appréciation du produit. Elle est
    // plafonnée à 0 par le moteur pour tout poste non sourcé (voir
    // src/engine/mapping.ts) : une donnée sans justificatif ne peut pas
    // améliorer la confiance d'un résultat.
    expect(training.confidence_level).toBe(70);
  });

  it('F — la décision est calculée par le serveur, classée, et munie de sa version', async () => {
    const run = await api<any>('POST', `/api/projects/${projectId}/decision-runs`, { cookie: session });
    expect(run.status).toBe(201);
    expect(run.body.engineVersion).toBe('2.0.0');
    expect(run.body.methodologyVersion).toBe('2026.1');

    const ranking = run.body.ranking;
    // Les trois offres sont classées, avec un coût complet et une valeur actualisée.
    // NB : la ligne écartée (montant absent) ne produit AUCUNE offre fantôme.
    expect(ranking).toHaveLength(3);
    for (const entry of ranking) {
      expect(entry.totalComprehensiveTCO).toBeGreaterThan(0);
      expect(Number.isFinite(entry.lifecycleCostLCC)).toBe(true);
      expect(entry.costLineCount).toBeGreaterThan(0);
    }
    // Le classement est croissant sur la VAN du coût complet — c'est la métrique
    // de comparaison, pas le prix affiché.
    const lccs = ranking.map((entry: any) => entry.lifecycleCostLCC);
    expect([...lccs].sort((a: number, b: number) => a - b)).toEqual(lccs);

    const recommendation = run.body.recommendation;
    // Trois issues possibles, et aucune n'est silencieuse : « ferme » (l'écart est
    // significatif), « conditionnel » (l'écart existe mais repose sur une donnée
    // fragile) et « indetermine » (l'écart est trop faible pour trancher).
    expect(['ferme', 'conditionnel', 'indetermine']).toContain(recommendation.status);
    expect(recommendation.reason.length).toBeGreaterThan(40);
    if (recommendation.status === 'indetermine') {
      // Un classement non concluant est DIT, avec l'écart qui l'explique.
      expect(recommendation.gapPercent).toBeLessThanOrEqual(0.5);
    }
    // Deux questions essentielles du produit ont une réponse chiffrée :
    // « à partir de quand l'option perd-elle ? » et « qu'est-ce qui pèse ? ».
    expect(run.body.breakEven).toBeTruthy();
    expect(run.body.sensitivity).toBeTruthy();
    // « À partir de quand la décision change-t-elle ? » : la réponse est une liste
    // de paramètres explorés, chacun avec son seuil d'inversion.
    expect(Array.isArray(run.body.decisionReversal?.parameters)).toBe(true);
    expect(run.body.decisionReversal.parameters.length).toBeGreaterThanOrEqual(4);
    for (const parameter of run.body.decisionReversal.parameters) {
      expect(typeof parameter.label).toBe('string');
      expect(typeof parameter.currentValue).toBe('number');
      expect(parameter.exploredRange.max).toBeGreaterThan(parameter.exploredRange.min);
      // Chaque paramètre dit s'il peut INVERSER la décision, et à partir de quelle
      // valeur ; quand l'inversion est hors de la plage explorée, c'est écrit.
      expect(typeof parameter.isReachable).toBe('boolean');
      expect(parameter.statement.length).toBeGreaterThan(20);
      expect(Array.isArray(parameter.intervals)).toBe(true);
    }
    // La convention de signe de l'écart est écrite noir sur blanc : sans elle,
    // un lecteur pressé inverserait le sens de la comparaison.
    expect(run.body.decisionReversal.signConvention.length).toBeGreaterThan(20);
    // Les données manquantes et non sourcées sont COMPTÉES et affichées, jamais
    // compensées : le lecteur sait sur quoi la décision repose réellement.
    const completeness = run.body.dataCompleteness;
    expect(typeof completeness.totalCostItems).toBe('number');
    expect(completeness.unsourcedAmountTotal).toBe(6400); // poste « formation », sans justificatif
    expect(completeness.byQualityStatus.unsourced).toBeGreaterThanOrEqual(1);
  });

  it('F2 — le rejeu de la décision redonne EXACTEMENT le même résultat', async () => {
    const runs = await api<{ items: { id: string }[] }>('GET', `/api/projects/${projectId}/decision-runs`, { cookie: session });
    expect(runs.status).toBe(200);
    expect(runs.body.items.length).toBeGreaterThan(0);
    const runId = runs.body.items[0].id;

    const replay = await api<any>('POST', `/api/decision-runs/${runId}/replay`, { cookie: session });
    expect(replay.status).toBe(200);
    expect(replay.body.identical).toBe(true);
    expect(replay.body.differences).toHaveLength(0);

    // L'instantané des entrées est conservé : sans lui, un dossier ancien ne
    // serait pas rejouable.
    const stored = await api<any>('GET', `/api/decision-runs/${runId}`, { cookie: session });
    expect(stored.status).toBe(200);
    expect(stored.body.assumptions).toBeTruthy();
    expect(stored.body.input_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Le dossier n'a pas bougé depuis la décision : le produit doit le DIRE, sans
    // quoi une décision ancienne paraîtrait à jour.
    expect(stored.body.freshness.dataChangedSinceRun).toBe(false);
    expect(stored.body.freshness.currentFingerprint).toBe(stored.body.input_fingerprint);
  });

  it('A4 — la reconnexion (nouvelle session) retrouve tout : rien ne dépend du navigateur', async () => {
    session2 = await login(org.adminEmail);
    // Une reconnexion crée une NOUVELLE session : l'ancienne reste utilisable
    // (deux postes ouverts), mais aucun jeton n'est réutilisé.
    expect(session2).not.toBe(session);

    const projects = await api<{ items: any[] }>('GET', '/api/projects', { cookie: session2 });
    expect(projects.status).toBe(200);
    expect(projects.body.items.map((project: any) => project.reference)).toContain('TCO-2026-001');

    const offers = await api<{ items: any[] }>('GET', `/api/offers?projectId=${projectId}`, { cookie: session2 });
    expect(offers.body.items).toHaveLength(3);
  });

  it('F3 — toute écriture est tracée, et le journal d’audit est vérifiable', async () => {
    const logs = await api<{ items: any[] }>('GET', '/api/audit-logs?limit=200', { cookie: session2 });
    expect(logs.status).toBe(200);
    const actions = logs.body.items.map((entry: any) => entry.action);
    for (const expected of ['project.created', 'import.committed', 'decision.run', 'auth.login']) {
      expect(actions).toContain(expected);
    }

    const integrity = await api<any>('GET', '/api/audit-logs/integrity', { cookie: session2 });
    expect(integrity.status).toBe(200);
    expect(integrity.body.intact).toBe(true);
    expect(integrity.body.totalEntries).toBeGreaterThan(0);
    expect(integrity.body.firstBrokenId).toBeNull();

    // Le client ne peut PAS écrire dans le journal d'audit.
    const forbidden = await api('POST', '/api/audit-logs', { cookie: session2, json: { action: 'falsifiee' } });
    expect(forbidden.status).toBe(403);
  });

  it('Cloisonnement — un autre organisme ne voit ni dossier, ni offre, ni lot d’import', async () => {
    const otherAdmin = 'achats@autre-entreprise.example';
    const registration = await api('POST', '/api/auth/register', {
      json: {
        organizationName: 'Autre Entreprise SA',
        slug: 'autre-entreprise',
        domain: 'autre-entreprise.example',
        adminEmail: otherAdmin,
        adminFullName: 'Samir Benali',
      },
    });
    expect(registration.status).toBe(201);
    const otherSession = await login(otherAdmin);

    // Accès direct par identifiant : refusé, et sans révéler l'existence.
    const project = await api('GET', `/api/projects/${projectId}`, { cookie: otherSession });
    expect([403, 404]).toContain(project.status);

    const offers = await api('GET', `/api/offers?projectId=${projectId}`, { cookie: otherSession });
    expect(offers.status).toBe(200);
    expect(offers.body.items).toHaveLength(0);

    const imports = await api('GET', `/api/projects/${projectId}/imports`, { cookie: otherSession });
    expect([403, 404]).toContain(imports.status);

    // Le journal d'audit de l'autre organisme ne contient aucune action de la PME.
    const logs = await api<{ items: any[] }>('GET', '/api/audit-logs', { cookie: otherSession });
    expect(logs.status).toBe(200);
    expect(logs.body.items.map((entry: any) => entry.action)).not.toContain('import.committed');

    // Une décision sur un dossier d'autrui est refusée.
    const decision = await api('POST', `/api/projects/${projectId}/decision-runs`, { cookie: otherSession });
    expect([403, 404]).toContain(decision.status);

    // Les simulations probabilistes d'autrui ne sont ni lisibles ni relançables.
    const simulations = await api<{ items: any[]; total: number }>('GET', `/api/projects/${projectId}/risk-simulations`, {
      cookie: otherSession,
    });
    expect(simulations.status).toBe(200);
    expect(simulations.body.total).toBe(0);
    expect(simulations.body.items).toHaveLength(0);

    // Le dossier de la PME n'a subi AUCUNE atteinte de ces tentatives.
    const after = await api<{ items: any[] }>('GET', `/api/offers?projectId=${projectId}`, { cookie: session2 });
    expect(after.body.items).toHaveLength(3);
  });

  it('F4 — simulation probabiliste : hypothèses déclarées, graine enregistrée, résultat rejouable', async () => {
    const offers = await api<{ items: any[] }>('GET', `/api/offers?limit=200&projectId=${projectId}`, { cookie: session });
    // Le classement central est demandé pour connaître le gagnant : la simulation
    // compare le gagnant à un challenger, elle ne décide pas qui gagne.
    const run = await api<any>('POST', `/api/projects/${projectId}/decision-runs`, { cookie: session });
    expect(run.status).toBe(201);
    const winnerId = run.body.ranking[0].offerId;
    const challengerId = run.body.ranking[1].offerId;

    const simulation = await api<any>('POST', `/api/projects/${projectId}/risk-simulations`, {
      cookie: session,
      json: {
        winnerOfferId: winnerId,
        challengerOfferId: challengerId,
        seed: 'reunion-comite-achat-2026-10-08',
        iterations: 2000,
        variables: [
          {
            parameter: 'energyInflationRate',
            distribution: 'normal',
            mean: 0.05,
            stdDev: 0.02,
            source: 'Hypothèse du service achats, révision annuelle 2026',
          },
          {
            parameter: 'carbonPricePerTonne',
            distribution: 'uniform',
            min: 60,
            max: 180,
          },
        ],
        correlations: [{ between: ['energyInflationRate', 'carbonPricePerTonne'], rho: 0.6 }],
      },
    });
    expect(simulation.status).toBe(201);

    const result = simulation.body.result;
    expect(result.engineVersion).toBe('2.0.0');
    expect(result.methodologyVersion).toMatch(/monte-carlo/);
    expect(result.seedUsed).toBe('reunion-comite-achat-2026-10-08');
    expect(result.iterations).toBe(2000);

    // Les quantiles sont ordonnés, et la probabilité d'inversion est bornée.
    expect(result.delta.p10).toBeLessThanOrEqual(result.delta.p50);
    expect(result.delta.p50).toBeLessThanOrEqual(result.delta.p90);
    expect(result.probabilityDecisionReverses).toBeGreaterThanOrEqual(0);
    expect(result.probabilityDecisionReverses).toBeLessThanOrEqual(1);

    // La convention de signe est écrite : sans elle, l'écart se lit à l'envers.
    expect(result.delta.signConvention).toMatch(/NÉGATIF signifie que le challenger devient MOINS coûteux/);

    // Les hypothèses sont tracées, avec leur source ou l'absence de source.
    const energy = result.distributions.find((entry: any) => entry.parameter === 'energyInflationRate');
    const carbon = result.distributions.find((entry: any) => entry.parameter === 'carbonPricePerTonne');
    expect(energy.source).toMatch(/service achats/);
    expect(carbon.source).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/Aucune source déclarée/);

    // La lecture dit ce que les quantiles SONT, et ce qu'ils ne sont pas.
    const reading = result.reading.join(' ');
    expect(reading).toMatch(/quantiles?/i);
    expect(reading).toMatch(/ce ne sont pas des bornes d’un intervalle de confiance statistique/);
    expect(reading).not.toMatch(/intervalle de confiance (à|au|de) \d/i);

    // L'action est tracée, avec la graine : la simulation est auditable.
    const logs = await api<{ items: any[] }>('GET', '/api/audit-logs?limit=200', { cookie: session });
    const audit = logs.body.items.find((entry: any) => entry.action === 'risk.simulation_run');
    expect(audit).toBeTruthy();
    expect(audit.new_value).toMatch(/reunion-comite-achat-2026-10-08/);

    // LECTURE : la simulation enregistrée est relue, avec sa fraîcheur.
    const stored = await api<any>('GET', `/api/risk-simulations/${simulation.body.simulationId}`, { cookie: session });
    expect(stored.status).toBe(200);
    expect(stored.body.freshness.dataChangedSinceSimulation).toBe(false);
    expect(stored.body.seed).toBe('reunion-comite-achat-2026-10-08');

    // REJEU : à graine et hypothèses identiques, les quantiles sont IDENTIQUES.
    const replay = await api<any>('POST', `/api/risk-simulations/${simulation.body.simulationId}/replay`, {
      cookie: session,
    });
    expect(replay.status).toBe(200);
    expect(replay.body.identical).toBe(true);
    expect(replay.body.differences).toEqual([]);
    expect(replay.body.result.delta.p50).toBe(result.delta.p50);

    // La liste du dossier expose les simulations passées, et pas seulement la dernière.
    const list = await api<{ items: any[]; total: number }>(
      'GET',
      `/api/projects/${projectId}/risk-simulations`,
      { cookie: session }
    );
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(2); // la simulation et son rejeu
    expect(list.body.items[0].seed).toBeTruthy();
  });

  it('F5 — une hypothèse incohérente est REFUSÉE : le produit ne simule pas n’importe quoi', async () => {
    const offers = await api<{ items: any[] }>('GET', `/api/offers?limit=200&projectId=${projectId}`, { cookie: session });
    const [first, second] = offers.body.items;

    // 1. Sans graine : résultat non reproductible ⇒ refusé.
    const withoutSeed = await api<any>('POST', `/api/projects/${projectId}/risk-simulations`, {
      cookie: session,
      json: {
        winnerOfferId: first.id,
        challengerOfferId: second.id,
        variables: [{ parameter: 'energyInflationRate', distribution: 'normal', mean: 0.05, stdDev: 0.02 }],
      },
    });
    expect(withoutSeed.status).toBe(400);
    expect(withoutSeed.body.code).toBe('SEED_REQUIRED');
    expect(withoutSeed.body.error).toMatch(/auditable/);

    // 2. Aucune variable déclarée : le produit n'invente pas d'incertitude.
    const withoutVariables = await api<any>('POST', `/api/projects/${projectId}/risk-simulations`, {
      cookie: session,
      json: { winnerOfferId: first.id, challengerOfferId: second.id, seed: 'x', variables: [] },
    });
    expect(withoutVariables.status).toBe(400);
    expect(withoutVariables.body.code).toBe('NO_VARIABLES');

    // 3. Corrélations qui se contredisent : refusées, jamais « réparées ».
    const impossible = await api<any>('POST', `/api/projects/${projectId}/risk-simulations`, {
      cookie: session,
      json: {
        winnerOfferId: first.id,
        challengerOfferId: second.id,
        seed: 'x',
        variables: [
          { parameter: 'energyInflationRate', distribution: 'normal', mean: 0.05, stdDev: 0.02 },
          { parameter: 'carbonPricePerTonne', distribution: 'normal', mean: 100, stdDev: 20 },
          { parameter: 'inflationRate', distribution: 'normal', mean: 0.02, stdDev: 0.005 },
        ],
        correlations: [
          { between: ['energyInflationRate', 'carbonPricePerTonne'], rho: 0.95 },
          { between: ['carbonPricePerTonne', 'inflationRate'], rho: -0.95 },
          { between: ['energyInflationRate', 'inflationRate'], rho: 0.95 },
        ],
      },
    });
    expect(impossible.status).toBe(400);
    expect(impossible.body.code).toBe('CORRELATION_MATRIX_NOT_POSITIVE_DEFINITE');
    expect(impossible.body.error).toMatch(/ne modifie jamais une hypothèse à votre place/);

    // 4. Une loi mal paramétrée est refusée avec le paramètre manquant.
    const malformed = await api<any>('POST', `/api/projects/${projectId}/risk-simulations`, {
      cookie: session,
      json: {
        winnerOfferId: first.id,
        challengerOfferId: second.id,
        seed: 'x',
        variables: [{ parameter: 'discountRate', distribution: 'triangular', min: 0.02, max: 0.09 }],
      },
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error).toMatch(/mode/);

    // 5. Un paramètre inconnu est refusé en listant les paramètres simulables.
    const unknownParameter = await api<any>('POST', `/api/projects/${projectId}/risk-simulations`, {
      cookie: session,
      json: {
        winnerOfferId: first.id,
        challengerOfferId: second.id,
        seed: 'x',
        variables: [{ parameter: 'prixDuCafe', distribution: 'normal', mean: 1, stdDev: 1 }],
      },
    });
    expect(unknownParameter.status).toBe(400);
    expect(unknownParameter.body.code).toBe('UNKNOWN_PARAMETER');
    expect(unknownParameter.body.error).toMatch(/discountRate/);
  });

  it('Sécurité — une requête mutante authentifiée par cookie SANS origine est refusée', async () => {
    const withoutOrigin = await api('POST', '/api/projects', {
      cookie: session,
      omitOrigin: true,
      json: { reference: 'TCO-CSRF', name: 'Tentative sans origine', category: 'Test', currency: 'EUR' },
    });
    expect(withoutOrigin.status).toBe(403);
    expect(withoutOrigin.body.code).toBe('CSRF_ORIGIN_MISSING');

    const foreignOrigin = await api('POST', '/api/projects', {
      cookie: session,
      headers: { Origin: 'https://attaquant.example' },
      json: { reference: 'TCO-CSRF2', name: 'Tentative origine tierce', category: 'Test', currency: 'EUR' },
    });
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.body.code).toBe('CSRF_ORIGIN_DENIED');

    // Aucun dossier n'a été créé par ces tentatives.
    const projects = await api<{ items: any[] }>('GET', '/api/projects', { cookie: session });
    expect(projects.body.items.map((project: any) => project.reference)).not.toContain('TCO-CSRF');
  });

  it('A5 — une offre saisie dans l’interface est enregistrée puis RELUE avec ses statuts serveur', async () => {
    // Ce test reproduit exactement le trajet du formulaire : l'offre est envoyée
    // par l'API, puis RELUE comme le fait l'écran (liste + détail par offre), et
    // convertie par la MÊME fonction que celle utilisée par le navigateur
    // (`mapOffer`, partagée). Si les deux conversions divergeaient, ce test
    // échouerait.
    const created = await api<any>('POST', '/api/offers', {
      cookie: session,
      json: {
        projectId,
        supplierName: 'Atelier Reconditionnement Ouest',
        offerReference: 'OFF-ARC-2026',
        apparentTotal: 174000,
        quantity: 48,
        currency: 'EUR',
        deliveryLeadTimeWeeks: 6,
        warrantyMonths: 24,
        expectedLifespanYears: 8,
        technicalSuitabilityScore: 75,
        isResponsibleCandidate: true,
        dataSource: 'manual',
        costItems: [
          {
            label: 'Rétrofit des 48 utilitaires',
            category: 'acquisition',
            amount: 174000,
            sourceName: 'Devis ARC-2026-17',
            confidenceLevel: 85,
            isRecurringYearly: false,
          },
          {
            label: 'Énergie (électricité)',
            category: 'Énergie',
            amount: 31500,
            sourceName: 'Contrat recharge ARC',
            confidenceLevel: 80,
            isRecurringYearly: true,
            yearOccurrences: [1, 2, 3, 4, 5, 6, 7, 8],
          },
          {
            label: 'Maintenance annuelle',
            category: 'entretien',
            amount: 12400,
            isRecurringYearly: true,
            yearOccurrences: [1, 2, 3, 4, 5, 6, 7, 8],
          },
        ],
      },
    });
    expect(created.status).toBe(201);

    // Relecture : liste puis détail, avec la conversion partagée du moteur.
    const list = await api<{ items: any[] }>('GET', `/api/offers?limit=200&projectId=${projectId}`, { cookie: session });
    expect(list.body.items).toHaveLength(4);
    const row = list.body.items.find((offer: any) => offer.offer_reference === 'OFF-ARC-2026');
    expect(row).toBeTruthy();
    expect(row.data_source).toBe('manual');

    const detail = await api<any>('GET', `/api/offers/${row.id}`, { cookie: session });
    const mapped = mapOffer(
      {
        offer: detail.body.offer,
        costItems: detail.body.costItems,
        carbonItems: detail.body.carbonItems,
        riskItems: detail.body.riskItems,
      },
      { organizationId: 'test', userId: 'test', userName: 'test', now: '2026-10-08T00:00:00.000Z' }
    );

    // Les libellés d'écriture accentués et usuels ont été ramenés à des catégories
    // RÉELLES du moteur, sans qu'aucun poste ne soit perdu.
    expect(mapped.offer.costItems).toHaveLength(3);
    const energy = mapped.offer.costItems.find((item) => /nergie/i.test(item.label));
    const maintenance = mapped.offer.costItems.find((item) => /Maintenance/i.test(item.label));
    expect(energy).toBeTruthy();
    expect(maintenance).toBeTruthy();
    expect(energy!.category).toBe('energie_consommables');
    expect(maintenance!.category).toBe('maintenance_reparations');

    // La provenance est conservée, et le poste sans source n'est pas présenté comme
    // vérifié : il est « manquante », donc exclu de la confiance du résultat.
    expect(energy!.amount.sourceName).toBe('Contrat recharge ARC');
    expect(maintenance!.amount.sourceType).toBe('manquante');
    expect(maintenance!.amount.confidenceLevel).toBe(0);

    // Une catégorie réellement inconnue est REFUSÉE avec la liste des valeurs
    // autorisées : le produit ne rapproche pas par ressemblance.
    const rejected = await api<any>('POST', '/api/offers', {
      cookie: session,
      json: {
        projectId,
        supplierName: 'Fournisseur Test',
        offerReference: 'OFF-REFUSEE',
        apparentTotal: 1000,
        costItems: [{ label: 'Poste inventé', category: 'coût imaginaire', amount: 1000 }],
      },
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe('INVALID_COST_CATEGORY');
    expect(rejected.body.error).toMatch(/acquisition/); // la liste autorisée est donnée

    // Le dossier compte désormais quatre offres dans la décision : la nouvelle y
    // entre sans ressaisie, avec ses propres données.
    const run = await api<any>('POST', `/api/projects/${projectId}/decision-runs`, { cookie: session });
    expect(run.status).toBe(201);
    expect(run.body.ranking).toHaveLength(4);
    expect(run.body.ranking.map((entry: any) => entry.offerReference)).toContain('OFF-ARC-2026');
  });

  it('Intégrité — un corps JSON malformé est rejeté proprement, sans trace technique', async () => {
    const malformed = await api('POST', '/api/projects', { cookie: session2, raw: '{"reference": "TCO-2026-002",' });
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.body)).not.toMatch(/SyntaxError|at Object|node_modules/);
  });

  it('Observabilité — les mesures d’exploitation sont réservées à l’administration de la plateforme', async () => {
    const denied = await api('GET', '/api/metrics', { cookie: session2 });
    expect(denied.status).toBe(403);
    const anonymous = await api('GET', '/api/metrics');
    expect(anonymous.status).toBe(401);
  });
});
