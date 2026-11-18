import { Pool } from '@neondatabase/serverless';
import type { TenantPrincipal } from '../server/tenantIdentity';

export interface TenantSqlResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
}

export interface TenantSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<TenantSqlResult<Row>>;
  release(): void | Promise<void>;
}

export interface TenantSqlPool {
  connect(): Promise<TenantSqlClient>;
}

/**
 * Explicit adapter only. It does not read process.env or connect until a caller
 * invokes connect(); production wiring is intentionally not enabled by P1.
 */
export const createNeonTenantSqlPool = (connectionString: string): TenantSqlPool => {
  const pool = new Pool({ connectionString });
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends Record<string, unknown> = Record<string, unknown>>(
          text: string,
          values: readonly unknown[] = [],
        ): Promise<TenantSqlResult<Row>> {
          const result = await client.query(text, [...values] as never);
          return { rows: result.rows as Row[] };
        },
        release: () => client.release(),
      };
    },
  };
};

export async function inTenantSqlTransaction<T>(
  pool: TenantSqlPool,
  operation: (client: TenantSqlClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    const result = await operation(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original error; release the connection below.
      }
    }
    throw error;
  } finally {
    await client.release();
  }
}

/**
 * Resolve only an already-provisioned, active local membership for a Clerk
 * subject. The GUC is transaction-local and is used solely by the narrow users
 * SELECT policy that exposes the matching clerk_id row before tenant resolution.
 */
export async function findActiveTenantMembership(
  pool: TenantSqlPool,
  clerkUserId: string,
): Promise<TenantPrincipal | null> {
  if (!clerkUserId.trim()) return null;

  return inTenantSqlTransaction(pool, async (client) => {
    await client.query(
      "SELECT set_config('true_tco.clerk_user_id', $1, true)",
      [clerkUserId],
    );
    const result = await client.query<{
      user_id: string;
      organization_id: string;
      clerk_id: string | null;
      role: string;
      is_active: boolean;
    }>(
      `SELECT id AS user_id, organization_id, clerk_id, role, is_active
       FROM users
       WHERE clerk_id = $1
       ORDER BY id
       LIMIT 2`,
      [clerkUserId],
    );

    if (result.rows.length !== 1) return null;
    const membership = result.rows[0];
    if (
      membership.is_active !== true ||
      membership.clerk_id !== clerkUserId ||
      !isUuid(membership.user_id) ||
      !isUuid(membership.organization_id) ||
      !isUserRole(membership.role)
    ) {
      return null;
    }

    return createTenantPrincipal({
      clerkUserId,
      userId: membership.user_id,
      organizationId: membership.organization_id,
      role: membership.role,
    });
  });
}

/** Start every data transaction with server-derived, transaction-local RLS context. */
export async function withTenantSqlTransaction<T>(
  pool: TenantSqlPool,
  principal: TenantPrincipal,
  operation: (client: TenantSqlClient) => Promise<T>,
): Promise<T> {
  return inTenantSqlTransaction(pool, async (client) => {
    await client.query(
      `SELECT
         set_config('true_tco.organization_id', $1, true),
         set_config('true_tco.user_id', $2, true),
         set_config('true_tco.clerk_user_id', $3, true)`,
      [principal.organizationId, principal.userId, principal.clerkUserId],
    );
    const membership = await client.query<{ id: string }>(
      `SELECT id FROM users
       WHERE id = $1 AND organization_id = $2 AND clerk_id = $3 AND is_active = TRUE
       LIMIT 1`,
      [principal.userId, principal.organizationId, principal.clerkUserId],
    );
    if (membership.rows.length !== 1) throw new Error('Tenant membership is no longer active.');
    return operation(client);
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_ROLES = new Set([
  'admin',
  'directeur_achats',
  'acheteur',
  'finance_controleur',
  'rse_esg',
  'direction_generale',
]);

const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
const isUserRole = (value: string): value is TenantPrincipal['role'] => USER_ROLES.has(value);

// Module-private constructor: principals are created only after the membership
// row has been verified against the Clerk subject and validated from the DB.
function createTenantPrincipal(input: {
  clerkUserId: string;
  userId: string;
  organizationId: string;
  role: TenantPrincipal['role'];
}): TenantPrincipal {
  return Object.freeze({ ...input });
}
