import React, { createContext, useContext, useState, ReactNode } from 'react';
import { AuthService } from '../services/authService';

interface AuthContextType {
  user: null;
  isAuthenticated: false;
  isLoading: false;
  isLoginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  // No cached profile, local token, simulated login or role switch can authenticate.
  const value: AuthContextType = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    isLoginModalOpen,
    openLoginModal: () => setIsLoginModalOpen(true),
    closeLoginModal: () => setIsLoginModalOpen(false),
    logout: AuthService.logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
