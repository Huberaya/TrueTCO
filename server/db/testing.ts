import { PgliteDb } from './adapters';
import { runMigrations } from './migrate';
import { Db } from './types';

/** Base de test migrée, prête à l'emploi (PostgreSQL réel via PGlite). */
export async function createTestDb(options: { appRole?: string | null; quiet?: boolean } = {}): Promise<Db> {
  const db = await PgliteDb.create(options.appRole === undefined ? 'truetco_app' : options.appRole);
  await runMigrations(db, { logger: options.quiet ? () => {} : undefined });
  return db;
}

let shared: Promise<Db> | null = null;
/** Base partagée entre tests d'un même fichier (les migrations sont coûteuses). */
export async function sharedTestDb(): Promise<Db> {
  if (!shared) shared = createTestDb({ quiet: true });
  return shared;
}
