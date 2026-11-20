import { createNeonTenantSqlPool, type TenantSqlPool } from './tenantSql';

export type RuntimeDatabaseEnvironment = Record<string, string | undefined>;

/**
 * Build the least-privilege application pool from its dedicated Vercel secret.
 *
 * DATABASE_URL is deliberately not a fallback: it remains reserved for the
 * existing Drizzle/migration tooling until that workflow is split explicitly.
 * This factory validates the role and Neon endpoint without logging the URL.
 * Pool creation is lazy; no connection is opened until connect() is called.
 */
export function createRuntimeTenantSqlPool(
  env: RuntimeDatabaseEnvironment = process.env,
): TenantSqlPool {
  const connectionString = env.DATABASE_URL_RUNTIME;
  if (!connectionString) {
    throw new Error('DATABASE_URL_RUNTIME is required for the runtime database pool.');
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL_RUNTIME must be a valid PostgreSQL connection URL.');
  }

  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    parsed.username !== 'truetco_app' ||
    !parsed.hostname.endsWith('.neon.tech') ||
    parsed.pathname !== '/neondb' ||
    parsed.searchParams.get('sslmode') !== 'require'
  ) {
    throw new Error('DATABASE_URL_RUNTIME must target the Neon neondb database using the truetco_app role and TLS.');
  }

  return createNeonTenantSqlPool(connectionString);
}
