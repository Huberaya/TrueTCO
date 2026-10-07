import React, { useState } from 'react';
import { Project, ProjectStatus, ProcurementCategory, SupplierOffer } from '../types/domain';
import {
  Plus,
  FolderKanban,
  CheckCircle2,
  Clock,
  Filter,
  Search,
  ArrowRight,
  Building,
  Calendar,
  Layers,
  Archive,
  RefreshCw,
  Copy,
  Sliders,
  Scale,
  FileText,
} from 'lucide-react';
import { NavView } from './Sidebar';
import { ProjectDetailModal } from './ProjectDetailModal';

interface ProjectsViewProps {
  projects: Project[];
  currentProjectId: string;
  offers?: SupplierOffer[];
  onSelectProject: (p: Project) => void;
  onOpenNewProject: () => void;
  onNavigate: (view: NavView) => void;
  onUpdateProject?: (updated: Project) => void;
  onDuplicateProject?: (p: Project) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  projects,
  currentProjectId,
  offers = [],
  onSelectProject,
  onOpenNewProject,
  onNavigate,
  onUpdateProject,
  onDuplicateProject,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedDetailProject, setSelectedDetailProject] = useState<Project | null>(null);

  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.companyName && p.companyName.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;

    return matchesSearch && matchesStatus && matchesCategory;
  });

  const getStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case 'brouillon':
        return { label: 'Brouillon', color: 'text-slate-400 bg-slate-900 border-slate-700' };
      case 'collecte_offres':
        return { label: 'Collecte des offres', color: 'text-indigo-400 bg-indigo-950/60 border-indigo-800/60' };
      case 'analyse':
        return { label: 'En Analyse TCO', color: 'text-sky-400 bg-sky-950/60 border-sky-800/60' };
      case 'validation_finance':
        return { label: 'Validation Finance', color: 'text-amber-400 bg-amber-950/60 border-amber-800/60' };
      case 'validation_achats':
        return { label: 'Validation Achats', color: 'text-purple-400 bg-purple-950/60 border-purple-800/60' };
      case 'decision':
        return { label: 'Comité de Décision', color: 'text-emerald-400 bg-emerald-950/60 border-emerald-800/60' };
      case 'termine':
        return { label: 'Terminé / Arbitré', color: 'text-slate-300 bg-slate-800 border-slate-700' };
      case 'archive':
        return { label: 'Archivé', color: 'text-slate-500 bg-slate-950 border-slate-800' };
      default:
        return { label: status, color: 'text-slate-400 bg-slate-900 border-slate-800' };
    }
  };

  const handleStatusChange = (p: Project, newStatus: ProjectStatus) => {
    if (onUpdateProject) {
      onUpdateProject({
        ...p,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const totalBudget = projects.reduce((acc, p) => acc + p.budgetCap, 0);
  const activeCount = projects.filter((p) => p.status !== 'archive' && p.status !== 'termine').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <FolderKanban className="w-4 h-4 text-emerald-400" />
            Chantier 3 · Module « Projets & Appels d'Offres »
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Gestion du Cycle de Vie des Projets d'Achat
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Gestion multicritères conforme à la Section 5 : horizons (1, 3, 5, 7, 10 ans), volumes d'achat, gouvernance des statuts et isolation des hypothèses financières.
          </p>
        </div>

        <button
          onClick={onOpenNewProject}
          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Nouveau Projet
        </button>
      </div>

      {/* Top Quick Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Total Consultations</div>
          <div className="text-xl font-bold font-mono text-white mt-0.5">{projects.length}</div>
          <div className="text-[10px] text-slate-500">{activeCount} actives en cours</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Budget Plafond Global</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
            {totalBudget.toLocaleString('fr-FR')} €
          </div>
          <div className="text-[10px] text-slate-500">Engagements pluriannuels</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">En Attente de Visa</div>
          <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
            {projects.filter((p) => p.status === 'validation_finance' || p.status === 'validation_achats').length}
          </div>
          <div className="text-[10px] text-slate-500">Finance ou Achats</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Catégories d'Achat</div>
          <div className="text-xl font-bold font-mono text-sky-400 mt-0.5">
            {new Set(projects.map((p) => p.category)).size}
          </div>
          <div className="text-[10px] text-slate-500">Flottes, IT, Équipements...</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Rechercher par nom, entité, référence ou catégorie..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Toutes les catégories</option>
            <option value="flotte_automobile">Flotte automobile & VUL</option>
            <option value="informatique_it">Informatique IT</option>
            <option value="equipements_industriels">Équipements industriels</option>
            <option value="packaging">Packaging</option>
            <option value="energie_batiment">Énergie & Bâtiment</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Tous les 8 statuts</option>
            <option value="brouillon">Brouillon</option>
            <option value="collecte_offres">Collecte des offres</option>
            <option value="analyse">Analyse</option>
            <option value="validation_finance">Validation Finance</option>
            <option value="validation_achats">Validation Achats</option>
            <option value="decision">Décision</option>
            <option value="termine">Terminé</option>
            <option value="archive">Archivé</option>
          </select>
        </div>
      </div>

      {/* Projects List */}
      <div className="grid grid-cols-1 gap-4">
        {filteredProjects.map((p) => {
          const isSelected = p.id === currentProjectId;
          const badge = getStatusBadge(p.status);

          return (
            <div
              key={p.id}
              className={`p-5 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-slate-900 border-emerald-600/80 shadow-md ring-1 ring-emerald-500/20'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-white text-base">{p.name}</span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
                      {p.reference}
                    </span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${badge.color}`}>
                      {badge.label}
                    </span>
                    {isSelected && (
                      <span className="text-[10px] text-emerald-400 font-mono font-semibold bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                        Projet Actif
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Building className="w-3.5 h-3.5 text-slate-500" />
                      {p.companyName || 'Acme Group Europe'}
                    </span>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      Début : {p.startDate || p.createdAt.split('T')[0]} ({p.analysisDurationMonths || 3} mois d'analyse)
                    </span>
                    <span>·</span>
                    <span>Fréquence : {p.purchaseFrequency || 'unique'}</span>
                  </div>

                  <p className="text-xs text-slate-300 mt-1 leading-relaxed">{p.objective}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setSelectedDetailProject(p)}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    title="Ouvrir la fiche complète et piloter les 8 statuts du cycle de vie"
                  >
                    <Sliders className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Fiche & Cycle de Vie</span>
                  </button>

                  {onDuplicateProject && (
                    <button
                      onClick={() => onDuplicateProject(p)}
                      className="p-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg transition-colors"
                      title="Dupliquer ce projet d'achat"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Status Dropdown Controller */}
                  <select
                    value={p.status}
                    onChange={(e) => handleStatusChange(p, e.target.value as ProjectStatus)}
                    className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    title="Changer le statut du projet"
                  >
                    <option value="brouillon">1. Brouillon</option>
                    <option value="collecte_offres">2. Collecte des offres</option>
                    <option value="analyse">3. Analyse TCO</option>
                    <option value="validation_finance">4. Validation Finance</option>
                    <option value="validation_achats">5. Validation Achats</option>
                    <option value="decision">6. Comité de Décision</option>
                    <option value="termine">7. Terminé / Arbitré</option>
                    <option value="archive">8. Archivé</option>
                  </select>

                  <button
                    onClick={() => {
                      onSelectProject(p);
                      onNavigate('comparator');
                    }}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <span>Lancer TCO</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 pt-3 border-t border-slate-800/80 text-xs">
                <div>
                  <div className="text-slate-400 text-[11px]">Budget Plafond</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {p.budgetCap.toLocaleString('fr-FR')} €
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 text-[11px]">Horizon d'Analyse</div>
                  <div className="font-mono font-bold text-emerald-400 mt-0.5">
                    {p.horizonYears} ans
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 text-[11px]">Volume & Unité</div>
                  <div className="font-mono font-bold text-white mt-0.5">
                    {p.plannedVolume} {p.unitName}
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 text-[11px]">WACC Actualisation</div>
                  <div className="font-mono text-slate-300 mt-0.5">
                    {(p.discountRate * 100).toFixed(1)}% / an
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 text-[11px]">Offres Reçues</div>
                  <div className="font-mono text-emerald-400 mt-0.5 flex items-center gap-1">
                    <Scale className="w-3.5 h-3.5" />
                    <span>{offers.filter((o) => o.projectId === p.id).length} offre(s)</span>
                  </div>
                </div>

                <div>
                  <div className="text-slate-400 text-[11px]">Chef de Projet</div>
                  <div className="text-slate-200 mt-0.5 truncate">{p.ownerName}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Project Detail & Lifecycle Modal */}
      {selectedDetailProject && (
        <ProjectDetailModal
          isOpen={Boolean(selectedDetailProject)}
          onClose={() => setSelectedDetailProject(null)}
          project={selectedDetailProject}
          offers={offers}
          isActive={selectedDetailProject.id === currentProjectId}
          onSelectProject={(proj) => {
            onSelectProject(proj);
            setSelectedDetailProject(proj);
          }}
          onUpdateProject={(updated) => {
            if (onUpdateProject) onUpdateProject(updated);
            setSelectedDetailProject(updated);
          }}
          onDuplicateProject={(proj) => {
            if (onDuplicateProject) onDuplicateProject(proj);
            setSelectedDetailProject(null);
          }}
        />
      )}
    </div>
  );
};
