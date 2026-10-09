/**
 * TrueTCO — Point d'entrée du serveur
 * ---------------------------------------------------------------------------
 * Ce fichier ne fait que deux choses : construire la base de données (via
 * `createDbFromEnv`), construire l'application (`createApp`) et l'écouter.
 * Toute la logique est testable ailleurs.
 *
 * CONFIGURATION (voir .env.example) :
 *   DATABASE_URL                  chaîne PostgreSQL (production/staging)
 *   TRUETCO_USE_PGLITE=true       base PostgreSQL embarquée (tests uniquement)
 *   TRUETCO_AUTO_MIGRATE=true     applique les migrations au démarrage
 *   TRUETCO_ALLOW_DEMO_AUTH       sessions de recette (interdit en production)
 *   TRUETCO_ALLOWED_ORIGINS       origines autorisées (liste séparée par des virgules)
 *   TRUETCO_METHODOLOGY_VERSION   version des conventions de calcul (2026.2 par défaut)
 */

import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './server/app';
import { createDbFromEnv } from './server/db/adapters';
import { runMigrations } from './server/db/migrate';
import { TCO_ENGINE_VERSION } from './src/engine/tcoEngine';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const usePglite = process.env.TRUETCO_USE_PGLITE === 'true';

if (isProd && !hasDatabaseUrl) {
  console.error('[TrueTCO] FATAL : DATABASE_URL est obligatoire en production.');
  process.exit(1);
}
if (isProd && process.env.TRUETCO_ALLOW_DEMO_AUTH === 'true') {
  console.error(
    '[TrueTCO] FATAL : TRUETCO_ALLOW_DEMO_AUTH est interdit en production (aucune authentification réelle ne serait appliquée).'
  );
  process.exit(1);
}
if (isProd && usePglite) {
  console.error('[TrueTCO] FATAL : PGlite est un moteur de test, interdit en production.');
  process.exit(1);
}
if (!hasDatabaseUrl && !usePglite) {
  console.error(
    '[TrueTCO] FATAL : aucune base configurée. Renseignez DATABASE_URL (PostgreSQL).\n' +
      '            Sans base de données, TrueTCO ne peut ni authentifier, ni stocker, ni calculer de façon reproductible :\n' +
      '            démarrer malgré tout produirait une application qui perd silencieusement les données.'
  );
  process.exit(1);
}

const allowedOrigins = (process.env.TRUETCO_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

async function main() {
  const db = await createDbFromEnv();

  if (process.env.TRUETCO_AUTO_MIGRATE === 'true') {
    await runMigrations(db);
  }

  const status = await db.status();
  console.log(
    `[TrueTCO] Base connectée (${status.driver}, ${status.databaseVersion ?? 'version inconnue'}) — ` +
      `rôle applicatif assumé : ${status.appRoleAssumed ? 'oui' : 'non'}.`
  );

  const app = createApp({
    db,
    isProd,
    allowDemoAuth: !isProd && process.env.TRUETCO_ALLOW_DEMO_AUTH === 'true',
    allowedOrigins,
    engineVersion: TCO_ENGINE_VERSION,
    methodologyVersion: process.env.TRUETCO_METHODOLOGY_VERSION ?? '2026.2',
    staticDir: isProd ? path.join(__dirname, 'dist') : null,
  });

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[TrueTCO] Serveur prêt sur le port ${PORT} (${isProd ? 'production' : 'développement'}).`);
    if (!isProd) {
      console.log('[TrueTCO] Front de développement : npm run dev:client (Vite) ou npm run dev (serveur + Vite intégré).');
    }
  });

  const shutdown = async (signal: string) => {
    console.log(`[TrueTCO] Arrêt demandé (${signal}) : fermeture des connexions…`);
    server.close(async () => {
      await db.close().catch(() => undefined);
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[TrueTCO] Démarrage impossible :', err);
  process.exit(1);
});
