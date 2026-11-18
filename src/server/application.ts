import express, { type RequestHandler } from 'express';
import { createClerkSessionMiddleware } from './clerkAuth';
import { createFailClosedApiGate } from './apiGate';

export interface ApplicationOptions {
  clerkMiddleware?: RequestHandler;
  apiGate?: RequestHandler;
  afterApiMiddleware?: RequestHandler;
}

const rawPathOf = (originalUrl: string): string => originalUrl.split(/[?#]/, 1)[0] ?? '';

/**
 * Detect encoded/non-canonical spellings of the API prefix that would otherwise
 * miss Express's `/api` mount and reach a later SPA/static fallback. They still
 * pass through Clerk and the exact same fail-closed gate, in that order.
 */
const isNonCanonicalApiPath = (originalUrl: string): boolean => {
  const rawPath = rawPathOf(originalUrl);
  if (/^\/api(?:\/|$)/i.test(rawPath)) return false;

  let decodedPath = rawPath.replaceAll('\\', '/');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (/^\/api(?:\/|$)/i.test(decodedPath)) return true;
    try {
      const decoded = decodeURIComponent(decodedPath);
      if (decoded === decodedPath) return false;
      decodedPath = decoded.replaceAll('\\', '/');
    } catch {
      return false;
    }
  }

  return /^\/api(?:\/|$)/i.test(decodedPath);
};

/** Shared production Express stack; only the liveness route is public. */
export const createApplication = (options: ApplicationOptions = {}) => {
  const app = express();
  const clerk = options.clerkMiddleware ?? createClerkSessionMiddleware();
  const gate = options.apiGate ?? createFailClosedApiGate();

  app.use(express.json({ limit: '10mb' }));

  // Encoded API-prefix bypasses must still run the ordered Clerk → gate chain.
  app.use((req, res, next) => {
    if (!isNonCanonicalApiPath(req.originalUrl)) return next();
    return clerk(req, res, (error) => {
      if (error) return next(error);
      return gate(req, res, next);
    });
  });

  app.use('/api', clerk);
  app.use('/api', gate);
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  if (options.afterApiMiddleware) app.use(options.afterApiMiddleware);
  return app;
};
