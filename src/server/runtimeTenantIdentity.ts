import { createRuntimeTenantSqlPool } from '../db/runtimeTenantPool';
import { findActiveTenantMembership, type TenantSqlPool } from '../db/tenantSql';
import { createTenantIdentityMiddleware, type ClerkAuthReader } from './tenantIdentity';

export interface RuntimeTenantIdentityOptions {
  /** Injection seam for unit tests; production uses the dedicated DATABASE_URL_RUNTIME factory. */
  createPool?: () => TenantSqlPool;
  /** Injection seam for unit tests; production reads only Clerk middleware state. */
  readAuth?: ClerkAuthReader;
}

/**
 * Wire the verified Clerk subject to a lazy, singleton runtime pool. Missing or
 * invalid DATABASE_URL_RUNTIME fails closed on protected API requests; there is
 * deliberately no DATABASE_URL/migration credential fallback. The pool opens
 * no connection until the membership lookup is reached after Clerk verification.
 */
export function createRuntimeTenantIdentityMiddleware(
  options: RuntimeTenantIdentityOptions = {},
) {
  const createPool = options.createPool ?? (() => createRuntimeTenantSqlPool());
  let pool: TenantSqlPool | undefined;

  return createTenantIdentityMiddleware({
    readAuth: options.readAuth,
    lookupMembership: (clerkUserId) => {
      pool ??= createPool();
      return findActiveTenantMembership(pool, clerkUserId);
    },
  });
}
