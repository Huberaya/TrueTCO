import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthService, EnterpriseUser, SSOProvider } from '../services/authService';
import { UserRole } from '../types/domain';

interface AuthContextType {
  user: EnterpriseUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isLoginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  loginWithSSO: (params: {
    email: string;
    ssoProvider: SSOProvider;
    fullName?: string;
    role?: UserRole;
    department?: string;
  }) => Promise<EnterpriseUser>;
  logout: () => Promise<void>;
  switchRole: (newRole: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Default Corporate user (Sophie Valéry - Azure AD SSO)
const DEFAULT_ENTERPRISE_USER: EnterpriseUser = {
  id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  email: 'sophie.valery@acme.com',
  fullName: 'Sophie Valéry',
  role: 'directeur_achats',
  ssoProvider: 'azure_ad',
  department: 'Direction des Achats Groupe',
  isActive: true,
  lastLoginAt: new Date().toISOString(),
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<EnterpriseUser | null>(() => {
    return AuthService.getCachedUser() || DEFAULT_ENTERPRISE_USER;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Verify session with Neon backend on startup
    AuthService.getCurrentUser()
      .then((remoteUser) => {
        if (!isMounted) return;
        if (remoteUser) {
          setUser(remoteUser);
        } else {
          // If no remote session token, auto-provision default enterprise session with Azure AD
          AuthService.loginWithSSO({
            email: DEFAULT_ENTERPRISE_USER.email,
            ssoProvider: DEFAULT_ENTERPRISE_USER.ssoProvider,
            fullName: DEFAULT_ENTERPRISE_USER.fullName,
            role: DEFAULT_ENTERPRISE_USER.role,
            department: DEFAULT_ENTERPRISE_USER.department,
          })
            .then((res) => {
              if (isMounted) setUser(res.user);
            })
            .catch((err) => {
              console.warn('Auto-login fallback error:', err);
              if (isMounted) setUser(DEFAULT_ENTERPRISE_USER);
            });
        }
      })
      .catch(() => {
        if (isMounted) setUser(DEFAULT_ENTERPRISE_USER);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const loginWithSSO = async (params: {
    email: string;
    ssoProvider: SSOProvider;
    fullName?: string;
    role?: UserRole;
    department?: string;
  }) => {
    setIsLoading(true);
    try {
      const res = await AuthService.loginWithSSO(params);
      setUser(res.user);
      setIsLoginModalOpen(false);
      return res.user;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await AuthService.logout();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const switchRole = (newRole: UserRole) => {
    if (!user) return;
    const updated: EnterpriseUser = {
      ...user,
      role: newRole,
    };
    setUser(updated);
    AuthService.setCachedUser(updated);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        isLoginModalOpen,
        openLoginModal: () => setIsLoginModalOpen(true),
        closeLoginModal: () => setIsLoginModalOpen(false),
        loginWithSSO,
        logout,
        switchRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
