import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeTenantSqlPool } from './runtimeTenantPool';

const validUrl = 'postgresql://truetco_app:secret@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require';

test('runtime pool requires its dedicated connection variable and never falls back to migration URL', () => {
  assert.throws(
    () => createRuntimeTenantSqlPool({ DATABASE_URL: validUrl }),
    /DATABASE_URL_RUNTIME is required/,
  );
});

test('runtime pool rejects owner, non-Neon, wrong database and non-TLS URLs', () => {
  for (const url of [
    validUrl.replace('truetco_app', 'neondb_owner'),
    validUrl.replace('ep-example-pooler.eu-central-1.aws.neon.tech', 'db.example.com'),
    validUrl.replace('/neondb?', '/postgres?'),
    validUrl.replace('?sslmode=require', ''),
    'not-a-url',
  ]) {
    assert.throws(
      () => createRuntimeTenantSqlPool({ DATABASE_URL_RUNTIME: url }),
      /DATABASE_URL_RUNTIME/,
    );
  }
});

test('runtime pool accepts only the dedicated Neon truetco_app URL without opening a connection', () => {
  const pool = createRuntimeTenantSqlPool({ DATABASE_URL_RUNTIME: validUrl });
  assert.equal(typeof pool.connect, 'function');
});
