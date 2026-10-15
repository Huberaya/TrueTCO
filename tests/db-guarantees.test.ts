import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations } from '../server/migrate';
import { MIGRATIONS_DIR, ORG_A, ORG_B, createHarness, id, pgliteExecutor, seed, type Harness } from './helpers/harness';

/** Garanties portées par la BASE elle-même, indépendamment du code applicatif. */
describe('Garanties base de données', () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('rls'); await seed(h); });
  afterAll(async () => { await h.close(); });

  /** Exécute `sql` sous le rôle applicatif (soumis au RLS) avec les variables de session données. */
  const asApp = (sql: string, vars: Record<string, string> = {}) =>
    h.pg.transaction(async (tx) => {
      await tx.query('SET LOCAL ROLE truetco_app');
      for (const [k, v] of Object.entries(vars)) await tx.query('SELECT set_config($1,$2,true)', [k, v]);
      return (await tx.query(sql)).rows as any[];
    });

  describe('RLS fail-closed', () => {
    it.each(['projects', 'suppliers', 'supplier_offers', 'cost_items', 'reference_benchmarks', 'audit_logs', 'users', 'organizations'])(
      '%s : sans contexte tenant => 0 ligne', async (t) => {
        expect(await asApp(`SELECT 1 FROM ${t}`)).toHaveLength(0);
      });

    it('contexte A => uniquement les lignes de A, sur toutes les tables', async () => {
      for (const t of ['projects', 'suppliers', 'supplier_offers', 'cost_items', 'reference_benchmarks', 'audit_logs']) {
        const rows = await asApp(`SELECT DISTINCT organization_id FROM ${t}`, { 'app.org_id': ORG_A });
        expect(rows.map((r) => r.organization_id), t).toEqual([ORG_A]);
      }
    });

    it('un contexte vide ou invalide ne donne rien', async () => {
      expect(await asApp('SELECT 1 FROM projects', { 'app.org_id': '' })).toHaveLength(0);
      await expect(asApp('SELECT 1 FROM projects', { 'app.org_id': 'pas-un-uuid' })).rejects.toThrow();
    });

    it('INSERT dans une autre organisation refusé', async () => {
      await expect(asApp(
        `INSERT INTO suppliers(organization_id,name,country_code,standard_lead_time_days) VALUES ('${ORG_B}','X','FR',1)`,
        { 'app.org_id': ORG_A }
      )).rejects.toThrow(/row-level security/);
    });

    it("UPDATE / DELETE d'une ligne d'une autre organisation : 0 ligne touchée", async () => {
      await asApp(`UPDATE projects SET name='HACK' WHERE id='${id('d', 2)}'`, { 'app.org_id': ORG_A });
      await asApp(`DELETE FROM projects WHERE id='${id('d', 2)}'`, { 'app.org_id': ORG_A });
      expect((await h.pg.query(`SELECT name FROM projects WHERE id='${id('d', 2)}'`)).rows).toEqual([{ name: 'Projet B SECRET' }]);
    });

    it("déplacer sa propre ligne vers une autre organisation est refusé (WITH CHECK)", async () => {
      await expect(asApp(`UPDATE projects SET organization_id='${ORG_B}' WHERE id='${id('d', 1)}'`, { 'app.org_id': ORG_A })).rejects.toThrow(/row-level security/);
    });

    it('le rôle applicatif ne contourne pas le RLS et ne peut pas désactiver sa propre sécurité', async () => {
      const [r] = await h.pg.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='truetco_app'`).then((x) => x.rows as any[]);
      expect(r).toEqual({ rolsuper: false, rolbypassrls: false });
      await expect(asApp('ALTER TABLE projects DISABLE ROW LEVEL SECURITY')).rejects.toThrow();
      await expect(asApp('DROP POLICY tenant_isolation ON projects')).rejects.toThrow();
    });

    it('un utilisateur ne peut pas se lier à une identité par UPDATE sans email vérifié', async () => {
      const rows = await asApp(
        `UPDATE users SET clerk_id='uEvil' WHERE clerk_id IS NULL RETURNING id`, { 'app.clerk_id': 'uEvil' });
      expect(rows).toHaveLength(0);
    });

    it('organizations : création impossible sans app.new_org_id correspondant', async () => {
      await expect(asApp(`INSERT INTO organizations(name,slug) VALUES ('Intrus','intrus')`)).rejects.toThrow(/row-level security/);
    });
  });

  describe('intégrité inter-tenant par clés étrangères composites (même RLS contourné)', () => {
    it("une offre ne peut pas lier le projet d'une organisation au fournisseur d'une autre", async () => {
      await expect(h.pg.exec(
        `INSERT INTO supplier_offers(organization_id,project_id,supplier_id,offer_reference,apparent_total) VALUES ('${ORG_A}','${id('d', 1)}','${id('c', 2)}','X',1)`
      )).rejects.toThrow(/fk_offers_supplier_same_org|foreign key/);
      await expect(h.pg.exec(
        `INSERT INTO supplier_offers(organization_id,project_id,supplier_id,offer_reference,apparent_total) VALUES ('${ORG_A}','${id('d', 2)}','${id('c', 1)}','X',1)`
      )).rejects.toThrow(/fk_offers_project_same_org|foreign key/);
    });

    it("une ligne de coût ne peut pas pointer l'offre d'une autre organisation", async () => {
      await expect(h.pg.exec(
        `INSERT INTO cost_items(organization_id,offer_id,category,label,amount,unit,source_name,source_type,confidence_level) VALUES ('${ORG_A}','${id('e', 2)}','c','l',1,'€','s','verifiee',1)`
      )).rejects.toThrow(/foreign key|fk_cost_items/);
    });

    it('organization_id est obligatoire sur toutes les tables enfants', async () => {
      const cols = (await h.pg.query(`SELECT table_name FROM information_schema.columns WHERE column_name='organization_id' AND is_nullable='NO' AND table_schema='public'`)).rows as any[];
      const tables = cols.map((c) => c.table_name);
      for (const t of ['projects', 'suppliers', 'supplier_offers', 'cost_items', 'carbon_items', 'risk_items', 'reference_benchmarks', 'audit_logs', 'users']) {
        expect(tables, t).toContain(t);
      }
    });
  });

  describe("journal d'audit en écriture seule", () => {
    it('UPDATE interdit — y compris pour le propriétaire de la base', async () => {
      await expect(h.pg.exec(`UPDATE audit_logs SET justification='réécrit'`)).rejects.toThrow(/écriture seule/);
    });
    it('DELETE interdit sans purge explicite, TRUNCATE interdit', async () => {
      await expect(h.pg.exec(`DELETE FROM audit_logs`)).rejects.toThrow(/écriture seule/);
      await expect(h.pg.exec(`TRUNCATE audit_logs`)).rejects.toThrow(/écriture seule/);
    });
    it('le rôle applicatif ne possède même pas les privilèges UPDATE/DELETE', async () => {
      const p = (await h.pg.query(`SELECT has_table_privilege('truetco_app','audit_logs','UPDATE') u, has_table_privilege('truetco_app','audit_logs','DELETE') d, has_table_privilege('truetco_app','audit_logs','INSERT') i`)).rows[0] as any;
      expect(p).toEqual({ u: false, d: false, i: true });
    });
    it('la purge (offboarding / RGPD) reste possible mais exige un drapeau explicite', async () => {
      const db = new PGlite();
      await applyMigrations(pgliteExecutor(db), MIGRATIONS_DIR);
      await db.exec(`INSERT INTO organizations(id,name,slug) VALUES ('${ORG_A}','A','a');
                     INSERT INTO audit_logs(organization_id,user_name,user_role,entity_name,field_changed,old_value,new_value,justification) VALUES ('${ORG_A}','u','r','e','f','o','n','j')`);
      await expect(db.exec(`DELETE FROM organizations WHERE id='${ORG_A}'`)).rejects.toThrow(/écriture seule/);
      await db.exec(`BEGIN; SELECT set_config('app.audit_purge','on',true); DELETE FROM organizations WHERE id='${ORG_A}'; COMMIT;`);
      expect((await db.query('SELECT count(*)::int n FROM audit_logs')).rows).toEqual([{ n: 0 }]);
    });
  });
});

describe("Audit applicatif : identité et date imposées par le serveur", () => {
  let h: Harness;
  beforeAll(async () => { h = await createHarness('rls'); await seed(h); });
  afterAll(async () => { await h.close(); });

  it("un client ne peut pas forger l'auteur, le rôle, l'organisation ni la date", async () => {
    const r = await h.call('uBuyer').post('/api/audit-logs').send({
      entityName: 'WACC', fieldChanged: 'Taux', oldValue: '4%', newValue: '9%', justification: 'Validé par le DAF',
      userName: 'Le PDG', userRole: 'admin', organizationId: ORG_B, timestamp: '1999-01-01T00:00:00Z', id: id('f', 1), origin: 'server',
    });
    expect(r.status).toBe(201);
    const row = (await h.pg.query(`SELECT * FROM audit_logs WHERE entity_name='WACC'`)).rows[0] as any;
    expect(row).toMatchObject({ user_name: 'Buyer A', user_role: 'acheteur', organization_id: ORG_A, origin: 'client_declared' });
    expect(new Date(row.timestamp).getFullYear()).toBeGreaterThanOrEqual(2025);
    expect(row.id).not.toBe(id('f', 1));
  });

  it('chaque modification de projet est journalisée champ par champ, par le serveur', async () => {
    const base = { reference: 'AUD-1', name: 'Audité', budgetCap: 1000, plannedVolume: 1, horizonYears: 5, discountRate: 0.05, energyInflationRate: 0.04, inflationRate: 0.02, carbonPricePerTonne: 100 };
    expect((await h.call('uBuyer').post('/api/projects').send({ ...base, id: id('d', 9) })).status).toBe(200);
    expect((await h.call('uBuyer').post('/api/projects').send({ ...base, id: id('d', 9), discountRate: 0.07, name: 'Audité v2' })).status).toBe(200);
    const rows = (await h.pg.query(`SELECT field_changed, old_value, new_value, user_name, origin FROM audit_logs WHERE entity_name='Projet AUD-1' ORDER BY timestamp, field_changed`)).rows as any[];
    expect(rows.map((r) => r.field_changed)).toEqual(expect.arrayContaining(['Création', 'discount_rate', 'name']));
    const dr = rows.find((r) => r.field_changed === 'discount_rate');
    expect(dr).toMatchObject({ old_value: '0.0500', new_value: '0.0700', user_name: 'Buyer A', origin: 'server' });
  });

  it('une mutation qui échoue ne laisse AUCUNE entrée d\'audit orpheline (même transaction)', async () => {
    const before = (await h.pg.query('SELECT count(*)::int n FROM audit_logs')).rows[0] as any;
    const r = await h.call('uBuyer').post('/api/offers').send({ id: 'o-fail', projectId: id('d', 1), supplierId: id('c', 1), apparentTotal: 1, quantity: 1, offerReference: 'OFF-A' });
    expect(r.status).toBe(409); // doublon (project_id, offer_reference)
    const after = (await h.pg.query('SELECT count(*)::int n FROM audit_logs')).rows[0] as any;
    expect(after.n).toBe(before.n);
  });
});
