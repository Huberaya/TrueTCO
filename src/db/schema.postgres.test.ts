import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { PGlite } from '@electric-sql/pglite';
import test from 'node:test';

const applicationTables = [
  'audit_logs',
  'carbon_items',
  'cost_items',
  'organizations',
  'projects',
  'reference_benchmarks',
  'risk_items',
  'supplier_offers',
  'suppliers',
  'users',
];
const ddlUrl = new URL('./schema.sql', import.meta.url);
const migrationDir = fileURLToPath(new URL('../../drizzle/migrations', import.meta.url));
const readSql = (url: URL) => readFile(url, 'utf8');

async function createFromDdl() {
  const db = new PGlite();
  await db.exec(await readSql(ddlUrl));
  return db;
}

async function createFromMigrations() {
  const client = new PGlite();
  await migrate(drizzle(client), { migrationsFolder: migrationDir });
  return client;
}

async function catalog(db: PGlite) {
  const columns = (
    await db.query<Record<string, unknown>>(
      `SELECT table_name, column_name, format_type(a.atttypid, a.atttypmod) AS data_type,
              is_nullable, column_default
       FROM information_schema.columns c
       JOIN pg_class t ON t.relname = c.table_name
       JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = c.table_schema
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attname = c.column_name
       WHERE c.table_schema = 'public' AND c.table_name = ANY($1::text[])
       ORDER BY table_name, ordinal_position`,
      [applicationTables],
    )
  ).rows.map((row) => ({
    ...row,
    // PostgreSQL reports equivalent defaults differently for SQL text and Drizzle output.
    column_default: typeof row.column_default === 'string' ? row.column_default.replaceAll('now()', 'CURRENT_TIMESTAMP') : null,
  }));
  const constraints = (
    await db.query<Record<string, unknown>>(
      `SELECT t.relname AS table_name, c.conname, c.contype,
              pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])
         AND c.contype IN ('p', 'u', 'f', 'c')
       ORDER BY table_name, conname`,
      [applicationTables],
    )
  ).rows;
  const indexes = (
    await db.query<Record<string, unknown>>(
      `SELECT tablename, indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = ANY($1::text[])
       ORDER BY tablename, indexname`,
      [applicationTables],
    )
  ).rows.map((row) => ({
    ...row,
    indexdef: typeof row.indexdef === 'string' ? row.indexdef.replaceAll('"', '').replaceAll('public.', '').replaceAll(/\s+/g, ' ').trim() : '',
  }));
  const triggers = (
    await db.query<Record<string, unknown>>(
      `SELECT event_object_table AS table_name, trigger_name, action_timing,
              event_manipulation, action_statement
       FROM information_schema.triggers
       WHERE trigger_schema = 'public' AND event_object_table = ANY($1::text[])
       ORDER BY table_name, trigger_name`,
      [applicationTables],
    )
  ).rows;

  return { columns, constraints, indexes, triggers };
}

async function insertValidFixture(db: PGlite) {
  const organization = (await db.query<Record<string, unknown>>("INSERT INTO organizations (name) VALUES ('Fixture Org') RETURNING id")).rows[0].id as string;
  const user = (
    await db.query<Record<string, unknown>>(
      "INSERT INTO users (organization_id, email, full_name, role) VALUES ($1, 'buyer@example.invalid', 'Buyer', 'acheteur') RETURNING id",
      [organization],
    )
  ).rows[0].id as string;
  const project = (
    await db.query<Record<string, unknown>>(
      `INSERT INTO projects (organization_id, reference, name, category, company_name,
         budget_cap, planned_volume, unit_name, horizon_years, discount_rate,
         energy_inflation_rate, general_inflation_rate, created_by_user_id)
       VALUES ($1, 'P-1', 'Project', 'IT', 'Fixture Org', 1000, 1, 'unit', 3, 0.04, 0.02, 0.02, $2)
       RETURNING id`,
      [organization, user],
    )
  ).rows[0].id as string;
  const supplier = (
    await db.query<Record<string, unknown>>(
      "INSERT INTO suppliers (organization_id, name, country_code, standard_lead_time_days) VALUES ($1, 'Supplier A', 'FR', 10) RETURNING id",
      [organization],
    )
  ).rows[0].id as string;
  const offer = (
    await db.query<Record<string, unknown>>(
      "INSERT INTO supplier_offers (project_id, supplier_id, offer_reference, apparent_total) VALUES ($1, $2, 'O-1', 100) RETURNING id",
      [project, supplier],
    )
  ).rows[0].id as string;
  return { organization, user, project, supplier, offer };
}

test('PostgreSQL 18 creates the SQL snapshot idempotently and enforces keys, checks, relations and triggers', async () => {
  const db = await createFromDdl();
  try {
    await db.exec(await readSql(ddlUrl));
    const version = (await db.query<Record<string, unknown>>("SELECT current_setting('server_version') AS version")).rows[0].version as string;
    assert.match(version, /^18\./, `expected a disposable PostgreSQL 18 engine, got ${version}`);
    const tableNames = (
      await db.query<Record<string, unknown>>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name")
    ).rows.map((row) => row.table_name);
    assert.deepEqual(tableNames, applicationTables);

    const fixture = await insertValidFixture(db);
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO users (organization_id, email, full_name, role) VALUES ($1, 'bad@example.invalid', 'Bad', 'root')", [fixture.organization]),
      /users_role_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>(
        `INSERT INTO projects (organization_id, reference, name, category, company_name,
         budget_cap, planned_volume, unit_name, horizon_years, discount_rate,
         energy_inflation_rate, general_inflation_rate)
         VALUES ($1, 'P-BAD', 'Bad project', 'IT', 'Fixture Org', 0, 1, 'unit', 3, 0, 0, 0)`,
        [fixture.organization],
      ),
      /projects_budget_cap_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO suppliers (organization_id, name, country_code, standard_lead_time_days, esg_score) VALUES ($1, 'Bad supplier', 'FR', 1, 101)", [fixture.organization]),
      /suppliers_esg_score_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO supplier_offers (project_id, supplier_id, offer_reference, apparent_total) VALUES ($1, $2, 'O-BAD', -1)", [fixture.project, fixture.supplier]),
      /supplier_offers_apparent_total_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO cost_items (offer_id, category, label, amount, unit, source_name, source_type, confidence_level) VALUES ($1, 'purchase', 'x', 1, 'unit', 'fixture', 'invented', 50)", [fixture.offer]),
      /cost_items_source_type_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO carbon_items (offer_id, scope, lifecycle_phase, emissions_per_unit_tonne_co2e, total_lifecycle_emissions, emission_factor_source, confidence_level) VALUES ($1, 'Scope 4', 'use', 1, 1, 'fixture', 50)", [fixture.offer]),
      /carbon_items_scope_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO risk_items (offer_id, description, probability, financial_impact) VALUES ($1, 'bad risk', 1.1, 10)", [fixture.offer]),
      /risk_items_probability_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO reference_benchmarks (organization_id, name, category, source, value, unit, valid_until, confidence_score, last_audit_date) VALUES ($1, 'bad benchmark', 'unknown', 'fixture', 1, 'unit', now(), 50, now())", [fixture.organization]),
      /reference_benchmarks_category_check/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO projects (organization_id, reference, name, category, company_name, budget_cap, planned_volume, unit_name, horizon_years, discount_rate, energy_inflation_rate, general_inflation_rate) VALUES ($1, 'P-1', 'duplicate', 'IT', 'Fixture Org', 1, 1, 'unit', 1, 0, 0, 0)", [fixture.organization]),
      /uq_projects_org_ref/,
    );
    await assert.rejects(db.query<Record<string, unknown>>("DELETE FROM suppliers WHERE id = $1", [fixture.supplier]), /supplier_offers_supplier_id_suppliers_id_fk/);

    await db.query<Record<string, unknown>>("UPDATE organizations SET updated_at = '2000-01-01T00:00:00Z' WHERE id = $1", [fixture.organization]);
    await db.query<Record<string, unknown>>("UPDATE organizations SET name = 'Fixture Org Updated' WHERE id = $1", [fixture.organization]);
    const updatedAt = (await db.query<Record<string, unknown>>('SELECT updated_at FROM organizations WHERE id = $1', [fixture.organization])).rows[0].updated_at as Date;
    assert.notEqual(new Date(updatedAt).toISOString(), '2000-01-01T00:00:00.000Z', 'updated_at trigger must replace a stale timestamp');

    await db.query<Record<string, unknown>>('DELETE FROM organizations WHERE id = $1', [fixture.organization]);
    const remaining = (
      await db.query<Record<string, unknown>>("SELECT count(*)::int AS count FROM projects UNION ALL SELECT count(*)::int FROM users UNION ALL SELECT count(*)::int FROM suppliers UNION ALL SELECT count(*)::int FROM supplier_offers")
    ).rows.map((row) => row.count);
    assert.deepEqual(remaining, [0, 0, 0, 0], 'organization cascade must delete its dependent rows');
  } finally {
    await db.close();
  }
});

test('Drizzle migration from an empty PostgreSQL database matches schema.sql and ledger replay is a no-op', async () => {
  const ddlDb = await createFromDdl();
  const migrationDb = await createFromMigrations();
  try {
    assert.deepEqual(await catalog(migrationDb), await catalog(ddlDb), 'the migration and bootstrap snapshots must be structurally equivalent');
    const before = await catalog(migrationDb);
    await migrate(drizzle(migrationDb), { migrationsFolder: migrationDir });
    assert.deepEqual(await catalog(migrationDb), before, 'the migration ledger must prevent replaying a committed migration');
    const fixture = await insertValidFixture(migrationDb);
    const defaultValues = (
      await migrationDb.query(
        `SELECT p.status, p.carbon_price_per_tonne, s.incoterm
         FROM projects p CROSS JOIN suppliers s
         WHERE p.id = $1 AND s.id = $2`,
        [fixture.project, fixture.supplier],
      )
    ).rows[0];
    assert.deepEqual(defaultValues, { status: 'Brouillon', carbon_price_per_tonne: '120.00', incoterm: 'DDP' });
    assert.equal((await migrationDb.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'new_value'")).rows.length, 1);
  } finally {
    await ddlDb.close();
    await migrationDb.close();
  }
});

test('proposed tenant drafts apply only in an isolated database and enforce their stop conditions', async () => {
  const db = await createFromDdl();
  const draftExpand = await readSql(new URL('../../db/migrations/proposed/0001_expand_tenant_scope.sql.draft', import.meta.url));
  const draftEnforce = await readSql(new URL('../../db/migrations/proposed/0002_enforce_tenant_consistency.sql.draft', import.meta.url));
  try {
    const orgA = (await db.query<Record<string, unknown>>("INSERT INTO organizations (name) VALUES ('Tenant A') RETURNING id")).rows[0].id as string;
    const orgB = (await db.query<Record<string, unknown>>("INSERT INTO organizations (name) VALUES ('Tenant B') RETURNING id")).rows[0].id as string;
    const projectA = (await db.query<Record<string, unknown>>("INSERT INTO projects (organization_id, reference, name, category, company_name, budget_cap, planned_volume, unit_name, horizon_years, discount_rate, energy_inflation_rate, general_inflation_rate) VALUES ($1, 'A-1', 'A', 'IT', 'A', 1, 1, 'unit', 1, 0, 0, 0) RETURNING id", [orgA])).rows[0].id as string;
    const projectB = (await db.query<Record<string, unknown>>("INSERT INTO projects (organization_id, reference, name, category, company_name, budget_cap, planned_volume, unit_name, horizon_years, discount_rate, energy_inflation_rate, general_inflation_rate) VALUES ($1, 'B-1', 'B', 'IT', 'B', 1, 1, 'unit', 1, 0, 0, 0) RETURNING id", [orgB])).rows[0].id as string;
    const supplierA = (await db.query<Record<string, unknown>>("INSERT INTO suppliers (organization_id, name, country_code, standard_lead_time_days) VALUES ($1, 'Supplier A', 'FR', 1) RETURNING id", [orgA])).rows[0].id as string;
    const supplierB = (await db.query<Record<string, unknown>>("INSERT INTO suppliers (organization_id, name, country_code, standard_lead_time_days) VALUES ($1, 'Supplier B', 'FR', 1) RETURNING id", [orgB])).rows[0].id as string;
    const offerA = (await db.query<Record<string, unknown>>("INSERT INTO supplier_offers (project_id, supplier_id, offer_reference, apparent_total) VALUES ($1, $2, 'O-A', 1) RETURNING id", [projectA, supplierA])).rows[0].id as string;
    const crossOffer = (await db.query<Record<string, unknown>>("INSERT INTO supplier_offers (project_id, supplier_id, offer_reference, apparent_total) VALUES ($1, $2, 'O-CROSS', 1) RETURNING id", [projectA, supplierB])).rows[0].id as string;
    const costItem = (await db.query<Record<string, unknown>>("INSERT INTO cost_items (offer_id, category, label, amount, unit, source_name, source_type, confidence_level) VALUES ($1, 'purchase', 'fixture', 1, 'unit', 'fixture', 'estimee', 50) RETURNING id", [offerA])).rows[0].id as string;
    const carbonItem = (await db.query<Record<string, unknown>>("INSERT INTO carbon_items (offer_id, scope, lifecycle_phase, emissions_per_unit_tonne_co2e, total_lifecycle_emissions, emission_factor_source, confidence_level) VALUES ($1, 'Scope 1', 'use', 1, 1, 'fixture', 50) RETURNING id", [offerA])).rows[0].id as string;
    const riskItem = (await db.query<Record<string, unknown>>("INSERT INTO risk_items (offer_id, description, probability, financial_impact) VALUES ($1, 'fixture', 0.5, 1) RETURNING id", [offerA])).rows[0].id as string;

    await db.exec(draftExpand);
    await db.exec(draftExpand);
    await assert.rejects(db.exec(draftEnforce), /Tenant columns contain NULL rows/);
    await db.exec('ROLLBACK');
    await db.query<Record<string, unknown>>('UPDATE supplier_offers SET organization_id = $1 WHERE id = $2', [orgA, offerA]);
    await db.query<Record<string, unknown>>('UPDATE supplier_offers SET organization_id = $1 WHERE id = $2', [orgA, crossOffer]);
    await db.query<Record<string, unknown>>('UPDATE cost_items SET organization_id = $1 WHERE id = $2', [orgA, costItem]);
    await db.query<Record<string, unknown>>('UPDATE carbon_items SET organization_id = $1 WHERE id = $2', [orgA, carbonItem]);
    await db.query<Record<string, unknown>>('UPDATE risk_items SET organization_id = $1 WHERE id = $2', [orgA, riskItem]);
    await assert.rejects(db.exec(draftEnforce), /Cross-organization offer relation found/);
    await db.exec('ROLLBACK');

    await db.query<Record<string, unknown>>('UPDATE supplier_offers SET supplier_id = $1 WHERE id = $2', [supplierA, crossOffer]);
    const children = [
      { table: 'cost_items', id: costItem },
      { table: 'carbon_items', id: carbonItem },
      { table: 'risk_items', id: riskItem },
    ] as const;
    for (const child of children) {
      await db.query<Record<string, unknown>>(`UPDATE ${child.table} SET organization_id = $1 WHERE id = $2`, [orgB, child.id]);
      await assert.rejects(db.exec(draftEnforce), /Cross-organization offer child found/);
      await db.exec('ROLLBACK');
      await db.query<Record<string, unknown>>(`UPDATE ${child.table} SET organization_id = $1 WHERE id = $2`, [orgA, child.id]);
    }
    await db.exec(draftEnforce);

    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO supplier_offers (organization_id, project_id, supplier_id, offer_reference, apparent_total) VALUES ($1, $2, $3, 'O-BLOCKED', 1)", [orgA, projectA, supplierB]),
      /fk_supplier_offers_supplier_tenant/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO supplier_offers (organization_id, project_id, supplier_id, offer_reference, apparent_total) VALUES ($1, $2, $3, 'O-WRONG-PROJECT', 1)", [orgB, projectA, supplierB]),
      /fk_supplier_offers_project_tenant/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO cost_items (organization_id, offer_id, category, label, amount, unit, source_name, source_type, confidence_level) VALUES ($1, $2, 'purchase', 'wrong tenant', 1, 'unit', 'fixture', 'estimee', 50)", [orgB, offerA]),
      /fk_cost_items_offer_tenant/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO carbon_items (organization_id, offer_id, scope, lifecycle_phase, emissions_per_unit_tonne_co2e, total_lifecycle_emissions, emission_factor_source, confidence_level) VALUES ($1, $2, 'Scope 1', 'use', 1, 1, 'fixture', 50)", [orgB, offerA]),
      /fk_carbon_items_offer_tenant/,
    );
    await assert.rejects(
      db.query<Record<string, unknown>>("INSERT INTO risk_items (organization_id, offer_id, description, probability, financial_impact) VALUES ($1, $2, 'wrong tenant', 0.5, 1)", [orgB, offerA]),
      /fk_risk_items_offer_tenant/,
    );
    assert.equal((await db.query<Record<string, unknown>>('SELECT count(*)::int AS count FROM projects WHERE id = $1', [projectB])).rows[0].count, 1);
  } finally {
    await db.close();
  }
});
