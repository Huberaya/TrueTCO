import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import test from 'node:test';
import { createClerkSessionMiddleware, getClerkServerConfig } from './clerkAuth';

test('Clerk server config requires private secret, publishable key and exact authorized parties', () => {
  assert.deepEqual(
    getClerkServerConfig({}).configured,
    false,
  );

  const valid = getClerkServerConfig({
    CLERK_SECRET_KEY: 'sk_test_server_secret_not_real',
    CLERK_PUBLISHABLE_KEY: 'pk_test_frontend_key_not_real',
    CLERK_AUTHORIZED_PARTIES: 'https://app.example.invalid, http://localhost:3000',
  });
  assert.equal(valid.configured, true);
  if (!valid.configured) return;
  assert.deepEqual(valid.config.authorizedParties, ['https://app.example.invalid', 'http://localhost:3000']);
  assert.equal(valid.config.secretKey, 'sk_test_server_secret_not_real');

  for (const parties of [
    'https://app.example.invalid/path',
    'https://*.example.invalid',
    'http://app.example.invalid',
    'not-a-url',
  ]) {
    const result = getClerkServerConfig({
      CLERK_SECRET_KEY: 'sk_test_server_secret_not_real',
      CLERK_PUBLISHABLE_KEY: 'pk_test_frontend_key_not_real',
      CLERK_AUTHORIZED_PARTIES: parties,
    });
    assert.equal(result.configured, false, `${parties} must not be accepted`);
    if (!result.configured) assert.ok(result.missing.includes('CLERK_AUTHORIZED_PARTIES'));
  }

  const publicKeyAsSecret = getClerkServerConfig({
    CLERK_SECRET_KEY: 'pk_test_not_a_secret',
    VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_frontend_key_not_real',
    CLERK_AUTHORIZED_PARTIES: 'https://app.example.invalid',
  });
  assert.equal(publicKeyAsSecret.configured, false);
});

test('Clerk configuration failure is fail-closed while liveness remains public', async () => {
  const app = express();
  let businessHandlerCalled = false;
  app.use('/api', createClerkSessionMiddleware({}));
  app.use('/api', (_req, res, next) => {
    if (_req.path === '/health') return next();
    businessHandlerCalled = true;
    return res.json({ secret: 'must-not-be-reached' });
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/projects', (_req, res) => res.json({ secret: 'must-not-be-reached' }));

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const health = await fetch(`${baseUrl}/api/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const projects = await fetch(`${baseUrl}/api/projects`);
    assert.equal(projects.status, 503);
    const body = await projects.json();
    assert.equal(body.success, false);
    assert.match(body.error, /configuration Clerk serveur incomplète/);
    assert.doesNotMatch(JSON.stringify(body), /CLERK_SECRET_KEY|sk_test|secret/i);
    assert.equal(businessHandlerCalled, false);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

test('production server verifies Clerk before, but never instead of, the global API gate', async () => {
  const { readFile } = await import('node:fs/promises');
  const serverSource = await readFile(new URL('../../server.ts', import.meta.url), 'utf8');
  const clerkMount = serverSource.indexOf("app.use('/api', createClerkSessionMiddleware())");
  const gateMount = serverSource.indexOf("app.use('/api', createFailClosedApiGate())");
  assert.ok(clerkMount >= 0 && gateMount > clerkMount);
  assert.match(serverSource, /createClerkSessionMiddleware\(\)/);
  assert.match(serverSource, /createFailClosedApiGate\(\)/);
});
