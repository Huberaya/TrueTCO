import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, type Mode, ORG_A, ORG_B, createHarness, id, seed, validProject } from './helpers/harness';

/**
 * Preuve d'isolation, exécutée DEUX fois :
 *  - 'rls'      : rôle applicatif soumis au Row Level Security (comme en production)
 *  - 'app-only' : RLS contourné — la couche applicative doit isoler À ELLE SEULE
 * Un échec dans un seul des deux modes révèle un défaut d'une couche de défense.
 */
describe.each<Mode>(['rls', 'app-only'])('Authentification & isolation multi-tenant [%s]', (mode) => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness(mode); await seed(h); });
  afterAll(async () => { await h.close(); });

  const secretLeak = (body: unknown) => /SECRET/.test(JSON.stringify(body));

  describe('privé par défaut', () => {
    const routes: [string, string][] = [
      ['GET', '/api/projects'], ['GET', '/api/suppliers'], ['GET', '/api/offers'], ['GET', '/api/benchmarks'],
      ['GET', '/api/audit-logs'], ['GET', '/api/tenants'], ['GET', '/api/tenants/current'], ['GET', '/api/auth/me'],
      ['GET', '/api/auth/users'], ['GET', '/api/admin/tenants'], ['GET', '/api/route-qui-nexiste-pas'],
      ['POST', '/api/projects'], ['POST', '/api/suppliers'], ['POST', '/api/offers'], ['POST', '/api/benchmarks'],
      ['POST', '/api/audit-logs'], ['POST', '/api/tenants'], ['POST', '/api/users/invitations'],
      ['POST', '/api/erp/connectors/x/test'], ['POST', '/api/erp/connectors/x/sync-inbound'],
      ['POST', '/api/erp/connectors/x/push-award'], ['POST', '/api/ai/parse-document'],
      ['PATCH', '/api/users/x'], ['PATCH', '/api/tenants/current'],
    ];
    it.each(routes)('%s %s sans jeton => 401', async (method, url) => {
      const r = await (h.anon() as any)[method.toLowerCase()](url).send({});
      expect(r.status).toBe(401);
    });

    it.each([
      ['jeton invalide', 'Bearer bad'],
      ['schéma non Bearer', 'Basic dXNlcjpwYXNz'],
      ['jeton vide', 'Bearer '],
    ])('%s => 401', async (_n, header) => {
      const r = await h.anon().get('/api/projects').set('Authorization', header);
      expect(r.status).toBe(401);
    });

    it('un jeton passé en query ou en body est ignoré', async () => {
      expect((await h.anon().get('/api/projects?token=tok:uAdmin&access_token=tok:uAdmin')).status).toBe(401);
      expect((await h.anon().post('/api/projects').send({ token: 'tok:uAdmin', ...validProject() })).status).toBe(401);
    });

    it('/api/health est public et ne révèle rien', async () => {
      const r = await h.anon().get('/api/health');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ status: 'ok' });
    });

    it("l'ancien SSO factice est mort (410) et ne crée aucun compte", async () => {
      const before = (await h.pg.query('select count(*)::int n from users')).rows[0] as { n: number };
      for (const url of ['/api/auth/sso/login', '/api/users/sync', '/api/auth/logout']) {
        const r = await h.anon().post(url).send({ email: 'evil@x.io', role: 'admin', organizationId: ORG_A, tenantId: ORG_A });
        expect(r.status).toBe(410);
      }
      const after = (await h.pg.query('select count(*)::int n from users')).rows[0] as { n: number };
      expect(after.n).toBe(before.n);
    });
  });

  describe('identité sans organisation', () => {
    it('/auth/me => onboarding, aucune donnée métier accessible', async () => {
      const me = await h.call('uNone').get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body).toMatchObject({ authenticated: true, needsOnboarding: true, user: null, memberships: [] });
      for (const u of ['/api/projects', '/api/suppliers', '/api/benchmarks', '/api/audit-logs', '/api/offers']) {
        expect((await h.call('uNone').get(u)).status).toBe(403);
      }
      expect((await h.call('uNone').get('/api/tenants')).body).toEqual([]);
    });
  });

  describe('lectures : A ne voit jamais B', () => {
    it.each(['/api/projects', '/api/suppliers', '/api/benchmarks', '/api/audit-logs', '/api/offers', '/api/auth/users', '/api/tenants', '/api/tenants/current'])('GET %s', async (url) => {
      const r = await h.call('uAdmin').get(url);
      expect(r.status).toBe(200);
      expect(secretLeak(r.body)).toBe(false);
      expect(JSON.stringify(r.body)).not.toContain(ORG_B);
    });

    it("l'organisation courante est bien celle de A", async () => {
      const r = await h.call('uAdmin').get('/api/projects');
      expect(r.body.map((p: any) => p.reference)).toEqual(['A-REF-1']);
    });

    it('x-tenant-id = B pour un membre de A => 403 (le header est un sélecteur, pas une autorité)', async () => {
      for (const u of ['/api/projects', '/api/suppliers', '/api/benchmarks', '/api/audit-logs']) {
        const r = await h.call('uAdmin', ORG_B).get(u);
        expect(r.status).toBe(403);
        expect(secretLeak(r.body)).toBe(false);
      }
    });

    it('x-tenant-id malformé ou inexistant => 403', async () => {
      expect((await h.call('uAdmin', 'pas-un-uuid').get('/api/projects')).status).toBe(403);
      expect((await h.call('uAdmin', '99999999-9999-4999-8999-999999999999').get('/api/projects')).status).toBe(403);
      expect((await h.call('uAdmin', "' OR 1=1 --").get('/api/projects')).status).toBe(403);
    });

    it('?tenantId, ?organizationId et body.organizationId/tenantId sont ignorés', async () => {
      const r = await h.call('uAdmin').get(`/api/projects?tenantId=${ORG_B}&organizationId=${ORG_B}&organization_id=${ORG_B}`);
      expect(r.status).toBe(200);
      expect(secretLeak(r.body)).toBe(false);

      const w = await h.call('uAdmin').post('/api/projects').send(validProject({ reference: 'SPOOF-1', organizationId: ORG_B, tenantId: ORG_B, organization_id: ORG_B }));
      expect(w.status).toBe(200);
      const row = (await h.pg.query(`select organization_id from projects where reference='SPOOF-1'`)).rows[0] as any;
      expect(row.organization_id).toBe(ORG_A);
    });

    it("lister /api/tenants ne révèle que ses propres organisations", async () => {
      const r = await h.call('uBAdmin').get('/api/tenants');
      expect(r.body.map((t: any) => t.id)).toEqual([ORG_B]);
    });

    it('un administrateur de plateforme ne lit AUCUNE donnée métier client', async () => {
      const r = await h.call('uPlat').get('/api/projects');
      expect(r.status).toBe(403);
      const list = await h.call('uPlat').get('/api/admin/tenants');
      expect(list.status).toBe(200);
      expect(list.body.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(list.body)).not.toMatch(/SECRET|reference|budget/);
    });

    it("un non-administrateur de plateforme n'accède pas à /admin/tenants", async () => {
      expect((await h.call('uAdmin').get('/api/admin/tenants')).status).toBe(403);
    });
  });

  describe('écritures : A ne modifie jamais B', () => {
    it("POST /projects avec l'id d'un projet de B => 404 et B intact", async () => {
      const r = await h.call('uAdmin').post('/api/projects').send(validProject({ id: id('d', 2), name: 'PIRATÉ', budgetCap: 1 }));
      expect(r.status).toBe(404);
      const b = (await h.pg.query(`select name, budget_cap::float8 as b from projects where id='${id('d', 2)}'`)).rows[0] as any;
      expect(b.name).toBe('Projet B SECRET');
      expect(b.b).toBe(2000);
    });

    it("POST /suppliers avec l'id d'un fournisseur de B => 404 et B intact", async () => {
      const r = await h.call('uAdmin').post('/api/suppliers').send({ id: id('c', 2), name: 'PIRATÉ' });
      expect(r.status).toBe(404);
      const b = (await h.pg.query(`select name from suppliers where id='${id('c', 2)}'`)).rows[0] as any;
      expect(b.name).toBe('Fournisseur B SECRET');
    });

    it('offre de A visant le projet de B => 404', async () => {
      const r = await h.call('uAdmin').post('/api/offers').send({ id: 'o-x1', projectId: id('d', 2), supplierId: id('c', 1), apparentTotal: 1, quantity: 1 });
      expect(r.status).toBe(404);
    });

    it('offre de A visant le fournisseur de B => 404', async () => {
      const r = await h.call('uAdmin').post('/api/offers').send({ id: 'o-x2', projectId: id('d', 1), supplierId: id('c', 2), apparentTotal: 1, quantity: 1 });
      expect(r.status).toBe(404);
    });

    it("offre de A écrasant l'offre de B (même id) => 404 et B intact", async () => {
      const r = await h.call('uAdmin').post('/api/offers').send({ id: id('e', 2), projectId: id('d', 1), supplierId: id('c', 1), apparentTotal: 1, quantity: 1, offerReference: 'PIRATÉ' });
      expect(r.status).toBe(404);
      const b = (await h.pg.query(`select offer_reference, organization_id from supplier_offers where id='${id('e', 2)}'`)).rows[0] as any;
      expect(b).toMatchObject({ offer_reference: 'OFF-B', organization_id: ORG_B });
    });

    it("une offre légitime de A fonctionne et remplace ses lignes de coût", async () => {
      const body = { id: 'offre-legit', projectId: id('d', 1), supplierId: id('c', 1), apparentTotal: 500, quantity: 2,
        costItems: [{ category: 'acquisition', label: 'x', amount: { value: 500, unit: '€', sourceType: 'verifiee', sourceName: 'devis', confidenceLevel: 95 } }] };
      expect((await h.call('uAdmin').post('/api/offers').send(body)).status).toBe(200);
      body.costItems = [];
      expect((await h.call('uAdmin').post('/api/offers').send(body)).status).toBe(200);
      const n = (await h.pg.query(`select count(*)::int n from cost_items ci join supplier_offers o on o.id=ci.offer_id where o.offer_reference like 'OFF-%' and o.organization_id='${ORG_A}' and ci.label='x'`)).rows[0] as any;
      expect(n.n).toBe(0);
      const list = await h.call('uAdmin').get(`/api/offers?projectId=${id('d', 1)}`);
      expect(list.status).toBe(200);
      expect(secretLeak(list.body)).toBe(false);
    });

    it('GET /offers?projectId=<projet de B> => liste vide, pas de fuite', async () => {
      const r = await h.call('uAdmin').get(`/api/offers?projectId=${id('d', 2)}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });

    it("un benchmark de même nom reste indépendant par organisation", async () => {
      const r = await h.call('uFin').post('/api/benchmarks').send({ name: 'Prix carbone', category: 'carbone', source: 'Quinet II', value: 150, unit: '€/t', confidenceLevel: 95 });
      expect(r.status).toBe(200);
      const rows = (await h.pg.query(`select organization_id, value::float8 as v from reference_benchmarks where name='Prix carbone' order by organization_id`)).rows as any[];
      expect(rows).toEqual([{ organization_id: ORG_A, v: 150 }, { organization_id: ORG_B, v: 999 }]);
    });

    it('annoter le projet de B dans le journal de A => 404', async () => {
      const r = await h.call('uAdmin').post('/api/audit-logs').send({ projectId: id('d', 2), entityName: 'x', fieldChanged: 'y', justification: 'z' });
      expect(r.status).toBe(404);
    });

    it("gérer l'utilisateur de B depuis A (PATCH) => 404", async () => {
      const r = await h.call('uAdmin').patch(`/api/users/${id('b', 1)}`).send({ role: 'acheteur', isActive: false });
      expect(r.status).toBe(404);
      const u = (await h.pg.query(`select role, is_active from users where id='${id('b', 1)}'`)).rows[0] as any;
      expect(u).toMatchObject({ role: 'admin', is_active: true });
    });

    it("inviter dans A avec organizationId=B dans le body crée l'utilisateur dans A", async () => {
      const r = await h.call('uAdmin').post('/api/users/invitations').send({ email: 'x1@a.com', fullName: 'X1', role: 'acheteur', organizationId: ORG_B });
      expect(r.status).toBe(201);
      const u = (await h.pg.query(`select organization_id from users where email='x1@a.com'`)).rows[0] as any;
      expect(u.organization_id).toBe(ORG_A);
    });
  });

  describe('utilisateur multi-organisations', () => {
    it('ne voit que les données de l\'organisation sélectionnée, avec son rôle dans celle-ci', async () => {
      const a = await h.call('uMulti', ORG_A).get('/api/projects');
      expect(a.body.map((p: any) => p.reference)).toEqual(expect.arrayContaining(['A-REF-1']));
      expect(secretLeak(a.body)).toBe(false);

      const b = await h.call('uMulti', ORG_B).get('/api/projects');
      expect(secretLeak(b.body)).toBe(true);
      expect(b.body.map((p: any) => p.reference)).not.toContain('A-REF-1');

      // acheteur dans A (pas d'écriture benchmark), finance dans B (écriture autorisée)
      const body = { name: 'Bench multi', category: 'carbone', source: 's', value: 1, unit: 'u', confidenceLevel: 50 };
      expect((await h.call('uMulti', ORG_A).post('/api/benchmarks').send(body)).status).toBe(403);
      expect((await h.call('uMulti', ORG_B).post('/api/benchmarks').send(body)).status).toBe(200);
    });
  });
});
