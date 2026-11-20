import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApplication } from './application';
import { createRuntimeTenantIdentityMiddleware } from './runtimeTenantIdentity';
import type { TenantSqlClient, TenantSqlPool } from '../db/tenantSql';

function listen(app: ReturnType<typeof createApplication>) {
  const server = app.listen(0, '127.0.0.1');
  return once(server, 'listening').then(() => {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    return { server, baseUrl: `http://127.0.0.1:${address.port}` };
  });
}

function membershipPool() {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  let releases = 0;
  const pool: TenantSqlPool = {
    async connect() {
      const client: TenantSqlClient = {
        async query<Row extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
          calls.push({ sql: sql.trim(), values });
          if (sql.includes('SELECT id AS user_id, organization_id, clerk_id, role, is_active')) {
            return {
              rows: [{
                user_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
                organization_id: '550e8400-e29b-41d4-a716-446655440000',
                clerk_id: 'clerk-user-runtime-test',
                role: 'acheteur',
                is_active: true,
              }] as unknown as Row[],
            };
          }
          return { rows: [] as Row[] };
        },
        release() { releases += 1; },
      };
      return client;
    },
  };
  return { pool, calls, get releases() { return releases; } };
}

test('runtime tenant identity lazily resolves the verified subject, skips health, then keeps business APIs gated', async () => {
  const fake = membershipPool();
  let poolFactoryCalls = 0;
  const tenant = createRuntimeTenantIdentityMiddleware({
    createPool: () => { poolFactoryCalls += 1; return fake.pool; },
    readAuth: () => ({ isAuthenticated: true, userId: 'clerk-user-runtime-test' }),
  });
  const app = createApplication({
    clerkMiddleware: (_request, _response, next) => next(),
    tenantIdentityMiddleware: tenant,
  });
  const { server, baseUrl } = await listen(app);
  try {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.equal(poolFactoryCalls, 0, 'health must not initialize a database pool or resolve identity');

    const projects = await fetch(`${baseUrl}/api/projects`);
    assert.equal(projects.status, 503, 'successful identity resolution must not bypass the business API gate');
    assert.equal(poolFactoryCalls, 1, 'pool is created lazily and reused');
    assert.equal(fake.releases, 1);
    assert.deepEqual(fake.calls.map(({ sql }) => sql), [
      'BEGIN',
      "SELECT set_config('true_tco.clerk_user_id', $1, true)",
      'SELECT id AS user_id, organization_id, clerk_id, role, is_active\n       FROM users\n       WHERE clerk_id = $1\n       ORDER BY id\n       LIMIT 2',
      'COMMIT',
    ]);
    assert.deepEqual(fake.calls[1].values, ['clerk-user-runtime-test']);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('missing runtime URL fails closed after identity and does not fall back to DATABASE_URL', async () => {
  const tenant = createRuntimeTenantIdentityMiddleware({
    createPool: () => {
      // Mirrors the production factory: a migration URL alone is never accepted.
      throw new Error('DATABASE_URL_RUNTIME is required for the runtime database pool.');
    },
    readAuth: () => ({ isAuthenticated: true, userId: 'clerk-user-runtime-test' }),
  });
  const app = createApplication({
    clerkMiddleware: (_request, _response, next) => next(),
    tenantIdentityMiddleware: tenant,
  });
  const { server, baseUrl } = await listen(app);
  try {
    const response = await fetch(`${baseUrl}/api/projects`);
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /contrôle d’accès est temporairement indisponible/);
    assert.doesNotMatch(body, /DATABASE_URL|postgresql:|secret|truetco_app/);
  } finally {
    server.close();
    await once(server, 'close');
  }
});
