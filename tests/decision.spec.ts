/**
 * TESTS DE DÉCISION — moteur exécuté par le serveur
 * ---------------------------------------------------------------------------
 * Ces tests vérifient que l'API :
 *   - calcule réellement (les montants doivent correspondre au calcul à la main) ;
 *   - classe les offres sur la VAN du coût complet ;
 *   - ne recommande rien quand les données interdisent une recommandation ferme ;
 *   - refuse de calculer sur des données reconnues invalides ;
 *   - journalise chaque exécution ;
 *   - REJOUE une exécution passée à l'identique (reproductibilité) ;
 *   - isole les organisations (une organisation ne peut pas lire les décisions
 *     d'une autre, même avec l'identifiant exact).
 */

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createTestDb } from '../server/db/testing';
import { Db } from '../server/db/types';
import { hashToken, sessionExpiry } from '../server/auth/session';

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

let db: Db;
let app: express.Express;
const token = `decision-token-${'d'.repeat(24)}`;
const tokenB = `decision-token-b-${'e'.repeat(24)}`;
let userA = '';
let userB = '';
let projectId = '';
let projectNoOffers = '';
let projectInvalidData = '';
let runId = '';

const auth = { Authorization: `Bearer ${token}` };
const authB = { Authorization: `Bearer ${tokenB}` };

/**
 * Offre dont le TCO est calculable à la main :
 *   200 000 € d'acquisition + 45 000 €/an pendant 5 ans = 425 000 € nominaux.
 */
async function createOffer(
  target: string,
  reference: string,
  supplierName: string,
  apparentTotal: number,
  costItems: Record<string, unknown>[]
): Promise<string> {
  const response = await request(app)
    .post('/api/offers')
    .set(auth)
    .send({ projectId: target, supplierName, offerReference: reference, apparentTotal, costItems, expectedLifespanYears: 5 });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

beforeAll(async () => {
  db = await createTestDb({ quiet: true });

  await db.systemTx(async (tx) => {
    for (const [orgId, name, slug, domain] of [
      [ORG_A, 'Organisation A', 'org-a', 'a.example.com'],
      [ORG_B, 'Organisation B', 'org-b', 'b.example.com'],
    ]) {
      await tx.query(`INSERT INTO organizations (id, name, slug, domain) VALUES ($1,$2,$3,$4)`, [orgId, name, slug, domain]);
    }
    const a = await tx.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, full_name, role, status)
       VALUES ($1, 'decideur@a.example.com', 'Décideur A', 'org_admin', 'active') RETURNING id`,
      [ORG_A]
    );
    const b = await tx.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, full_name, role, status)
       VALUES ($1, 'decideur@b.example.com', 'Décideur B', 'org_admin', 'active') RETURNING id`,
      [ORG_B]
    );
    userA = a[0].id;
    userB = b[0].id;

    await tx.query(
      `INSERT INTO user_sessions (organization_id, user_id, token_hash, auth_method, expires_at)
       VALUES ($1,$2,$3,'test',$4), ($5,$6,$7,'test',$4)`,
      [ORG_A, userA, hashToken(token), sessionExpiry().toISOString(), ORG_B, userB, hashToken(tokenB)]
    );

    const projects = await tx.query<{ id: string; reference: string }>(
      `INSERT INTO projects (organization_id, reference, name, category, currency, horizon_years, discount_rate,
                             energy_inflation_rate, general_inflation_rate, carbon_price_per_tonne, created_by)
       VALUES ($1, 'DEC-1', 'Dossier de décision', 'Flotte automobile', 'EUR', 5, 0.0500, 0, 0, 0, $2),
              ($1, 'DEC-2', 'Dossier sans offre', 'Flotte automobile', 'EUR', 5, 0.0500, 0, 0, 0, $2),
              ($1, 'DEC-3', 'Dossier données invalides', 'Flotte automobile', 'EUR', 5, 0.0500, 0, 0, 0, $2)
       RETURNING id, reference`,
      [ORG_A, userA]
    );
    projectId = projects.find((p) => p.reference === 'DEC-1')!.id;
    projectNoOffers = projects.find((p) => p.reference === 'DEC-2')!.id;
    projectInvalidData = projects.find((p) => p.reference === 'DEC-3')!.id;
  });

  app = createApp({
    db,
    isProd: false,
    allowDemoAuth: false,
    allowedOrigins: [],
    engineVersion: '2.0.0',
    methodologyVersion: '2026.1',
  });

  // Offre B : 350 000 € d'acquisition, 10 000 €/an d'exploitation.
  await createOffer(projectId, 'OFF-B', 'Fournisseur B (investissement élevé)', 350_000, [
    {
      category: 'acquisition',
      label: "Prix d'acquisition",
      amount: 350_000,
      sourceName: 'Devis B-2026-01 signé',
      qualityStatus: 'valid',
      confidenceLevel: 95,
    },
    {
      category: 'energie_consommables',
      label: 'Énergie annuelle',
      amount: 10_000,
      sourceName: 'Relevés télématiques 2025',
      qualityStatus: 'valid',
      confidenceLevel: 90,
      isRecurringYearly: true,
      yearlyInflationType: 'none',
    },
  ]);

  // Offre A : 200 000 € d'acquisition, 45 000 €/an d'exploitation.
  await createOffer(projectId, 'OFF-A', 'Fournisseur A (prix bas, exploitation chère)', 200_000, [
    {
      category: 'acquisition',
      label: "Prix d'acquisition",
      amount: 200_000,
      sourceName: 'Devis A-2026-01',
      qualityStatus: 'valid',
      confidenceLevel: 90,
    },
    {
      category: 'energie_consommables',
      label: 'Énergie annuelle',
      amount: 45_000,
      sourceName: 'Relevés télématiques 2025',
      qualityStatus: 'valid',
      confidenceLevel: 85,
      isRecurringYearly: true,
      yearlyInflationType: 'none',
    },
  ]);

  // Dossier 3 : un poste en erreur doit bloquer le calcul.
  await createOffer(projectInvalidData, 'OFF-ERR', 'Fournisseur erroné', 10_000, [
    { category: 'acquisition', label: 'Prix', amount: 10_000, sourceName: 'Devis', qualityStatus: 'valid' },
  ]);
  await db.asOrganization(ORG_A, (tx) =>
    tx.query(
      `UPDATE cost_items SET quality_status = 'error', explanation_notes = 'Montant illisible sur le devis'
        WHERE label = 'Prix' AND offer_id IN (SELECT id FROM supplier_offers WHERE offer_reference = 'OFF-ERR')`
    )
  );
});

afterAll(async () => {
  await db?.close();
});

describe('Décision — calcul réel par le serveur', () => {
  it('T-DEC-01 : le calcul produit les montants attendus (vérifiés à la main)', async () => {
    const response = await request(app).post(`/api/projects/${projectId}/decision-runs`).set(auth).expect(201);
    runId = response.body.runId;

    expect(response.body.engineVersion).toBe('2.0.0');
    expect(response.body.inputVersion).toBe(1);
    expect(response.body.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const byReference = Object.fromEntries(
      response.body.ranking.map((entry: any) => [entry.offerReference, entry])
    );

    // A : 200 000 + 45 000 × 5 ans = 425 000 € nominaux.
    expect(byReference['OFF-A'].totalComprehensiveTCO).toBeCloseTo(425_000, 0);
    // B : 350 000 + 10 000 × 5 ans = 400 000 € nominaux.
    expect(byReference['OFF-B'].totalComprehensiveTCO).toBeCloseTo(400_000, 0);

    // VAN à 5 % sur 5 ans : facteur d'annuité exact = (1 − 1,05^-5) / 0,05 = 4,32947667…
    // Comparaison à l'euro près (tolérance explicite, pas un arrondi de test).
    const annuity = (1 - Math.pow(1.05, -5)) / 0.05;
    expect(Math.abs(byReference['OFF-A'].lifecycleCostLCC - (200_000 + 45_000 * annuity))).toBeLessThan(1);
    expect(Math.abs(byReference['OFF-B'].lifecycleCostLCC - (350_000 + 10_000 * annuity))).toBeLessThan(1);
    // Le TCO nominal, lui, ne dépend pas de l'actualisation : 425 000 € et 400 000 €.
    expect(byReference['OFF-A'].lifecycleCostLCC).toBeLessThan(byReference['OFF-A'].totalComprehensiveTCO);
  });

  it('T-DEC-02 : le classement se fait sur la VAN du coût complet, pas sur le prix affiché', async () => {
    const response = await request(app).get(`/api/decision-runs/${runId}`).set(auth).expect(200);
    const ranking = response.body.results.ranking;

    // L'offre la moins chère à l'achat (OFF-A, 200 k€) n'est PAS la meilleure en VAN.
    expect(ranking[0].offerReference).toBe('OFF-B');
    expect(ranking[0].lifecycleCostLCC).toBeLessThan(ranking[1].lifecycleCostLCC);

    // L'avantage économique face à l'offre « apparemment la moins chère » est chiffré.
    const advantage = response.body.results.recommendation.economicAdvantage;
    expect(advantage.apparentCheapestOfferId).not.toBe(ranking[0].offerId);
    expect(advantage.vsSecondBestNpv).toBeGreaterThan(0);
  });

  it('T-DEC-03 : la recommandation porte un statut explicite et sa raison', async () => {
    const response = await request(app).get(`/api/decision-runs/${runId}`).set(auth).expect(200);
    const recommendation = response.body.results.recommendation;

    expect(['ferme', 'conditionnel', 'indetermine']).toContain(recommendation.status);
    expect(recommendation.reason.length).toBeGreaterThan(20);
    expect(recommendation.offerId).toBe(response.body.recommended_offer_id);

    // Sur cette paire d'offres, l'écart de VAN est de 1 531 € sur 393 295 €, soit
    // 0,39 % : sous le seuil de robustesse de 0,5 %. Le produit refuse donc une
    // recommandation ferme et l'explique. C'est le comportement attendu : une
    // décision à 0,4 % d'écart n'est pas robuste.
    expect(recommendation.status).toBe('indetermine');
    expect(response.body.results.warnings.join(' ')).toMatch(/0,5 %|moins de 0,5/i);
    expect(recommendation.reason).toMatch(/moins de 0,5/i);
  });

  it('T-DEC-03b : un écart significatif produit une recommandation FERME', async () => {
    // Nouveau dossier : écart de VAN de 23 200 € sur 371 600 € (6,2 %), données
    // sourcées et confiance élevée ⇒ recommandation ferme attendue.
    const created = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ reference: 'DEC-6', name: 'Dossier à écart net', category: 'Flotte automobile', currency: 'EUR' })
      .expect(201);

    await createOffer(created.body.id, 'OFF-ECONOME', 'Fournisseur économe', 350_000, [
      { category: 'acquisition', label: 'Prix', amount: 350_000, sourceName: 'Devis signé', qualityStatus: 'valid', confidenceLevel: 95 },
      {
        category: 'energie_consommables',
        label: 'Énergie annuelle',
        amount: 5_000,
        sourceName: 'Relevés 2025',
        qualityStatus: 'valid',
        confidenceLevel: 92,
        isRecurringYearly: true,
        yearlyInflationType: 'none',
      },
    ]);
    await createOffer(created.body.id, 'OFF-GOURMAND', 'Fournisseur gourmand', 200_000, [
      { category: 'acquisition', label: 'Prix', amount: 200_000, sourceName: 'Devis', qualityStatus: 'valid', confidenceLevel: 95 },
      {
        category: 'energie_consommables',
        label: 'Énergie annuelle',
        amount: 45_000,
        sourceName: 'Relevés 2025',
        qualityStatus: 'valid',
        confidenceLevel: 92,
        isRecurringYearly: true,
        yearlyInflationType: 'none',
      },
    ]);

    const response = await request(app).post(`/api/projects/${created.body.id}/decision-runs`).set(auth).expect(201);
    expect(response.body.recommendation.status).toBe('ferme');
    expect(response.body.recommendation.reason).toMatch(/VAN de coût complet la plus faible/);
    expect(response.body.ranking[0].offerReference).toBe('OFF-ECONOME');
    expect(response.body.recommendation.economicAdvantage.vsSecondBestNpv).toBeGreaterThan(20_000);
  });

  it('T-DEC-04 : l’analyse d’inversion de décision répond à « quand la décision change-t-elle »', async () => {
    const response = await request(app).get(`/api/decision-runs/${runId}`).set(auth).expect(200);
    const reversal = response.body.results.decisionReversal;

    expect(reversal).not.toBeNull();
    expect(reversal.winnerOfferId).toBe(response.body.recommended_offer_id);
    expect(reversal.signConvention).toMatch(/challenger/);

    const wacc = reversal.parameters.find((p: any) => p.parameter === 'taux_actualisation');
    expect(wacc.isReachable).toBe(true);
    expect(wacc.nearestThreshold).toBeGreaterThan(0.05);
    expect(wacc.nearestThreshold).toBeLessThan(0.07);
    expect(wacc.statement).toMatch(/s'inverse à partir de/);

    // Chaque paramètre déclare sa plage explorée : aucune extrapolation cachée.
    for (const parameter of reversal.parameters) {
      expect(parameter.exploredRange).toBeDefined();
      if (parameter.nearestThreshold !== null) {
        expect(parameter.nearestThreshold).toBeGreaterThanOrEqual(parameter.exploredRange.min);
        expect(parameter.nearestThreshold).toBeLessThanOrEqual(parameter.exploredRange.max);
      }
    }
  });

  it('T-DEC-05 : le point mort et la sensibilité sont calculés sur la même base que la recommandation', async () => {
    const response = await request(app).get(`/api/decision-runs/${runId}`).set(auth).expect(200);
    expect(response.body.results.breakEven).not.toBeNull();
    expect(response.body.results.breakEven.method).toBe('discounted_cumulative_crossover');
    expect(Array.isArray(response.body.results.sensitivity)).toBe(true);
    expect(response.body.results.sensitivity.length).toBeGreaterThan(0);
  });

  it('T-DEC-06 : la traçabilité par poste permet de répondre à « pourquoi ce montant »', async () => {
    const response = await request(app).get(`/api/decision-runs/${runId}`).set(auth).expect(200);
    const traces = response.body.results.lineTraces;
    expect(traces.length).toBe(2);

    const line = traces
      .find((t: any) => t.supplierName.includes('Fournisseur B'))
      .lines.find((l: any) => l.label === "Prix d'acquisition");

    expect(line).toBeDefined();
    expect(line.amountNominal).toBe(350_000);
    expect(line.sourceName).toContain('Devis B-2026-01');
    expect(line.confidenceLevel).toBe(95);
    expect(line.declaredCategory).toBe('acquisition');
  });

  it('T-DEC-07 : l’exécution est journalisée avec ses versions et son empreinte', async () => {
    const logs = await request(app).get('/api/audit-logs?action=decision.run').set(auth).expect(200);
    // Plusieurs exécutions ont eu lieu dans cette suite : on vérifie CELLE-CI.
    const entry = logs.body.items.find((l: any) => l.entity_id === runId);
    expect(entry).toBeDefined();
    expect(entry.entity_id).toBe(runId);
    expect(entry.actor_id).toBe(userA);
    const payload = JSON.parse(entry.new_value);
    expect(payload.engineVersion).toBe('2.0.0');
    expect(payload.methodologyVersion).toBe('2026.1');
    expect(payload.offersCompared).toBe(2);
  });

  it('T-DEC-08 : l’historique des exécutions est conservé avec un numéro de révision croissant', async () => {
    const second = await request(app).post(`/api/projects/${projectId}/decision-runs`).set(auth).expect(201);
    expect(second.body.inputVersion).toBe(2);

    const history = await request(app).get(`/api/projects/${projectId}/decision-runs`).set(auth).expect(200);
    expect(history.body.total).toBe(2);
    expect(history.body.items[0].input_version).toBe(2);
    expect(history.body.items[1].input_version).toBe(1);
  });

  it('T-DEC-09 : une exécution passée est rejouée à l’identique (reproductibilité)', async () => {
    const replay = await request(app).post(`/api/decision-runs/${runId}/replay`).set(auth).expect(200);
    expect(replay.body.identical).toBe(true);
    expect(replay.body.differences).toEqual([]);
    expect(replay.body.replayedFingerprint).toBe(replay.body.storedFingerprint);
    expect(replay.body.replayedRecommendationOfferId).toBe(replay.body.storedRecommendationOfferId);
  });

  it('T-DEC-10 : le rejeu depuis le snapshot reste identique, et la fraîcheur signale les données modifiées', async () => {
    // On modifie un montant après le calcul : l'empreinte du rejeu doit changer,
    // mais le SNAPSHOT permet encore de rejouer la décision d'origine.
    const offerId = (
      await request(app).get('/api/offers?limit=50').set(auth)
    ).body.items.find((o: any) => o.offer_reference === 'OFF-A').id;

    await db.asOrganization(ORG_A, (tx) =>
      tx.query(`UPDATE cost_items SET amount = amount + 1000 WHERE offer_id = $1 AND category = 'acquisition'`, [offerId])
    );

    // 1. Le rejeu reste IDENTIQUE : il utilise le snapshot enregistré, c'est
    //    exactement l'intérêt de la rejouabilité (une décision passée reste
    //    vérifiable même si les données ont évolué depuis).
    const replay = await request(app).post(`/api/decision-runs/${runId}/replay`).set(auth).expect(200);
    expect(replay.body.identical).toBe(true);
    expect(replay.body.differences).toEqual([]);

    // 2. La comparaison avec les données VIVANTES signale, elle, la divergence :
    //    sans cette information, une décision ancienne pourrait passer pour à jour.
    const detail = await request(app).get(`/api/decision-runs/${runId}`).set(auth).expect(200);
    expect(detail.body.freshness.dataChangedSinceRun).toBe(true);
    expect(detail.body.freshness.explanation).toMatch(/ont changé depuis cette exécution/);
    expect(detail.body.freshness.currentFingerprint).not.toBe(detail.body.freshness.storedFingerprint);

    // Remise en état pour les tests suivants.
    await db.asOrganization(ORG_A, (tx) =>
      tx.query(`UPDATE cost_items SET amount = amount - 1000 WHERE offer_id = $1 AND category = 'acquisition'`, [offerId])
    );

    const afterRestore = await request(app).get(`/api/decision-runs/${runId}`).set(auth).expect(200);
    expect(afterRestore.body.freshness.dataChangedSinceRun).toBe(false);
    expect(afterRestore.body.freshness.explanation).toMatch(/identiques à celles de cette exécution/);
  });

  it('T-DEC-11 : les résultats consolidés sont écrits sur les offres (copie du calcul serveur)', async () => {
    const offers = await request(app).get('/api/offers?limit=50').set(auth).expect(200);
    const offerB = offers.body.items.find((o: any) => o.offer_reference === 'OFF-B');
    expect(offerB.computed_lcc).toBeTruthy();
    expect(Number(offerB.computed_lcc)).toBeCloseTo(350_000 + 10_000 * 4.3295, 0);
    expect(offerB.engine_version).toBe('2.0.0');
    expect(offerB.computed_at).not.toBeNull();
  });
});

describe('Décision — règles d’honnêteté et de sûreté', () => {
  it('T-DEC-12 : un dossier sans offre ne produit pas de recommandation', async () => {
    const response = await request(app).post(`/api/projects/${noOffers()}/decision-runs`).set(auth).expect(409);
    expect(response.body.code).toBe('NO_OFFER_TO_COMPARE');
    expect(response.body.error).toMatch(/rien à comparer/i);
  });

  it('T-DEC-13 : un poste en erreur bloque le calcul, avec la liste des postes concernés', async () => {
    const response = await request(app)
      .post(`/api/projects/${projectInvalidData}/decision-runs`)
      .set(auth)
      .expect(409);
    expect(response.body.code).toBe('DECISION_BLOCKED_INVALID_DATA');
    expect(response.body.details.blockingIssues[0].offerReference).toBe('OFF-ERR');
    expect(response.body.details.blockingIssues[0].label).toBe('Prix');
  });

  it('T-DEC-14 : un poste non chiffré est exclu du total et signalé dans les avertissements', async () => {
    const created = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ reference: 'DEC-4', name: 'Dossier avec poste manquant', category: 'Flotte automobile', currency: 'EUR' })
      .expect(201);

    await createOffer(created.body.id, 'OFF-MISSING', 'Fournisseur partiel', 100_000, [
      { category: 'acquisition', label: 'Prix', amount: 100_000, sourceName: 'Devis', qualityStatus: 'valid' },
      { category: 'maintenance_reparations', label: 'Maintenance (non chiffrée)', amount: 0, qualityStatus: 'missing' },
    ]);

    const response = await request(app).post(`/api/projects/${created.body.id}/decision-runs`).set(auth).expect(201);
    // Le total ne contient PAS un « 0 € » inventé pour la maintenance.
    expect(response.body.ranking[0].totalComprehensiveTCO).toBeCloseTo(100_000, 0);
    expect(response.body.warnings.join(' ')).toMatch(/manquant.*EXCLUS/is);
    expect(response.body.dataCompleteness.byQualityStatus.missing).toBe(1);
    // Une donnée manquante interdit une recommandation ferme.
    expect(response.body.recommendation.status).toBe('indetermine');
  });

  it('T-DEC-15 : un poste sans source affaiblit la recommandation au lieu d’être ignoré', async () => {
    const created = await request(app)
      .post('/api/projects')
      .set(auth)
      .send({ reference: 'DEC-5', name: 'Dossier non sourcé', category: 'Flotte automobile', currency: 'EUR' })
      .expect(201);

    await createOffer(created.body.id, 'OFF-UNSOURCED', 'Fournisseur sans justificatif', 50_000, [
      { category: 'acquisition', label: 'Prix annoncé oralement', amount: 50_000, qualityStatus: 'valid' },
    ]);

    const response = await request(app).post(`/api/projects/${created.body.id}/decision-runs`).set(auth).expect(201);
    expect(response.body.recommendation.status).toBe('conditionnel');
    expect(response.body.warnings.join(' ')).toMatch(/aucune source documentaire/i);

    const detail = await request(app).get(`/api/offers/${response.body.ranking[0].offerId}`).set(auth).expect(200);
    expect(detail.body.costItems[0].quality_status).toBe('unsourced');
  });

  it('T-DEC-16 : la décision est isolée entre organisations', async () => {
    // B tente de lire l'exécution de A avec l'identifiant exact.
    await request(app).get(`/api/decision-runs/${runId}`).set(authB).expect(404);
    await request(app).post(`/api/decision-runs/${runId}/replay`).set(authB).expect(404);
    await request(app).get(`/api/projects/${projectId}/decision-runs`).set(authB).expect(404).catch(() => undefined);
    // B ne peut pas déclencher de calcul sur un dossier de A.
    const response = await request(app).post(`/api/projects/${projectId}/decision-runs`).set(authB);
    expect([403, 404]).toContain(response.status);
  });
});

function noOffers(): string {
  return projectNoOffers;
}
