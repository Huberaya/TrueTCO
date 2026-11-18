import type { RequestHandler } from 'express';
import type { UserRole } from '../types/domain';
import { getTenantPrincipal } from './tenantIdentity';

/**
 * P1 candidate policy. It is deliberately not mounted on any production route;
 * product/security owners must approve it before routes can be allowlisted.
 */
export const PERMISSIONS = [
  'projects:read', 'projects:create', 'projects:update', 'projects:archive',
  'suppliers:read', 'suppliers:create', 'suppliers:update',
  'offers:read', 'offers:create', 'offers:update',
  'cost_items:read', 'cost_items:create', 'cost_items:update',
  'carbon_items:read', 'carbon_items:create', 'carbon_items:update',
  'risk_items:read', 'risk_items:create', 'risk_items:update',
  'benchmarks:read', 'benchmarks:create', 'benchmarks:update',
  'audit_logs:read', 'users:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
const definePermissions = (...permissions: Permission[]): readonly Permission[] => Object.freeze(permissions);
const allOperationalPermissions = PERMISSIONS.filter((permission) => permission !== 'users:read');
const readOnlyPermissions = PERMISSIONS.filter((permission) => permission.endsWith(':read'));

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = Object.freeze({
  // Tenant-scoped administrator; cannot assign roles, delete records or bypass audit.
  admin: definePermissions(...allOperationalPermissions, 'users:read'),
  directeur_achats: definePermissions(
    'projects:read', 'projects:create', 'projects:update', 'projects:archive',
    'suppliers:read', 'offers:read',
    'cost_items:read', 'carbon_items:read', 'risk_items:read', 'benchmarks:read', 'audit_logs:read',
  ),
  acheteur: definePermissions(
    'projects:read', 'projects:create', 'projects:update',
    'suppliers:read', 'suppliers:create', 'suppliers:update',
    'offers:read', 'offers:create', 'offers:update',
    'cost_items:read', 'cost_items:create', 'cost_items:update',
    'carbon_items:read', 'risk_items:read', 'benchmarks:read',
  ),
  finance_controleur: definePermissions(
    'projects:read', 'offers:read', 'cost_items:read', 'cost_items:update',
    'benchmarks:read', 'audit_logs:read',
  ),
  rse_esg: definePermissions(
    'projects:read', 'suppliers:read', 'offers:read',
    'carbon_items:read', 'carbon_items:create', 'carbon_items:update',
    'risk_items:read', 'risk_items:create', 'risk_items:update',
    'benchmarks:read', 'audit_logs:read',
  ),
  direction_generale: definePermissions(...readOnlyPermissions),
});

export function roleCan(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function requireTenantPermission(permission: Permission): RequestHandler {
  return (_request, response, next) => {
    const principal = getTenantPrincipal(response);
    if (!principal) {
      return response.status(401).json({ success: false, error: 'Authentification requise.' });
    }
    if (!roleCan(principal.role, permission)) {
      return response.status(403).json({ success: false, error: 'Permission insuffisante.' });
    }
    return next();
  };
}
