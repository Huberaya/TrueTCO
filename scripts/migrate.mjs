/**
 * TrueTCO — Application des migrations sur la base configurée
 * ---------------------------------------------------------------------------
 * Utilisation : npm run db:migrate
 *
 * Lit DATABASE_URL (ou bascule sur PGlite si TRUETCO_USE_PGLITE=true, pour un
 * essai local). Le runner refuse d'appliquer une migration dont l'empreinte
 * SHA-256 a changé depuis son application : un fichier déjà joué est un fait
 * historique, il ne se réécrit pas — on ajoute une nouvelle migration.
 */
import 'dotenv/config';
import { createDbFromEnv } from '../server/db/adapters.ts';
import { runMigrations } from '../server/db/migrate.ts';

try {
  const db = await createDbFromEnv();
  const status = await db.status();
  console.log(`[TrueTCO] Base : ${status.driver} — ${status.databaseVersion ?? 'version inconnue'}`);
  await runMigrations(db);
  await db.close();
  console.log('[TrueTCO] Migrations à jour.');
} catch (err) {
  console.error('[TrueTCO] Échec des migrations :', err instanceof Error ? err.message : err);
  process.exit(1);
}
