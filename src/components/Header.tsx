import React, { useState, useRef, useEffect } from 'react';
import { UserRole, Project } from '../types/domain';
import { NeonUserRecord } from '../services/neonService';
import {
  ShieldCheck,
  Plus,
  Activity,
  Database,
  LogIn,
  Check,
  Lock,
  ChevronDown,
  Building,
  LogOut,
  UserCheck,
  Key,
  Shield,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { useAuth } from '../context/AuthContext';
import { useTenant } from '../context/TenantContext';
import { TenantSwitcher } from './TenantSwitcher';

interface HeaderProps {
  currentProject: Project;
  projects: Project[];
  onSelectProject: (proj: Project) => void;
  activeRole: UserRole;
  onOpenNewProject: () => void;
  onOpenTestsModal: () => void;
  onOpenReportModal: () => void;
  onOpenBackupModal?: () => void;
  syncedUser?: NeonUserRecord | null;
  isSyncingUser?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentProject,
  projects,
  onSelectProject,
  activeRole,
  onOpenNewProject,
  onOpenTestsModal,
  onOpenReportModal,
  onOpenBackupModal,
}) => {
  const { user, isAuthenticated, logout, openLoginModal } = useAuth();
  const { currentTenant } = useTenant();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const roleLabels: Record<UserRole, string> = {
    directeur_achats: 'Dir. Achats',
    acheteur: 'Acheteur Lead',
    finance_controleur: 'Contrôleur DAF',
    rse_esg: 'Resp. RSE',
    direction_generale: 'Direction Générale',
    admin: 'Admin Plateforme',
  };

  const providerBadges: Record<string, { label: string; icon: string; border: string; bg: string }> = {
    azure_ad: { label: 'Azure AD SSO', icon: '🔷', border: 'border-sky-700/80', bg: 'bg-sky-950/80 text-sky-300' },
    google_workspace: { label: 'Google Workspace', icon: '🔴', border: 'border-rose-700/80', bg: 'bg-rose-950/80 text-rose-300' },
    auth0: { label: 'Auth0 IdP', icon: '🛡️', border: 'border-indigo-700/80', bg: 'bg-indigo-950/80 text-indigo-300' },
    okta: { label: 'Okta SAML 2.0', icon: '🌀', border: 'border-blue-700/80', bg: 'bg-blue-950/80 text-blue-300' },
    magic_link: { label: 'SSO Link', icon: '✉️', border: 'border-emerald-700/80', bg: 'bg-emerald-950/80 text-emerald-300' },
  };

  const currentProviderBadge = user ? providerBadges[user.ssoProvider] || providerBadges.azure_ad : providerBadges.azure_ad;

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-950/95 backdrop-blur-md px-5 flex items-center justify-between z-30 sticky top-0 no-print">
      {/* Brand & Project Selector */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="hidden sm:block">
            <span className="font-extrabold tracking-tight text-white flex items-center gap-1.5 text-base">
              TrueTCO
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-400 border border-emerald-800/80 font-bold">
                SSO
              </span>
            </span>
          </div>
        </div>

        {/* Multi-Tenant Enterprise Switcher */}
        <TenantSwitcher />

        {/* Project Selector dropdown */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
          <select
            value={currentProject.id}
            onChange={(e) => {
              const selected = projects.find((p) => p.id === e.target.value);
              if (selected) onSelectProject(selected);
            }}
            className="bg-transparent text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer max-w-[200px] truncate pr-2 pl-1"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id} className="bg-slate-900 text-slate-200">
                {p.reference} - {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions de service, rapport, nouveau dossier et session */}
      <div className="flex items-center gap-3">
        {/* État du service API */}
        <button
          onClick={onOpenTestsModal}
          className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
          title="Vérifier la disponibilité de l'API et de la base ; les tests s'exécutent dans Vitest/CI"
        >
          <Activity className="w-3.5 h-3.5 text-sky-400" />
          <span className="hidden xl:inline">État API</span>
        </button>

        {/* Sauvegarde locale du navigateur */}
        {onOpenBackupModal && (
          <button
            onClick={onOpenBackupModal}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
            title="Ouvrir l'export ou la restauration du jeu de données local du navigateur."
          >
            <Database className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden lg:inline text-slate-300 font-mono text-[11px]">Sauvegarde locale</span>
          </button>
        )}

        {/* PWA In-App Install Trigger */}
        <PWAInstallButton />

        {/* Executive Report Trigger */}
        <button
          onClick={onOpenReportModal}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold transition-colors"
        >
          Rapport Décisionnel
        </button>

        {/* New Project CTA */}
        <button
          onClick={onOpenNewProject}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Nouveau Projet</span>
        </button>

        {/* Rôle courant — lecture seule : le rôle est attribué par un
            administrateur et vérifié côté serveur, jamais choisi ici. */}
        <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
          <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
          <span
            className="px-2 py-1 bg-slate-900 border border-slate-700/80 rounded text-slate-200 text-xs font-medium"
            title="Rôle issu de votre session authentifiée. Toute modification doit être effectuée par un administrateur."
          >
            {roleLabels[activeRole] ?? activeRole}
          </span>
        </div>

        {/* Enterprise SSO User & Session Section */}
        <div className="relative pl-2 border-l border-slate-800" ref={dropdownRef}>
          {isAuthenticated && user ? (
            <div>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 px-2 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-700/80 rounded-lg text-xs font-medium transition-all group"
                title="Gérer la session SSO entreprise"
              >
                {/* Avatar with provider badge indicator */}
                <div className="relative">
                  <div className="w-7 h-7 rounded-full bg-emerald-950 border border-emerald-500/60 flex items-center justify-center text-emerald-300 font-bold text-xs">
                    {user.fullName
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 text-[10px]" title={currentProviderBadge.label}>
                    {currentProviderBadge.icon}
                  </span>
                </div>

                <div className="hidden lg:block text-left">
                  <div className="text-white font-semibold text-[11px] leading-tight truncate max-w-[110px]">
                    {user.fullName}
                  </div>
                  <div className="text-[10px] text-emerald-400 font-mono leading-tight">
                    {roleLabels[user.role] || user.role}
                  </div>
                </div>

                <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-transform" />
              </button>

              {/* Profile & SSO Dropdown Card */}
              {isDropdownOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-4 text-xs z-50 animate-fade-in space-y-3">
                  
                  {/* Organization & Header */}
                  <div className="pb-3 border-b border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 flex items-center gap-1 font-bold truncate max-w-[170px]">
                        <Building className="w-3 h-3 text-emerald-400 shrink-0" />
                        {currentTenant.name}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border ${currentProviderBadge.border} ${currentProviderBadge.bg}`}>
                        {currentProviderBadge.label}
                      </span>
                    </div>
                    <div className="font-bold text-white text-sm">{user.fullName}</div>
                    <div className="text-[11px] text-slate-400 truncate">{user.email}</div>
                    <div className="text-[10px] text-emerald-400">{user.department}</div>
                  </div>

                  {/* SSO Session Security Status */}
                  <div className="p-2.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-1.5 text-[11px]">
                    <div className="flex items-center justify-between text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-emerald-400" />
                        Statut de Session
                      </span>
                      <span className="text-emerald-400 font-mono text-[10px] font-bold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        Active (24h)
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Session vérifiée par le serveur (cookie HttpOnly)
                    </div>
                  </div>

                  {/* Rôle de session (lecture seule) */}
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-medium block">
                      Rôle attribué par l'administrateur :
                    </label>
                    <div className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 text-xs font-semibold">
                      {roleLabels[activeRole] ?? activeRole}
                    </div>
                    <p className="text-[10px] text-slate-500 leading-relaxed">
                      Les droits sont appliqués côté serveur à partir de votre session. Aucun
                      changement de rôle n'est possible depuis l'interface.
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-800 space-y-2">
                    <button
                      onClick={() => {
                        setIsDropdownOpen(false);
                        openLoginModal();
                      }}
                      className="w-full py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <UserCheck className="w-3.5 h-3.5 text-sky-400" />
                      <span>Changer de Compte SSO</span>
                    </button>

                    <button
                      onClick={async () => {
                        setIsDropdownOpen(false);
                        await logout();
                      }}
                      className="w-full py-1.5 px-3 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/80 text-rose-300 rounded-lg font-medium text-xs flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5 text-rose-400" />
                      <span>Déconnexion de Session</span>
                    </button>
                  </div>

                </div>
              )}
            </div>
          ) : (
            <button
              onClick={openLoginModal}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors shadow-md shadow-emerald-950/40"
              title="Connexion SSO Entreprise (Azure AD, Google, Auth0, Okta)"
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Connexion SSO</span>
            </button>
          )}
        </div>

      </div>
    </header>
  );
};
