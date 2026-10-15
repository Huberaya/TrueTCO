import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyMigrations } from '../server/migrate';
import { MIGRATIONS_DIR, pgliteExecutor } from './helpers/harness';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PROJ = `(id,organization_id,reference,name,category,company_name,budget_cap,planned_volume,unit_name,horizon_years,discount_rate,energy_inflation_rate,general_inflation_rate)`;

describe('Migrations', () => {
  it('base vierge : applique tout, et la ré-exécution est un no-op', async () => {
    const pg = new PGlite();
    expect(await applyMigrations(pgliteExecutor(pg), MIGRATIONS_DIR)).toEqual(['001_baseline.sql', '002_tenant_isolation.sql']);
    expect(await applyMigrations(pgliteExecutor(pg), MIGRATIONS_DIR)).toEqual([]);
  });

  it('base héritée : les comptes issus de l\'ancien SSO factice sont neutralisés, les enfants rétro-remplis, user_sessions supprimée', async () => {
    const pg = new PGlite();
    const ex = pgliteExecutor(pg);
    await applyMigrations(ex, MIGRATIONS_DIR, { upTo: '001_baseline.sql' });
    await pg.exec(`
      INSERT INTO organizations(id,name,slug) VALUES ('${A}','Victim','victim');
      INSERT INTO users(organization_id,email,full_name,role,sso_provider,clerk_id) VALUES
        ('${A}','attacker@evil.io','x','admin','azure_ad','user_spoofed'), ('${A}','legit@victim.com','L','directeur_achats',NULL,'user_legit');
      CREATE TABLE user_sessions(token text);
      INSERT INTO projects ${PROJ} VALUES ('d1111111-1111-4111-8111-111111111111','${A}','R','P','c','co',1,1,'u',5,0.05,0.04,0.02);
      INSERT INTO suppliers(id,organization_id,name,country_code,standard_lead_time_days) VALUES ('c1111111-1111-4111-8111-111111111111','${A}','S','FR',1);
      INSERT INTO supplier_offers(id,project_id,supplier_id,offer_reference,apparent_total) VALUES ('e1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','c1111111-1111-4111-8111-111111111111','O',1);
      INSERT INTO cost_items(offer_id,category,label,amount,unit,source_name,source_type,confidence_level) VALUES ('e1111111-1111-4111-8111-111111111111','a','l',1,'€','s','devis_fournisseur',1);`);
    await applyMigrations(ex, MIGRATIONS_DIR);
    const users = (await pg.query(`SELECT email,is_active,clerk_id,quarantined_at IS NOT NULL q FROM users ORDER BY email`)).rows as any[];
    expect(users).toEqual([
      { email: 'attacker@evil.io', is_active: false, clerk_id: null, q: true },
      { email: 'legit@victim.com', is_active: false, clerk_id: null, q: true },
    ]);
    expect(((await pg.query(`SELECT organization_id FROM cost_items`)).rows[0] as any).organization_id).toBe(A);
    expect(((await pg.query(`SELECT to_regclass('user_sessions') r`)).rows[0] as any).r).toBeNull();
  });

  it('base héritée contenant des données inter-tenants : la migration REFUSE plutôt que de masquer', async () => {
    const pg = new PGlite();
    const ex = pgliteExecutor(pg);
    await applyMigrations(ex, MIGRATIONS_DIR, { upTo: '001_baseline.sql' });
    await pg.exec(`
      INSERT INTO organizations(id,name,slug) VALUES ('${A}','A','a'),('${B}','B','b');
      INSERT INTO projects ${PROJ} VALUES ('d1111111-1111-4111-8111-111111111111','${A}','R','P','c','co',1,1,'u',5,0.05,0.04,0.02);
      INSERT INTO suppliers(id,organization_id,name,country_code,standard_lead_time_days) VALUES ('c2222222-2222-4222-8222-222222222222','${B}','S','FR',1);
      INSERT INTO supplier_offers(id,project_id,supplier_id,offer_reference,apparent_total) VALUES ('e1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','c2222222-2222-4222-8222-222222222222','O',1);`);
    await expect(applyMigrations(ex, MIGRATIONS_DIR)).rejects.toThrow(/organisations différentes/);
    // transaction annulée : rien n'a été modifié
    expect(((await pg.query(`SELECT count(*)::int n FROM schema_migrations`)).rows[0] as any).n).toBe(1);
  });

  it('une migration déjà appliquée ne peut pas être éditée (dérive d\'historique)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a(x int);');
    const pg = new PGlite();
    await applyMigrations(pgliteExecutor(pg), dir);
    fs.writeFileSync(path.join(dir, '001_a.sql'), 'CREATE TABLE a(x int, y int);');
    await expect(applyMigrations(pgliteExecutor(pg), dir)).rejects.toThrow(/checksum/);
  });
});
