import { clerkMiddleware, type ClerkMiddlewareOptions } from '@clerk/express';
import type { RequestHandler } from 'express';

export type ClerkEnvironment = Record<string, string | undefined>;

export type ClerkServerConfig = Pick<ClerkMiddlewareOptions, 'secretKey' | 'publishableKey' | 'authorizedParties'>;

export type ClerkConfigResult =
  | { configured: true; config: ClerkServerConfig }
  | { configured: false; missing: string[] };

const isPlaceholder = (value: string | undefined): boolean =>
  !value || /sample|placeholder|change.?me|your.?key/i.test(value);

const parseAuthorizedParties = (raw: string | undefined): string[] | null => {
  if (!raw) return null;
  const parties = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parties.length === 0) return null;

  const validated = parties.map((party) => {
    if (party.includes('*')) return null;
    try {
      const url = new URL(party);
      const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
      if ((!localHttp && url.protocol !== 'https:') || url.origin !== party || url.pathname !== '/') return null;
      return url.origin;
    } catch {
      return null;
    }
  });

  if (validated.some((party) => party === null)) return null;
  return [...new Set(validated as string[])];
};

/**
 * Read server-side Clerk configuration without logging or exposing secret values.
 * A public frontend key is not accepted as the server secret, and at least one
 * exact, HTTPS authorized party is required (HTTP is allowed only for localhost).
 */
export const getClerkServerConfig = (env: ClerkEnvironment = process.env): ClerkConfigResult => {
  const secretKey = env.CLERK_SECRET_KEY;
  const publishableKey = env.CLERK_PUBLISHABLE_KEY ?? env.VITE_CLERK_PUBLISHABLE_KEY;
  const authorizedParties = parseAuthorizedParties(env.CLERK_AUTHORIZED_PARTIES);
  const missing: string[] = [];

  if (isPlaceholder(secretKey) || !secretKey?.startsWith('sk_')) missing.push('CLERK_SECRET_KEY');
  if (isPlaceholder(publishableKey) || !publishableKey?.startsWith('pk_')) missing.push('CLERK_PUBLISHABLE_KEY');
  if (!authorizedParties) missing.push('CLERK_AUTHORIZED_PARTIES');

  if (missing.length > 0) return { configured: false, missing };
  return {
    configured: true,
    config: {
      secretKey: secretKey!,
      publishableKey: publishableKey!,
      authorizedParties: authorizedParties!,
    },
  };
};

/**
 * Clerk token verification layer, deliberately separate from authorization.
 * It never opens a route: server.ts mounts the global fail-closed API gate after
 * this middleware, until membership mapping, RBAC and tenant-safe DB access have
 * passed integration tests. Liveness remains public and contains no internals.
 */
export const createClerkSessionMiddleware = (env: ClerkEnvironment = process.env): RequestHandler => {
  const result = getClerkServerConfig(env);
  if (!result.configured) {
    return (req, res, next) => {
      if (req.method === 'GET' && req.path === '/health') return next();
      return res.status(503).json({
        success: false,
        error: 'API métier indisponible : configuration Clerk serveur incomplète.',
      });
    };
  }

  const verifySession = clerkMiddleware(result.config);
  return (req, res, next) => {
    if (req.method === 'GET' && req.path === '/health') return next();
    return verifySession(req, res, next);
  };
};
