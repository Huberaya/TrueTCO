import { UserRole } from '../types/domain';

export type SSOProvider = 'azure_ad' | 'google_workspace' | 'auth0' | 'okta' | 'magic_link' | 'demo_local';

export interface EnterpriseUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  ssoProvider: SSOProvider;
  department?: string;
  isActive?: boolean;
  lastLoginAt?: string;
  /** Organisation de la session, décidée par le serveur (jamais par le client). */
  organizationId: string;
  organizationName?: string;
  /** Vrai si la session provient du mode de recette local (aucun fournisseur d'identité). */
  isDemoSession?: boolean;
}

export interface SSOLoginResponse {
  success: boolean;
  expiresAt: string;
  organizationId: string;
  organizationName?: string;
  organizationSlug?: string | null;
  authenticationMode?: string;
  warning?: string;
  user: EnterpriseUser;
}

/**
 * ===========================================================================
 * CLIENT D'AUTHENTIFICATION
 * ===========================================================================
 * CE QUI A CHANGÉ (sécurité) :
 *   - le jeton de session n'est PLUS stocké dans localStorage : le serveur le
 *     dépose dans un cookie HttpOnly / Secure / SameSite=Lax. Un script injecté
 *     dans la page ne peut donc plus l'exfiltrer ;
 *   - plus de « user » mis en cache côté navigateur : l'état d'authentification
 *     est TOUJOURS vérifié auprès du serveur (/api/auth/me). En cas de panne
 *     réseau, l'utilisateur est considéré non authentifié plutôt que
 *     silencieusement considéré connecté ;
 *   - le rôle n'est jamais choisi par le client : il provient de la session
 *     serveur et conditionne les vérifications de permissions côté API.
 */
export interface AuthInstanceConfig {
  /** Connecteurs OIDC/SAML réellement déployés (liste vide tant qu'aucun ne l'est). */
  federatedProviders: string[];
  /** Mode démonstration local activé par l'exploitant (sans mot de passe ni second facteur). */
  demoMode: boolean;
  mfa: boolean;
  scim: boolean;
  ssoFederation: boolean;
  note: string;
}

export const AuthService = {
  /**
   * Configuration d'authentification de l'instance, telle que le serveur la
   * déclare. L'interface ne doit afficher aucun fournisseur d'identité, aucun
   * second facteur et aucune fédération qui ne figure pas ici.
   */
  async getAuthConfig(): Promise<AuthInstanceConfig | null> {
    try {
      const response = await fetch('/api/auth/config', { credentials: 'same-origin' });
      if (!response.ok) return null;
      return (await response.json()) as AuthInstanceConfig;
    } catch {
      // Serveur injoignable : l'interface n'invente pas de configuration, elle
      // annonce simplement ne pas pouvoir la lire.
      return null;
    }
  },

  /** Connexion. En production, échoue tant qu'aucun IdP n'est branché (501). */
  async loginWithSSO(params: {
    email: string;
    /** Domaine d'organisation, pour lever l'ambiguïté si l'adresse existe ailleurs. */
    domain?: string;
  }): Promise<SSOLoginResponse> {
    const response = await fetch('/api/auth/sso/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: params.email,
        domain: params.domain ?? null,
      }),
    });

    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ error: `Échec de l'authentification (HTTP ${response.status}).` }));
      const error = new Error(err.error || `Erreur HTTP ${response.status}`) as Error & { code?: string };
      error.code = err.code;
      throw error;
    }

    // La connexion ne renvoie PAS d'identité : celle-ci est toujours relue
    // depuis la session serveur (/api/auth/me). Le navigateur ne fabrique donc
    // jamais son propre utilisateur, de rôle ou d'organisation.
    const session = (await response.json()) as { expiresAt: string; authMethod?: string; warning?: string };
    const user = await AuthService.getCurrentUser();
    if (!user) {
      throw new Error("La session a été créée mais son identité n'a pas pu être relue : réessayez.");
    }
    return {
      success: true,
      expiresAt: session.expiresAt,
      organizationId: user.organizationId,
      organizationName: user.organizationName,
      authenticationMode: session.authMethod,
      warning: session.warning,
      user,
    };
  },

  /** Vérifie la session courante auprès du serveur. */
  async getCurrentUser(): Promise<EnterpriseUser | null> {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data?.authenticated && data.user) {
        return {
          id: data.user.id,
          email: data.user.email,
          fullName: data.user.fullName,
          role: data.user.role,
          ssoProvider: data.user.ssoProvider ?? 'demo_local',
          department: data.user.department ?? undefined,
          isActive: data.user.isActive,
          organizationId: data.organization?.id ?? '',
          organizationName: data.organization?.name,
          isDemoSession: Boolean(data.session?.isDemo),
        } as EnterpriseUser;
      }
      return null;
    } catch {
      // Serveur injoignable : aucune session ne peut être considérée valide.
      return null;
    }
  },

  /** Droits effectifs renvoyés par le serveur (pour l'affichage uniquement). */
  async getSessionPermissions(): Promise<string[]> {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.permissions) ? data.permissions : [];
    } catch {
      return [];
    }
  },

  async logout(): Promise<void> {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // La session serveur reste révoquée côté API lors de sa prochaine
      // utilisation ; l'échec réseau n'est pas bloquant pour la déconnexion UI.
    }
  },

  /** Annuaire de l'organisation (nécessite la permission user:read). */
  async getEnterpriseDirectory(): Promise<EnterpriseUser[]> {
    try {
      const response = await fetch('/api/auth/users', {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : (data.users ?? []);
    } catch {
      return [];
    }
  },
};
