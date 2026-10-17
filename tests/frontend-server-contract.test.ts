import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BENCHMARK_CATEGORIES, PROJECT_STATUSES, SOURCE_TYPES } from '../server/validation';

/**
 * Contrat frontend ⇄ serveur : toute valeur que l'interface peut produire doit être acceptée par le serveur.
 * Deux décalages (statut « adjudique », catégories « energie_kwh » / « recyclage ») faisaient échouer des
 * enregistrements sans bruit ; ce test les rend impossibles à reproduire.
 */
const domain = fs.readFileSync(path.resolve(__dirname, '../src/types/domain.ts'), 'utf8');
const literals = (block: string) => [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const unionBody = (re: RegExp) => { const m = domain.match(re); if (!m) throw new Error(`Union introuvable : ${re}`); return m[1]; };
const stripComments = (s: string) => s.replace(/\/\/.*$/gm, '');

describe('Contrat frontend ⇄ serveur', () => {
  it('ProjectStatus : tous les statuts du frontend sont acceptés', () => {
    const front = literals(stripComments(unionBody(/export type ProjectStatus\s*=([^;]+);/)));
    expect(front.length).toBeGreaterThan(5);
    for (const v of front) expect(PROJECT_STATUSES, v).toContain(v);
  });

  it('DataSourceType : toutes les provenances du frontend sont acceptées', () => {
    const front = literals(stripComments(unionBody(/export type DataSourceType\s*=([^;]+);/)));
    expect(front.length).toBe(8);
    for (const v of front) expect(SOURCE_TYPES, v).toContain(v);
  });

  it('catégories de référentiel : toutes celles du frontend sont acceptées', () => {
    const m = domain.match(/category:\s*((?:'[a-z_]+'\s*\|\s*)+'[a-z_]+');\s*\n[^\n]*\n?[^\n]*valid/i) ?? domain.match(/export interface ExternalityReferenceBenchmark[\s\S]*?category:\s*([^;]+);/);
    expect(m).toBeTruthy();
    for (const v of literals(m![1])) expect(BENCHMARK_CATEGORIES, v).toContain(v);
  });

  it('la contrainte CHECK de la base accepte les mêmes statuts que le serveur', () => {
    const sql = fs.readFileSync(path.resolve(__dirname, '../db/migrations/003_entity_documents.sql'), 'utf8');
    for (const v of PROJECT_STATUSES) expect(sql, v).toContain(`'${v}'`);
    for (const v of BENCHMARK_CATEGORIES) expect(sql, v).toContain(`'${v}'`);
  });
});
