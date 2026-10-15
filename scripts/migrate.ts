/**
 * Applique les migrations de db/migrations/ (suivi dans schema_migrations, checksums vérifiés).
 *   npm run db:migrate
 * Doit s'exécuter avec le rôle PROPRIÉTAIRE : MIGRATION_DATABASE_URL (ou, à défaut, DATABASE_URL).
 * Le rôle applicatif truetco_app (utilisé par le serveur) n'a PAS le droit de modifier le schéma.
 */
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { applyMigrations } from '../server/migrate';

dotenv.config();
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../db/migrations');

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL (ou DATABASE_URL) manquant');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const done = await applyMigrations(
      {
        run: async (sql) => { await client.query(sql); },
        rows: async (sql, params) => (await client.query(sql, params as any[])).rows,
      },
      dir
    );
    console.log(done.length ? `✓ Migrations appliquées : ${done.join(', ')}` : '✓ Base à jour, rien à appliquer.');
    if (done.includes('002_tenant_isolation.sql')) {
      console.log('\n⚠️  002 a mis en quarantaine TOUS les comptes existants (aucun n\'avait été authentifié de façon fiable).');
      console.log('   1. Revoir : db/ops/review-quarantined-users.sql');
      console.log('   2. Ré-amorcer un administrateur : npm run admin:bootstrap -- --org <slug|uuid> --email <email> --name "<Nom>"');
      console.log('   3. Créer le mot de passe du rôle applicatif : ALTER ROLE truetco_app LOGIN PASSWORD \'...\';  (voir docs/SECURITY.md)');
    }
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error('✗', e.message); process.exit(1); });
