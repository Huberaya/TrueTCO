import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { AuthService } from '../services/authService';
import { NeonService } from '../services/neonService';
import { TenantService } from '../services/tenantService';

const source = (relative: string) => readFile(new URL(relative, import.meta.url), 'utf8');

test('historical tenant resolver, session lookup, user sync and fallback identities are absent from the server stack', async () => {
  const [server, application] = await Promise.all([source('../../server.ts'), source('./application.ts')]);
  assert.doesNotMatch(server + application, /resolveTenantId|getOrganizationId|x-tenant-id|x-organization-id|x-tenant-slug/);
  assert.doesNotMatch(server + application, /req\.(?:query|body|headers)\s*\.\s*(?:tenant|organization|user|role|clerk)/i);
  assert.doesNotMatch(server + application, /user_sessions|a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11|ORDER BY created_at/);
  assert.doesNotMatch(server, /tenantIdentityMiddleware/, 'candidate P1 tenant middleware must remain unconfigured in production');
  assert.doesNotMatch(application, /app\.(?:get|post|put|patch|delete|all)\('\/api\/(?!health)/);
  assert.match(application, /app\.get\('\/api\/health'/);
});

test('auth, tenant discovery and Clerk user sync compatibility methods cannot read, persist or send browser identity', async () => {
  const [authSource, tenantSource, neonSource, syncHook, appSource] = await Promise.all([
    source('../services/authService.ts'),
    source('../services/tenantService.ts'),
    source('../services/neonService.ts'),
    source('../hooks/useClerkNeonSync.ts'),
    source('../App.tsx'),
  ]);
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    throw new Error('unexpected network request');
  };

  try {
    assert.equal(AuthService.getToken(), null);
    assert.equal(AuthService.getCachedUser(), null);
    assert.equal(await AuthService.getCurrentUser(), null);
    assert.deepEqual(await AuthService.getEnterpriseDirectory(), []);
    await AuthService.logout();

    assert.equal(TenantService.getActiveTenantId(), null);
    TenantService.setActiveTenantId('00000000-0000-0000-0000-000000000099');
    assert.deepEqual(await TenantService.getTenants(), []);
    assert.equal(await TenantService.getCurrentTenant(), null);
    await assert.rejects(TenantService.createTenant({ name: 'forged' }), /Organisation indisponible/);

    assert.equal(await NeonService.saveProject({} as never), false);
    assert.equal(await NeonService.fetchProjects(), null);
    assert.equal(fetchCount, 0, 'identity and tenant APIs must not issue a browser request');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.doesNotMatch(authSource + tenantSource + neonSource + syncHook + appSource, /localStorage|sessionStorage|truetco_enterprise_sso_token|truetco_enterprise_sso_user|truetco_active_tenant_id|x-tenant-id|Authorization:/);
  assert.doesNotMatch(authSource, /loginWithSSO|SSOLoginResponse|SSOProvider|fetch\(/);
  assert.doesNotMatch(neonSource + syncHook, /syncClerkUser|clerkId|organizationId|tenantId|\/api\/users\/sync|useUser\(|setSyncedUser/);
  assert.doesNotMatch(appSource, /setActiveRole|user\?\.role|currentTenant\.id/);
});
