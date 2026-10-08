/**
 * TrueTCO — Socle de sécurité HTTP
 * ---------------------------------------------------------------------------
 * En-têtes de sécurité, limitation de débit, journalisation corrélée et
 * gestion d'erreurs non fuyante.
 *
 * Objectif : ne JAMAIS renvoyer au client un message d'erreur interne
 * (requête SQL, nom de table, trace) et ne JAMAIS laisser une route métier
 * sans limitation de débit.
 */

import { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId?: string;
      /** Détails d'authentification posés par server/auth.ts */
      auth?: any;
    }
  }
}

export const SESSION_COOKIE = 'truetco_session';

/**
 * Sérialise le cookie de session.
 * HttpOnly : inaccessible au JavaScript de la page (une injection XSS ne peut
 *   donc pas exfiltrer le jeton, contrairement à un stockage localStorage).
 * Secure : en production uniquement (le développement local est en HTTP).
 * SameSite=Lax : protège des requêtes inter-sites tout en autorisant la
 *   navigation directe.
 */
export function serializeSessionCookie(token: string, expiresAt: Date, isProd: boolean): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(isProd: boolean): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

/** Lit une valeur de cookie sans dépendance externe. */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header || typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * En-têtes de sécurité. CSP volontairement stricte côté application, avec les
 * exceptions nécessaires aux polices Google Fonts déjà utilisées par l'app.
 */
export function securityHeaders(isProd: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      res.setHeader(
        'Content-Security-Policy',
        [
          "default-src 'self'",
          // Vite/React en production : styles inline émis par Tailwind + polices Google.
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: blob:",
          "connect-src 'self'",
          "script-src 'self'",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'self'",
          "frame-ancestors 'none'",
        ].join('; ')
      );
    }
    next();
  };
}

/**
 * Limiteur de débit à fenêtre glissante, en mémoire.
 *
 * LIMITE CONNUE ET DOCUMENTÉE : ce compteur est local au processus. En
 * déploiement multi-instances (Vercel/Cloud Run serverless), il doit être
 * remplacé par un store partagé (Redis / Upstash). Voir `TRUETCO_RATE_LIMIT_STORE`.
 */
export function rateLimit(options: { windowMs: number; max: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${options.name}:${clientKey(req)}`;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      scheduleCleanup(hits, now);
      return next();
    }

    if (entry.count >= options.max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Trop de requêtes. Merci de réessayer dans quelques instants.',
        code: 'RATE_LIMITED',
        retryAfterSeconds: retryAfter,
      });
    }

    entry.count += 1;
    next();
  };
}

function clientKey(req: Request): string {
  // `trust proxy` est activé au niveau de l'application : req.ip reflète
  // l'adresse réelle. Repli sur le socket pour les tests locaux.
  const auth = req.auth as { user?: { id?: string } } | undefined;
  if (auth?.user?.id) return `u:${auth.user.id}`;
  return `ip:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;
}

let lastCleanup = 0;
function scheduleCleanup(hits: Map<string, { count: number; resetAt: number }>, now: number) {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, value] of hits) {
    if (value.resetAt <= now) hits.delete(key);
  }
}

/** Identifiant de corrélation pour tracer une requête de bout en bout. */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const id = req.headers['x-correlation-id'];
  req.correlationId = typeof id === 'string' && id.length <= 128 ? id : crypto.randomUUID();
  res.setHeader('X-Correlation-Id', req.correlationId);
  next();
}

/**
 * Gestion d'erreurs centralisée : journalise côté serveur, ne renvoie qu'un
 * message neutre + l'identifiant de corrélation au client.
 */
export function errorHandler(isProd: boolean) {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    const correlationIdValue = req.correlationId ?? 'n/a';
    console.error(`[TrueTCO][${correlationIdValue}] ${req.method} ${req.path} →`, err);

    if (res.headersSent) return;
    res.status(500).json({
      error: 'Une erreur interne est survenue. Le support peut analyser cet incident via l’identifiant de corrélation.',
      code: 'INTERNAL_ERROR',
      correlationId: correlationIdValue,
      // Détail technique uniquement hors production ; en production le message
      // SQL peut révéler la structure du schéma et des données.
      ...(isProd ? {} : { detail: err?.message }),
    });
  };
}

/** Erreur métier avec code HTTP explicite. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}
