import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useAuth as useClerkAuth } from '@clerk/clerk-react';
import { AuthService, EnterpriseUser, Membership } from '../services/authService';
import { UserRole } from '../types/domain';
import { ACTIVE_TENANT_KEY, purgeLegacySessionArtifacts, setActiveTenant, setTokenProvider } from '../services/apiClient';
import { AuthLoadingScreen, AuthErrorScreen, OnboardingScreen, SignInScreen } from '../components/AuthScreens';

export const CLERK_ENABLED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

interface AuthContextType {
  user: EnterpriseUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** true : profil local fictif, aucune donnée n'est lue ni écrite sur le serveur. */
  isDemo: boolean;
  memberships: Membership[];
  isLoginModalOpen: boolean;
  openLoginModal: () => void;
  closeLoginModal: () => void;
  logout: () => Promise<void>;
  /** Démonstration uniquement : en mode connecté, le rôle est imposé par le serveur. */
  switchRole: (newRole: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_USER: EnterpriseUser = {
  id: 'demo-user',
  email: 'demo@truetco.local',
  fullName: 'Profil de démonstration',
  role: 'directeur_achats',
  ssoProvider: 'demo',
  department: 'Démonstration locale',
  isActive: true,
};

/** Mode démo : pas de Clerk configuré. Aucune requête serveur n'est émise. */
const DemoAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<EnterpriseUser>(DEMO_USER);
  const [isLoginModalOpen, setLoginModalOpen] = useState(false);

  useEffect(() => {
    purgeLegacySessionArtifacts();
    setTokenProvider(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user, isAuthenticated: true, isLoading: false, isDemo: true, memberships: [],
        isLoginModalOpen, openLoginModal: () => setLoginModalOpen(true), closeLoginModal: () => setLoginModalOpen(false),
        logout: async () => undefined,
        switchRole: (role) => setUser((u) => ({ ...u, role })),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

/** Mode connecté : identité Clerk, rôle et organisation lus auprès du serveur. */
const ClerkAuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isLoaded, isSignedIn, getToken, signOut } = useClerkAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [user, setUser] = useState<EnterpriseUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isLoginModalOpen, setLoginModalOpen] = useState(false);

  const loadSession = useCallback(async () => {
    setStatus('loading');
    try {
      let session = await AuthService.fetchSession();
      // Réutilise la dernière organisation choisie SI l'utilisateur en est membre (le serveur revérifie).
      const stored = localStorage.getItem(ACTIVE_TENANT_KEY);
      const wanted = session.memberships.find((m) => m.organizationId === stored)?.organizationId ?? session.organizationId;
      if (wanted && wanted !== session.organizationId) session = await AuthService.fetchSession(wanted);
      setActiveTenant(wanted ?? null);
      setUser(session.user);
      setMemberships(session.memberships);
      setNeedsOnboarding(session.needsOnboarding);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    purgeLegacySessionArtifacts();
    if (!isLoaded) return;
    if (!isSignedIn) {
      setTokenProvider(null);
      setUser(null);
      setMemberships([]);
      setStatus('ready');
      return;
    }
    setTokenProvider(() => getTokenRef.current());
    void loadSession();
  }, [isLoaded, isSignedIn, loadSession]);

  const logout = useCallback(async () => {
    setTokenProvider(null);
    setUser(null);
    await signOut();
  }, [signOut]);

  if (!isLoaded || (isSignedIn && status === 'loading')) return <AuthLoadingScreen />;
  if (!isSignedIn) return <SignInScreen />;
  if (status === 'error') return <AuthErrorScreen onRetry={loadSession} onLogout={logout} />;
  if (needsOnboarding || !user) return <OnboardingScreen onCreated={loadSession} onLogout={logout} />;

  return (
    <AuthContext.Provider
      value={{
        user, isAuthenticated: true, isLoading: false, isDemo: false, memberships,
        isLoginModalOpen, openLoginModal: () => setLoginModalOpen(true), closeLoginModal: () => setLoginModalOpen(false),
        logout,
        switchRole: () => undefined, // le rôle est celui du serveur : non modifiable côté client
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) =>
  CLERK_ENABLED ? <ClerkAuthProvider>{children}</ClerkAuthProvider> : <DemoAuthProvider>{children}</DemoAuthProvider>;

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
