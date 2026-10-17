import type { RequestHandler } from 'express';
import { forbidden, unauthorized } from './errors';
import type { AuthContext, Role } from './types';

export type Permission =
  | 'project:read'
  | 'project:write'
  | 'offer:read'
  | 'offer:write'
  | 'supplier:read'
  | 'supplier:write'
  | 'benchmark:read'
  | 'benchmark:write'
  | 'audit:read'
  | 'audit:annotate'
  | 'user:read'
  | 'user:manage'
  | 'tenant:update'
  | 'ai:parse';

const ALL_ROLES: Role[] = ['admin', 'directeur_achats', 'acheteur', 'finance_controleur', 'rse_esg', 'direction_generale'];

/**
 * Matrice de permissions : source unique de vérité, appliquée CÔTÉ SERVEUR.
 * Principe : moindre privilège. Les rôles de contrôle (finance, RSE, direction) lisent tout
 * mais n'écrivent que dans leur périmètre ; la direction est en lecture seule.
 */
export const PERMISSIONS: Record<Permission, readonly Role[]> = {
  'project:read': ALL_ROLES,
  'project:write': ['admin', 'directeur_achats', 'acheteur', 'finance_controleur'],
  'offer:read': ALL_ROLES,
  'offer:write': ['admin', 'directeur_achats', 'acheteur'],
  'supplier:read': ALL_ROLES,
  'supplier:write': ['admin', 'directeur_achats', 'acheteur', 'rse_esg'],
  'benchmark:read': ALL_ROLES,
  'benchmark:write': ['admin', 'finance_controleur', 'rse_esg'],
  'audit:read': ALL_ROLES,
  'audit:annotate': ['admin', 'directeur_achats', 'acheteur', 'finance_controleur', 'rse_esg'],
  'user:read': ['admin', 'directeur_achats'],
  'user:manage': ['admin'],
  'tenant:update': ['admin'],
  'ai:parse': ['admin', 'directeur_achats', 'acheteur'],
};

export function can(ctx: AuthContext | undefined, permission: Permission): boolean {
  const role = ctx?.active?.role;
  return !!role && PERMISSIONS[permission].includes(role);
}

/** Middleware : exige une appartenance active ET la permission. Refus par défaut. */
export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.ctx) return next(unauthorized());
    if (!req.ctx.active) return next(forbidden("Aucune organisation active : créez ou rejoignez une organisation"));
    if (!can(req.ctx, permission)) return next(forbidden('Droits insuffisants pour cette action'));
    next();
  };
