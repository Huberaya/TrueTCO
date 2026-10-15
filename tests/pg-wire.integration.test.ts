import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { PgDb, checkRlsEnforced } from '../server/db';
import { FakeVerifier } from './helpers/harness';

/**
 * Intégration « sur le fil » : le VRAI pilote `pg`, le VRAI PgDb, les VRAIS scripts CLI,
 * contre un serveur Postgres (protocole réseau), et non plus l'API directe de PGlite.
 */
describe('Intégration pilote pg + CLI', () => {
  let socket: PGLiteSocketServer;
  let db: PgDb;
  const port = 54329;
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  const env = { ...process.env, MIGRATION_DATABASE_URL: url, DATABASE_URL: url, PGSSLMODE: 'disable' };
  const root = path.resolve(__dirname, '..');
  const run = promisify(execFile);
  // Asynchrone OBLIGATOIRE : le serveur Postgres de test tourne dans CE processus (un appel synchrone l'interbloquerait).
  const tsx = async (script: string, args: string[] = []) => (await run('npx', ['tsx', script, ...args], { cwd: root, env })).stdout;

  beforeAll(async () => {
    const pgl = new PGlite();
    socket = new PGLiteSocketServer({ db: pgl, port, host: '127.0.0.1', maxConnections: 1 });
    await socket.start();
    db = new PgDb(url);
  }, 60_000);
  afterAll(async () => { await db?.close(); await socket?.stop(); });

  it('npm run db:migrate applique les migrations puis signale la quarantaine', async () => {
    const out = await tsx('scripts/migrate.ts');
    expect(out).toMatch(/001_baseline\.sql, 002_tenant_isolation\.sql/);
    expect(out).toMatch(/admin:bootstrap/);
    expect(await tsx('scripts/migrate.ts')).toMatch(/Base à jour/);
  }, 90_000);

  it("admin:bootstrap crée l'organisation et un admin EN ATTENTE (non lié), ré-activable sans doublon", async () => {
    const out = await tsx('scripts/bootstrap-admin.ts', ['--org', 'acme', '--create-org', 'Acme SAS', '--email', 'Boss@Acme.com', '--name', 'La Boss']);
    expect(out).toMatch(/boss@acme\.com est administrateur en attente/);
    await tsx('scripts/bootstrap-admin.ts', ['--org', 'acme', '--email', 'boss@acme.com', '--name', 'La Boss']);
    const c = new pg.Client({ connectionString: url }); await c.connect();
    const rows = (await c.query(`SELECT email, role, is_active, clerk_id FROM users`)).rows;
    await c.end();
    expect(rows).toEqual([{ email: 'boss@acme.com', role: 'admin', is_active: true, clerk_id: null }]);
  }, 90_000);

  it("bootstrap sans --create-org sur une organisation inconnue => erreur claire", async () => {
    await expect(tsx('scripts/bootstrap-admin.ts', ['--org', 'inconnue', '--email', 'a@b.co', '--name', 'X'])).rejects.toThrow();
  }, 60_000);

  it('PgDb : transactions, contexte tenant et premier login via le pilote réel', async () => {
    const verifier = new FakeVerifier();
    verifier.profiles.set('uBoss', { email: 'boss@acme.com', emailVerified: true, fullName: 'La Boss' });
    const app = createApp({ db, verifier, config: loadConfig({ NODE_ENV: 'test' } as any), log: () => {} });

    const me = await request(app).get('/api/auth/me').set('Authorization', 'Bearer tok:uBoss');
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: 'boss@acme.com', role: 'admin' });   // lié via email vérifié

    const created = await request(app).post('/api/projects').set('Authorization', 'Bearer tok:uBoss')
      .send({ reference: 'P1', name: 'Réel', budgetCap: 10, plannedVolume: 1, horizonYears: 3, discountRate: 0, energyInflationRate: 0.03, inflationRate: 0.02, carbonPricePerTonne: 90 });
    expect(created.status).toBe(200);
    const list = await request(app).get('/api/projects').set('Authorization', 'Bearer tok:uBoss');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ reference: 'P1', discountRate: 0, budgetCap: 10 });

    // une erreur dans une transaction annule tout (pas d'audit orphelin) et ne bloque pas le pool
    const dup = await request(app).post('/api/projects').set('Authorization', 'Bearer tok:uBoss')
      .send({ reference: 'P1', name: 'Doublon', budgetCap: 10, plannedVolume: 1, horizonYears: 3, discountRate: 0.01, energyInflationRate: 0.03, inflationRate: 0.02, carbonPricePerTonne: 90 });
    expect(dup.status).toBe(409);
    expect((await request(app).get('/api/projects').set('Authorization', 'Bearer tok:uBoss')).status).toBe(200);
  }, 60_000);

  it('checkRlsEnforced signale un rôle qui contourne le RLS (ici superuser)', async () => {
    expect(await checkRlsEnforced(db)).toMatchObject({ enforced: false });
  });
});
