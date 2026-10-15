import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../server/app';
import type { AuthVerifier } from '../../server/auth';
import { loadConfig } from '../../server/config';
import type { Db, Queryable } from '../../server/db';
import { applyMigrations } from '../../server/migrate';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const id = (prefix: string, n: number) => `${prefix}${String(n).padStart(7, '0')}-0000-4000-8000-000000000000`;

/** Exécuteur de migrations pour PGlite. */
export const pgliteExecutor = (pg: PGlite) => ({
  run: async (sql: string) => { await pg.exec(sql); },
  rows: async (sql: string, params?: unknown[]) => (await pg.query(sql, params as any[])).rows as any[],
});

/**
 * Mode 'rls'      : les requêtes s'exécutent sous le rôle truetco_app (NOBYPASSRLS) comme en production.
 * Mode 'app-only' : propriétaire/superuser, RLS contourné : prouve que la couche APPLICATIVE isole à elle seule.
 */
export type Mode = 'rls' | 'app-only';

export interface Profile { email?: string; emailVerified: boolean; fullName?: string }

export class FakeVerifier implements AuthVerifier {
  profiles = new Map<string, Profile>();
  /** Jeton de test : `tok:<clerkId>` ; `bad` et tout le reste = invalide. */
  async verify(token: string) {
    const m = /^tok:(\w+)$/.exec(token);
    return m ? { clerkId: m[1] } : null;
  }
  async loadProfile(clerkId: string) { return this.profiles.get(clerkId) ?? null; }
}

export async function createHarness(mode: Mode, env: Record<string, string> = {}) {
  const pg = new PGlite();
  await applyMigrations(pgliteExecutor(pg), MIGRATIONS_DIR);

  const db: Db = {
    tx: (fn) =>
      pg.transaction(async (tx) => {
        if (mode === 'rls') await tx.query('SET LOCAL ROLE truetco_app');
        const q: Queryable = {
          query: async (text, params) => {
            const r = await tx.query(text, params as any[]);
            return { rows: r.rows as any[], rowCount: Math.max(r.affectedRows ?? 0, r.rows.length) };
          },
        };
        return fn(q);
      }),
    close: async () => { await pg.close(); },
  };

  const verifier = new FakeVerifier();
  const logs: Record<string, unknown>[] = [];
  const config = loadConfig({ NODE_ENV: 'test', PLATFORM_ADMIN_CLERK_IDS: 'uPlat', ...env } as NodeJS.ProcessEnv);
  const app: Express = createApp({ db, verifier, config, log: (e) => logs.push(e) });

  /** Appelant authentifié ; `tenant` = valeur du header sélecteur x-tenant-id. */
  const call = (clerkId: string, tenant?: string) => {
    const h = (r: request.Test) => {
      r.set('Authorization', `Bearer tok:${clerkId}`);
      if (tenant) r.set('x-tenant-id', tenant);
      return r;
    };
    return {
      get: (u: string) => h(request(app).get(u)),
      post: (u: string) => h(request(app).post(u)),
      patch: (u: string) => h(request(app).patch(u)),
      delete: (u: string) => h(request(app).delete(u)),
    };
  };

  return { pg, db, app, verifier, logs, config, call, anon: () => request(app), close: () => pg.close() };
}
export type Harness = Awaited<ReturnType<typeof createHarness>>;

const PROJECT_COLS = `(id, organization_id, reference, name, category, company_name, budget_cap, planned_volume, unit_name, horizon_years, discount_rate, energy_inflation_rate, general_inflation_rate, carbon_price_per_tonne)`;

/**
 * Jeu de données : deux entreprises étanches + cas limites.
 *   A : uAdmin(admin) uBuyer(acheteur) uFin(finance) uDir(direction_generale) uAdmin2(admin)
 *   B : uBAdmin(admin, SEUL admin)
 *   uMulti : acheteur dans A ET finance dans B ; uNone : identité sans organisation
 */
export async function seed(h: Harness) {
  const { pg } = h;
  await pg.exec(`
    INSERT INTO organizations(id,name,slug) VALUES ('${ORG_A}','Acme A','acme-a'),('${ORG_B}','Globex B','globex-b');
    INSERT INTO users(id,organization_id,email,full_name,role,clerk_id) VALUES
      ('${id('a', 1)}','${ORG_A}','admin@a.com','Admin A','admin','uAdmin'),
      ('${id('a', 2)}','${ORG_A}','buyer@a.com','Buyer A','acheteur','uBuyer'),
      ('${id('a', 3)}','${ORG_A}','fin@a.com','Fin A','finance_controleur','uFin'),
      ('${id('a', 4)}','${ORG_A}','dir@a.com','Dir A','direction_generale','uDir'),
      ('${id('a', 5)}','${ORG_A}','admin2@a.com','Admin2 A','admin','uAdmin2'),
      ('${id('a', 6)}','${ORG_A}','multi@x.com','Multi A','acheteur','uMulti'),
      ('${id('b', 1)}','${ORG_B}','admin@b.com','Admin B','admin','uBAdmin'),
      ('${id('b', 2)}','${ORG_B}','multi@x.com','Multi B','finance_controleur','uMulti');
    INSERT INTO projects ${PROJECT_COLS} VALUES
      ('${id('d', 1)}','${ORG_A}','A-REF-1','Projet A','c','Acme',1000,1,'u',5,0.05,0.04,0.02,100),
      ('${id('d', 2)}','${ORG_B}','B-REF-1','Projet B SECRET','c','Globex',2000,1,'u',5,0.05,0.04,0.02,100);
    INSERT INTO suppliers(id,organization_id,name,country_code,standard_lead_time_days) VALUES
      ('${id('c', 1)}','${ORG_A}','Fournisseur A','FR',10),
      ('${id('c', 2)}','${ORG_B}','Fournisseur B SECRET','FR',10);
    INSERT INTO supplier_offers(id,organization_id,project_id,supplier_id,offer_reference,apparent_total) VALUES
      ('${id('e', 1)}','${ORG_A}','${id('d', 1)}','${id('c', 1)}','OFF-A',100),
      ('${id('e', 2)}','${ORG_B}','${id('d', 2)}','${id('c', 2)}','OFF-B',200);
    INSERT INTO cost_items(organization_id,offer_id,category,label,amount,unit,source_name,source_type,confidence_level) VALUES
      ('${ORG_A}','${id('e', 1)}','acquisition','a',100,'€','s','verifiee',90),
      ('${ORG_B}','${id('e', 2)}','acquisition','b SECRET',200,'€','s','verifiee',90);
    INSERT INTO reference_benchmarks(organization_id,name,category,source,value,unit,valid_until,confidence_score,last_audit_date) VALUES
      ('${ORG_A}','Prix carbone','carbone','Quinet',100,'€/t',now(),90,now()),
      ('${ORG_B}','Prix carbone','carbone','Autre B SECRET',999,'€/t',now(),90,now());
    INSERT INTO audit_logs(organization_id,user_name,user_role,entity_name,field_changed,old_value,new_value,justification) VALUES
      ('${ORG_A}','Admin A','admin','Projet A','x','1','2','j'),
      ('${ORG_B}','Admin B','admin','Projet B SECRET','x','1','2','j');
  `);
}

export const validProject = (over: Record<string, unknown> = {}) => ({
  reference: 'NEW-1', name: 'Nouveau', budgetCap: 5000, plannedVolume: 10, horizonYears: 5,
  discountRate: 0.05, energyInflationRate: 0.04, inflationRate: 0.02, carbonPricePerTonne: 100, ...over,
});
