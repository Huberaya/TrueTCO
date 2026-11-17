import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import express from 'express';
import test from 'node:test';
import { createFailClosedApiGate } from './apiGate';
import { createClerkSessionMiddleware } from './clerkAuth';

const businessRoutes: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/api/tenants' },
  { method: 'GET', path: '/api/tenants/current' },
  { method: 'POST', path: '/api/tenants' },
  { method: 'POST', path: '/api/users/sync' },
  { method: 'POST', path: '/api/auth/sso/login' },
  { method: 'GET', path: '/api/auth/me' },
  { method: 'POST', path: '/api/auth/logout' },
  { method: 'GET', path: '/api/auth/users' },
  { method: 'GET', path: '/api/projects' },
  { method: 'POST', path: '/api/projects' },
  { method: 'POST', path: '/api/offers' },
  { method: 'POST', path: '/api/audit-logs' },
  { method: 'GET', path: '/api/audit-logs' },
  { method: 'GET', path: '/api/suppliers' },
  { method: 'POST', path: '/api/suppliers' },
  { method: 'GET', path: '/api/benchmarks' },
  { method: 'POST', path: '/api/benchmarks' },
  { method: 'POST', path: '/api/erp/connectors/probe/test' },
  { method: 'POST', path: '/api/erp/connectors/probe/sync-inbound' },
  { method: 'POST', path: '/api/erp/connectors/probe/push-award' },
  { method: 'POST', path: '/api/ai/parse-document' },
];

const commonMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const clerkTestEnv = {
  CLERK_SECRET_KEY: 'sk_test_only_for_injected_test_middleware',
  CLERK_PUBLISHABLE_KEY: 'pk_test_only_for_injected_test_middleware',
  CLERK_AUTHORIZED_PARTIES: 'https://app.example.invalid',
};

test('production server mounts Clerk, then the gate, then the only public handler and static fallback', async () => {
  const serverSource = await readFile(new URL('../../server.ts', import.meta.url), 'utf8');
  const clerkMount = serverSource.indexOf("app.use('/api', createClerkSessionMiddleware())");
  const gateMount = serverSource.indexOf("app.use('/api', createFailClosedApiGate())");
  const healthRoute = serverSource.indexOf("app.get('/api/health'");
  const appFallback = serverSource.indexOf('app.use(vite.middlewares)');
  const staticFallback = serverSource.indexOf('app.use(express.static');

  assert.ok(clerkMount >= 0 && gateMount > clerkMount, 'Clerk verification must precede the global gate');
  assert.ok(healthRoute > gateMount, 'health must be the sole explicit API handler after the gate');
  assert.ok(appFallback > gateMount && staticFallback > gateMount, 'SPA/static fallbacks must follow the API gate');

  const routePattern = /app\.(get|post|put|patch|delete|all)\(\s*['"](\/api\/[^'"]+)['"]/g;
  const routes = [...serverSource.matchAll(routePattern)].map((route) => `${route[1].toUpperCase()} ${route[2]}`);
  assert.deepEqual(routes, ['GET /api/health'], 'no historical business or session handler may remain registered');
  assert.doesNotMatch(serverSource, /resolveTenantId|getOrganizationId|x-tenant-id|x-organization-id|x-tenant-slug|user_sessions|clerkId|req\.query|req\.body/);
  assert.doesNotMatch(serverSource, /createDisabledIntegrationRouter|DATABASE_URL|neon\(/);
});

test('forged tenant, role, bearer and identity inputs cannot reach legacy handlers; Clerk runs before gate', async () => {
  const app = express();
  app.use(express.json());
  const middlewareOrder: string[] = [];
  const clerk = createClerkSessionMiddleware(clerkTestEnv, () => (_req, _res, next) => {
    middlewareOrder.push('clerk');
    next(); // even a valid Clerk session must not open an API route while authorization is incomplete
  });
  const gate = createFailClosedApiGate();
  app.use('/api', clerk);
  app.use('/api', (req, res, next) => {
    middlewareOrder.push('gate');
    return gate(req, res, next);
  });

  let historicalHandlerInvocations = 0;
  for (const route of businessRoutes) {
    app.all(route.path, (_req, res) => {
      historicalHandlerInvocations += 1;
      return res.json({ leaked: 'business-handler-ran', success: true });
    });
  }
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(express.static(new URL('../../public', import.meta.url).pathname));
  app.get('*', (_req, res) => res.send('static-shell-only'));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const adversarialRequests: Array<{ path: string; init: RequestInit }> = [
      { path: '/api/projects', init: { headers: { 'x-tenant-id': '00000000-0000-0000-0000-000000000099' } } },
      { path: '/api/projects', init: { headers: { 'x-organization-id': '00000000-0000-0000-0000-000000000099', 'x-tenant-slug': 'victim-org' } } },
      { path: '/api/projects?tenantId=00000000-0000-0000-0000-000000000099', init: {} },
      { path: '/api/projects', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: '00000000-0000-0000-0000-000000000099', tenantId: '00000000-0000-0000-0000-000000000099' }) } },
      { path: '/api/projects', init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-role': 'admin' }, body: JSON.stringify({ role: 'admin', organizationId: '00000000-0000-0000-0000-000000000099' }) } },
      { path: '/api/auth/me', init: { headers: { authorization: 'Bearer arbitrary-forged-token' } } },
      { path: '/api/users/sync', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clerkId: 'user_forged', email: 'attacker@example.invalid', role: 'admin', organizationId: '00000000-0000-0000-0000-000000000099' }) } },
      { path: '/api/auth/sso/login', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'attacker@example.invalid', role: 'admin', ssoProvider: 'fake' }) } },
      { path: '/api/auth/logout', init: { method: 'POST', headers: { authorization: 'Bearer arbitrary-forged-token', 'content-type': 'application/json' }, body: JSON.stringify({ token: 'arbitrary-forged-token' }) } },
      { path: '/api/auth/users', init: {} },
    ];

    for (const { path, init } of adversarialRequests) {
      const response = await fetch(`${baseUrl}${path}`, init);
      assert.equal(response.status, 503, `${init.method ?? 'GET'} ${path} must be closed`);
      assert.doesNotMatch(await response.text(), /business-handler-ran|attacker@example/);
    }

    assert.deepEqual(middlewareOrder.slice(0, 2), ['clerk', 'gate']);
    assert.equal(historicalHandlerInvocations, 0, 'handlers after the gate must not execute');

    for (const method of commonMethods) {
      const response = await fetch(`${baseUrl}/api/health`, { method });
      if (method === 'GET') {
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok' });
      } else {
        assert.equal(response.status, 503, `${method} /api/health must not be public`);
      }
    }

    for (const route of businessRoutes) {
      for (const method of commonMethods) {
        const response = await fetch(`${baseUrl}${route.path}`, { method });
        assert.equal(response.status, 503, `${method} ${route.path} must fail closed`);
        assert.doesNotMatch(await response.text(), /business-handler-ran/);
      }
    }

    for (const path of ['/API/projects', '/api/%70rojects', '/api//projects', '/%61pi/projects', '/api%2Fprojects', '/api/unknown']) {
      const response = await fetch(`${baseUrl}${path}`);
      const text = await response.text();
      assert.doesNotMatch(text, /business-handler-ran|business-data/);
      assert.notEqual(text, 'business-handler-ran');
    }

    assert.equal(historicalHandlerInvocations, 0, 'no historical handler may run for any adversarial request');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
