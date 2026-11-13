import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import express from 'express';
import test from 'node:test';
import { createFailClosedApiGate } from './apiGate';

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

test('production server mounts the API gate before every API handler and fallback', async () => {
  const [serverSource, integrationsSource] = await Promise.all([
    readFile(new URL('../../server.ts', import.meta.url), 'utf8'),
    readFile(new URL('./safetyRoutes.ts', import.meta.url), 'utf8'),
  ]);
  const gateMount = serverSource.indexOf("app.use('/api', createFailClosedApiGate())");
  assert.ok(gateMount >= 0, 'the server must mount the API gate');

  const routePattern = /app\.(get|post|put|patch|delete|all)\(\s*['"](\/api\/[^'"]+)['"]/g;
  const serverRoutes = [...serverSource.matchAll(routePattern)];
  assert.ok(serverRoutes.length > 0);
  for (const route of serverRoutes) {
    assert.ok(route.index! > gateMount, `API route ${route[2]} must be behind the gate`);
  }
  const integrationPaths = new Set([
    '/api/erp/connectors/:id/test',
    '/api/erp/connectors/:id/sync-inbound',
    '/api/erp/connectors/:id/push-award',
    '/api/ai/parse-document',
  ]);
  const expectedServerRoutes = businessRoutes
    .filter((route) => !route.path.startsWith('/api/erp/') && route.path !== '/api/ai/parse-document')
    .map((route) => `${route.method} ${route.path}`);
  expectedServerRoutes.push('GET /api/health');
  assert.deepEqual(
    serverRoutes.map((route) => `${route[1].toUpperCase()} ${route[2]}`).sort(),
    expectedServerRoutes.sort(),
    'server.ts API handlers must match the checked-in inventory',
  );

  const disabledMount = serverSource.indexOf('app.use(createDisabledIntegrationRouter())');
  assert.ok(disabledMount > gateMount, 'the integration router must also be behind the gate');
  const appFallback = serverSource.indexOf('app.use(vite.middlewares)');
  const staticFallback = serverSource.indexOf("app.use(express.static(path.resolve(__dirname, 'dist')))");
  assert.ok(appFallback > gateMount && staticFallback > gateMount, 'Vite and static fallbacks must follow the gate');

  const integrationRoutes = [...integrationsSource.matchAll(/router\.post\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(integrationRoutes.sort(), [...integrationPaths].sort(), 'disabled integration routes must match the inventory');
  assert.match(serverSource, /app\.get\('\/api\/health'/);
  assert.doesNotMatch(serverSource, /app\.(?:post|put|patch|delete)\('\/api\/health'/);
});

test('anonymous callers cannot reach any business API by route, method, or common path variant', async () => {
  const app = express();
  let handlerInvocations = 0;
  let dataMutations = 0;

  app.use('/api', createFailClosedApiGate());
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  for (const route of businessRoutes) {
    app.all(route.path, (req, res) => {
      handlerInvocations += 1;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) dataMutations += 1;
      return res.json({ success: true, secret: 'business-data', mutated: true });
    });
  }

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (const path of new Set(businessRoutes.map((route) => route.path))) {
      for (const method of commonMethods) {
        const response = await fetch(`${baseUrl}${path}`, { method });
        assert.equal(response.status, 503, `${method} ${path} must fail closed`);
        const text = await response.text();
        assert.doesNotMatch(text, /business-data|mutated/);
        if (method !== 'HEAD') {
          const body = JSON.parse(text);
          assert.equal(body.success, false);
          assert.match(body.error, /authentification et autorisations serveur non configurées/);
        }
      }
    }

    for (const path of ['/API/projects', '/api/%70rojects', '/api//projects', '/%61pi/projects', '/api%2Fprojects']) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.ok(response.status < 200 || response.status >= 300, `path variant ${path} must not expose business data`);
      const text = await response.text();
      assert.doesNotMatch(text, /business-data|mutated/);
    }

    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const healthWithQuery = await fetch(`${baseUrl}/api/health?probe=1`);
    assert.equal(healthWithQuery.status, 200);
    assert.deepEqual(await healthWithQuery.json(), { status: 'ok' });

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      const response = await fetch(`${baseUrl}/api/health`, { method });
      assert.equal(response.status, 503, `${method} /api/health must not be public`);
    }

    assert.equal(handlerInvocations, 0, 'no business handler may run anonymously');
    assert.equal(dataMutations, 0, 'no anonymous request may mutate business data');
  } finally {
    server.close();
    await once(server, 'close');
  }
});
