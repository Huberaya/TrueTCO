import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { verifyToken } from '@clerk/express';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwtKey = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const authorizedParties = ['https://truetco.test.invalid'];
const audience = 'truetco-api';
const issuer = 'https://local-test.clerk.accounts.dev';
const SESSION_TOKEN_CATEGORY = 'cl_B7d4PD111AAA';

function signSessionToken(claimOverrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'local-generated-p1-key', cat: SESSION_TOKEN_CATEGORY });
  const payload = encode({
    sub: 'user_local_generated_only',
    iss: issuer,
    azp: authorizedParties[0],
    aud: audience,
    iat: now,
    nbf: now - 1,
    exp: now + 60,
    ...claimOverrides,
  });
  const signed = `${header}.${payload}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), privateKey).toString('base64url')}`;
}

const verify = (token: string) => verifyToken(token, { jwtKey, authorizedParties, audience, issuer });

test('official Clerk verifier accepts the local test-signed session token only for the pinned audience and party', async () => {
  const result = await verify(signSessionToken());
  assert.equal('errors' in result, false);
  assert.equal('sub' in result ? result.sub : undefined, 'user_local_generated_only');
});

test('official Clerk verifier rejects malformed, expired, wrong-issuer, wrong-audience and unauthorized-party tokens', async () => {
  const isRejected = async (token: string): Promise<boolean> => {
    try {
      const result = await verify(token);
      return 'errors' in result && Array.isArray(result.errors) && result.errors.length > 0;
    } catch {
      return true;
    }
  };

  assert.equal(await isRejected('not.a.signed.jwt'), true, 'malformed tokens must fail verification');
  assert.equal(
    await isRejected(signSessionToken({ exp: Math.floor(Date.now() / 1000) - 30 })),
    true,
    'expired tokens must fail verification',
  );
  assert.equal(
    await isRejected(signSessionToken({ iss: 'https://attacker.test.invalid' })),
    true,
    'tokens from another issuer must fail verification',
  );
  assert.equal(
    await isRejected(signSessionToken({ aud: 'another-service' })),
    true,
    'a token for another audience must fail verification',
  );
  assert.equal(
    await isRejected(signSessionToken({ azp: 'https://attacker.test.invalid' })),
    true,
    'unapproved authorized parties must fail verification',
  );
});

// This key pair and subject are generated only inside the disposable test process.
// They are not a Clerk secret, live Clerk token, provisioned user, or tenant.
