import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AuthService, EnterpriseUser, SSOProvider } from '../services/authService';

interface AuthContextType {
  user: EnterpriseUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** Message d'erreur éventuel de la dernière tentative de connexion. */
  authError: string | null;
  isLoginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  loginWithSSO: (params: {
    email: string;
    ssoProvider: SSOProvider;
    fullName?: string;
    department?: string;
  }) => Promise<EnterpriseUser>;
  logout: () => Promise<void>;
  /** Droits renvoyés par le serveur — utilisés uniquement pour l'affichage. */
  permissions: string[];
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * ===========================================================================
 * ÉTAT D'AUTHENTIFICATION — PRINCIPES
 * ===========================================================================
 * 1. AUCUNE session n'est créée automatiquement. La version précédente
 *    connectait chaque visiteur avec un compte de démonstration codé en dur
 *    (« Sophie Valéry », directeur des achats @ acme.com) dès le chargement de
 *    la page : l'application s'ouvrait donc déjà authentifiée pour n'importe
 *    qui, sur un tenant par défaut.
 * 2. L'état est TOUJOURS vérifié auprès du serveur. Si le serveur ne répond pas,
 *    l'utilisateur n'est pas authentifié.
 * 3. Le rôle est FOURNI par le serveur et n'est pas modifiable dans
 *    l'interface : un sélecteur de rôle côté client ne peut pas accorder de
 *    droits, mais il laissait croire le contraire (et masquait l'absence de
 *    contrôle serveur).
 */
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<EnterpriseUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const refreshSession = useCallback(async () => {
    const remoteUser = await AuthService.getCurrentUser();
    setUser(remoteUser);
    setPermissions(remoteUser ? await AuthService.getSessionPermissions() : []);
  }, []);

  useEffect(() => {
    let isMounted = true;
    refreshSession()
      .catch(() => {
        if (isMounted) setUser(null);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [refreshSession]);

  const loginWithSSO = async (params: {
    email: string;
    ssoProvider: SSOProvider;
    fullName?: string;
    department?: string;
  }) => {
    setIsLoading(true);
    setAuthError(null);
    try {
      const res = await AuthService.loginWithSSO(params);
      setUser(res.user);
      setPermissions(await AuthService.getSessionPermissions());
      setIsLoginModalOpen(false);
      return res.user;
    } catch (err: any) {
      setAuthError(err?.message ?? "Échec de l'authentification.");
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await AuthService.logout();
      setUser(null);
      setPermissions([]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        authError,
        isLoginModalOpen,
        openLoginModal: () => setIsLoginModalOpen(true),
        closeLoginModal: () => setIsLoginModalOpen(false),
        loginWithSSO,
        logout,
        permissions,
        refreshSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
