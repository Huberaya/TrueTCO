export const AUTH_UNAVAILABLE_MESSAGE =
  'Connexion indisponible : aucun parcours d’authentification utilisateur n’est configuré.';

/** Legacy local sessions and simulated SSO are unsupported. */
export const AuthService = {
  getToken(): null {
    return null;
  },

  getCachedUser(): null {
    return null;
  },

  async getCurrentUser(): Promise<null> {
    return null;
  },

  async logout(): Promise<void> {
    // No local or server-side legacy session is supported.
  },

  async getEnterpriseDirectory(): Promise<[]> {
    return [];
  },
};
