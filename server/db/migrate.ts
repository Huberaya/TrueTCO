/**
 * TrueTCO — Exécuteur de migrations
 * ---------------------------------------------------------------------------
 * Règles :
 *  1. Une migration est un fichier SQL figé, identifié par un numéro.
 *  2. Son empreinte SHA-256 est enregistrée à l'application. Si le fichier est
 *     modifié APRÈS avoir été appliqué, l'exécuteur refuse de démarrer : deux
 *     environnements ne doivent jamais pouvoir diverger silencieusement.
 *  3. Chaque migration s'exécute dans UNE transaction : en cas d'échec, la base
 *     reste exactement dans l'état précédent.
 *  4. Les migrations s'exécutent avec la connexion propriétaire (elles créent
 *     des rôles, des tables, des policies), jamais avec le rôle applicatif.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Db } from './types';

export interface MigrationFile {
  version: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
}

export interface MigrationOutcome {
  version: string;
  name: string;
  applied: boolean;
  skipped?: boolean;
  durationMs: number;
  reason?: string;
}

const MIGRATION_DIR_DEFAULT = path.resolve(process.cwd(), 'src/db/migrations');

export async function loadMigrations(dir: string = MIGRATION_DIR_DEFAULT): Promise<MigrationFile[]> {
  const entries = await fs.readdir(dir);
  const files = entries.filter((f) => f.endsWith('.sql')).sort();

  const migrations: MigrationFile[] = [];
  for (const filename of files) {
    const match = /^(\d{4})_([a-z0-9_]+)\.sql$/i.exec(filename);
    if (!match) {
      throw new Error(
        `Nom de migration invalide : « ${filename} ». Format attendu : NNNN_nom_en_minuscules.sql`
      );
    }
    const sql = await fs.readFile(path.join(dir, filename), 'utf8');
    migrations.push({
      version: match[1],
      name: match[2],
      filename,
      sql,
      checksum: crypto.createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }

  const seen = new Set<string>();
  for (const m of migrations) {
    if (seen.has(m.version)) {
      throw new Error(`Version de migration dupliquée : ${m.version}`);
    }
    seen.add(m.version);
  }
  return migrations;
}

export async function runMigrations(
  db: Db,
  options: { dir?: string; logger?: (msg: string) => void } = {}
): Promise<MigrationOutcome[]> {
  const log = options.logger ?? ((msg: string) => console.log(`[TrueTCO][migration] ${msg}`));
  const migrations = await loadMigrations(options.dir);

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version      VARCHAR(20) PRIMARY KEY,
      name         VARCHAR(255) NOT NULL,
      checksum     CHAR(64) NOT NULL,
      applied_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      duration_ms  INTEGER
    )
  `);

  const applied = await db.query<{ version: string; checksum: string; name: string }>(
    'SELECT version, checksum, name FROM schema_migrations ORDER BY version'
  );
  const appliedByVersion = new Map(applied.map((row) => [row.version, row]));

  const outcomes: MigrationOutcome[] = [];

  for (const migration of migrations) {
    const already = appliedByVersion.get(migration.version);

    if (already) {
      if (already.checksum !== migration.checksum) {
        throw new Error(
          `La migration ${migration.version}_${migration.name} a été MODIFIÉE après application ` +
            `(empreinte différente). Créez une nouvelle migration au lieu de modifier un fichier déjà appliqué.`
        );
      }
      outcomes.push({
        version: migration.version,
        name: migration.name,
        applied: false,
        skipped: true,
        durationMs: 0,
        reason: 'déjà appliquée',
      });
      continue;
    }

    const startedAt = Date.now();
    log(`Application de ${migration.filename}…`);
    try {
      await db.systemTx(async (tx) => {
        await tx.query(migration.sql);
        await tx.query(
          'INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt]
        );
      });
    } catch (err) {
      const message = (err as Error).message;
      log(`ÉCHEC sur ${migration.filename} : ${message}`);
      throw new Error(
        `Migration ${migration.version}_${migration.name} échouée — aucune modification partielle n'a été conservée. ` +
          `Cause : ${message}`
      );
    }

    const durationMs = Date.now() - startedAt;
    log(`${migration.filename} appliquée en ${durationMs} ms`);
    outcomes.push({ version: migration.version, name: migration.name, applied: true, durationMs });
  }

  return outcomes;
}
