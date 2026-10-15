import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Exécuteur SQL minimal, implémenté pour `pg` (prod/CLI) et PGlite (tests). */
export interface MigrationExecutor {
  run(sql: string): Promise<void>;
  rows<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export function loadMigrations(dir: string): MigrationFile[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      return { name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
    });
}

/**
 * Applique les migrations en attente, chacune dans sa transaction.
 * Refuse de continuer si une migration déjà appliquée a été modifiée (dérive d'historique).
 * `upTo` permet de s'arrêter avant une migration (tests de migration sur données héritées).
 */
export async function applyMigrations(
  ex: MigrationExecutor,
  dir: string,
  opts: { upTo?: string } = {}
): Promise<string[]> {
  await ex.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Map(
    (await ex.rows<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).map((r) => [r.name, r.checksum])
  );

  const done: string[] = [];
  for (const m of loadMigrations(dir)) {
    if (opts.upTo && m.name > opts.upTo) break;
    const prev = applied.get(m.name);
    if (prev) {
      if (prev !== m.checksum) {
        throw new Error(`Migration ${m.name} modifiée après application (checksum différent). Créer une nouvelle migration au lieu d'éditer l'existante.`);
      }
      continue;
    }
    await ex.run('BEGIN');
    try {
      await ex.run(m.sql);
      await ex.rows('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [m.name, m.checksum]);
      await ex.run('COMMIT');
    } catch (err) {
      await ex.run('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${m.name} échouée : ${(err as Error).message}`);
    }
    done.push(m.name);
  }
  return done;
}
