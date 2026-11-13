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

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<EnterpriseUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // Cached user data is not proof of identity. Only a server-verified session may authenticate.
    AuthService.getCurrentUser()
      .then((remoteUser) => {
        if (isMounted) setUser(remoteUser);
      })
      .catch(() => {
        if (isMounted) setUser(null);
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
