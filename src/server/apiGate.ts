import type { RequestHandler } from 'express';

/**
 * Temporary fail-closed gate: until verified identity, authorization and tenant
 * isolation are implemented, all business API calls fail with 503. Only the
 * non-sensitive liveness endpoint is allowed through.
 */
export const createFailClosedApiGate = (): RequestHandler => (req, res, next) => {
  if (req.method === 'GET' && req.path === '/health') return next();
  return res.status(503).json({
    success: false,
    error: 'API métier indisponible : authentification et autorisations serveur non configurées.',
  });
};
