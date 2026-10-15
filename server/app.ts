import crypto from 'node:crypto';
import express, { type ErrorRequestHandler, type Express } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { type AuthVerifier, authenticate } from './auth';
import type { Config } from './config';
import type { Db } from './db';
import { HttpError, mapDbError } from './errors';
import { dataRouter } from './routes/data';
import { legacySimulatedRouter } from './routes/legacy-simulated';
import { sessionRouter } from './routes/session';

export interface AppDeps {
  db: Db;
  verifier: AuthVerifier;
  config: Config;
  /** Sortie de logs structurés (jamais de corps de requête ni de jeton). */
  log?: (entry: Record<string, unknown>) => void;
}

/**
 * Construit l'application API. Principe : PRIVÉ PAR DÉFAUT.
 * Toute route sous /api passe par `authenticate` ; la seule exception est /api/health (déclarée ici, en un seul endroit).
 * Une route ajoutée plus tard sans effort supplémentaire de sécurité est donc protégée, et un test le vérifie.
 */
export function createApp(deps: AppDeps): Express {
  const { db, verifier, config } = deps;
  const log = deps.log ?? ((e) => console.log(JSON.stringify(e)));
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  app.use(
    helmet({
      // CSP en mode rapport tant que l'intégration Clerk/PWA n'est pas validée en conditions réelles (cf. docs/SECURITY.md).
      contentSecurityPolicy: config.isProd
        ? {
            reportOnly: true,
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'", 'https://*.clerk.accounts.dev', 'https://*.clerk.com', 'https://challenges.cloudflare.com'],
              styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
              fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
              imgSrc: ["'self'", 'data:', 'blob:', 'https://img.clerk.com'],
              connectSrc: ["'self'", 'https://*.clerk.accounts.dev', 'https://*.clerk.com'],
              frameSrc: ["'self'", 'https://challenges.cloudflare.com'],
              workerSrc: ["'self'", 'blob:'],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: '1mb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Débit global par IP, + compteur dédié aux ÉCHECS (jetons invalides, accès refusés) contre l'énumération.
  const limiterMsg = { error: 'rate_limited', message: 'Trop de requêtes, réessayez plus tard' };
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, message: limiterMsg }));
  app.use('/api', rateLimit({ windowMs: 10 * 60_000, limit: 100, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: limiterMsg }));

  // --- SEULE route publique ---
  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  // Anciens endpoints d'authentification factice : définitivement retirés (410), jamais ré-implémentés.
  app.all(['/api/auth/sso/login', '/api/auth/logout', '/api/users/sync'], (_req, res) => {
    res.status(410).json({ error: 'gone', message: "Endpoint supprimé : l'authentification est gérée par Clerk." });
  });

  // --- Tout le reste de /api est privé ---
  app.use('/api', authenticate({ db, verifier, config }));
  app.use('/api', sessionRouter({ db, verifier }));
  app.use('/api', dataRouter({ db }));
  app.use('/api', legacySimulatedRouter());
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'not_found', 'Route inconnue')));

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const asBody = (status: number, code: string, message: string, details?: unknown) =>
      res.status(status).json({ error: code, message, ...(details ? { details } : {}), requestId: req.id });

    if (err instanceof HttpError) return asBody(err.status, err.code, err.message, err.details);
    const mapped = mapDbError(err);
    if (mapped) return asBody(mapped.status, mapped.code, mapped.message);
    if (err?.type === 'entity.too.large') return asBody(413, 'payload_too_large', 'Requête trop volumineuse');
    if (err?.type === 'entity.parse.failed') return asBody(400, 'invalid_json', 'JSON invalide');

    // Erreur inattendue : détail uniquement dans les logs serveur, corrélé par requestId. Jamais renvoyé au client.
    log({ level: 'error', requestId: req.id, method: req.method, path: req.path, code: err?.code, message: String(err?.message ?? err) });
    return asBody(500, 'internal_error', 'Erreur interne');
  };
  app.use(errorHandler);

  return app;
}
