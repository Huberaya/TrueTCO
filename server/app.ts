/**
 * TrueTCO — Application HTTP (assemble le serveur sans l'écouter)
 * ---------------------------------------------------------------------------
 * Séparer `createApp` de l'écoute réseau permet de lancer l'application
 * complète dans les tests (supertest) : les tests d'API, de sécurité et
 * d'isolation s'exécutent donc sur la MÊME application que la production, et
 * non sur une imitation.
 *
 * Chaîne d'un requête :
 *   correlationId → en-têtes de sécurité → CORS contrôlé → corps JSON borné
 *   → limitation de débit → route (session → RBAC → transaction → audit)
 *   → gestionnaire d'erreurs (aucune fuite technique)
 */

import express, { Express, Request, Response } from 'express';
import { createApiRouter } from './api/router';
import { Db } from './db/types';
import { errorHandler } from './http';

export interface AppOptions {
  db: Db;
  isProd: boolean;
  allowDemoAuth: boolean;
  allowedOrigins: string[];
  engineVersion: string;
  methodologyVersion: string;
  /** Chemin des fichiers statiques du build (production uniquement). */
  staticDir?: string | null;
}

/**
 * En-têtes de sécurité. La CSP de production est restrictive : aucune ressource
 * tierce n'est chargée sans décision explicite, aucun script inline n'est
 * autorisé (le build Vite n'en produit pas).
 */
function securityHeaders(isProd: boolean) {
  return (_req: Request, res: Response, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      isProd
        ? [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; ')
        : ["default-src 'self'", "script-src 'self' 'unsafe-inline' 'unsafe-eval'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "connect-src 'self' ws: wss:", "object-src 'none'", "frame-ancestors 'none'"].join('; ')
    );
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

function correlationId() {
  let counter = 0;
  return (req: Request, res: Response, next: () => void) => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && /^[A-Za-z0-9._-]{6,64}$/.test(incoming)
        ? incoming
        : `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    req.correlationId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

/** Limitation de débit en mémoire (par instance ; Redis en déploiement multi-instance). */
function rateLimit(options: { windowMs: number; max: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    const key = `${options.name}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > options.max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000).toString());
      res.status(429).json({
        error: 'Trop de requêtes : réessayez dans quelques instants.',
        code: 'RATE_LIMITED',
      });
      return;
    }
    // Purge opportuniste pour borner la mémoire.
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    next();
  };
}

export function createApp(options: AppOptions): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(correlationId());
  app.use(securityHeaders(options.isProd));

  // CORS : par défaut, aucune origine tierce n'est autorisée.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin.length > 0) {
      if (options.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      } else if (req.path.startsWith('/api/')) {
        // Une origine inconnue sur une route d'API est refusée : le navigateur
        // d'un site tiers ne doit pas pouvoir déclencher d'appel porteur de
        // cookie même sans lire la réponse.
        res.status(403).json({
          error: 'Origine non autorisée.',
          code: 'ORIGIN_NOT_ALLOWED',
        });
        return;
      }
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Le corps des requêtes est borné : un document volumineux passe par le
  // module de téléversement (Phase 2), pas par le corps JSON de l'API.
  app.use(express.json({ limit: '512kb' }));

  app.use(
    '/api/auth',
    rateLimit({ windowMs: 60_000, max: 30, name: 'auth' })
  );

  app.use('/api', createApiRouter({
    db: options.db,
    isProd: options.isProd,
    allowDemoAuth: options.allowDemoAuth,
    allowedOrigins: options.allowedOrigins,
    engineVersion: options.engineVersion,
    methodologyVersion: options.methodologyVersion,
  }));

  // Route inconnue sous /api : 404 JSON explicite (jamais le fallback HTML).
  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: "Cette route d'API n'existe pas.",
      code: 'API_ROUTE_NOT_FOUND',
    });
  });

  if (options.staticDir) {
    app.use(express.static(options.staticDir, { index: ['index.html'], maxAge: '1h' }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile('index.html', { root: options.staticDir as string });
    });
  }

  app.use(errorHandler(options.isProd));

  return app;
}
