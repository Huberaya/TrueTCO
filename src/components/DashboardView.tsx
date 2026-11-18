import React, { useState } from 'react';
import { Project, SupplierOffer, UserRole } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import {
  TrendingUp,
  Leaf,
  FileCheck2,
  ArrowRight,
  FolderKanban,
  Sparkles,
  CheckCircle2,
  Clock,
  Eye,
  BarChart3,
} from 'lucide-react';
import { NavView } from './Sidebar';

interface DashboardViewProps {
  project: Project;
  projects: Project[];
  offers: SupplierOffer[];
  activeRole: UserRole;
  onNavigate: (view: NavView) => void;
  onSelectProject: (proj: Project) => void;
  onUpdateProject?: (updated: Project) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  project,
  projects,
  offers,
  activeRole,
  onNavigate,
  onSelectProject,
}) => {
  // Executive Mode Toggle (Vue Dirigeant Synthétique vs Vue Contrôle de Gestion)
  const [executiveMode, setExecutiveMode] = useState<boolean>(true);

  // Approval notification state

  // Calculate results for the active project
  const currentOffers = offers.filter((o) => o.projectId === project.id);
  const activeResults = currentOffers.map((offer) => ({
    offer,
    calc: TCOEngine.calculateOfferTCO(project, offer),
  }));

  const convOffer = activeResults.find((r) => !r.offer.isResponsibleCandidate) || activeResults[0];
  const respOffer = activeResults.find((r) => r.offer.isResponsibleCandidate) || activeResults[1] || activeResults[0];

  const breakEven = convOffer && respOffer
    ? TCOEngine.calculateBreakEven(convOffer.calc, respOffer.calc, project.horizonYears)
    : null;

  // Potential savings (Nominal TCO difference between conventional and responsible winner)
  const currentProjectSavings = convOffer && respOffer
    ? Math.max(0, convOffer.calc.totalComprehensiveTCO - respOffer.calc.totalComprehensiveTCO)
    : 0;

  // Avoided emissions for current project
  const currentAvoidedEmissions = convOffer && respOffer
    ? Math.max(0, convOffer.calc.totalLifecycleCO2eTonnes - respOffer.calc.totalLifecycleCO2eTonnes)
    : 0;

  // Avoided risk exposure
  const currentAvoidedRisks = convOffer && respOffer
    ? Math.max(0, convOffer.calc.riskExpositionTotal - respOffer.calc.riskExpositionTotal)
    : 0;

  // Global KPIs across ALL projects in portfolio
  const totalAnalyzedBudget = projects.reduce((acc, p) => acc + p.budgetCap, 0);
  const totalSuppliersCount = new Set(offers.map((o) => o.supplierName)).size;
  const pendingValidationProjects = projects.filter(
    (p) => p.status === 'validation_finance' || p.status === 'validation_achats' || p.status === 'decision'
  );

  // Indicative savings for the active project only; not a validated portfolio total.
  const portfolioSavings = currentProjectSavings;
  const portfolioAvoidedEmissions = currentAvoidedEmissions;

  // Best choice for active project
  const sortedByTCO = [...activeResults].sort((a, b) => a.calc.totalComprehensiveTCO - b.calc.totalComprehensiveTCO);
  const bestChoice = sortedByTCO[0];

  // Cheapest upfront capex
  const sortedByInitial = [...activeResults].sort((a, b) => a.calc.apparentDirectCost - b.calc.apparentDirectCost);
  const cheapestInitial = sortedByInitial[0];



  return (
    <div className="space-y-6">
      {/* Top Header & Executive Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            Chantier 2 · Dashboard Direction & Pilotage Stratégique
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Tableau de bord de démonstration — analyses indicatives
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Vue de démonstration fondée sur les données affichées localement. Les hypothèses, sources, calculs et résultats ne sont pas vérifiés.
          </p>
        </div>

        {/* View Mode Segmented Control */}
        <div className="flex items-center gap-2">
          <div className="flex items-center p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <button
              onClick={() => setExecutiveMode(true)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                executiveMode
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Vue Synthétique Dirigeant
            </button>
            <button
              onClick={() => setExecutiveMode(false)}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                !executiveMode
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Vue Analyste DAF / Achats
            </button>
          </div>

          <button
            onClick={() => onNavigate('comparator')}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <span>Détail Comparateur</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Approval Feedback Flash Banner */}


      {/* EXECUTIVE SYNTHESIS SECTION (SECTION 22) */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              Simulation indicative — aucune décision enregistrée
            </span>
            <h3 className="text-lg font-bold text-white mt-0.5">
              {project.name}
            </h3>
            <div className="text-xs text-slate-400 font-mono mt-0.5">
              Réf : {project.reference} · Périmètre : {project.plannedVolume} {project.unitName} sur {project.horizonYears} ans
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[11px] text-slate-400">Statut consultation</span>
              <div className="font-mono text-xs font-semibold text-emerald-400 uppercase">
                {project.status.replace(/_/g, ' ')} — démo
              </div>
            </div>
          </div>
        </div>

        {/* 6 Key Macro Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Budget saisi</span>
            <div className="text-lg font-bold font-mono text-white tabular-nums">
              {project.budgetCap.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[10px] text-slate-500">Plafond budgétaire saisi</div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">TCO modélisé — non vérifié</span>
            <div className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
              {bestChoice ? `${bestChoice.calc.totalComprehensiveTCO.toLocaleString('fr-FR')} €` : '-'}
            </div>
            <div className="text-[10px] text-slate-500">{bestChoice?.offer.supplierName}</div>
          </div>

          <div className="p-3 bg-slate-950 border border-emerald-900/60 rounded-xl space-y-1 bg-gradient-to-br from-slate-950 to-emerald-950/20">
            <span className="text-[10px] text-emerald-400 uppercase tracking-wider">Écart TCO modélisé</span>
            <div className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
              +{currentProjectSavings.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[10px] text-slate-400">écart entre offres de démonstration</div>
          </div>

          <div className="p-3 bg-slate-950 border border-sky-900/60 rounded-xl space-y-1">
            <span className="text-[10px] text-sky-400 uppercase tracking-wider">Différence carbone calculée</span>
            <div className="text-lg font-bold font-mono text-sky-400 tabular-nums">
              {currentAvoidedEmissions} <span className="text-xs font-sans">tCO2e</span>
            </div>
            <div className="text-[10px] text-slate-500">{project.carbonPricePerTonne} €/t tutélaire</div>
          </div>

          <div className="p-3 bg-slate-950 border border-indigo-900/60 rounded-xl space-y-1">
            <span className="text-[10px] text-indigo-400 uppercase tracking-wider">Point mort indicatif</span>
            <div className="text-lg font-bold font-mono text-white tabular-nums">
              {breakEven?.breakEvenMonth ? `${breakEven.breakEvenMonth} mois` : 'Immédiat'}
            </div>
            <div className="text-[10px] text-slate-400">Amortissement CAPEX</div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-[10px] text-amber-400 uppercase tracking-wider">Écart d’exposition au risque</span>
            <div className="text-lg font-bold font-mono text-amber-400 tabular-nums">
              +{currentAvoidedRisks.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[10px] text-slate-500">Différence calculée sur les hypothèses saisies</div>
          </div>
        </div>

        {/* Visual Decision Chart: Upfront Price vs Total Real Cost */}
        <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Comparaison indicative : prix facial et TCO calculé
              </h4>
              <p className="text-[11px] text-slate-400">
                Comparaison calculée à partir des valeurs saisies; elle ne vérifie ni les prix, ni les unités, ni les hypothèses.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-3 h-3 rounded-sm bg-slate-600" /> Prix facial saisi
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-3 h-3 rounded-sm bg-emerald-500" /> TCO calculé — indicatif
              </span>
            </div>
          </div>

          {/* Comparative Bars */}
          <div className="space-y-4 pt-2">
            {activeResults.map(({ offer, calc }) => {
              const maxVal = Math.max(...activeResults.map((r) => r.calc.totalComprehensiveTCO)) * 1.05;
              const upfrontPct = (calc.apparentDirectCost / maxVal) * 100;
              const tcoPct = (calc.totalComprehensiveTCO / maxVal) * 100;
              const isBest = calc.totalComprehensiveTCO === bestChoice?.calc.totalComprehensiveTCO;

              return (
                <div key={offer.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white">{offer.supplierName}</span>
                      {offer.isResponsibleCandidate && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded font-medium">
                          Candidate déclarée
                        </span>
                      )}
                      {isBest && (
                        <span className="text-[10px] text-emerald-300 bg-emerald-600/30 border border-emerald-500/50 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> TCO calculé le plus bas — non validé
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-xs text-slate-300">
                      Facial : <strong className="text-white">{calc.apparentDirectCost.toLocaleString('fr-FR')} €</strong>{' '}
                      → TCO calculé (indicatif) :{' '}
                      <strong className={isBest ? 'text-emerald-400 font-extrabold' : 'text-white'}>
                        {calc.totalComprehensiveTCO.toLocaleString('fr-FR')} €
                      </strong>
                    </div>
                  </div>

                  <div className="space-y-1">
                    {/* Bar 1: Upfront */}
                    <div className="h-2.5 bg-slate-900 rounded overflow-hidden">
                      <div
                        style={{ width: `${upfrontPct}%` }}
                        className="h-full bg-slate-600 rounded transition-all"
                      />
                    </div>
                    {/* Bar 2: Total TCO */}
                    <div className="h-3.5 bg-slate-900 rounded overflow-hidden">
                      <div
                        style={{ width: `${tcoPct}%` }}
                        className={`h-full rounded transition-all ${
                          isBest ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Executive Action Banner */}
        <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
          <div className="text-xs text-slate-300 space-y-0.5">
            <strong className="text-white">Simulation du projet actif :</strong> selon les données et hypothèses saisies, l’offre {respOffer?.offer.supplierName || 'responsable'} présente un écart TCO indicatif de{' '}
            <span className="font-mono text-emerald-400 font-bold">
              {currentProjectSavings.toLocaleString('fr-FR')} €
            </span>{' '}
            sur l’horizon configuré ({project.horizonYears} ans). Ce résultat n’est ni vérifié, ni une validation d’achat ; le point mort indicatif est{' '}
            <span className="font-mono text-white font-bold">{breakEven?.breakEvenMonth} mois</span>.
          </div>

          <div className="flex items-center gap-2">
            <div role="note" className="max-w-md rounded-lg border border-amber-700/70 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
              Les validations DAF/Achats et la décision du comité sont désactivées : aucune identité vérifiée ni piste d’approbation probante n’est configurée.
            </div>

            <button
              onClick={() => onNavigate('report')}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
              Ouvrir le rapport indicatif (PDF)
            </button>
          </div>
        </div>
      </div>

      {/* PORTFOLIO-WIDE KPI CONSOLIDATION (SECTION 4.1) */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">
          Indicateurs indicatifs · Projet actif · {projects.length} dossier(s) dans l’espace de travail
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
            <span className="text-xs text-slate-400 flex items-center justify-between">
              <span>Portefeuille Analysé</span>
              <FolderKanban className="w-4 h-4 text-slate-500" />
            </span>
            <div className="text-2xl font-bold font-mono text-white tabular-nums">
              {totalAnalyzedBudget.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[11px] text-slate-400">
              {projects.length} consultations ouvertes · {totalSuppliersCount} fournisseurs
            </div>
          </div>

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
            <span className="text-xs text-emerald-400 flex items-center justify-between">
              <span>Écart TCO modélisé — non vérifié</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
              +{portfolioSavings.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[11px] text-slate-400">
              Estimation calculée uniquement pour le projet actif
            </div>
          </div>

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
            <span className="text-xs text-sky-400 flex items-center justify-between">
              <span>Écart carbone estimé — non vérifié</span>
              <Leaf className="w-4 h-4 text-sky-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-sky-400 tabular-nums">
              {portfolioAvoidedEmissions.toLocaleString('fr-FR')} tCO2e
            </div>
            <div className="text-[11px] text-slate-400">
              Scénario RSE indicatif — non vérifié
            </div>
          </div>

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
            <span className="text-xs text-amber-400 flex items-center justify-between">
              <span>Statuts de démonstration</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
              {pendingValidationProjects.length} exemples
            </div>
            <div className="text-[11px] text-slate-400">
              États locaux non vérifiés — aucune approbation n’est requise ici
            </div>
          </div>
        </div>
      </div>

      {/* Pending Validation Projects List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-emerald-400" />
            Projets avec un statut de démonstration
          </h4>
          <span className="text-[11px] text-slate-400">
            {pendingValidationProjects.length} état(s) affiché(s) — sans effet décisionnel
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pendingValidationProjects.map((p) => {
            const isCurrent = p.id === project.id;
            return (
              <div
                key={p.id}
                onClick={() => onSelectProject(p)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  isCurrent
                    ? 'bg-slate-950 border-emerald-600/80 shadow'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-white text-xs">{p.name}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-amber-400">
                    {p.status.replace(/_/g, ' ')} — démo
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mb-2 truncate">
                  {p.objective}
                </div>
                <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-900 text-slate-400">
                  <span>Plafond : <strong className="text-white font-mono">{p.budgetCap.toLocaleString('fr-FR')} €</strong></span>
                  <span className="text-emerald-400 font-medium">Sélectionner →</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
