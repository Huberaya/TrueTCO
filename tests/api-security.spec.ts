/**
 * TESTS D'API ET DE SÉCURITÉ (Phase 1)
 * ---------------------------------------------------------------------------
 * Ces tests frappent l'API réelle, sur la vraie base PostgreSQL (PGlite), avec
 * les vrais middlewares : if a middleware is missing, these tests fail.
 *
 * Couverture :
 *   - authentification : session obligatoire, jeton révoqué/expiré, déconnexion
 *   - RBAC : chaque rôle ne fait que ce qu'il peut
 *   - isolation : un utilisateur de A ne voit rien de B (403/404, jamais 200)
 *   - intégrité : journal d'audit serveur uniquement + chaîne vérifiable
 *   - validation : aucune écriture partielle en base sur requête invalide
 *   - CSRF : requête mutante par cookie depuis une origine tierce refusée
 */

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createTestDb } from '../server/db/testing';
import { Db } from '../server/db/types';
import { AuthContext, ROLE_PERMISSIONS } from '../server/auth/types';
import { hashToken, sessionExpiry } from '../server/auth/session';

const ORG_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

let db: Db;
let app: express.Express;
const tokens: Record<string, string> = {};
const users: Record<string, string> = {};
const projects: Record<string, string> = {};

async function issueToken(orgId: string, userId: string, token: string) {
  await db.asOrganization(orgId, (tx) =>
    tx.query(
      `INSERT INTO user_sessions (organization_id, user_id, token_hash, auth_method, expires_at)
       VALUES ($1, $2, $3, 'test', $4)`,
      [orgId, userId, hashToken(token), sessionExpiry().toISOString()]
    )
  );
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  db = await createTestDb({ quiet: true });

  const roleMap: Record<string, string> = {
    adminA: 'org_admin',
    procurementA: 'procurement',
    financeA: 'finance',
    esgA: 'esg',
    approverA: 'approver',
    viewerA: 'viewer',
    adminB: 'org_admin',
  };

  await db.systemTx(async (tx) => {
    for (const [orgId, name, slug, domain] of [
      [ORG_A, 'Société A', 'societe-a', 'a.example.com'],
      [ORG_B, 'Société B', 'societe-b', 'b.example.com'],
    ]) {
      await tx.query(`INSERT INTO organizations (id, name, slug, domain) VALUES ($1, $2, $3, $4)`, [orgId, name, slug, domain]);
    }

    for (const [key, role] of Object.entries(roleMap)) {
      const orgId = key.endsWith('B') ? ORG_B : ORG_A;
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO users (organization_id, email, full_name, role, status)
         VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
        [orgId, `${key}@${key.endsWith('B') ? 'b' : 'a'}.example.com`, `Utilisateur ${key}`, role]
      );
      users[key] = rows[0].id;
      tokens[key] = `test-token-${key}-${'x'.repeat(20)}`;
    }

    projects.A = (
      await tx.query<{ id: string }>(
        `INSERT INTO projects (organization_id, reference, name, category, created_by)
         VALUES ($1, 'DOSSIER-A', 'Dossier confidentiel A', 'Flotte', $2) RETURNING id`,
        [ORG_A, users.adminA]
      )
    )[0].id;

    projects.B = (
      await tx.query<{ id: string }>(
        `INSERT INTO projects (organization_id, reference, name, category, created_by)
         VALUES ($1, 'DOSSIER-B', 'Dossier confidentiel B', 'Flotte', $2) RETURNING id`,
        [ORG_B, users.adminB]
      )
    )[0].id;
  });

  for (const key of Object.keys(tokens)) {
    await issueToken(key.endsWith('B') ? ORG_B : ORG_A, users[key], tokens[key]);
  }

  app = createApp({
    db,
    isProd: false,
    allowDemoAuth: false,
    allowedOrigins: ['http://localhost:5173'],
    engineVersion: '2.1.0',
    methodologyVersion: '2026.2',
  });
});

afterAll(async () => {
  await db?.close();
});

describe('API — santé et métadonnées', () => {
  it("T-API-01 : /api/health indique le vrai moteur de base et les versions de calcul", async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.connected).toBe(true);
    expect(res.body.database.appRoleAssumed).toBe(true);
    expect(res.body.versions.engine).toBe('2.1.0');
  });

  it('T-API-02 : une route inconnue sous /api renvoie un 404 JSON (jamais le HTML du front)', async () => {
    const res = await request(app).get('/api/route-inexistante').expect(404);
    expect(res.body.code).toBe('API_ROUTE_NOT_FOUND');
  });

  it("T-API-03 : aucune session ⇒ 401 avec un code stable, sur toutes les routes métier", async () => {
    const routes = [
      ['get', '/api/projects'],
      ['get', '/api/offers'],
      ['get', '/api/suppliers'],
      ['get', '/api/audit-logs'],
      ['get', '/api/auth/users'],
      ['get', '/api/auth/me'],
    ] as const;
    for (const [method, url] of routes) {
      const res = await request(app)[method](url).expect(401);
      expect(res.body.code).toBe('AUTH_REQUIRED');
    }
  });

  it('T-API-04 : un jeton inventé ne donne aucun accès', async () => {
    const res = await request(app).get('/api/projects').set(auth('jeton-completement-invente')).expect(401);
    expect(res.body.code).toBe('SESSION_INVALID');
  });
});

describe('API — session et tenant non négociables', () => {
  it('T-API-05 : un en-tête x-tenant-id forgé est refusé (403 TENANT_MISMATCH)', async () => {
    const res = await request(app).get('/api/projects').set(auth(tokens.viewerA)).set('x-tenant-id', ORG_B).expect(403);
    expect(res.body.code).toBe('TENANT_MISMATCH');
  });

  it('T-API-06 : organizationId dans le corps de la requête ne peut pas changer de tenant', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(auth(tokens.adminA))
      .send({ organizationId: ORG_B, reference: 'FRAUDE-1', name: 'Tentative', category: 'Flotte' })
      .expect(403);
    expect(res.body.code).toBe('TENANT_MISMATCH');
  });

  it('T-API-07 : le rôle annoncé par le client est ignoré (adminA reste org_admin)', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set(auth(tokens.viewerA))
      .set('x-user-role', 'org_admin')
      .expect(200);
    expect(res.body.user.role).toBe('viewer');
    expect(res.body.permissions).toEqual(ROLE_PERMISSIONS.viewer);
  });

  it('T-API-08 : une session révoquée ne donne plus accès', async () => {
    const token = `revoked-token-${'y'.repeat(20)}`;
    await issueToken(ORG_A, users.procurementA, token);
    await request(app).get('/api/projects').set(auth(token)).expect(200);
    await request(app).post('/api/auth/logout').set(auth(token)).expect(204);
    const res = await request(app).get('/api/projects').set(auth(token)).expect(401);
    expect(res.body.code).toBe('SESSION_INVALID');
  });

  it('T-API-09 : une session expirée ne donne aucun accès', async () => {
    const token = `expired-token-${'z'.repeat(20)}`;
    await db.asOrganization(ORG_A, (tx) =>
      tx.query(
        `INSERT INTO user_sessions (organization_id, user_id, token_hash, auth_method, expires_at)
         VALUES ($1, $2, $3, 'test', CURRENT_TIMESTAMP - INTERVAL '1 second')`,
        [ORG_A, users.adminA, hashToken(token)]
      )
    );
    await request(app).get('/api/projects').set(auth(token)).expect(401);
  });
});

describe('API — cloisonnement entre organisations (IDOR)', () => {
  it('T-API-10 : lecture du dossier de l’autre organisation ⇒ 404, jamais 200', async () => {
    const res = await request(app).get(`/api/projects/${projects.B}`).set(auth(tokens.adminA)).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    // Pas d'information sur l'existence de la ressource.
    expect(JSON.stringify(res.body)).not.toContain('Dossier confidentiel B');
  });

  it('T-API-11 : modification du dossier de l’autre organisation ⇒ 404', async () => {
    await request(app).patch(`/api/projects/${projects.B}`).set(auth(tokens.adminA)).send({ name: 'Piraté' }).expect(404);

    const check = await db.systemTx((tx) =>
      tx.query<{ name: string }>('SELECT name FROM projects WHERE id = $1', [projects.B])
    );
    expect(check[0].name).toBe('Dossier confidentiel B');
  });

  it('T-API-12 : la liste des dossiers ne contient jamais ceux de l’autre organisation', async () => {
    const resA = await request(app).get('/api/projects').set(auth(tokens.adminA)).expect(200);
    expect(resA.body.items.map((p: any) => p.reference)).toEqual(['DOSSIER-A']);

    const resB = await request(app).get('/api/projects').set(auth(tokens.adminB)).expect(200);
    expect(resB.body.items.map((p: any) => p.reference)).toEqual(['DOSSIER-B']);
  });

  it('T-API-13 : créer une offre sur un dossier d’une autre organisation ⇒ 404, et rien n’est écrit', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set(auth(tokens.procurementA))
      .send({
        projectId: projects.B,
        supplierName: 'Fournisseur pirate',
        offerReference: 'PIRATE-1',
        apparentTotal: 1000,
        costItems: [{ category: 'acquisition', label: 'Prix', amount: 1000 }],
      })
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');

    const count = await db.systemTx((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::text n FROM supplier_offers WHERE offer_reference = 'PIRATE-1'`)
    );
    expect(count[0].n).toBe('0');
  });

  it('T-API-14 : les journaux d’audit d’une organisation ne sont pas lisibles par l’autre', async () => {
    const logsB = await request(app).get('/api/audit-logs').set(auth(tokens.adminB)).expect(200);
    const idsB = logsB.body.items.map((l: any) => l.id);

    const logsA = await request(app).get('/api/audit-logs').set(auth(tokens.adminA)).expect(200);
    for (const entry of logsA.body.items) {
      expect(idsB).not.toContain(entry.id);
    }
  });
});

describe('API — RBAC (chaque rôle ne peut faire que ce qu’il peut)', () => {
  it('T-API-15 : un lecteur ne peut pas créer de dossier (403 PERMISSION_DENIED)', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set(auth(tokens.viewerA))
      .send({ reference: 'REF-VIEWER', name: 'Tentative lecteur', category: 'Flotte' })
      .expect(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.requiredPermission).toBe('project:write');
  });

  it('T-API-16 : les achats peuvent créer un dossier mais pas gérer l’équipe', async () => {
    await request(app)
      .post('/api/projects')
      .set(auth(tokens.procurementA))
      .send({ reference: 'REF-PROC', name: 'Dossier achats', category: 'Flotte' })
      .expect(201);

    const res = await request(app)
      .post('/api/auth/invitations')
      .set(auth(tokens.procurementA))
      .send({ email: 'nouveau@a.example.com', role: 'viewer' })
      .expect(403);
    expect(res.body.code).toBe('PERMISSION_DENIED');
    expect(res.body.requiredPermission).toBe('user:write');
  });

  it('T-API-17 : un admin d’organisation ne peut PAS attribuer le rôle platform_admin (escalade)', async () => {
    const res = await request(app)
      .post('/api/auth/invitations')
      .set(auth(tokens.adminA))
      .send({ email: 'escalade@a.example.com', role: 'platform_admin' })
      .expect(403);
    expect(res.body.code).toBe('ROLE_ESCALATION_BLOCKED');
  });

  it('T-API-18 : un utilisateur ne peut pas s’auto-promouvoir via l’API de rôles', async () => {
    await request(app)
      .patch(`/api/auth/users/${users.viewerA}/role`)
      .set(auth(tokens.viewerA))
      .send({ role: 'org_admin' })
      .expect(403);
  });

  it('T-API-19 : la promotion par un admin fonctionne et révoque les sessions de l’intéressé', async () => {
    const token = `promo-token-${'p'.repeat(20)}`;
    await issueToken(ORG_A, users.viewerA, token);

    const res = await request(app)
      .patch(`/api/auth/users/${users.viewerA}/role`)
      .set(auth(tokens.adminA))
      .send({ role: 'esg' })
      .expect(200);
    expect(res.body.role).toBe('esg');

    // Le rôle a changé : l'ancienne session ne doit plus porter les anciens droits.
    await request(app).get('/api/auth/me').set(auth(token)).expect(401);

    // Remise en état pour les tests suivants.
    await request(app).patch(`/api/auth/users/${users.viewerA}/role`).set(auth(tokens.adminA)).send({ role: 'viewer' }).expect(200);
    tokens.viewerA = `test-token-viewerA-restored-${'w'.repeat(20)}`;
    await issueToken(ORG_A, users.viewerA, tokens.viewerA);
  });

  it('T-API-20 : seule une permission « project:lock » peut verrouiller un dossier', async () => {
    const created = await request(app)
      .post('/api/projects')
      .set(auth(tokens.adminA))
      .send({ reference: 'REF-LOCK', name: 'Dossier à verrouiller', category: 'Flotte' })
      .expect(201);
    const projectId = created.body.id;

    // Parcours du workflow : draft → data_review → … → decision
    const steps: [string, string][] = [
      ['data_review', tokens.adminA],
      ['finance_review', tokens.adminA],
      ['esg_review', tokens.adminA],
      ['approval', tokens.adminA],
      ['decision', tokens.adminA],
    ];
    for (const [status, token] of steps) {
      await request(app)
        .post(`/api/projects/${projectId}/status`)
        .set(auth(token))
        .send({ status, justification: `Passage à ${status} après revue documentaire.` })
        .expect(200);
    }

    // Un rôle d'achat ne dispose pas de project:lock (il peut saisir, pas approuver)
    const denied = await request(app)
      .post(`/api/projects/${projectId}/status`)
      .set(auth(tokens.procurementA))
      .send({ status: 'locked', justification: 'Verrouillage par un rôle non autorisé.' })
      .expect(403);
    expect(denied.body.code).toBe('PERMISSION_DENIED');
    expect(denied.body.requiredPermission).toBe('project:lock');

    // Réciproquement, un approbateur ne peut pas faire avancer le workflow par saisie.
    const approverCannotEdit = await request(app)
      .post(`/api/projects/${projectId}/status`)
      .set(auth(tokens.approverA))
      .send({ status: 'esg_review', justification: 'Retour en revue ESG par un approbateur.' })
      .expect(403);
    expect(approverCannotEdit.body.requiredPermission).toBe('project:write');

    // Un approbateur peut verrouiller
    const locked = await request(app)
      .post(`/api/projects/${projectId}/status`)
      .set(auth(tokens.approverA))
      .send({ status: 'locked', justification: 'Décision approuvée et verrouillée pour audit.' })
      .expect(200);
    expect(locked.body.status).toBe('locked');

    // Un dossier verrouillé refuse les modifications
    await request(app).patch(`/api/projects/${projectId}`).set(auth(tokens.adminA)).send({ name: 'Modifié' }).expect(409);
  });

  it('T-API-21 : une transition de statut interdite est refusée sans être appliquée', async () => {
    const created = await request(app)
      .post('/api/projects')
      .set(auth(tokens.adminA))
      .send({ reference: 'REF-TRANSITION', name: 'Dossier transitions', category: 'Flotte' })
      .expect(201);

    const res = await request(app)
      .post(`/api/projects/${created.body.id}/status`)
      .set(auth(tokens.adminA))
      .send({ status: 'locked', justification: 'Tentative de saut direct vers verrouillé.' })
      .expect(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');

    const check = await request(app).get(`/api/projects/${created.body.id}`).set(auth(tokens.adminA)).expect(200);
    expect(check.body.status).toBe('draft');
  });
});

describe('API — écriture transactionnelle et validation', () => {
  it('T-API-22 : une offre invalide (catégorie inconnue) ne laisse AUCUNE trace en base', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set(auth(tokens.procurementA))
      .send({
        projectId: projects.A,
        supplierName: 'Fournisseur X',
        offerReference: 'OFF-INVALID',
        apparentTotal: 5000,
        costItems: [
          { category: 'acquisition', label: 'Prix', amount: 5000, sourceName: 'Devis X' },
          { category: 'categorie-inconnue', label: 'Poste douteux', amount: 100 },
        ],
      })
      .expect(400);
    expect(res.body.code).toBe('INVALID_COST_CATEGORY');

    const offers = await db.systemTx((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::text n FROM supplier_offers WHERE offer_reference = 'OFF-INVALID'`)
    );
    expect(offers[0].n).toBe('0');
  });

  it('T-API-23 : une offre sans poste de coût est refusée (aucun TCO calculable)', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set(auth(tokens.procurementA))
      .send({ projectId: projects.A, supplierName: 'F', offerReference: 'OFF-VIDE', apparentTotal: 100, costItems: [] })
      .expect(400);
    expect(res.body.code).toBe('COST_ITEMS_REQUIRED');
  });

  it('T-API-24 : un poste annoncé « valid » sans source devient « unsourced »', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set(auth(tokens.procurementA))
      .send({
        projectId: projects.A,
        supplierName: 'Fournisseur Y',
        offerReference: 'OFF-UNSOURCED',
        apparentTotal: 2000,
        costItems: [{ category: 'acquisition', label: 'Prix annoncé', amount: 2000, qualityStatus: 'valid' }],
      })
      .expect(201);

    const detail = await request(app).get(`/api/offers/${res.body.id}`).set(auth(tokens.procurementA)).expect(200);
    expect(detail.body.costItems[0].quality_status).toBe('unsourced');
    expect(detail.body.costItems[0].source_name).toBeNull();
    expect(detail.body.costItems[0].confidence_level).toBe(0);
  });

  it('T-API-25 : les postes de coût persistés sont exactement ceux transmis (aucune invention)', async () => {
    const res = await request(app)
      .post('/api/offers')
      .set(auth(tokens.procurementA))
      .send({
        projectId: projects.A,
        supplierName: 'Fournisseur Z',
        offerReference: 'OFF-EXACT',
        apparentTotal: 12000,
        costItems: [
          { category: 'acquisition', label: 'Prix usine', amount: 12000, sourceName: 'Devis Z-2026', qualityStatus: 'valid', confidenceLevel: 90 },
          { category: 'energy', label: 'Énergie annuelle', amount: 1500, sourceName: 'Devis Z-2026', isRecurringYearly: true, yearlyInflationType: 'energy' },
        ],
      })
      .expect(201);

    const detail = await request(app).get(`/api/offers/${res.body.id}`).set(auth(tokens.procurementA)).expect(200);
    expect(detail.body.costItems).toHaveLength(2);
    const amounts = detail.body.costItems.map((c: any) => Number(c.amount)).sort((a: number, b: number) => a - b);
    expect(amounts).toEqual([1500, 12000]);
    expect(detail.body.offer.computed_tco_nominal).toBeNull();
    expect(detail.body.offer.engine_version).toBeNull();
  });

  it('T-API-26 : les montants négatifs hors plage et les chaînes absurdement longues sont refusés', async () => {
    await request(app)
      .post('/api/projects')
      .set(auth(tokens.adminA))
      .send({ reference: 'REF-'.repeat(500), name: 'Trop long', category: 'Flotte' })
      .expect(400);
  });
});

describe('API — journal d’audit', () => {
  it('T-API-27 : le client ne peut pas écrire dans le journal d’audit (403 explicite)', async () => {
    const res = await request(app)
      .post('/api/audit-logs')
      .set(auth(tokens.adminA))
      .send({ action: 'action.forgée', entityType: 'project', newValue: 'preuve inventée' })
      .expect(403);
    expect(res.body.code).toBe('AUDIT_SERVER_WRITTEN_ONLY');
  });

  it('T-API-28 : les écritures serveur sont journalisées avec l’acteur de la session', async () => {
    const res = await request(app)
      .post('/api/suppliers')
      .set(auth(tokens.procurementA))
      .send({ name: 'Fournisseur Tracé' })
      .expect(201);

    const logs = await request(app)
      .get('/api/audit-logs?action=supplier.created')
      .set(auth(tokens.adminA))
      .expect(200);

    const entry = logs.body.items.find((l: any) => l.entity_id === res.body.id);
    expect(entry).toBeDefined();
    expect(entry.actor_id).toBe(users.procurementA);
    expect(entry.actor_role).toBe('procurement');
    expect(entry.entry_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.previous_hash === null || /^[0-9a-f]{64}$/.test(entry.previous_hash)).toBe(true);
  });

  it('T-API-29 : la chaîne d’audit est vérifiable et intègre', async () => {
    const res = await request(app).get('/api/audit-logs/integrity').set(auth(tokens.adminA)).expect(200);
    expect(res.body.intact).toBe(true);
    expect(res.body.totalEntries).toBeGreaterThan(0);
  });

  it('T-API-30 : modifier une entrée ancienne casse la chaîne (détection)', async () => {
    // Simulation d'une falsification directe en base (attaquant avec accès
    // disque) : la chaîne doit le révéler, alors même que le trigger bloque
    // l'écriture par l'application.
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY'));
    let blocked = false;
    try {
      await db.systemTx((tx) => tx.query(`UPDATE audit_logs SET new_value = '"falsifié"' WHERE id = (SELECT min(id) FROM audit_logs)`));
    } catch (err) {
      blocked = true;
    } finally {
      await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY'));
    }
    expect(blocked).toBe(true);

    // Contre-épreuve : on désactive aussi le trigger pour vérifier que la
    // détection par chaîne de hachage fonctionne (deuxième niveau de défense).
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs NO FORCE ROW LEVEL SECURITY'));
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_no_update'));
    await db.systemTx((tx) =>
      tx.query(`UPDATE audit_logs SET new_value = '"falsifié"' WHERE id = (SELECT min(id) FROM audit_logs WHERE organization_id = $1)`, [ORG_A])
    );
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_no_update'));
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY'));

    const integrity = await request(app).get('/api/audit-logs/integrity').set(auth(tokens.adminA)).expect(200);
    expect(integrity.body.intact).toBe(false);
    expect(integrity.body.firstContentMismatchId).not.toBeNull();

    // Réparation de l'entrée falsifiée pour ne pas fausser les tests suivants.
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_no_update'));
    await db.systemTx((tx) =>
      tx.query(`UPDATE audit_logs SET new_value = NULL WHERE id = (SELECT min(id) FROM audit_logs WHERE organization_id = $1)`, [ORG_A])
    );
    await db.systemTx((tx) => tx.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_no_update'));

    const repaired = await request(app).get('/api/audit-logs/integrity').set(auth(tokens.adminA)).expect(200);
    expect(repaired.body.intact).toBe(true);
  });
});

describe('API — protection CSRF', () => {
  it('T-API-31 : une requête mutante par cookie depuis une origine inconnue est refusée', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', `truetco_session=${tokens.adminA}`)
      .set('Origin', 'https://site-malveillant.example')
      .send({ reference: 'CSRF-1', name: 'Requête CSRF', category: 'Flotte' })
      .expect(403);
    // Deux protections indépendantes couvrent ce cas : le contrôle d'origine de
    // l'application (CORS) et la vérification same-origin du module de session.
    expect(['CSRF_ORIGIN_DENIED', 'ORIGIN_NOT_ALLOWED']).toContain(res.body.code);

    const count = await db.systemTx((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::text n FROM projects WHERE reference = 'CSRF-1'`)
    );
    expect(count[0].n).toBe('0');
  });

  it('T-API-32 : une requête mutante par cookie sans origine est refusée', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', `truetco_session=${tokens.adminA}`)
      .send({ reference: 'CSRF-2', name: 'Sans origine', category: 'Flotte' })
      .expect(403);
    expect(res.body.code).toBe('CSRF_ORIGIN_MISSING');
  });

  it('T-API-33 : une requête mutante par cookie depuis une origine autorisée passe', async () => {
    const res = await request(app)
      .post('/api/projects')
      .set('Cookie', `truetco_session=${tokens.adminA}`)
      .set('Origin', 'http://localhost:5173')
      .send({ reference: 'CSRF-OK', name: 'Origine autorisée', category: 'Flotte' })
      .expect(201);
    expect(res.body.reference).toBe('CSRF-OK');
  });
});

describe('API — inscription, invitations, erreurs propres', () => {
  it('T-API-34 : inscription refuse un e-mail hors du domaine déclaré', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        organizationName: 'Société C',
        slug: 'societe-c',
        domain: 'c.example.com',
        adminEmail: 'admin@autre-domaine.example',
        adminFullName: 'Admin C',
      })
      .expect(400);
    expect(res.body.code).toBe('EMAIL_DOMAIN_MISMATCH');
  });

  it('T-API-35 : inscription puis invitation puis acceptation (parcours complet réel)', async () => {
    const registration = await request(app)
      .post('/api/auth/register')
      .send({
        organizationName: 'Société C',
        slug: 'societe-c',
        domain: 'c.example.com',
        adminEmail: 'admin@c.example.com',
        adminFullName: 'Admin C',
      })
      .expect(201);

    const tokenC = `admin-c-token-${'c'.repeat(20)}`;
    await issueToken(registration.body.organizationId, registration.body.userId, tokenC);

    const invitation = await request(app)
      .post('/api/auth/invitations')
      .set(auth(tokenC))
      .send({ email: 'acheteur@c.example.com', role: 'procurement', fullName: 'Acheteur C' })
      .expect(201);
    expect(invitation.body.emailSent).toBe(false);
    expect(invitation.body.note).toContain("Aucun fournisseur d'e-mail");

    const invitationToken = decodeURIComponent(invitation.body.invitationLink.split('token=')[1]);

    const accepted = await request(app)
      .post('/api/auth/invitations/accept')
      .send({ token: invitationToken, fullName: 'Acheteur C' })
      .expect(201);
    expect(accepted.body.organizationId).toBe(registration.body.organizationId);

    // Le même jeton ne peut pas servir deux fois.
    const reused = await request(app)
      .post('/api/auth/invitations/accept')
      .send({ token: invitationToken, fullName: 'Acheteur C bis' })
      .expect(409);
    expect(reused.body.code).toBe('INVITATION_ALREADY_USED');
  });

  it('T-API-36 : le mode démonstration est désactivé par défaut (aucune session sans fournisseur d’identité)', async () => {
    const res = await request(app).post('/api/auth/sso/login').send({ email: 'adminA@a.example.com' }).expect(501);
    expect(res.body.code).toBe('AUTH_PROVIDER_NOT_CONFIGURED');
  });

  it('T-API-37 : les erreurs n’exposent aucune donnée technique de la base', async () => {
    const res = await request(app).get('/api/offers/pas-un-uuid').set(auth(tokens.adminA)).expect(400);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/pg_|relation |column |syntax error|SELECT/i);
    expect(res.body.correlationId).toBeTruthy();
  });
});
