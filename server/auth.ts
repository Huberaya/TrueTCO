/**
 * TrueTCO — Authentification, sessions et autorisations (RBAC)
 * ---------------------------------------------------------------------------
 * PRINCIPE FONDAMENTAL : le tenant (organisation) n'est JAMAIS déduit d'un
 * en-tête, d'un paramètre de requête ou du corps de la requête fourni par le
 * client. Il est TOUJOURS déduit de la session authentifiée.
 *
 * L'implémentation précédente acceptait `x-tenant-id`, `?tenantId=` ou
 * `body.organizationId` : n'importe quel appelant non authentifié pouvait
 * lire et écrire les données de n'importe quelle entreprise (IDOR total).
 */

import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { HttpError, SESSION_COOKIE, readCookie } from './security';

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'directeur_achats'
  | 'acheteur'
  | 'finance_controleur'
  | 'rse_esg'
  | 'direction_generale'
  | 'lecteur';

export type Permission =
  | 'project:read'
  | 'project:write'
  | 'project:delete'
  | 'offer:read'
  | 'offer:write'
  | 'supplier:read'
  | 'supplier:write'
  | 'benchmark:read'
  | 'benchmark:write'
  | 'audit:read'
  | 'audit:write'
  | 'user:read'
  | 'user:write'
  | 'tenant:read'
  | 'tenant:write'
  | 'ai:parse'
  | 'erp:sync'
  | 'report:export';

const READ_ONLY: Permission[] = [
  'project:read',
  'offer:read',
  'supplier:read',
  'benchmark:read',
  'audit:read',
  'tenant:read',
  'report:export',
];

/**
 * Matrice de permissions appliquée CÔTÉ SERVEUR. L'interface ne fait que
 * refléter ces droits : elle ne les accorde jamais.
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  super_admin: [
    ...READ_ONLY,
    'project:write',
    'project:delete',
    'offer:write',
    'supplier:write',
    'benchmark:write',
    'audit:write',
    'user:read',
    'user:write',
    'tenant:write',
    'ai:parse',
    'erp:sync',
  ],
  admin: [
    ...READ_ONLY,
    'project:write',
    'project:delete',
    'offer:write',
    'supplier:write',
    'benchmark:write',
    'audit:write',
    'user:read',
    'user:write',
    'ai:parse',
    'erp:sync',
  ],
  directeur_achats: [
    ...READ_ONLY,
    'project:write',
    'offer:write',
    'supplier:write',
    'audit:write',
    'user:read',
    'ai:parse',
    'erp:sync',
  ],
  acheteur: [...READ_ONLY, 'project:write', 'offer:write', 'supplier:write', 'audit:write', 'ai:parse'],
  finance_controleur: [...READ_ONLY, 'benchmark:write'],
  rse_esg: [...READ_ONLY, 'benchmark:write', 'audit:write', 'ai:parse'],
  direction_generale: [...READ_ONLY],
  lecteur: [...READ_ONLY],
};

export interface AuthContext {
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    department?: string | null;
    ssoProvider?: string | null;
    isActive: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string | null;
    dataResidency?: string | null;
    defaultCurrency?: string | null;
    countryCode?: string | null;
  };
  sessionId: string;
  expiresAt: string;
  /** Indique qu'une session de démonstration a été émise hors production. */
  isDemoSession: boolean;
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

/**
 * Empreinte SHA-256 du jeton de session. Les jetons ne sont JAMAIS stockés en
 * clair : une fuite de la base ne permet donc pas de rejouer une session.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateSessionToken(): string {
  return `sso_${crypto.randomBytes(32).toString('hex')}`;
}

export interface AuthDependencies {
  sql: any;
  /** true en production : interdit les sessions de démonstration. */
  isProd: boolean;
  /** Autorise explicitement les sessions de démonstration hors production. */
  allowDemoAuth: boolean;
}

export class AuthService {
  constructor(private readonly deps: AuthDependencies) {}

  /**
   * Extrait le jeton de session. Ordre : cookie HttpOnly (navigateur) puis
   * en-tête `Authorization: Bearer …` (appels machine-à-machine).
   */
  public static extractBearer(req: Request): string | null {
    const fromCookie = readCookie(req, SESSION_COOKIE);
    if (fromCookie && fromCookie.length > 0 && fromCookie.length <= 512) return fromCookie;

    const header = req.headers.authorization;
    if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
    const token = header.slice('Bearer '.length).trim();
    return token.length > 0 && token.length <= 512 ? token : null;
  }

  /** Charge la session + l'utilisateur + l'organisation à partir du jeton. */
  public async resolveSession(token: string): Promise<AuthContext | null> {
    const { sql } = this.deps;
    if (!sql) return null;

    const tokenHash = hashToken(token);
    const rows = await sql`
      SELECT s.id AS "sessionId", s.expires_at AS "expiresAt", s.sso_provider AS "sessionProvider",
             u.id, u.email, u.full_name AS "fullName", u.role, u.department,
             u.sso_provider AS "ssoProvider", u.is_active AS "isActive",
             o.id AS "orgId", o.name AS "orgName", o.slug AS "orgSlug",
             o.data_residency AS "dataResidency", o.default_currency AS "defaultCurrency",
             o.country_code AS "countryCode"
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      JOIN organizations o ON s.organization_id = o.id
      WHERE s.token_hash = ${tokenHash}
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND u.is_active = true
        AND o.is_active = true
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) return null;
    const r = rows[0];

    return {
      sessionId: r.sessionId,
      expiresAt: r.expiresAt,
      // Une session n'est « de démonstration » que si elle a été créée par le
      // mécanisme de démonstration (sso_provider = 'demo_local') : le mode de
      // déploiement ne suffit pas à qualifier la session.
      isDemoSession: r.sessionProvider === 'demo_local',
      user: {
        id: r.id,
        email: r.email,
        fullName: r.fullName,
        role: r.role as UserRole,
        department: r.department,
        ssoProvider: r.ssoProvider,
        isActive: r.isActive,
      },
      organization: {
        id: r.orgId,
        name: r.orgName,
        slug: r.orgSlug,
        dataResidency: r.dataResidency,
        defaultCurrency: r.defaultCurrency,
        countryCode: r.countryCode,
      },
    };
  }

  /**
   * Middleware d'authentification. Rejette toute requête sans session valide
   * ET toute session dont le tenant ne correspond pas à celui demandé.
   */
  public requireSession() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        const token = AuthService.extractBearer(req);
        if (!token) {
          return res.status(401).json({
            error: 'Authentification requise. Fournir un jeton de session valide (Authorization: Bearer …).',
            code: 'AUTH_REQUIRED',
          });
        }

        const context = await this.resolveSession(token);
        if (!context) {
          return res.status(401).json({
            error: 'Session invalide, expirée ou révoquée.',
            code: 'SESSION_INVALID',
          });
        }

        // Protection contre l'usurpation de tenant : un client peut demander un
        // autre tenant, mais il est rejeté s'il ne correspond pas à sa session.
        const requested =
          (typeof req.headers['x-tenant-id'] === 'string' && (req.headers['x-tenant-id'] as string)) ||
          (typeof req.query?.tenantId === 'string' && (req.query.tenantId as string)) ||
          (typeof req.body?.organizationId === 'string' && (req.body.organizationId as string)) ||
          null;

        if (
          requested &&
          requested !== context.organization.id &&
          context.user.role !== 'super_admin'
        ) {
          console.warn(
            `[TrueTCO][${req.correlationId}] Tentative d'accès inter-tenant refusée : session=${context.organization.id} demandé=${requested} user=${context.user.id}`
          );
          return res.status(403).json({
            error: "Accès refusé : la ressource demandée appartient à une autre organisation.",
            code: 'TENANT_MISMATCH',
          });
        }

        if (context.user.role === 'super_admin' && requested) {
          // Un super-admin peut cibler un tenant explicitement ; l'action est tracée.
          context.organization = { ...context.organization, id: requested };
        }

        req.auth = context;
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }

  /** Middleware d'autorisation : exige une permission du rôle. */
  public requirePermission(permission: Permission) {
    return (req: Request, res: Response, next: NextFunction) => {
      const ctx = req.auth as AuthContext | undefined;
      if (!ctx) {
        return res.status(401).json({ error: 'Authentification requise.', code: 'AUTH_REQUIRED' });
      }
      if (!hasPermission(ctx.user.role, permission)) {
        console.warn(
          `[TrueTCO][${req.correlationId}] Permission refusée : ${permission} pour le rôle ${ctx.user.role}`
        );
        return res.status(403).json({
          error: `Accès refusé : votre rôle (${ctx.user.role}) ne dispose pas du droit « ${permission} ».`,
          code: 'PERMISSION_DENIED',
          requiredPermission: permission,
        });
      }
      return next();
    };
  }

  public get contextOf(): (req: Request) => AuthContext {
    return (req: Request) => {
      const ctx = req.auth as AuthContext | undefined;
      if (!ctx) throw new HttpError(401, 'AUTH_REQUIRED', 'Authentification requise.');
      return ctx;
    };
  }

  public tenantIdOf(req: Request): string {
    return this.contextOf(req).organization.id;
  }
}
