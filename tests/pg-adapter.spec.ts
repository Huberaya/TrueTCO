/**
 * TEST DU CHEMIN DE PRODUCTION (pilote `pg` sur le protocole réseau PostgreSQL)
 * ---------------------------------------------------------------------------
 * Les tests d'isolation et d'API tournent sur PGlite en mode embarqué : c'est un
 * vrai moteur PostgreSQL, mais le pilote utilisé est différent de celui de la
 * production. Ce fichier vérifie donc le code RÉELLEMENT exécuté en production :
 *   - `PgDb` (pool `pg`, `SET LOCAL ROLE`, `set_config` en portée transactionnelle)
 *   - le protocole réseau PostgreSQL (requêtes préparées, transactions, erreurs)
 *
 * Pour cela, PGlite est exposé sur le protocole PostgreSQL via
 * `@electric-sql/pglite-socket` : aucun serveur externe n'est nécessaire, et le
 * pilote `pg` se connecte exactement comme il le ferait à PostgreSQL managé.
 *
 * Ce que ce test NE remplace PAS : un test contre le PostgreSQL réel de
 * production (version serveur, extensions, paramètres de sécurité réseau,
 * comportement du pool sous charge). Il faut l'exécuter également, une fois, dans
 * l'environnement cible — c'est écrit dans TESTING.md.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgDb } from '../server/db/adapters';
import { runMigrations } from '../server/db/migrate';
import { PgliteDb } from '../server/db/adapters';

/**
 * Chargement défensif des modules PGlite : selon la résolution ESM/CJS de
 * l'environnement d'exécution, les classes sont exposées soit directement, soit
 * sous `default`. Un import qui échoue ici ferait « passer » les tests sans rien
 * vérifier — c'est exactement ce qu'il faut éviter.
 */
async function loadPgliteModules(): Promise<{
  PGLite: any;
  PGLiteSocketServer: any;
}> {
  const [pgliteModule, socketModule] = await Promise.all([
    import('@electric-sql/pglite'),
    import('@electric-sql/pglite-socket'),
  ]);
  const PGLite = (pgliteModule as any).PGlite ?? (pgliteModule as any).default?.PGlite;
  const PGLiteSocketServer =
    (socketModule as any).PGLiteSocketServer ?? (socketModule as any).default?.PGLiteSocketServer;
  return { PGLite, PGLiteSocketServer };
}

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

let socketServer: { start: () => Promise<void>; stop: () => Promise<void> } | null = null;
let pgDb: PgDb | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  try {
    const { PGLite, PGLiteSocketServer } = await loadPgliteModules();
    if (!PGLite || !PGLiteSocketServer) {
      throw new Error('modules PGlite introuvables (export introuvable)');
    }
    // `new PGLite()` (comme le fait l'adaptateur de test) : la fabrique statique
    // `create()` n'est pas exposée de la même façon selon la résolution ESM/CJS.
    const pglite = new PGLite();
    const server = new PGLiteSocketServer({ db: pglite, port: 5433, host: '127.0.0.1' });
    socketServer = server as { start: () => Promise<void>; stop: () => Promise<void> };
    await server.start();
  } catch (err) {
    // Aucun test ne doit « réussir » en silence : le motif de non-exécution est
    // affiché, et la suite échoue explicitement plus bas.
    skipReason = `Socket PostgreSQL indisponible dans cet environnement : ${(err as Error).message}`;
    return;
  }

  pgDb = new PgDb('postgresql://postgres:postgres@127.0.0.1:5433/postgres', 'truetco_app', false);
  await runMigrations(pgDb, { logger: () => {} });

  await pgDb.systemTx(async (tx) => {
    for (const [orgId, name, slug] of [
      [ORG_A, 'Organisation A', 'org-a'],
      [ORG_B, 'Organisation B', 'org-b'],
    ]) {
      await tx.query(`INSERT INTO organizations (id, name, slug, domain) VALUES ($1, $2, $3, $4)`, [
        orgId,
        name,
        slug,
        `${slug}.example.com`,
      ]);
    }
    await tx.query(
      `INSERT INTO projects (organization_id, reference, name, category) VALUES
         ($1, 'REF-A', 'Dossier A', 'Flotte'), ($2, 'REF-B', 'Dossier B', 'Flotte')`,
      [ORG_A, ORG_B]
    );
  });
});

afterAll(async () => {
  await pgDb?.close().catch(() => undefined);
  await socketServer?.stop().catch(() => undefined);
});

describe('PgDb (pilote de production)', () => {
  it('T-PG-00 : l’environnement permet d’exécuter le pilote de production', () => {
    // Garde-fou : si le socket PostgreSQL ne peut pas être ouvert, la suite ne
    // doit pas se contenter de « passer » — elle doit le dire.
    if (skipReason) {
      console.error(`[TrueTCO] Test du pilote de production NON EXÉCUTÉ : ${skipReason}`);
      throw new Error(
        `Le test du pilote de production n'a pas pu s'exécuter (${skipReason}). ` +
          "Il doit être lancé contre le PostgreSQL de l'environnement cible avant toute mise en production " +
          '(voir TESTING.md).'
      );
    }
    expect(pgDb).not.toBeNull();
  });

  it('T-PG-01 : migrations et statut sur le protocole réseau PostgreSQL', async () => {
    if (skipReason) {
      console.warn(skipReason);
      return;
    }
    const status = await pgDb!.status();
    expect(status.connected).toBe(true);
    expect(status.driver).toBe('postgres');
    expect(status.appRoleAssumed).toBe(true);
    expect(status.databaseVersion).toBeTruthy();

    // Le test ne fige pas la liste : il exige que TOUTES les migrations présentes
    // sur le disque soient appliquées, et dans l'ordre. Une nouvelle migration
    // oubliée en production fait donc échouer le test, sans qu'il faille le
    // modifier à chaque livraison — et sans qu'un numéro puisse être oublié.
    const fs = await import('fs/promises');
    const path = await import('path');
    const files = (await fs.readdir(path.resolve(process.cwd(), 'src/db/migrations')))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const expectedVersions = files.map((name) => name.slice(0, 4));

    const applied = await pgDb!.systemTx((tx) =>
      tx.query<{ version: string; checksum: string }>(`SELECT version, checksum FROM schema_migrations ORDER BY version`)
    );
    expect(applied.map((m) => m.version)).toEqual(expectedVersions);
  });

  it('T-PG-02 : le cloisonnement RLS se comporte de façon identique avec le pilote de production', async () => {
    if (skipReason) return;
    const rowsA = await pgDb!.asOrganization(ORG_A, (tx) => tx.query('SELECT reference FROM projects'));
    expect(rowsA.map((r: any) => r.reference)).toEqual(['REF-A']);

    const rowsB = await pgDb!.asOrganization(ORG_B, (tx) => tx.query('SELECT reference FROM projects'));
    expect(rowsB.map((r: any) => r.reference)).toEqual(['REF-B']);

    // Sans contexte : échec fermé, aucune donnée visible.
    const none = await pgDb!.tx((tx) => tx.query('SELECT reference FROM projects'));
    expect(none).toHaveLength(0);
  });

  it('T-PG-03 : une écriture inter-organisation est refusée par la policy', async () => {
    if (skipReason) return;
    await expect(
      pgDb!.asOrganization(ORG_A, (tx) =>
        tx.query(`INSERT INTO projects (organization_id, reference, name, category) VALUES ($1, 'X', 'X', 'Flotte')`, [ORG_B])
      )
    ).rejects.toThrow();

    const created = await pgDb!.systemTx((tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::text n FROM projects WHERE reference = 'X'`)
    );
    expect(created[0].n).toBe('0');
  });

  it('T-PG-04 : les erreurs SQL sont traduites sans exposer la requête ni le schéma', async () => {
    if (skipReason) return;
    // Résolution d'une requête invalide : le message doit rester exploitable pour
    // l'utilisateur et ne doit pas contenir de trace technique.
    const error = await pgDb!
      .asOrganization(ORG_A, (tx) => tx.query('SELECT colonne_inexistante FROM projects'))
      .then(() => null)
      .catch((err) => err as Error & { code?: string });

    expect(error).not.toBeNull();
    expect((error as any).code).toBe('DB_SCHEMA');
    expect(error!.message).not.toMatch(/colonne_inexistante/);
    expect(error!.message).not.toMatch(/pg_catalog|information_schema/);
    // La cause technique reste disponible pour l'exploitant, jamais pour le client.
    expect((error as any).technical).toMatch(/colonne_inexistante/);

    const missingTableError = await pgDb!
      .asOrganization(ORG_A, (tx) => tx.query('SELECT * FROM table_absente_test'))
      .then(() => null)
      .catch((err) => err as Error & { code?: string });
    expect(missingTableError).not.toBeNull();
    expect((missingTableError as any).code).toBe('DB_SCHEMA');
    expect(missingTableError!.message).toMatch(/migration/i);
    expect(missingTableError!.message).not.toMatch(/table_absente_test/);
  });

  it('T-PG-05 : le hachage du journal d’audit produit le même résultat quel que soit le pilote', async () => {
    if (skipReason) return;
    // Le hachage est calculé par PostgreSQL : il doit être identique en embarqué
    // et en réseau, sans quoi un dossier vérifié sur un environnement ne le serait
    // pas sur un autre.
    // Instance embarquée migrée de la même façon : la comparaison n'a de sens
    // qu'entre deux bases portant le même schéma.
    const embedded = await PgliteDb.create(null);
    await runMigrations(embedded, { logger: () => {} });
    const [viaNetwork] = await pgDb!.systemTx((tx) =>
      tx.query<{ hash: string }>(`SELECT truetco_audit_content_hash($1::uuid, '2026-01-01T00:00:00.000Z'::timestamptz, NULL::uuid, 'Acteur'::text, 'org_admin'::text,
              'test.action'::text, 'project'::text, NULL::uuid, NULL::uuid, 'field'::text, 'avant'::text, 'après'::text, 'justification'::text, 'corr'::text) AS hash`, [ORG_A])
    );
    const [viaEmbedded] = await embedded.query<{ hash: string }>(
      `SELECT truetco_audit_content_hash($1::uuid, '2026-01-01T00:00:00.000Z'::timestamptz, NULL::uuid, 'Acteur'::text, 'org_admin'::text,
              'test.action'::text, 'project'::text, NULL::uuid, NULL::uuid, 'field'::text, 'avant'::text, 'après'::text, 'justification'::text, 'corr'::text) AS hash`,
      [ORG_A]
    );
    expect(viaNetwork.hash).toBe(viaEmbedded.hash);
    expect(viaNetwork.hash).toMatch(/^[0-9a-f]{64}$/);
    await embedded.close();
  });
});
