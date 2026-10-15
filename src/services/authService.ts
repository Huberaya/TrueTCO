import { UserRole } from '../types/domain';
import { apiFetch } from './apiClient';

/** 'clerk' = identité vérifiée par le serveur ; 'demo' = profil local fictif, sans aucun droit serveur. */
export type SSOProvider = 'clerk' | 'demo';

export interface EnterpriseUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  ssoProvider: SSOProvider;
  department: string;
  isActive?: boolean;
  lastLoginAt?: string;
}

export interface Membership {
  userId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: UserRole;
}

export interface ServerSession {
  user: EnterpriseUser | null;
  organizationId: string | null;
  memberships: Membership[];
  needsOnboarding: boolean;
  isPlatformAdmin: boolean;
}

export const AuthService = {
  /** Session telle que connue du SERVEUR (rôle et organisation issus de la base, jamais du client). */
  async fetchSession(tenantId?: string): Promise<ServerSession> {
    const res = await apiFetch('/api/auth/me', {}, { tenantId });
    if (!res.ok) throw new Error(`Session indisponible (HTTP ${res.status})`);
    const data = await res.json();
    return {
      user: data.user ?? null,
      organizationId: data.organizationId ?? null,
      memberships: data.memberships ?? [],
      needsOnboarding: !!data.needsOnboarding,
      isPlatformAdmin: !!data.isPlatformAdmin,
    };
  },
};
