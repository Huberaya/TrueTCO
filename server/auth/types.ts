/**
 * TrueTCO — Modèle d'authentification et d'autorisation
 * ---------------------------------------------------------------------------
 * Rôles (§9 du cahier des charges) :
 *   platform_admin  Administration de la plateforme (support, exploitation)
 *   org_admin       Administration de l'organisation (équipe, paramètres)
 *   procurement     Création et analyse des dossiers d'achat
 *   finance         Validation des hypothèses financières
 *   esg             Validation des facteurs environnementaux
 *   approver        Approbation / verrouillage d'une décision
 *   viewer          Lecture seule
 *
 * Le rôle et l'organisation proviennent EXCLUSIVEMENT de la session serveur.
 * Aucune valeur fournie par le client (`role`, `organizationId`, en-têtes) n'est
 * utilisée pour construire l'identité.
 */

export type UserRole =
  | 'platform_admin'
  | 'org_admin'
  | 'procurement'
  | 'finance'
  | 'esg'
  | 'approver'
  | 'viewer';

export const USER_ROLES: UserRole[] = [
  'platform_admin',
  'org_admin',
  'procurement',
  'finance',
  'esg',
  'approver',
  'viewer',
];

export type Permission =
  | 'project:read'
  | 'project:write'
  | 'project:delete'
  | 'project:lock'
  | 'offer:read'
  | 'offer:write'
  | 'supplier:read'
  | 'supplier:write'
  | 'cost:write'
  | 'import:read'
  | 'import:write'
  | 'document:read'
  | 'document:write'
  | 'factor:read'
  | 'factor:write'
  | 'factor:verify'
  | 'audit:read'
  | 'user:read'
  | 'user:write'
  | 'organization:write'
  | 'approval:write'
  | 'decision:run'
  | 'decision:read'
  | 'report:export'
  | 'erp:sync'
  | 'ai:extract'
  | 'billing:read'
  | 'platform:admin';

const READ_ONLY: Permission[] = [
  'project:read',
  'offer:read',
  'supplier:read',
  'document:read',
  'factor:read',
  'audit:read',
  'decision:read',
  'report:export',
  'import:read',
];

/**
 * Matrice de permissions. Toute évolution doit être accompagnée d'un test
 * d'API vérifiant le refus (cf. tests/api-security.spec.ts).
 */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  platform_admin: [
    ...READ_ONLY,
    'project:write',
    'project:delete',
    'project:lock',
    'offer:write',
    'supplier:write',
    'cost:write',
    'import:write',
    'document:write',
    'factor:read',
    'audit:read',
    'user:read',
    'user:write',
    'organization:write',
    'approval:write',
    'decision:run',
    'report:export',
    'billing:read',
    'platform:admin',
  ],
  org_admin: [
    ...READ_ONLY,
    'project:write',
    'project:delete',
    'project:lock',
    'offer:write',
    'supplier:write',
    'cost:write',
    'import:write',
    'document:write',
    'factor:write',
    'user:read',
    'user:write',
    'organization:write',
    'approval:write',
    'decision:run',
    'billing:read',
  ],
  procurement: [
    ...READ_ONLY,
    'project:write',
    'offer:write',
    'supplier:write',
    'cost:write',
    'import:write',
    'document:write',
    'decision:run',
  ],
  finance: [...READ_ONLY, 'factor:write', 'factor:verify', 'cost:write', 'decision:run', 'approval:write'],
  esg: [...READ_ONLY, 'factor:write', 'factor:verify', 'cost:write', 'decision:run', 'approval:write'],
  approver: [...READ_ONLY, 'approval:write', 'project:lock', 'decision:read'],
  viewer: [...READ_ONLY],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export interface AuthContext {
  session: {
    id: string;
    expiresAt: string;
    authMethod: string;
    isDemo: boolean;
  };
  user: {
    id: string;
    email: string;
    fullName: string;
    role: UserRole;
    department: string | null;
    status: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    dataResidency: string | null;
    defaultCurrency: string | null;
    countryCode: string | null;
  };
  /** Permissions effectives, calculées côté serveur (jamais reçues du client). */
  permissions: Permission[];
}

/** Rôles autorisés à administrer les utilisateurs et les invitations. */
export function canManageTeam(role: UserRole): boolean {
  return role === 'org_admin' || role === 'platform_admin';
}

/**
 * Un rôle non administrateur ne peut pas s'attribuer un rôle d'administration.
 * `org_admin` peut tout attribuer SAUF `platform_admin` (réservé à la
 * plateforme, il donne accès à toutes les organisations).
 */
export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === 'platform_admin') return true;
  if (actorRole !== 'org_admin') return false;
  return targetRole !== 'platform_admin';
}
