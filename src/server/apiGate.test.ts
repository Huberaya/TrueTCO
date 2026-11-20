import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import express, { type RequestHandler } from 'express';
import test from 'node:test';
import { createApplication } from './application';
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
  { method: 'POST', path: '/api/auth/role' },
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
  CLERK_JWT_AUDIENCE: 'truetco-api',
};

test('production app factory is mounted before every Vite/static fallback and registers only health', async () => {
  const applicationSource = await readFile(new URL('./application.ts', import.meta.url), 'utf8');
  const serverSource = await readFile(new URL('../../server.ts', import.meta.url), 'utf8');
  const clerkMount = applicationSource.indexOf("app.use('/api', clerk)");
  const tenantMount = applicationSource.indexOf("app.use('/api', options.tenantIdentityMiddleware)");
  const gateMount = applicationSource.indexOf("app.use('/api', gate)");
  const healthRoute = applicationSource.indexOf("app.get('/api/health'");
  const appFactory = serverSource.indexOf('const app = createApplication({');
  const viteFallback = serverSource.indexOf('app.use(vite.middlewares)');
  const staticFallback = serverSource.indexOf('app.use(express.static');

  assert.ok(clerkMount >= 0 && tenantMount > clerkMount && gateMount > tenantMount, 'Clerk verification must precede candidate tenant identity, which must precede the global gate');
  assert.ok(healthRoute > gateMount, 'health must be the only explicit API handler after the gate');
  assert.ok(appFactory >= 0 && viteFallback > appFactory && staticFallback > appFactory, 'Vite/static fallbacks must be mounted after the shared API stack');
  assert.match(serverSource, /tenantIdentityMiddleware:\s*createRuntimeTenantIdentityMiddleware\(\)/, 'production wiring may resolve identity but must retain the gate');

  const routePattern = /app\.(get|post|put|patch|delete|all)\(\s*['"](\/api\/[^'"]+)['"]/g;
  const routes = [...applicationSource.matchAll(routePattern)].map((route) => `${route[1].toUpperCase()} ${route[2]}`);
  assert.deepEqual(routes, ['GET /api/health'], 'no business or session handler may be registered in the production app factory');
  assert.doesNotMatch(serverSource, /app\.(?:get|post|put|patch|delete|all)\(\s*['"]\/api\//, 'the server entry point must not add API routes after the gate');
});

test('optional tenant middleware runs after Clerk and before the unchanged fail-closed gate', async () => {
  const order: string[] = [];
  const app = createApplication({
    clerkMiddleware: (_req, _res, next) => { order.push('clerk'); next(); },
    tenantIdentityMiddleware: (_req, _res, next) => { order.push('tenant'); next(); },
    apiGate: (req, res, next) => { order.push('gate'); return createFailClosedApiGate()(req, res, next); },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/projects`);
    assert.equal(response.status, 503);
    assert.deepEqual(order, ['clerk', 'tenant', 'gate']);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('non-canonical API paths also pass through Clerk, tenant identity and the fail-closed gate', async () => {
  const order: string[] = [];
  const app = createApplication({
    clerkMiddleware: (_req, _res, next) => { order.push('clerk'); next(); },
    tenantIdentityMiddleware: (_req, _res, next) => { order.push('tenant'); next(); },
    apiGate: (req, res, next) => { order.push('gate'); return createFailClosedApiGate()(req, res, next); },
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/%61pi/projects`);
    assert.equal(response.status, 503);
    assert.deepEqual(order, ['clerk', 'tenant', 'gate']);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('actual production app stack runs Clerk then the gate and blocks forged identities before legacy handlers and fallback', async () => {
  const middlewareOrder: Array<{ stage: string; path: string; method: string }> = [];
  const clerk = createClerkSessionMiddleware(clerkTestEnv, () => (req, _res, next) => {
    middlewareOrder.push({ stage: 'clerk', path: req.originalUrl, method: req.method });
    next(); // even a verified Clerk session cannot open routes before authorization is implemented
  });
  const realGate = createFailClosedApiGate();
  const gate: RequestHandler = (req, res, next) => {
    middlewareOrder.push({ stage: 'gate', path: req.originalUrl, method: req.method });
    return realGate(req, res, next);
  };

  let historicalHandlerInvocations = 0;
  let staticFallbackInvocations = 0;
  const postGateRouter = express.Router();
  for (const route of businessRoutes) {
    postGateRouter.all(route.path, (_req, res) => {
      historicalHandlerInvocations += 1;
      return res.json({ leaked: 'business-handler-ran', success: true });
    });
  }
  postGateRouter.use((_req, res) => {
    staticFallbackInvocations += 1;
    return res.status(200).send('static-shell-only');
  });

  const app = createApplication({
    clerkMiddleware: clerk,
    apiGate: gate,
    afterApiMiddleware: postGateRouter,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const forged: Array<{ path: string; init: RequestInit }> = [
      { path: '/api/projects', init: { headers: { 'x-tenant-id': 'tenant-victim' } } },
      { path: '/api/projects', init: { headers: { 'x-organization-id': 'org-victim', 'x-tenant-slug': 'victim-org' } } },
      { path: '/api/projects?tenantId=tenant-victim&organizationId=org-victim', init: {} },
      { path: '/api/projects', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId: 'org-victim', tenantId: 'tenant-victim' }) } },
      { path: '/api/projects', init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-role': 'admin' }, body: JSON.stringify({ role: 'admin', organizationId: 'org-victim' }) } },
      { path: '/api/auth/me', init: { headers: { authorization: 'Bearer arbitrary-forged-token' } } },
      { path: '/api/users/sync', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clerkId: 'user_forged', email: 'attacker@example.invalid', role: 'admin', organizationId: 'org-victim' }) } },
      { path: '/api/auth/sso/login', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'attacker@example.invalid', role: 'admin', ssoProvider: 'fake' }) } },
      { path: '/api/auth/role', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'admin' }) } },
      { path: '/api/auth/logout', init: { method: 'POST', headers: { authorization: 'Bearer arbitrary-forged-token', 'content-type': 'application/json' }, body: JSON.stringify({ token: 'arbitrary-forged-token' }) } },
      { path: '/api/auth/users', init: {} },
      { path: '/api/tenants/org-victim/projects', init: {} },
    ];

    for (const { path, init } of forged) {
      const response = await fetch(`${baseUrl}${path}`, init);
      assert.equal(response.status, 503, `${init.method ?? 'GET'} ${path} must be closed`);
      assert.doesNotMatch(await response.text(), /business-handler-ran|attacker@example/);
    }

    for (const method of commonMethods) {
      const response = await fetch(`${baseUrl}/api/health`, { method });
      if (method === 'GET') {
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ok' });
      } else {
        assert.equal(response.status, 503, `${method} /api/health must not be public`);
      }
    }

    const spoofedHealth = await fetch(`${baseUrl}/api/health?tenantId=victim`, {
      headers: { authorization: 'Bearer arbitrary-forged-token', 'x-role': 'admin', 'x-tenant-id': 'tenant-victim' },
    });
    assert.equal(spoofedHealth.status, 200);
    assert.deepEqual(await spoofedHealth.json(), { status: 'ok' });

    for (const route of businessRoutes) {
      for (const method of commonMethods) {
        const response = await fetch(`${baseUrl}${route.path}`, { method });
        assert.equal(response.status, 503, `${method} ${route.path} must fail closed`);
        assert.doesNotMatch(await response.text(), /business-handler-ran/);
      }
    }

    const nonCanonicalApiPaths = [
      '/API/projects',
      '/%61pi/projects',
      '/api%2Fprojects',
      '/api%252Fprojects',
      '/api\\projects',
      '/api/%70rojects',
      '/api/%68ealth',
    ];
    for (const path of nonCanonicalApiPaths) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 503, `non-canonical API path ${path} must fail closed`);
      assert.doesNotMatch(await response.text(), /business-handler-ran|static-shell-only/);
    }

    const unknownApi = await fetch(`${baseUrl}/api/unknown`);
    assert.equal(unknownApi.status, 503);
    assert.equal(await unknownApi.json().then((body) => body.success), false);

    const ordinaryPage = await fetch(`${baseUrl}/dashboard`);
    assert.equal(ordinaryPage.status, 200);
    assert.equal(await ordinaryPage.text(), 'static-shell-only');
    assert.equal(staticFallbackInvocations, 1, 'static fallback should only run for a non-API request');
    assert.equal(historicalHandlerInvocations, 0, 'no legacy handler may run for any forged or variant API request');
    const protectedApiEvents = middlewareOrder.filter(
      (event) => !(event.stage === 'gate' && event.method === 'GET' && event.path.split('?', 1)[0] === '/api/health'),
    );
    assert.equal(protectedApiEvents.length % 2, 0);
    for (let index = 0; index < protectedApiEvents.length; index += 2) {
      const pair = protectedApiEvents.slice(index, index + 2);
      assert.deepEqual(pair.map((event) => event.stage), ['clerk', 'gate'], `each non-health API request must pass Clerk before the gate (events: ${JSON.stringify(protectedApiEvents)})`);
      assert.equal(pair[0].path, pair[1].path, 'Clerk and gate must evaluate the same raw URL');
      assert.equal(pair[0].method, pair[1].method, 'Clerk and gate must evaluate the same HTTP method');
    }
  } finally {
    server.close();
    await once(server, 'close');
  }
});
