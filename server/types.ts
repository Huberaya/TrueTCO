export type Role =
  | 'admin'
  | 'directeur_achats'
  | 'acheteur'
  | 'finance_controleur'
  | 'rse_esg'
  | 'direction_generale';

export const ROLES: readonly Role[] = [
  'admin',
  'directeur_achats',
  'acheteur',
  'finance_controleur',
  'rse_esg',
  'direction_generale',
];

export interface VerifiedIdentity {
  /** Identifiant Clerk (claim `sub`) : seule source d'identité de confiance. */
  clerkId: string;
  email?: string;
  emailVerified: boolean;
  fullName?: string;
}

export interface Membership {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
}

export interface AuthContext {
  identity: VerifiedIdentity;
  /** Appartenance ACTIVE (organisation courante). null tant que l'identité n'a aucune organisation. */
  active: (Membership & { email: string; fullName: string }) | null;
  memberships: Membership[];
  isPlatformAdmin: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      ctx?: AuthContext;
    }
  }
}
