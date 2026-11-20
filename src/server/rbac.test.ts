import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSIONS, ROLE_PERMISSIONS, requireTenantPermission, roleCan } from './rbac';
import type { UserRole } from '../types/domain';

const roles: UserRole[] = [
  'admin', 'directeur_achats', 'acheteur', 'finance_controleur', 'rse_esg', 'direction_generale',
];

test('candidate RBAC matrix is complete, explicit, immutable and least-privilege by role', () => {
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [...roles].sort());
  assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
  for (const role of roles) {
    assert.ok(Array.isArray(ROLE_PERMISSIONS[role]));
    assert.equal(new Set(ROLE_PERMISSIONS[role]).size, ROLE_PERMISSIONS[role].length);
    for (const permission of ROLE_PERMISSIONS[role]) assert.ok(PERMISSIONS.includes(permission));
  }

  assert.equal(roleCan('admin', 'users:read'), true);
  assert.equal(roleCan('admin', 'audit_logs:read'), true);
  assert.equal(roleCan('directeur_achats', 'offers:create'), false);
  assert.equal(roleCan('acheteur', 'offers:create'), true);
  assert.equal(roleCan('finance_controleur', 'cost_items:update'), true);
  assert.equal(roleCan('finance_controleur', 'cost_items:create'), false);
  assert.equal(roleCan('rse_esg', 'carbon_items:update'), true);
  assert.equal(roleCan('rse_esg', 'offers:update'), false);
  assert.equal(roleCan('direction_generale', 'projects:read'), true);
  assert.equal(roleCan('direction_generale', 'projects:update'), false);
});

test('permission middleware fails closed without a tenant principal and enforces its permission', () => {
  const invoke = (principal: unknown, permission: Parameters<typeof requireTenantPermission>[0]) => {
    const response = {
      locals: principal === undefined ? {} : { tenantPrincipal: principal },
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(body: unknown) { this.body = body; return this; },
    };
    let nextCalls = 0;
    requireTenantPermission(permission)({} as never, response as never, () => { nextCalls += 1; });
    return { response, nextCalls };
  };
  const missing = invoke(undefined, 'projects:read');
  assert.equal(missing.response.statusCode, 401);
  assert.equal(missing.nextCalls, 0);

  const acheteur = {
    clerkUserId: 'user_clerk_a',
    userId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    organizationId: '550e8400-e29b-41d4-a716-446655440000',
    role: 'acheteur',
  };
  const allowed = invoke(acheteur, 'offers:create');
  assert.equal(allowed.response.statusCode, 200);
  assert.equal(allowed.nextCalls, 1);
  const denied = invoke(acheteur, 'users:read');
  assert.equal(denied.response.statusCode, 403);
  assert.equal(denied.nextCalls, 0);
});
