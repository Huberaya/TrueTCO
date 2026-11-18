import React from 'react';
import {
  LayoutDashboard,
  FolderKanban,
  Building2,
  Scale,
  TrendingUp,
  GitFork,
  Activity,
  Database,
  History,
  FileCheck,
  Award,
  Network,
  Sparkles,
  Fingerprint,
  Leaf,
} from 'lucide-react';

export type NavView =
  | 'dashboard'
  | 'chantier1'
  | 'projects'
  | 'suppliers'
  | 'comparator'
  | 'multicriteria'
  | 'breakeven'
  | 'scenarios'
  | 'sensitivity'
  | 'externalities'
  | 'audit'
  | 'report'
  | 'erp_connectors'
  | 'ai_parser'
  | 'digital_signature'
  | 'csrd_taxonomy';

interface SidebarProps {
  currentView: NavView;
  onNavigate: (view: NavView) => void;
  pendingApprovalsCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  pendingApprovalsCount = 0,
}) => {
  const navItems: { id: NavView; label: string; icon: React.ReactNode; badge?: string | number }[] = [
    {
      id: 'chantier1',
      label: 'Chantier 1 (calculs indicatifs)',
      icon: <Scale className="w-4 h-4 text-emerald-400" />,
      badge: 'Démo',
    },
    {
      id: 'dashboard',
      label: 'Tableau de bord — démo',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'comparator',
      label: 'Comparateur indicatif',
      icon: <Scale className="w-4 h-4" />,
    },
    {
      id: 'multicriteria',
      label: 'Pondérations — démo',
      icon: <Award className="w-4 h-4 text-emerald-400" />,
      badge: 'Démo',
    },
    {
      id: 'breakeven',
      label: 'Point mort — indicatif',
      icon: <TrendingUp className="w-4 h-4" />,
    },
    {
      id: 'scenarios',
      label: 'Simulateur Scénarios',
      icon: <GitFork className="w-4 h-4" />,
    },
    {
      id: 'sensitivity',
      label: 'Sensibilité — indicative',
      icon: <Activity className="w-4 h-4" />,
    },
    {
      id: 'projects',
      label: 'Chantier 3 (projets — démo)',
      icon: <FolderKanban className="w-4 h-4 text-emerald-400" />,
      badge: 'Démo',
    },
    {
      id: 'suppliers',
      label: 'Chantier 4 (fournisseurs — démo)',
      icon: <Building2 className="w-4 h-4 text-emerald-400" />,
      badge: 'Démo',
    },
    {
      id: 'externalities',
      label: 'Chantier 5 (références — non vérifiées)',
      icon: <Database className="w-4 h-4 text-emerald-400" />,
      badge: 'Démo',
    },
    {
      id: 'audit',
      label: 'Chantier 5 (journal applicatif)',
      icon: <History className="w-4 h-4 text-emerald-400" />,
      badge: 'Démo',
    },
    {
      id: 'report',
      label: 'Chantier 6 (rapport indicatif)',
      icon: <FileCheck className="w-4 h-4 text-emerald-400" />,
      badge: 'Démo',
    },
    {
      id: 'erp_connectors',
      label: 'Chantier 7 (ERP — désactivé)',
      icon: <Network className="w-4 h-4 text-sky-400" />,
      badge: 'Off',
    },
    {
      id: 'ai_parser',
      label: 'Chantier 8 (analyse docs — désactivée)',
      icon: <Sparkles className="w-4 h-4 text-purple-400" />,
      badge: 'Off',
    },
    {
      id: 'digital_signature',
      label: 'Chantier 9 (signature — désactivée)',
      icon: <Fingerprint className="w-4 h-4 text-emerald-400" />,
      badge: 'Off',
    },
    {
      id: 'csrd_taxonomy',
      label: 'Chantier 10 (CSRD — données insuffisantes)',
      icon: <Leaf className="w-4 h-4 text-teal-400" />,
      badge: 'Off',
    },
  ];

  return (
    <aside className="w-60 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col h-[calc(100vh-3.5rem)] no-print">
      <div className="p-3">
        <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 px-3 py-1.5">
          Navigation Principale
        </div>
        <nav className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white font-semibold border border-slate-800'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span className={isActive ? 'text-emerald-400' : 'text-slate-500'}>
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${
                    item.id === 'chantier1'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}>
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-slate-800/80">
        <div className="p-3 bg-slate-900/70 border border-slate-800 rounded-lg text-xs">
          <div className="flex items-center justify-between text-slate-400 text-[11px] mb-1">
            <span>Règle d'arbitrage</span>
            <span className="text-amber-300 font-mono">À valider</span>
          </div>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Résultats exploratoires : hypothèses, provenance et calculs doivent être vérifiés indépendamment.
          </p>
        </div>
      </div>
    </aside>
  );
};
