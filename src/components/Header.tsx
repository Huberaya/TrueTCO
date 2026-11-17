import React from 'react';
import type { Project } from '../types/domain';
import { CheckCircle2, Database, Plus, ShieldCheck, UserX } from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';
import { useAuth } from '../context/AuthContext';
import { TenantSwitcher } from './TenantSwitcher';

interface HeaderProps {
  currentProject: Project;
  projects: Project[];
  onSelectProject: (proj: Project) => void;
  onOpenNewProject: () => void;
  onOpenTestsModal: () => void;
  onOpenReportModal: () => void;
  onOpenBackupModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentProject,
  projects,
  onSelectProject,
  onOpenNewProject,
  onOpenTestsModal,
  onOpenReportModal,
  onOpenBackupModal,
}) => {
  const { openLoginModal } = useAuth();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-800 bg-slate-950/95 px-5 backdrop-blur-md no-print">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 font-bold text-emerald-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="hidden sm:block">
            <span className="flex items-center gap-1.5 text-base font-extrabold tracking-tight text-white">
              TrueTCO
              <span className="rounded border border-amber-800 bg-amber-950/70 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-200">
                DÉMO — NON CONNECTÉ
              </span>
            </span>
          </div>
        </div>

        <TenantSwitcher />

        <select
          value={currentProject.id}
          onChange={(event) => {
            const selected = projects.find((project) => project.id === event.target.value);
            if (selected) onSelectProject(selected);
          }}
          aria-label="Projet de démonstration local"
          className="max-w-[200px] truncate rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs font-semibold text-slate-200"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id} className="bg-slate-900 text-slate-200">
              {project.reference} - {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={onOpenTestsModal}
          className="hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 md:flex"
          title="Tests locaux du moteur; ils ne constituent pas une certification."
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span className="hidden xl:inline">Tests locaux</span>
        </button>

        {onOpenBackupModal && (
          <button
            onClick={onOpenBackupModal}
            className="hidden items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800 sm:flex"
            title="Données locales de démonstration; aucune connexion Neon n’est utilisée."
          >
            <Database className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Données locales</span>
          </button>
        )}

        <PWAInstallButton />

        <button onClick={onOpenReportModal} className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
          Rapport Décisionnel
        </button>

        <button onClick={onOpenNewProject} className="flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600">
          <Plus className="h-3.5 w-3.5" />
          <span>Nouveau Projet (local)</span>
        </button>

        <button onClick={openLoginModal} className="flex items-center gap-1.5 rounded-lg border border-amber-800 bg-amber-950/50 px-2.5 py-1.5 text-xs text-amber-100">
          <UserX className="h-3.5 w-3.5" />
          Non connecté
        </button>
      </div>
    </header>
  );
};
