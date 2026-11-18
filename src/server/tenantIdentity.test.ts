import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import test from 'node:test';
import {
  createTenantIdentityMiddleware,
  getTenantPrincipal,
  TENANT_AUTH_ERRORS,
  type TenantPrincipal,
} from './tenantIdentity';

const principal: TenantPrincipal = Object.freeze({
  clerkUserId: 'user_clerk_a',
  userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  organizationId: '550e8400-e29b-41d4-a716-446655440000',
  role: 'acheteur',
});

async function runMiddleware(options: Parameters<typeof createTenantIdentityMiddleware>[0], locals: Record<string, unknown> = {}) {
  const middleware = createTenantIdentityMiddleware(options) as unknown as (
    request: Request,
    response: Response,
    next: (error?: unknown) => void,
  ) => Promise<void>;
  const response = {
    locals,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  let nextCalls = 0;
  await middleware({} as Request, response as unknown as Response, () => { nextCalls += 1; });
  return { response, nextCalls };
}

test('tenant identity accepts only a verified Clerk subject with one matching local membership', async () => {
  const lookups: string[] = [];
  const result = await runMiddleware({
    readAuth: () => ({ isAuthenticated: true, userId: principal.clerkUserId }),
    lookupMembership: async (clerkUserId) => { lookups.push(clerkUserId); return principal; },
  });
  assert.deepEqual(lookups, [principal.clerkUserId]);
  assert.equal(result.nextCalls, 1);
  assert.equal(getTenantPrincipal(result.response), principal);
});

test('unauthenticated, missing/ambiguous membership and database failure fail closed', async () => {
  for (const readAuth of [
    () => ({ isAuthenticated: false, userId: null }),
    () => ({ isAuthenticated: true, userId: null }),
    () => { throw new Error('Clerk middleware was not run'); },
  ]) {
    let lookupCount = 0;
    const result = await runMiddleware({ readAuth, lookupMembership: async () => { lookupCount += 1; return principal; } });
    assert.equal(result.response.statusCode, 401);
    assert.equal(result.nextCalls, 0);
    assert.equal(lookupCount, 0);
  }

  const missing = await runMiddleware({
    readAuth: () => ({ isAuthenticated: true, userId: principal.clerkUserId }),
    lookupMembership: async () => null,
  });
  assert.equal(missing.response.statusCode, 403);
  assert.deepEqual(missing.response.body, { success: false, error: TENANT_AUTH_ERRORS.membership });
  assert.equal(missing.nextCalls, 0);

  const mismatchedSubject = await runMiddleware({
    readAuth: () => ({ isAuthenticated: true, userId: principal.clerkUserId }),
    lookupMembership: async () => ({ ...principal, clerkUserId: 'user_clerk_b' }),
  });
  assert.equal(mismatchedSubject.response.statusCode, 403);

  const unavailable = await runMiddleware({
    readAuth: () => ({ isAuthenticated: true, userId: principal.clerkUserId }),
    lookupMembership: async () => { throw new Error('database offline'); },
  });
  assert.equal(unavailable.response.statusCode, 503);
  assert.deepEqual(unavailable.response.body, { success: false, error: TENANT_AUTH_ERRORS.unavailable });
  assert.equal(unavailable.nextCalls, 0);
});

test('client-supplied organization, role and user fields are ignored; malformed locals are not principals', async () => {
  let lookupSubject = '';
  const forgedLocals = {
    tenantPrincipal: { organizationId: 'client-org', role: 'admin', userId: 'client-user' },
  };
  const result = await runMiddleware({
    readAuth: () => ({ isAuthenticated: true, userId: principal.clerkUserId }),
    lookupMembership: async (subject) => { lookupSubject = subject; return principal; },
  }, forgedLocals);
  assert.equal(lookupSubject, principal.clerkUserId);
  assert.equal(getTenantPrincipal(result.response), principal);
  assert.equal(getTenantPrincipal({ locals: { tenantPrincipal: { ...principal, role: 'root' } } }), null);
});
