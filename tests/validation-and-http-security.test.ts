import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { entityId, uuidV5 } from '../server/auth';
import { loadConfig } from '../server/config';
import { type Harness, ORG_A, createHarness, id, seed, validProject } from './helpers/harness';

describe('Validation des entrées', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('rls'); await seed(h); });
  afterAll(async () => { await h.close(); });
  const post = (url: string, body: unknown) => h.call('uAdmin').post(url).send(body as object);

  it('RÉGRESSION : un taux d\'actualisation de 0 % est conservé (ancien bug `Number(x) || 0.05`)', async () => {
    const r = await post('/api/projects', validProject({ reference: 'ZERO', discountRate: 0, energyInflationRate: 0, inflationRate: 0, carbonPricePerTonne: 0 }));
    expect(r.status).toBe(200);
    expect(r.body.project).toMatchObject({ discountRate: 0, energyInflationRate: 0, inflationRate: 0, carbonPricePerTonne: 0 });
  });

  it("les hypothèses financières n'ont aucune valeur par défaut silencieuse", async () => {
    for (const f of ['discountRate', 'energyInflationRate', 'inflationRate', 'carbonPricePerTonne', 'budgetCap', 'plannedVolume', 'horizonYears']) {
      const p = validProject({ reference: 'MISS-' + f }) as Record<string, unknown>;
      delete p[f];
      const r = await post('/api/projects', p);
      expect(r.status, f).toBe(400);
      expect(r.body.details.fields).toContain(f);
    }
  });

  it.each([
    ['budget négatif', { budgetCap: -1 }], ['budget nul', { budgetCap: 0 }], ['taux > 100 %', { discountRate: 1.5 }],
    ['taux négatif', { discountRate: -0.1 }], ['horizon 0', { horizonYears: 0 }], ['horizon 99', { horizonYears: 99 }],
    ['volume fractionnaire', { plannedVolume: 1.5 }], ['NaN', { budgetCap: 'abc' }], ['Infinity', { budgetCap: 1e400 }],
    ['statut inconnu', { status: 'hacked' }], ['référence vide', { reference: '   ' }], ['devise invalide', { currency: 'EURO!' }],
    ['prix carbone absurde', { carbonPricePerTonne: 1e9 }],
  ])('rejette : %s', async (_n, over) => {
    expect((await post('/api/projects', validProject(over as Record<string, unknown>))).status).toBe(400);
  });

  it('normalise les symboles de devise en ISO 4217', async () => {
    const r = await post('/api/projects', validProject({ reference: 'CUR', currency: '€' }));
    expect(r.body.project.currency).toBe('EUR');
  });

  it("une chaîne d'injection SQL est stockée littéralement et n'altère rien", async () => {
    const evil = `x'); DROP TABLE projects; --`;
    const r = await post('/api/projects', validProject({ reference: 'SQLI', name: evil, description: evil }));
    expect(r.status).toBe(200);
    expect(r.body.project.name).toBe(evil);
    expect(((await h.pg.query('SELECT count(*)::int n FROM projects')).rows[0] as any).n).toBeGreaterThan(1);
  });

  it('XSS : le texte est stocké tel quel (l\'échappement incombe au rendu React) mais jamais interprété par l\'API', async () => {
    const r = await post('/api/suppliers', { name: '<img src=x onerror=alert(1)>' });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
  });

  it('provenance non déclarée => "manquante" avec confiance 0 (jamais 85 % par défaut)', async () => {
    await post('/api/offers', { id: 'o-prov', projectId: id('d', 1), supplierId: id('c', 1), apparentTotal: 1, quantity: 1,
      costItems: [{ category: 'energie', label: 'sans source', amount: { value: 10 } }] });
    const row = (await h.pg.query(`SELECT source_name, source_type, confidence_level FROM cost_items WHERE label='sans source'`)).rows[0] as any;
    expect(row).toEqual({ source_name: 'Non renseignée', source_type: 'manquante', confidence_level: 0 });
  });

  it('JSON invalide => 400, corps trop gros => 413', async () => {
    const bad = await h.call('uAdmin').post('/api/projects').set('Content-Type', 'application/json').send('{"a":');
    expect(bad.status).toBe(400);
    const big = await h.call('uAdmin').post('/api/audit-logs').send({ entityName: 'x'.repeat(2_000_000), fieldChanged: 'f', justification: 'j' });
    expect(big.status).toBe(413);
  });

  it("identifiants clients : UUID v5 déterministe, isolé par organisation", () => {
    // Vecteur de référence RFC 4122 : uuid5(NAMESPACE_DNS, "python.org")
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    const other = '22222222-2222-4222-8222-222222222222';
    expect(entityId('offre-1', ORG_A)).toBe(entityId('offre-1', ORG_A));
    expect(entityId('offre-1', ORG_A)).not.toBe(entityId('offre-1', other));
    expect(entityId(id('d', 1).toUpperCase(), ORG_A)).toBe(id('d', 1));
  });
});

describe('Sécurité HTTP', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('rls'); await seed(h); });
  afterAll(async () => { await h.close(); });

  it('en-têtes de durcissement, pas de x-powered-by, pas de cache sur /api', async () => {
    const r = await h.call('uAdmin').get('/api/projects');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.headers['access-control-allow-origin']).toBeUndefined(); // pas de CORS ouvert
  });

  it('une erreur interne ne fuit ni SQL, ni stack, ni chemins — mais est corrélée par requestId dans les logs', async () => {
    const boom = createApp({
      db: { tx: async () => { throw Object.assign(new Error('relation "secret_table" does not exist at /srv/app/db.ts'), { code: 'XX000' }); }, close: async () => {} },
      verifier: h.verifier, config: h.config, log: (e) => h.logs.push(e),
    });
    const supertest = (await import('supertest')).default;
    const r = await supertest(boom).get('/api/projects').set('Authorization', 'Bearer tok:uAdmin');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/secret_table|\/srv\/|relation|stack/i);
    expect(r.body).toMatchObject({ error: 'internal_error', message: 'Erreur interne' });
    const logged = h.logs.find((l) => l.requestId === r.body.requestId);
    expect(String(logged?.message)).toMatch(/secret_table/); // le détail existe, mais côté serveur uniquement
  });

  it('les erreurs de contrainte ne révèlent pas le schéma (409/422 génériques)', async () => {
    const r = await h.call('uAdmin').post('/api/projects').send(validProject({ reference: 'A-REF-1' }));
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).not.toMatch(/uq_projects|constraint|violates|duplicate key/i);
  });

  it('frein aux jetons invalides : 429 après un seuil d\'échecs', async () => {
    const hh = await createHarness('rls');
    let status = 0;
    for (let i = 0; i < 105; i++) status = (await hh.anon().get('/api/projects').set('Authorization', 'Bearer nope')).status;
    expect(status).toBe(429);
    // un appelant légitime n'est pas pénalisé par ses succès
    await hh.close();
  });
});

describe('Configuration', () => {
  const prodBase = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', CLERK_SECRET_KEY: 'sk_x', CLERK_AUTHORIZED_PARTIES: 'https://truetco.vercel.app' };
  it('production valide', () => expect(loadConfig(prodBase as any).isProd).toBe(true));
  it.each(['DATABASE_URL', 'CLERK_SECRET_KEY', 'CLERK_AUTHORIZED_PARTIES'])('production sans %s => refus de démarrer', (k) => {
    const e: any = { ...prodBase }; delete e[k];
    expect(() => loadConfig(e)).toThrow(new RegExp(k));
  });
  it('aucune variable ne peut désactiver l\'authentification', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../server/config.ts'), 'utf8');
    expect(src).not.toMatch(/SKIP_AUTH|DISABLE_AUTH|NO_AUTH|BYPASS_AUTH|AUTH_DISABLED/i);
  });
});

/** Gardes statiques : empêchent la réapparition, par inadvertance, des anciennes failles. */
describe('Gardes statiques sur le code serveur', () => {
  const root = path.resolve(__dirname, '../server');
  const files = (function walk(d: string): string[] {
    return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
  })(root);
  const src = (f: string) => fs.readFileSync(f, 'utf8');
  const rel = (f: string) => path.relative(root, f);

  it("le tenant n'est jamais lu depuis la requête client (hors sélecteur validé de auth.ts)", () => {
    for (const f of files) {
      const s = src(f);
      expect(s, rel(f)).not.toMatch(/req\.(body|query|params)\.(organizationId|organization_id|tenantId|tenant_id|orgId)/);
      if (!f.endsWith('auth.ts')) expect(s, rel(f)).not.toMatch(/x-tenant-id/i);
    }
  });

  it("aucun SQL n'est construit par concaténation de données de requête", () => {
    for (const f of files) {
      for (const m of src(f).matchAll(/\.query\(\s*`([\s\S]*?)`/g)) {
        const interpolations = [...m[1].matchAll(/\$\{([^}]*)\}/g)].map((x) => x[1].trim());
        // Seules des constantes de colonnes (MAJUSCULES) sont autorisées dans le SQL.
        for (const i of interpolations) expect(i, `${rel(f)} : ${i}`).toMatch(/^[A-Z_]+$/);
      }
    }
  });

  it('aucune route de données ne contourne withTenant (pas de db.tx direct hors session/auth)', () => {
    for (const f of files.filter((x) => /routes\/data\.ts$/.test(x))) {
      expect(src(f)).not.toMatch(/\bdb\.tx\(/);
    }
  });

  it('chaque route des routeurs de données déclare une permission (refus par défaut)', () => {
    const s = src(path.join(root, 'routes/data.ts'));
    const routes = [...s.matchAll(/\br\.(get|post|patch|delete|put)\(\s*'([^']+)'\s*,\s*([^\n]*)/g)];
    expect(routes.length).toBeGreaterThan(8);
    for (const [, method, url, rest] of routes) expect(rest, `${method} ${url}`).toMatch(/requirePermission\(/);
  });

  it("le serveur n'expose plus d'erreur brute (jamais res.json({ error: err.message }))", () => {
    for (const f of files.filter((x) => !/legacy-simulated/.test(x))) expect(src(f), rel(f)).not.toMatch(/error:\s*(err|e|error)\??\.message/);
  });
});
