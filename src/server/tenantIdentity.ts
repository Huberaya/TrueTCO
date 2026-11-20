import { getAuth } from '@clerk/express';
import type { Request, RequestHandler } from 'express';
import type { UserRole } from '../types/domain';

export interface TenantPrincipal {
  readonly clerkUserId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly role: UserRole;
}

export interface VerifiedClerkAuth {
  isAuthenticated: boolean;
  userId: string | null;
}

export type ClerkAuthReader = (request: Request) => VerifiedClerkAuth;
export type TenantMembershipLookup = (clerkUserId: string) => Promise<TenantPrincipal | null>;

export const TENANT_AUTH_ERRORS = Object.freeze({
  unauthenticated: 'Authentification requise.',
  membership: 'Aucune appartenance TrueTCO active n’est associée à cette identité.',
  unavailable: 'Le contrôle d’accès est temporairement indisponible.',
});

const readClerkAuth: ClerkAuthReader = (request) => {
  // getAuth reads state attached by @clerk/express middleware. No request header,
  // query, body, browser cache or user-supplied claim is parsed here.
  const auth = getAuth(request);
  return { isAuthenticated: auth.isAuthenticated, userId: auth.userId };
};

/**
 * Must be mounted after Clerk middleware. A verified Clerk subject is only an
 * authentication factor: access requires exactly one active internal user row,
 * whose organization and role are read from PostgreSQL.
 */
export function createTenantIdentityMiddleware(options: {
  lookupMembership: TenantMembershipLookup;
  readAuth?: ClerkAuthReader;
}): RequestHandler {
  const readAuth = options.readAuth ?? readClerkAuth;

  return async (request, response, next) => {
    if (request.method === 'GET' && request.path === '/health') return next();

    let auth: VerifiedClerkAuth;
    try {
      auth = readAuth(request);
    } catch {
      return response.status(401).json({ success: false, error: TENANT_AUTH_ERRORS.unauthenticated });
    }

    if (!auth.isAuthenticated || typeof auth.userId !== 'string' || auth.userId.length === 0) {
      return response.status(401).json({ success: false, error: TENANT_AUTH_ERRORS.unauthenticated });
    }

    try {
      const principal = await options.lookupMembership(auth.userId);
      if (!principal || principal.clerkUserId !== auth.userId) {
        return response.status(403).json({ success: false, error: TENANT_AUTH_ERRORS.membership });
      }
      response.locals.tenantPrincipal = principal;
      return next();
    } catch {
      return response.status(503).json({ success: false, error: TENANT_AUTH_ERRORS.unavailable });
    }
  };
}

/** Safe for read-only tests and observability; it never accepts a client value. */
const VALID_TENANT_ROLES = new Set<UserRole>([
  'admin', 'directeur_achats', 'acheteur', 'finance_controleur', 'rse_esg', 'direction_generale',
]);
const TENANT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getTenantPrincipal(response: { locals: Record<string, unknown> }): TenantPrincipal | null {
  const principal = response.locals.tenantPrincipal;
  if (!principal || typeof principal !== 'object') return null;
  const candidate = principal as Partial<TenantPrincipal>;
  if (
    typeof candidate.clerkUserId !== 'string' || candidate.clerkUserId.length === 0 ||
    typeof candidate.userId !== 'string' || !TENANT_UUID.test(candidate.userId) ||
    typeof candidate.organizationId !== 'string' || !TENANT_UUID.test(candidate.organizationId) ||
    typeof candidate.role !== 'string' || !VALID_TENANT_ROLES.has(candidate.role as UserRole)
  ) {
    return null;
  }
  return candidate as TenantPrincipal;
}
