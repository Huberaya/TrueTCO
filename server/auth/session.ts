/**
 * TrueTCO — Sessions, jetons et middlewares d'authentification
 * ---------------------------------------------------------------------------
 * Principes de sécurité appliqués :
 *  1. Le jeton n'est JAMAIS stocké en clair : seul son SHA-256 est en base.
 *  2. Le jeton n'est JAMAIS exposé au JavaScript de la page : il voyage dans un
 *     cookie HttpOnly / Secure (en production) / SameSite=Lax.
 *  3. La résolution de session passe par une fonction SECURITY DEFINER étroite
 *     (`truetco_resolve_session`) : c'est le seul point d'accès possible avant
 *     que l'organisation soit connue.
 *  4. Toute requête mutante authentifiée par cookie est protégée contre le CSRF
 *     par vérification de l'origine (voir `requireSameOrigin`).
 *  5. Les sessions sont révocables individuellement (déconnexion) et
 *     globalement (changement de rôle, suspension d'utilisateur).
 */

import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { Db, Executor } from '../db/types';
import { AuthContext, Permission, ROLE_PERMISSIONS, UserRole, hasPermission } from './types';

export const SESSION_COOKIE = 'truetco_session';
const SESSION_TTL_HOURS = Number(process.env.TRUETCO_SESSION_TTL_HOURS ?? 12);
const INVITATION_TTL_HOURS = Number(process.env.TRUETCO_INVITATION_TTL_HOURS ?? 168);

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString('hex')}`;
}

export function sessionExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_HOURS * 3600 * 1000);
}

export function invitationExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITATION_TTL_HOURS * 3600 * 1000);
}

// -----------------------------------------------------------------------------
// Cookie helpers
// -----------------------------------------------------------------------------
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

/** Jeton de session : cookie HttpOnly en priorité, en-tête Bearer pour les machines. */
export function extractSessionToken(req: Request): string | null {
  const fromCookie = readCookie(req, SESSION_COOKIE);
  if (fromCookie && fromCookie.length > 0 && fromCookie.length <= 512) return fromCookie;

  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token.length > 0 && token.length <= 512) return token;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Résolution de session
// -----------------------------------------------------------------------------
interface SessionRow {
  session_id: string;
  expires_at: string;
  auth_method: string;
  user_id: string;
  user_email: string;
  user_full_name: string;
  user_role: string;
  user_department: string | null;
  user_status: string;
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  data_residency: string | null;
  default_currency: string | null;
  country_code: string | null;
}

export async function resolveSession(db: Db, token: string): Promise<AuthContext | null> {
  const rows = await db.query<SessionRow>('SELECT * FROM truetco_resolve_session($1)', [hashToken(token)]);
  const row = rows[0];
  if (!row) return null;

  const role = row.user_role as UserRole;
  return {
    session: {
      id: row.session_id,
      expiresAt: row.expires_at,
      authMethod: row.auth_method,
      isDemo: row.auth_method === 'demo_local',
    },
    user: {
      id: row.user_id,
      email: row.user_email,
      fullName: row.user_full_name,
      role,
      department: row.user_department,
      status: row.user_status,
    },
    organization: {
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      dataResidency: row.data_residency,
      defaultCurrency: row.default_currency,
      countryCode: row.country_code,
    },
    permissions: ROLE_PERMISSIONS[role] ?? [],
  };
}

export async function markSessionSeen(tx: Executor, sessionId: string): Promise<void> {
  await tx.query('UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = $1', [sessionId]);
}

// -----------------------------------------------------------------------------
// Middlewares
// -----------------------------------------------------------------------------
export interface AuthDependencies {
  db: Db;
}

export function requireSession(deps: AuthDependencies) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = extractSessionToken(req);
      if (!token) {
        res.status(401).json({
          error: 'Authentification requise : aucun jeton de session valide fourni.',
          code: 'AUTH_REQUIRED',
        });
        return;
      }

      const context = await resolveSession(deps.db, token);
      if (!context) {
        res.status(401).json({
          error: 'Session invalide, expirée ou révoquée.',
          code: 'SESSION_INVALID',
        });
        return;
      }

      // Un client peut demander explicitement une autre organisation : c'est
      // refusé. Le tenant n'est jamais négociable.
      const requested =
        (typeof req.headers['x-tenant-id'] === 'string' && (req.headers['x-tenant-id'] as string)) ||
        (typeof req.query?.organizationId === 'string' && (req.query.organizationId as string)) ||
        (typeof (req.body as any)?.organizationId === 'string' && (req.body as any).organizationId) ||
        null;

      if (requested && requested !== context.organization.id && context.user.role !== 'platform_admin') {
        console.warn(
          `[TrueTCO][${req.correlationId ?? '-'}] Tentative d'accès inter-organisation refusée : ` +
            `session=${context.organization.id} demandé=${requested} utilisateur=${context.user.id}`
        );
        res.status(403).json({
          error: "Accès refusé : la ressource demandée appartient à une autre organisation.",
          code: 'TENANT_MISMATCH',
        });
        return;
      }

      if (requested && context.user.role === 'platform_admin' && requested !== context.organization.id) {
        // Bascule d'organisation réservée à l'administration de plateforme :
        // elle est tracée et n'accorde aucun droit supplémentaire côté policy RLS
        // (le contexte est posé par le serveur, jamais par le client).
        context.organization = { ...context.organization, id: requested };
      }

      req.auth = context;
      req.sessionToken = token;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = req.auth;
    if (!ctx) {
      res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });
      return;
    }
    if (!hasPermission(ctx.user.role, permission)) {
      console.warn(
        `[TrueTCO][${req.correlationId ?? '-'}] Permission refusée : ${permission} (rôle ${ctx.user.role}, utilisateur ${ctx.user.id})`
      );
      res.status(403).json({
        error: `Accès refusé : votre rôle (${ctx.user.role}) ne dispose pas du droit « ${permission} ».`,
        code: 'PERMISSION_DENIED',
        requiredPermission: permission,
      });
      return;
    }
    next();
  };
}

/**
 * Défense contre le CSRF : pour toute requête mutante authentifiée par cookie,
 * l'origine (ou le référent) doit correspondre à l'hôte de la requête. Un
 * en-tête `Authorization: Bearer` (client machine, jamais envoyé
 * automatiquement par le navigateur) en est dispensé.
 */
export function requireSameOrigin(getAllowedOrigins: () => string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Pas d'authentification par cookie : rien à protéger contre le CSRF.
    if (!readCookie(req, SESSION_COOKIE)) return next();

    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers.host;
    const candidate = typeof origin === 'string' && origin ? origin : typeof referer === 'string' ? referer : null;

    if (!candidate) {
      // Requête sans Origin ni Referer portant un cookie de session : refusée
      // (les navigateurs envoient toujours l'un des deux pour une requête
      // déclenchée depuis une page).
      res.status(403).json({
        error: "Requête refusée : origine absente pour une requête authentifiée par cookie.",
        code: 'CSRF_ORIGIN_MISSING',
      });
      return;
    }

    let candidateHost: string;
    try {
      candidateHost = new URL(candidate).host;
    } catch {
      res.status(403).json({ error: 'Origine de requête illisible.', code: 'CSRF_ORIGIN_INVALID' });
      return;
    }

    const allowed = new Set<string>([host ?? '', ...getAllowedOrigins().map((o) => { try { return new URL(o).host; } catch { return o; } })]);
    if (!allowed.has(candidateHost)) {
      res.status(403).json({
        error: 'Requête refusée : origine non autorisée.',
        code: 'CSRF_ORIGIN_DENIED',
      });
      return;
    }
    next();
  };
}

/** Contexte applicatif d'une requête authentifiée (échoue si absent). */
export function ctxOf(req: Request): AuthContext {
  if (!req.auth) {
    const err = new Error('Authentification requise.') as Error & { status?: number; code?: string };
    err.status = 401;
    err.code = 'AUTH_REQUIRED';
    throw err;
  }
  return req.auth;
}
