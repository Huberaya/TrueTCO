#!/usr/bin/env node

/**
 * Retired legacy bootstrap entry point.
 *
 * This file intentionally performs no environment reads, network connections,
 * DDL, seed, or data mutation. The former CREATE TABLE IF NOT EXISTS + optional
 * seed script was not a versioned migration and could not reconcile an existing
 * database. Generate reviewed, ordered Drizzle migrations for a verified target;
 * do not use this legacy command against Neon.
 */

console.error(
  'Disabled: scripts/migrate-neon.mjs was a non-versioned bootstrap, not a migration runner. No database connection or write was attempted.',
);
console.error(
  'Use the reviewed migration files and the documented baseline/reconciliation procedure; production application is not authorized by this script.',
);
process.exitCode = 1;
