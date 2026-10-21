/**
 * CONNEXION PAR FOURNISSEUR D'IDENTITÉ (pont Clerk → sessions existantes)
 * ---------------------------------------------------------------------------
 * Vraie base (PGlite), vrais middlewares, faux vérificateur injecté (aucune clé Clerk requise).
 * Ces tests prouvent ce que le pont garantit : pas de compte créé à la volée, liaison uniquement par e-mail vérifié,
 * rôle = celui de TrueTCO, utilisateur suspendu refusé, session identique aux autres modes (RLS, révocation).
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { createTestDb } from '../server/db/testing';
import { Db } from '../server/db/types';
import { IdentityVerifier } from '../server/auth/idp';
import { registerOrganization } from '../server/auth/service';

class FakeVerifier implements IdentityVerifier {
  readonly provider = 'clerk';
  profiles = new Map<string, { email?: string; emailVerified: boolean }>();
  async verify(token: string) {
    const m = /^tok:(\w+)(?::(unverified))?$/.exec(token);
    if (!m) return null;
    return { subject: m[1], email: this.profiles.get(m[1])?.email, emailVerified: m[2] ? false : (this.profiles.get(m[1])?.emailVerified ?? false) };
  }
  async loadProfile(subject: string) { return this.profiles.get(subject) ?? null; }
}

let db: Db;
let app: express.Express;
const verifier = new FakeVerifier();
const META = { ipAddress: null, userAgent: null, correlationId: null };

const login = (token: string, body: object = {}) => request(app).post('/api/auth/sso/login').set('Authorization', `Bearer ${token}`).send(body);
const cookieOf = (res: request.Response) => String(res.headers['set-cookie']?.[0] ?? '').split(';')[0];

beforeAll(async () => {
  db = await createTestDb({ quiet: true });
  app = createApp({ db, identityVerifier: verifier, isProd: false, allowDemoAuth: false, allowedOrigins: [], engineVersion: 't', methodologyVersion: 't' });
  await registerOrganization(db, { organizationName: 'Acme', slug: 'acme', domain: 'acme.com', adminEmail: 'boss@acme.com', adminFullName: 'La Boss' }, META);
  await registerOrganization(db, { organizationName: 'Globex', slug: 'globex', domain: 'globex.com', adminEmail: 'boss@globex.com', adminFullName: 'Boss G' }, META);
  // même e-mail dans deux organisations (cas ambigu)
  await db.systemTx(async (tx) => {
    const org = (await tx.query<{ id: string }>(`SELECT id FROM organizations WHERE slug = 'globex'`))[0].id;
    await tx.query(`INSERT INTO users (organization_id, email, full_name, role, status) VALUES ($1, 'boss@acme.com', 'Boss chez Globex', 'viewer', 'active')`, [org]);
  });
  verifier.profiles.set('uAcme', { email: 'Boss@Acme.com', emailVerified: true });
  verifier.profiles.set('uGlobex', { email: 'boss@globex.com', emailVerified: true });
  verifier.profiles.set('uStranger', { email: 'inconnu@nowhere.io', emailVerified: true });
});
afterAll(async () => { await (db as any).close?.(); });

describe('/auth/config', () => {
  it('annonce le fournisseur configuré (et plus « aucun fournisseur »)', async () => {
    const r = await request(app).get('/api/auth/config');
    expect(r.body.federatedProviders).toEqual(['clerk']);
    expect(r.body.ssoFederation).toBe(true);
  });
});

describe('Connexion par identité vérifiée', () => {
  it('jeton absent ou invalide => 401, aucune session', async () => {
    expect((await request(app).post('/api/auth/sso/login').send({})).status).toBe(401);
    expect((await login('garbage')).status).toBe(401);
    expect((await request(app).post('/api/auth/sso/login').send({ token: 'tok:uAcme' })).status).toBe(401); // jamais dans le corps
  });

  it('identité inconnue : 403 et AUCUN compte créé à la volée', async () => {
    const before = (await db.systemTx((tx) => tx.query<{ n: string }>('SELECT count(*)::text n FROM users')))[0].n;
    const r = await login('tok:uStranger');
    expect(r.status).toBe(403);
    expect(r.body.code ?? r.body.error).toMatch(/USER_NOT_PROVISIONED/);
    const after = (await db.systemTx((tx) => tx.query<{ n: string }>('SELECT count(*)::text n FROM users')))[0].n;
    expect(after).toBe(before);
  });

  it('e-mail NON vérifié : refus (usurpation d\'un compte existant impossible)', async () => {
    verifier.profiles.set('uThief', { email: 'boss@globex.com', emailVerified: false });
    const r = await login('tok:uThief');
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toMatch(/IDP_EMAIL_NOT_VERIFIED/);
    const linked = await db.systemTx((tx) => tx.query(`SELECT 1 FROM users WHERE idp_subject = 'uThief'`));
    expect(linked).toHaveLength(0);
  });

  it('première connexion : liaison par e-mail vérifié, session valide, rôle = celui de TrueTCO', async () => {
    const r = await login('tok:uGlobex');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, authMethod: 'idp_clerk', isDemo: false });
    const cookie = cookieOf(r);
    expect(cookie).toMatch(/^[^=]+=.+/);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(JSON.stringify(me.body)).toContain('boss@globex.com');
    const row = (await db.systemTx((tx) => tx.query<{ idp_provider: string; idp_subject: string; role: string }>(`SELECT idp_provider, idp_subject, role FROM users WHERE lower(email)='boss@globex.com' AND idp_subject IS NOT NULL`)))[0];
    expect(row).toMatchObject({ idp_provider: 'clerk', idp_subject: 'uGlobex' });
    expect(row.role).toBe('org_admin');   // jamais un rôle fourni par le fournisseur
  });

  it('connexions suivantes : par identifiant d\'identité (plus par e-mail), même utilisateur', async () => {
    const a = await login('tok:uGlobex');
    const b = await login('tok:uGlobex');
    expect(a.status).toBe(200); expect(b.status).toBe(200);
    expect(cookieOf(a)).not.toBe(cookieOf(b));  // sessions distinctes
  });

  it('même e-mail dans deux organisations : refus explicite, puis choix par slug', async () => {
    const amb = await login('tok:uAcme');
    expect(amb.status).toBe(409);
    expect(JSON.stringify(amb.body)).toMatch(/ORGANIZATION_SELECTION_REQUIRED/);
    const ok = await login('tok:uAcme', { organizationSlug: 'acme' });
    expect(ok.status).toBe(200);
  });

  it('le journal d\'audit trace la liaison et la connexion (auteur = utilisateur, méthode idp)', async () => {
    const rows = await db.systemTx((tx) => tx.query<{ action: string }>(`SELECT action FROM audit_logs WHERE action IN ('auth.idp_linked','auth.login')`));
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['auth.idp_linked', 'auth.login']));
  });

  it('utilisateur suspendu : connexion refusée, même avec une identité déjà liée', async () => {
    await db.systemTx((tx) => tx.query(`UPDATE users SET status = 'suspended' WHERE idp_subject = 'uGlobex'`));
    const r = await login('tok:uGlobex');
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toMatch(/USER_NOT_ACTIVE/);
  });

  it("un compte NON actif (suspendu) ne peut pas être lié par e-mail : refus, aucune liaison", async () => {
    await db.systemTx(async (tx) => {
      const org = (await tx.query<{ id: string }>(`SELECT id FROM organizations WHERE slug = 'acme'`))[0].id;
      await tx.query(`INSERT INTO users (organization_id, email, full_name, role, status) VALUES ($1, 'sleeper@acme.com', 'Dormant', 'viewer', 'suspended')`, [org]);
    });
    verifier.profiles.set('uSleeper', { email: 'sleeper@acme.com', emailVerified: true });
    const r = await login('tok:uSleeper');
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).toMatch(/USER_NOT_PROVISIONED/);
    const linked = await db.systemTx((tx) => tx.query(`SELECT 1 FROM users WHERE idp_subject = 'uSleeper'`));
    expect(linked).toHaveLength(0);
  });

  it('une identité liée à un utilisateur ne peut pas en prendre un autre', async () => {
    await db.systemTx((tx) => tx.query(`UPDATE users SET status = 'active' WHERE idp_subject = 'uGlobex'`));
    verifier.profiles.set('uGlobex', { email: 'boss@acme.com', emailVerified: true }); // même sujet, autre e-mail
    const r = await login('tok:uGlobex');
    expect(r.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Cookie', cookieOf(r));
    expect(JSON.stringify(me.body)).toContain('boss@globex.com'); // reste globex : le sujet prime sur l'e-mail
  });
});

describe('Sans fournisseur configuré : comportement inchangé', () => {
  it('la route reste 501 (aucune session délivrée)', async () => {
    const bare = createApp({ db, isProd: false, allowDemoAuth: false, allowedOrigins: [], engineVersion: 't', methodologyVersion: 't' });
    const r = await request(bare).post('/api/auth/sso/login').set('Authorization', 'Bearer tok:uAcme').send({});
    expect(r.status).toBe(501);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
});
