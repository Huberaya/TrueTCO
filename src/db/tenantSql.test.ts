import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findActiveTenantMembership,
  inTenantSqlTransaction,
  withTenantSqlTransaction,
  type TenantSqlClient,
  type TenantSqlPool,
} from './tenantSql';
import type { TenantPrincipal } from '../server/tenantIdentity';

type Reply = { rows: Record<string, unknown>[] };
function fakePool(replies: Reply[] = []) {
  const calls: Array<{ sql: string; values: readonly unknown[] }> = [];
  let releases = 0;
  const client: TenantSqlClient = {
    async query<Row extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
      calls.push({ sql, values });
      return (replies.shift() ?? { rows: [] }) as { rows: Row[] };
    },
    release() { releases += 1; },
  };
  const pool: TenantSqlPool = { async connect() { return client; } };
  return { pool, calls, get releases() { return releases; } };
}

const membershipRow = {
  user_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  organization_id: '550e8400-e29b-41d4-a716-446655440000',
  clerk_id: 'user_clerk_a',
  role: 'acheteur',
  is_active: true,
};
const principal: TenantPrincipal = Object.freeze({
  clerkUserId: membershipRow.clerk_id,
  userId: membershipRow.user_id,
  organizationId: membershipRow.organization_id,
  role: 'acheteur',
});

test('membership lookup uses only the verified Clerk subject and rejects zero, multiple or invalid rows', async () => {
  const valid = fakePool([{ rows: [] }, { rows: [] }, { rows: [membershipRow] }]);
  const result = await findActiveTenantMembership(valid.pool, 'user_clerk_a');
  assert.deepEqual(result, principal);
  assert.match(valid.calls[1].sql, /set_config\('true_tco\.clerk_user_id', \$1, true\)/);
  assert.deepEqual(valid.calls[1].values, ['user_clerk_a']);
  assert.match(valid.calls[2].sql, /WHERE clerk_id = \$1[\s\S]*LIMIT 2/);
  assert.deepEqual(valid.calls[2].values, ['user_clerk_a']);
  assert.deepEqual(valid.calls.map((call) => call.sql.trim()), ['BEGIN', valid.calls[1].sql, valid.calls[2].sql, 'COMMIT']);
  assert.equal(valid.releases, 1);

  for (const rows of [[], [membershipRow, membershipRow], [{ ...membershipRow, is_active: false }], [{ ...membershipRow, organization_id: 'not-a-uuid' }]]) {
    const fake = fakePool([{ rows: [] }, { rows: [] }, { rows }]);
    assert.equal(await findActiveTenantMembership(fake.pool, 'user_clerk_a'), null);
    assert.equal(fake.releases, 1);
  }
  const blank = fakePool();
  assert.equal(await findActiveTenantMembership(blank.pool, '   '), null);
  assert.equal(blank.calls.length, 0);
});

test('tenant transactions set server-derived context, revalidate membership and always release', async () => {
  const fake = fakePool([{ rows: [] }, { rows: [] }, { rows: [{ id: principal.userId }] }, { rows: [{ answer: 42 }] }]);
  const result = await withTenantSqlTransaction(fake.pool, principal, async (client) => {
    const query = await client.query<{ answer: number }>('SELECT 42 AS answer');
    return query.rows[0].answer;
  });
  assert.equal(result, 42);
  assert.deepEqual(fake.calls.map((call) => call.sql.trim()), [
    'BEGIN',
    "SELECT\n         set_config('true_tco.organization_id', $1, true),\n         set_config('true_tco.user_id', $2, true),\n         set_config('true_tco.clerk_user_id', $3, true)",
    'SELECT id FROM users\n       WHERE id = $1 AND organization_id = $2 AND clerk_id = $3 AND is_active = TRUE\n       LIMIT 1',
    'SELECT 42 AS answer',
    'COMMIT',
  ]);
  assert.deepEqual(fake.calls[1].values, [principal.organizationId, principal.userId, principal.clerkUserId]);
  assert.deepEqual(fake.calls[2].values, [principal.userId, principal.organizationId, principal.clerkUserId]);
  assert.equal(fake.releases, 1);

  const revoked = fakePool([{ rows: [] }, { rows: [] }, { rows: [] }]);
  await assert.rejects(withTenantSqlTransaction(revoked.pool, principal, async () => 'must not run'), /no longer active/);
  assert.equal(revoked.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(revoked.releases, 1);

  const operationFailure = fakePool([{ rows: [] }, { rows: [] }, { rows: [{ id: principal.userId }] }]);
  await assert.rejects(withTenantSqlTransaction(operationFailure.pool, principal, async () => { throw new Error('operation failed'); }), /operation failed/);
  assert.equal(operationFailure.calls.at(-1)?.sql, 'ROLLBACK');
  assert.equal(operationFailure.releases, 1);
});

test('concurrent tenant operations retain request-local context on separate checked-out clients', async () => {
  const events: Array<{ client: number; sql: string; values: readonly unknown[] }> = [];
  let nextClient = 0;
  const pool: TenantSqlPool = {
    async connect() {
      const clientId = ++nextClient;
      let organizationScope = '';
      return {
        async query<Row extends Record<string, unknown>>(sql: string, values: readonly unknown[] = []) {
          events.push({ client: clientId, sql: sql.trim(), values });
          if (sql.includes("set_config('true_tco.organization_id'")) organizationScope = String(values[0]);
          if (sql.includes('SELECT id FROM users')) return { rows: [{ id: principal.userId }] as unknown as Row[] };
          if (sql.includes('SELECT current_setting')) {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { rows: [{ organization_id: organizationScope }] as unknown as Row[] };
          }
          return { rows: [] as Row[] };
        },
        release() { events.push({ client: clientId, sql: 'RELEASE', values: [] }); },
      };
    },
  };
  const tenantB: TenantPrincipal = Object.freeze({ ...principal, clerkUserId: 'user_clerk_b', organizationId: '8c45c3f5-7652-4be6-b1cf-50758dce6e9c' });
  const [resultA, resultB] = await Promise.all([
    withTenantSqlTransaction(pool, principal, async (client) => (await client.query<{ organization_id: string }>('SELECT current_setting(tenant)')).rows[0].organization_id),
    withTenantSqlTransaction(pool, tenantB, async (client) => (await client.query<{ organization_id: string }>('SELECT current_setting(tenant)')).rows[0].organization_id),
  ]);
  assert.equal(resultA, principal.organizationId);
  assert.equal(resultB, tenantB.organizationId);
  assert.deepEqual([...new Set(events.map((event) => event.client))].sort(), [1, 2]);
  for (const clientId of [1, 2]) {
    const clientEvents = events.filter((event) => event.client === clientId);
    assert.equal(clientEvents[0].sql, 'BEGIN');
    assert.ok(clientEvents.some((event) => event.sql === 'COMMIT'));
    assert.equal(clientEvents.at(-1)?.sql, 'RELEASE');
  }
});

test('transaction wrapper rolls back failed work and releases the connection exactly once', async () => {
  const fake = fakePool();
  await assert.rejects(inTenantSqlTransaction(fake.pool, async () => { throw new Error('db work failed'); }), /db work failed/);
  assert.deepEqual(fake.calls.map((call) => call.sql), ['BEGIN', 'ROLLBACK']);
  assert.equal(fake.releases, 1);
});
