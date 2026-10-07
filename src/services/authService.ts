import { UserRole } from '../types/domain';

export type SSOProvider = 'azure_ad' | 'google_workspace' | 'auth0' | 'okta' | 'magic_link';

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

export interface SSOLoginResponse {
  success: boolean;
  token: string;
  expiresAt: string;
  user: EnterpriseUser;
}

const TOKEN_KEY = 'truetco_enterprise_sso_token';
const USER_KEY = 'truetco_enterprise_sso_user';

export const AuthService = {
  getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TOKEN_KEY);
  },

  setToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TOKEN_KEY, token);
  },

  clearSession(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },

  getCachedUser(): EnterpriseUser | null {
    if (typeof window === 'undefined') return null;
    try {
      const stored = localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  },

  setCachedUser(user: EnterpriseUser): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  // Login via Enterprise SSO provider
  async loginWithSSO(params: {
    email: string;
    ssoProvider: SSOProvider;
    fullName?: string;
    role?: UserRole;
    department?: string;
  }): Promise<SSOLoginResponse> {
    const response = await fetch('/api/auth/sso/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Échec de la connexion SSO' }));
      throw new Error(err.error || `Erreur HTTP ${response.status}`);
    }

    const data: SSOLoginResponse = await response.json();
    this.setToken(data.token);
    this.setCachedUser(data.user);
    return data;
  },

  // Check current session validity against backend
  async getCurrentUser(): Promise<EnterpriseUser | null> {
    const token = this.getToken();
    if (!token) return null;

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        this.clearSession();
        return null;
      }

      const data = await response.json();
      if (data.authenticated && data.user) {
        this.setCachedUser(data.user);
        return data.user;
      }
      return null;
    } catch (err) {
      console.warn('Network error while checking SSO session, fallback to cached user:', err);
      return this.getCachedUser();
    }
  },

  // Logout current session
  async logout(): Promise<void> {
    const token = this.getToken();
    if (token) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ token }),
        });
      } catch (err) {
        console.warn('Failed to invalidate session on server:', err);
      }
    }
    this.clearSession();
  },

  // Fetch all corporate users in enterprise directory
  async getEnterpriseDirectory(): Promise<EnterpriseUser[]> {
    try {
      const response = await fetch('/api/auth/users');
      if (!response.ok) return [];
      return await response.json();
    } catch (err) {
      console.error('Failed to fetch enterprise directory:', err);
      return [];
    }
  },
};
