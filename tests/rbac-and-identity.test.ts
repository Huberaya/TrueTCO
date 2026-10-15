import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS, type Permission } from '../server/rbac';
import { ROLES, type Role } from '../server/types';
import { type Harness, type Mode, ORG_A, ORG_B, createHarness, id, seed, validProject } from './helpers/harness';

const CLERK_BY_ROLE: Record<Role, string> = {
  admin: 'uAdmin', directeur_achats: 'uDirAchats', acheteur: 'uBuyer', finance_controleur: 'uFin', rse_esg: 'uRse', direction_generale: 'uDir',
};

describe.each<Mode>(['rls', 'app-only'])('RBAC & identité [%s]', (mode) => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness(mode);
    await seed(h);
    await h.pg.exec(`INSERT INTO users(organization_id,email,full_name,role,clerk_id) VALUES
      ('${ORG_A}','da@a.com','DA','directeur_achats','uDirAchats'),('${ORG_A}','rse@a.com','RSE','rse_esg','uRse')`);
  });
  afterAll(async () => { await h.close(); });

  // Un endpoint représentatif par permission : (méthode, url, corps valide)
  const probes: Record<Permission, () => { method: 'get' | 'post' | 'patch'; url: string; body?: object }> = {
    'project:read': () => ({ method: 'get', url: '/api/projects' }),
    'project:write': () => ({ method: 'post', url: '/api/projects', body: validProject({ reference: 'RB-' + Math.random().toString(36).slice(2, 8) }) }),
    'offer:read': () => ({ method: 'get', url: '/api/offers' }),
    'offer:write': () => ({ method: 'post', url: '/api/offers', body: { id: 'o-' + Math.random(), projectId: id('d', 1), supplierId: id('c', 1), apparentTotal: 1, quantity: 1, offerReference: 'R' + Math.random() } }),
    'supplier:read': () => ({ method: 'get', url: '/api/suppliers' }),
    'supplier:write': () => ({ method: 'post', url: '/api/suppliers', body: { name: 'S-' + Math.random() } }),
    'benchmark:read': () => ({ method: 'get', url: '/api/benchmarks' }),
    'benchmark:write': () => ({ method: 'post', url: '/api/benchmarks', body: { name: 'B-' + Math.random(), source: 's', value: 1, unit: 'u', confidenceLevel: 50 } }),
    'audit:read': () => ({ method: 'get', url: '/api/audit-logs' }),
    'audit:annotate': () => ({ method: 'post', url: '/api/audit-logs', body: { entityName: 'e', fieldChanged: 'f', justification: 'j' } }),
    'user:read': () => ({ method: 'get', url: '/api/auth/users' }),
    'user:manage': () => ({ method: 'post', url: '/api/users/invitations', body: { email: `m${Math.random().toString(36).slice(2, 8)}@a.com`, fullName: 'M', role: 'acheteur' } }),
    'tenant:update': () => ({ method: 'patch', url: '/api/tenants/current', body: { name: 'Acme A' } }),
    'ai:parse': () => ({ method: 'post', url: '/api/ai/parse-document', body: { text: 'devis 50 unités', filename: 'd.txt' } }),
    'erp:use': () => ({ method: 'post', url: '/api/erp/connectors/ariba/test', body: {} }),
  };

  // Toute la matrice, rôle × permission : 6 × 15 = 90 cas dérivés de la table PERMISSIONS (source unique).
  const cases = (Object.keys(PERMISSIONS) as Permission[]).flatMap((perm) => ROLES.map((role) => [perm, role, PERMISSIONS[perm].includes(role)] as const));
  it.each(cases)('%s × %s => autorisé: %s', async (perm, role, allowed) => {
    const p = probes[perm]();
    const r = await (h.call(CLERK_BY_ROLE[role]) as any)[p.method](p.url).send(p.body ?? {});
    if (allowed) expect(r.status, JSON.stringify(r.body)).not.toBe(403);
    else expect(r.status).toBe(403);
  });

  it('le rôle envoyé dans le body ne donne aucun privilège', async () => {
    const r = await h.call('uBuyer').post('/api/users/invitations').send({ email: 'esc@a.com', fullName: 'E', role: 'admin', userRole: 'admin' });
    expect(r.status).toBe(403);
    const w = await h.call('uDir').post('/api/projects').send(validProject({ role: 'admin', userRole: 'admin' }));
    expect(w.status).toBe(403);
  });

  it('un acheteur ne peut pas se promouvoir (PATCH /users/:id)', async () => {
    const r = await h.call('uBuyer').patch(`/api/users/${id('a', 2)}`).send({ role: 'admin' });
    expect(r.status).toBe(403);
  });

  describe('administration des utilisateurs', () => {
    it('le dernier administrateur ne peut être ni rétrogradé ni désactivé', async () => {
      // B n'a qu'un admin
      const r1 = await h.call('uBAdmin').patch(`/api/users/${id('b', 1)}`).send({ role: 'acheteur' });
      expect(r1.status).toBe(409);
      expect(r1.body.error).toBe('last_admin');
      const r2 = await h.call('uBAdmin').patch(`/api/users/${id('b', 1)}`).send({ isActive: false });
      expect(r2.status).toBe(409);
    });

    it("avec 2 administrateurs, l'un peut être rétrogradé — mais pas les deux", async () => {
      expect((await h.call('uAdmin').patch(`/api/users/${id('a', 5)}`).send({ role: 'acheteur' })).status).toBe(200);
      expect((await h.call('uAdmin').patch(`/api/users/${id('a', 1)}`).send({ role: 'acheteur' })).status).toBe(409);
    });

    it('chaque changement de rôle est journalisé par le serveur', async () => {
      const rows = (await h.pg.query(`select user_name, field_changed, old_value, new_value, origin from audit_logs where organization_id='${ORG_A}' and field_changed='Rôle'`)).rows as any[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows[0]).toMatchObject({ user_name: 'Admin A', old_value: 'admin', new_value: 'acheteur', origin: 'server' });
    });
  });

  describe('liaison des invitations : uniquement via un email VÉRIFIÉ', () => {
    const invite = async (email: string, role = 'finance_controleur') => {
      const r = await h.call('uAdmin').post('/api/users/invitations').send({ email, fullName: 'Invité', role });
      expect(r.status).toBe(201);
    };

    it('email vérifié correspondant => appartenance avec le rôle invité', async () => {
      await invite('nouvelle.recrue@a.com');
      h.verifier.profiles.set('uNew1', { email: 'Nouvelle.Recrue@A.com', emailVerified: true, fullName: 'N R' });
      const me = await h.call('uNew1').get('/api/auth/me');
      expect(me.body.needsOnboarding).toBe(false);
      expect(me.body.user).toMatchObject({ role: 'finance_controleur' });
      expect(me.body.organizationId).toBe(ORG_A);
    });

    it('email NON vérifié => aucune appartenance (usurpation impossible)', async () => {
      await invite('victime@a.com', 'admin');
      h.verifier.profiles.set('uAttacker', { email: 'victime@a.com', emailVerified: false });
      const me = await h.call('uAttacker').get('/api/auth/me');
      expect(me.body.needsOnboarding).toBe(true);
      expect((await h.call('uAttacker').get('/api/projects')).status).toBe(403);
    });

    it("email vérifié mais différent de l'invitation => rien", async () => {
      h.verifier.profiles.set('uOther', { email: 'autre@evil.io', emailVerified: true });
      expect((await h.call('uOther').get('/api/auth/me')).body.needsOnboarding).toBe(true);
    });

    it('une invitation déjà liée ne peut pas être reprise par une autre identité', async () => {
      h.verifier.profiles.set('uThief', { email: 'nouvelle.recrue@a.com', emailVerified: true });
      expect((await h.call('uThief').get('/api/auth/me')).body.needsOnboarding).toBe(true);
    });

    it('un compte désactivé ne peut pas être (ré)activé par connexion', async () => {
      await invite('parti@a.com');
      const u = (await h.pg.query(`select id from users where email='parti@a.com'`)).rows[0] as any;
      expect((await h.call('uAdmin').patch(`/api/users/${u.id}`).send({ isActive: false })).status).toBe(200);
      h.verifier.profiles.set('uParti', { email: 'parti@a.com', emailVerified: true });
      expect((await h.call('uParti').get('/api/auth/me')).body.needsOnboarding).toBe(true);
    });

    it('un compte mis en quarantaine (hérité) ne peut pas être lié', async () => {
      await h.pg.exec(`INSERT INTO users(organization_id,email,full_name,role,is_active,quarantined_at) VALUES ('${ORG_A}','legacy@a.com','Legacy','admin',false,now())`);
      h.verifier.profiles.set('uLegacy', { email: 'legacy@a.com', emailVerified: true });
      expect((await h.call('uLegacy').get('/api/auth/me')).body.needsOnboarding).toBe(true);
    });
  });

  describe("création d'organisation", () => {
    it('refusée sans email vérifié', async () => {
      h.verifier.profiles.set('uUnver', { email: 'u@x.com', emailVerified: false });
      expect((await h.call('uUnver').post('/api/tenants').send({ name: 'Ma Société' })).status).toBe(403);
    });

    it('avec email vérifié : le créateur devient admin, formule et résidence NON choisies par le client', async () => {
      h.verifier.profiles.set('uFounder', { email: 'founder@startup.io', emailVerified: true, fullName: 'Fondatrice' });
      const r = await h.call('uFounder').post('/api/tenants').send({
        name: 'Startup Éclair', subscriptionTier: 'sovereign', dataResidency: 'EU-FRANCE-PARIS (SecNumCloud)', domain: 'acme.com', countryCode: 'fr',
      });
      expect(r.status).toBe(201);
      expect(r.body.tenant).toMatchObject({ name: 'Startup Éclair', subscriptionTier: 'starter', countryCode: 'FR' });
      expect(r.body.tenant.dataResidency).not.toMatch(/SecNumCloud/);
      expect(r.body.tenant.slug).toMatch(/^startup-eclair-[0-9a-f]{6}$/);

      const me = await h.call('uFounder').get('/api/auth/me');
      expect(me.body.user).toMatchObject({ role: 'admin' });
      // et reste étanche : le fondateur ne voit rien d'A ni de B
      const projects = await h.call('uFounder').get('/api/projects');
      expect(projects.body).toEqual([]);
    });

    it("le domaine email ne donne JAMAIS accès à une organisation existante", async () => {
      h.verifier.profiles.set('uSameDomain', { email: 'ceo@a.com', emailVerified: true });
      const me = await h.call('uSameDomain').get('/api/auth/me');
      expect(me.body.needsOnboarding).toBe(true);
    });

    it('plafonné par identité', async () => {
      h.verifier.profiles.set('uSpam', { email: 'spam@x.com', emailVerified: true });
      let last = 0;
      for (let i = 0; i < 6; i++) last = (await h.call('uSpam').post('/api/tenants').send({ name: `Org ${i} spam` })).status;
      expect([403, 429]).toContain(last);
    });
  });
});
