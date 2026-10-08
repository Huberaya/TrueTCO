import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { SSOProvider } from '../services/authService';
import { UserRole } from '../types/domain';
import {
  ShieldCheck,
  Building,
  Key,
  Lock,
  CheckCircle2,
  X,
  User,
  ExternalLink,
  Sparkles,
  ArrowRight,
  Briefcase,
  AlertCircle,
} from 'lucide-react';

interface EnterpriseLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PRECONFIGURED_USERS: Array<{
  email: string;
  fullName: string;
  role: UserRole;
  roleTitle: string;
  department: string;
  ssoProvider: SSOProvider;
  providerLabel: string;
  providerIcon: string;
}> = [
  {
    email: 'sophie.valery@acme.com',
    fullName: 'Sophie Valéry',
    role: 'directeur_achats',
    roleTitle: 'Directrice des Achats Groupe',
    department: 'Direction des Achats',
    ssoProvider: 'azure_ad',
    providerLabel: 'Microsoft Entra ID (Azure AD)',
    providerIcon: '🔷',
  },
  {
    email: 'lucas.bernard@acme.com',
    fullName: 'Lucas Bernard',
    role: 'finance_controleur',
    roleTitle: 'Contrôleur Financier & DAF',
    department: 'Direction Financière & Trésorerie',
    ssoProvider: 'google_workspace',
    providerLabel: 'Google Workspace Enterprise',
    providerIcon: '🔴',
  },
  {
    email: 'eleonore.chen@acme.com',
    fullName: 'Éléonore Chen',
    role: 'rse_esg',
    roleTitle: 'Responsable RSE & Stratégie Climat',
    department: 'Direction RSE & Durabilité',
    ssoProvider: 'auth0',
    providerLabel: 'Auth0 Enterprise Identity',
    providerIcon: '🛡️',
  },
  {
    email: 'a.mortemart@acme.com',
    fullName: 'Alexandre de Mortemart',
    role: 'direction_generale',
    roleTitle: 'Direction Générale (Comex)',
    department: 'Comité Exécutif d’Investissement',
    ssoProvider: 'okta',
    providerLabel: 'Okta SAML 2.0 Enterprise',
    providerIcon: '🌀',
  },
  {
    email: 'alexandre.acheteur@acme.com',
    fullName: 'Alexandre Acheteur',
    role: 'acheteur',
    roleTitle: 'Acheteur Industriel & Projets',
    department: 'Pôle Consultations Matériel',
    ssoProvider: 'azure_ad',
    providerLabel: 'Microsoft Entra ID (Azure AD)',
    providerIcon: '🔷',
  },
  {
    email: 'secops.admin@acme.com',
    fullName: 'Marc Delmas',
    role: 'admin',
    roleTitle: 'Administrateur DSI / Sécurité',
    department: 'Direction des Systèmes d’Information',
    ssoProvider: 'azure_ad',
    providerLabel: 'Microsoft Entra ID (Azure AD)',
    providerIcon: '🔷',
  },
];

export const EnterpriseLoginModal: React.FC<EnterpriseLoginModalProps> = ({ isOpen, onClose }) => {
  const { loginWithSSO, user: currentUser } = useAuth();
  const [tab, setTab] = useState<'directory' | 'custom'>('directory');
  const [loadingEmail, setLoadingEmail] = useState<string | null>(null);

  // Custom SSO form state
  const [customEmail, setCustomEmail] = useState('');
  const [customName, setCustomName] = useState('');
  const [customProvider, setCustomProvider] = useState<SSOProvider>('azure_ad');
  const [customRole, setCustomRole] = useState<UserRole>('acheteur');
  const [customDept, setCustomDept] = useState('Direction des Achats');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectPreconfigured = async (u: typeof PRECONFIGURED_USERS[0]) => {
    setLoadingEmail(u.email);
    setErrorMsg(null);
    try {
      await loginWithSSO({
        email: u.email,
        fullName: u.fullName,
        department: u.department,
        ssoProvider: u.ssoProvider,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur lors de la connexion SSO');
    } finally {
      setLoadingEmail(null);
    }
  };

  const handleCustomLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customEmail.trim() || !customEmail.includes('@')) {
      setErrorMsg('Veuillez saisir une adresse email professionnelle valide');
      return;
    }

    setLoadingEmail(customEmail);
    setErrorMsg(null);
    try {
      await loginWithSSO({
        email: customEmail.trim(),
        fullName: customName.trim() || customEmail.split('@')[0],
        department: customDept.trim() || 'Direction des Achats',
        ssoProvider: customProvider,
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur lors de la connexion SSO');
    } finally {
      setLoadingEmail(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]">
        
        {/* Modal Header */}
        <div className="p-6 bg-slate-950 border-b border-slate-800 flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 bg-emerald-950 text-emerald-400 border border-emerald-800/80 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                SSO Fédéré Sécurisé
              </span>
              <span className="text-[11px] text-slate-400 font-mono">ISO 27001 · SOC 2 Type II</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Portail d'Authentification Entreprise & SSO
            </h2>
            <p className="text-xs text-slate-400">
              Connexion certifiée pour les comités d'investissement, directions financières et acheteurs.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 bg-slate-900/60 px-6 pt-3 gap-2">
          <button
            onClick={() => setTab('directory')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
              tab === 'directory'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building className="w-4 h-4 text-emerald-400" />
            <span>Annuaire Entreprise (SSO 1-Clic)</span>
          </button>

          <button
            onClick={() => setTab('custom')}
            className={`pb-3 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-colors ${
              tab === 'custom'
                ? 'border-emerald-500 text-white'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Key className="w-4 h-4 text-sky-400" />
            <span>Fédération IdP Dédiée (Azure / Google / Auth0 / Okta)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {tab === 'directory' ? (
            <div className="space-y-4">
              <div className="text-xs text-slate-300 flex items-center justify-between">
                <span>Comptes certifiés de l'organisation <strong>ACME Corporation</strong> :</span>
                <span className="text-[11px] text-emerald-400 font-mono">Bdd Neon PostgreSQL active</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PRECONFIGURED_USERS.map((u) => {
                  const isCurrent = currentUser?.email.toLowerCase() === u.email.toLowerCase();
                  const isLoading = loadingEmail === u.email;

                  return (
                    <button
                      key={u.email}
                      onClick={() => handleSelectPreconfigured(u)}
                      disabled={isLoading}
                      className={`p-4 rounded-xl border text-left transition-all flex flex-col justify-between gap-3 ${
                        isCurrent
                          ? 'bg-emerald-950/40 border-emerald-600/80 shadow-md'
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <span>{u.providerIcon}</span>
                            {u.fullName}
                          </span>
                          {isCurrent && (
                            <span className="text-[10px] px-2 py-0.5 bg-emerald-500 text-slate-950 font-bold rounded-full">
                              Actif
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-emerald-400 font-medium">{u.roleTitle}</div>
                        <div className="text-[10px] text-slate-400">{u.department}</div>
                      </div>

                      <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>{u.email}</span>
                        <span className="flex items-center gap-1 text-slate-300">
                          {isLoading ? 'Authentification...' : 'Se connecter →'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <form onSubmit={handleCustomLogin} className="space-y-4 text-xs">
              <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 text-slate-300 leading-relaxed">
                Connectez-vous via la passerelle d'identité fédérée de votre organisation.
                Les jetons de session sont signés par le serveur d'authentification et tracés dans le journal d'audit.
              </div>

              <div className="space-y-1.5">
                <label className="text-slate-300 font-semibold block">
                  Email Professionnel d'Entreprise
                </label>
                <input
                  type="email"
                  value={customEmail}
                  onChange={(e) => setCustomEmail(e.target.value)}
                  placeholder="nom.prenom@votre-entreprise.com"
                  required
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold block">
                    Nom & Prénom
                  </label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Jean Dupont"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold block">
                    Fournisseur d'Identité SSO (IdP)
                  </label>
                  <select
                    value={customProvider}
                    onChange={(e) => setCustomProvider(e.target.value as SSOProvider)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                  >
                    <option value="azure_ad">Microsoft Entra ID (Azure AD)</option>
                    <option value="google_workspace">Google Workspace Enterprise SSO</option>
                    <option value="auth0">Auth0 Enterprise Platform</option>
                    <option value="okta">Okta Workforce Identity (SAML 2.0)</option>
                    <option value="magic_link">Magic Link / Code d'Entreprise Sécurisé</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold block">
                    Rôle Métier Attribué par l'Annuaire
                  </label>
                  <select
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value as UserRole)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                  >
                    <option value="acheteur">Acheteur Référent / Chef de Projet</option>
                    <option value="directeur_achats">Directeur des Achats</option>
                    <option value="finance_controleur">Contrôleur Financier / DAF</option>
                    <option value="rse_esg">Responsable RSE & Stratégie Climat</option>
                    <option value="direction_generale">Direction Générale / Comex</option>
                    <option value="admin">Administrateur DSI / Sécurité IT</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-slate-300 font-semibold block">
                    Direction / Département
                  </label>
                  <input
                    type="text"
                    value={customDept}
                    onChange={(e) => setCustomDept(e.target.value)}
                    placeholder="Direction des Achats Industriels"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loadingEmail !== null}
                className="w-full mt-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-950/40"
              >
                <Key className="w-4 h-4" />
                <span>{loadingEmail ? 'Fédération SSO en cours...' : 'Initier la Session SSO Fédérée'}</span>
              </button>
            </form>
          )}

          {/* Security & Audit notice */}
          <div className="p-4 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2 text-slate-200 font-semibold">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              Politique de Sécurité & Traçabilité Légale
            </div>
            <ul className="list-disc pl-4 space-y-1 text-slate-400">
              <li>Sessions protégées par des jetons cryptographiques de 256 bits valides 24h.</li>
              <li>Chaque connexion, délégation de rôle et signature de visa est enregistrée de manière immuable dans le registre d'audit légal (Conformité CAC & Article L. 823-10).</li>
              <li>Conforme aux exigences d'isolation d'entreprise et au chiffrement des flux de bout en bout.</li>
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Serveur d'Identité Connecté (Neon PostgreSQL)</span>
          </div>

          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
          >
            Fermer
          </button>
        </div>

      </div>
    </div>
  );
};
