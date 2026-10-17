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
  FileText,
  Award,
  Sparkles,
  Calculator,
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
  | 'ai_parser';

interface SidebarProps {
  currentView: NavView;
  onNavigate: (view: NavView) => void;
}

/**
 * Navigation : libellés fonctionnels uniquement.
 * Aucune pastille d'état (« Validé », « Actif »…) : un statut affiché doit refléter un état réel mesuré.
 */
const NAV_ITEMS: { id: NavView; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Tableau de bord', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'projects', label: 'Projets d\'achat', icon: <FolderKanban className="w-4 h-4" /> },
  { id: 'comparator', label: 'Comparateur & TCO', icon: <Scale className="w-4 h-4" /> },
  { id: 'chantier1', label: 'Détail du calcul', icon: <Calculator className="w-4 h-4" /> },
  { id: 'multicriteria', label: 'Analyse multicritère', icon: <Award className="w-4 h-4" /> },
  { id: 'breakeven', label: 'Point mort', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'scenarios', label: 'Scénarios', icon: <GitFork className="w-4 h-4" /> },
  { id: 'sensitivity', label: 'Sensibilité', icon: <Activity className="w-4 h-4" /> },
  { id: 'suppliers', label: 'Fournisseurs', icon: <Building2 className="w-4 h-4" /> },
  { id: 'externalities', label: 'Référentiels & hypothèses', icon: <Database className="w-4 h-4" /> },
  { id: 'ai_parser', label: 'Extraction de documents (IA)', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'audit', label: 'Journal d\'audit', icon: <History className="w-4 h-4" /> },
  { id: 'report', label: 'Dossier de synthèse', icon: <FileText className="w-4 h-4" /> },
];

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onNavigate }) => (
  <aside className="w-60 shrink-0 bg-slate-950 border-r border-slate-800 flex flex-col h-[calc(100vh-3.5rem)] no-print">
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 px-3 py-1.5">Navigation</div>
      <nav className="space-y-0.5" aria-label="Navigation principale">
        {NAV_ITEMS.map((item) => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-slate-900 text-white font-semibold border border-slate-800'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={isActive ? 'text-emerald-400' : 'text-slate-500'}>{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </div>
            </button>
          );
        })}
      </nav>
    </div>

    <div className="mt-auto p-4 border-t border-slate-800/80">
      <p className="text-[11px] text-slate-500 leading-relaxed">
        Aide à la décision : les résultats dépendent des hypothèses saisies et de la provenance indiquée pour chaque donnée.
      </p>
    </div>
  </aside>
);
