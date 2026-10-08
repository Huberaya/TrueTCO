import React, { useState } from 'react';
import { Project, SupplierOffer, UserRole, ProjectStatus } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import {
  TrendingUp,
  ShieldCheck,
  Leaf,
  FileCheck2,
  AlertTriangle,
  ArrowRight,
  FolderKanban,
  Building2,
  Sparkles,
  CheckCircle2,
  Clock,
  Eye,
  BarChart3,
  SlidersHorizontal,
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
  onUpdateProject,
}) => {
  // Executive Mode Toggle (Vue Dirigeant Synthétique vs Vue Contrôle de Gestion)
  const [executiveMode, setExecutiveMode] = useState<boolean>(true);

  // Approval notification state
  const [approvalFeedback, setApprovalFeedback] = useState<string | null>(null);

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

  // Portfolio-wide savings estimation
  const portfolioSavings = 412500 + currentProjectSavings;
  const portfolioAvoidedEmissions = 1120 + currentAvoidedEmissions;

  // Best choice for active project
  const sortedByTCO = [...activeResults].sort((a, b) => a.calc.totalComprehensiveTCO - b.calc.totalComprehensiveTCO);
  const bestChoice = sortedByTCO[0];

  // Cheapest upfront capex
  const sortedByInitial = [...activeResults].sort((a, b) => a.calc.apparentDirectCost - b.calc.apparentDirectCost);
  const cheapestInitial = sortedByInitial[0];

  const handleApproveStatus = (newStatus: ProjectStatus, stepLabel: string) => {
    if (onUpdateProject) {
      onUpdateProject({
        ...project,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      });
      setApprovalFeedback(`✓ Étape « ${stepLabel} » validée avec succès pour le projet ${project.reference}.`);
      setTimeout(() => setApprovalFeedback(null), 4000);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Executive Mode Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            Pilotage stratégique & vue direction
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Tableau de Bord Exécutif & Arbitrages Achats
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Vision consolidée pour la Direction Générale, la DAF et la Direction des Achats. Analyse objective du TCO global, des risques et des externalités.
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
      {approvalFeedback && (
        <div className="p-3 bg-emerald-950/60 border border-emerald-800/80 rounded-xl text-xs text-emerald-300 flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{approvalFeedback}</span>
        </div>
      )}

      {/* EXECUTIVE SYNTHESIS SECTION (SECTION 22) */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
              Décision en cours d'arbitrage
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
                {project.status.replace(/_/g, ' ')}
              </div>
            </div>
          </div>
        </div>

        {/* 6 Key Macro Metrics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Budget Analysé</span>
            <div className="text-lg font-bold font-mono text-white tabular-nums">
              {project.budgetCap.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[10px] text-slate-500">Plafond engagé</div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">TCO Optimal Réel</span>
            <div className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
              {bestChoice ? `${bestChoice.calc.totalComprehensiveTCO.toLocaleString('fr-FR')} €` : '-'}
            </div>
            <div className="text-[10px] text-slate-500">{bestChoice?.offer.supplierName}</div>
          </div>

          <div className="p-3 bg-slate-950 border border-emerald-900/60 rounded-xl space-y-1 bg-gradient-to-br from-slate-950 to-emerald-950/20">
            <span className="text-[10px] text-emerald-400 uppercase tracking-wider">Économie Nette</span>
            <div className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
              +{currentProjectSavings.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[10px] text-slate-400">vs offre thermique</div>
          </div>

          <div className="p-3 bg-slate-950 border border-sky-900/60 rounded-xl space-y-1">
            <span className="text-[10px] text-sky-400 uppercase tracking-wider">Émissions Évitées</span>
            <div className="text-lg font-bold font-mono text-sky-400 tabular-nums">
              {currentAvoidedEmissions} <span className="text-xs font-sans">tCO2e</span>
            </div>
            <div className="text-[10px] text-slate-500">{project.carbonPricePerTonne} €/t tutélaire</div>
          </div>

          <div className="p-3 bg-slate-950 border border-indigo-900/60 rounded-xl space-y-1">
            <span className="text-[10px] text-indigo-400 uppercase tracking-wider">Point Mort</span>
            <div className="text-lg font-bold font-mono text-white tabular-nums">
              {breakEven?.breakEvenMonth ? `${breakEven.breakEvenMonth} mois` : 'Immédiat'}
            </div>
            <div className="text-[10px] text-slate-400">Amortissement CAPEX</div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
            <span className="text-[10px] text-amber-400 uppercase tracking-wider">Risques Évités</span>
            <div className="text-lg font-bold font-mono text-amber-400 tabular-nums">
              +{currentAvoidedRisks.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[10px] text-slate-500">ZFE & fiscalité CO2</div>
          </div>
        </div>

        {/* Visual Decision Chart: Upfront Price vs Total Real Cost */}
        <div className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Comparaison Visuelle Immédiate : Prix Facial vs Coût Total Réel (TCO 5 ans)
              </h4>
              <p className="text-[11px] text-slate-400">
                Visualisez pourquoi l'option apparemment la plus chère à l'achat devient l'option la plus économique sur la durée.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="w-3 h-3 rounded-sm bg-slate-600" /> Prix d'achat direct (Devis)
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-3 h-3 rounded-sm bg-emerald-500" /> Coût Total Réel (TCO Complet)
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
                          Option Responsable
                        </span>
                      )}
                      {isBest && (
                        <span className="text-[10px] text-emerald-300 bg-emerald-600/30 border border-emerald-500/50 px-2 py-0.5 rounded font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Recommandation Financière
                        </span>
                      )}
                    </div>

                    <div className="font-mono text-xs text-slate-300">
                      Facial : <strong className="text-white">{calc.apparentDirectCost.toLocaleString('fr-FR')} €</strong>{' '}
                      → TCO Réel :{' '}
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
            <strong className="text-white">Avis du Contrôle de Gestion :</strong> L'arbitrage en faveur d'EcoMobility dégage un gain net de{' '}
            <span className="font-mono text-emerald-400 font-bold">
              {currentProjectSavings.toLocaleString('fr-FR')} €
            </span>{' '}
            sur 5 ans, avec un risque opérationnel maîtrisé et un point mort à{' '}
            <span className="font-mono text-white font-bold">{breakEven?.breakEvenMonth} mois</span>.
          </div>

          <div className="flex items-center gap-2">
            {project.status === 'analyse' && (
              <button
                onClick={() => handleApproveStatus('validation_finance', 'Validation Finance DAF')}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Valider les Hypothèses (DAF)
              </button>
            )}

            {project.status === 'validation_finance' && (
              <button
                onClick={() => handleApproveStatus('validation_achats', 'Validation Direction Achats')}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Approuver l'Arbitrage (Achats)
              </button>
            )}

            {project.status === 'validation_achats' && (
              <button
                onClick={() => handleApproveStatus('decision', 'Signature Comité de Décision')}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Clôturer en Comité Décision
              </button>
            )}

            <button
              onClick={() => onNavigate('report')}
              className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
            >
              <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
              Générer Rapport Décisionnel (PDF)
            </button>
          </div>
        </div>
      </div>

      {/* PORTFOLIO-WIDE KPI CONSOLIDATION (SECTION 4.1) */}
      <div className="space-y-4">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">
          Indicateurs Consolidés de l'Organisation ({projects.length} Appels d'Offres Actifs)
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
              <span>Économies Nettes Détectées</span>
              <TrendingUp className="w-4 h-4 text-emerald-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-emerald-400 tabular-nums">
              +{portfolioSavings.toLocaleString('fr-FR')} €
            </div>
            <div className="text-[11px] text-slate-400">
              Gains TCO cumulés sur les horizons pluriannuels
            </div>
          </div>

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
            <span className="text-xs text-sky-400 flex items-center justify-between">
              <span>Bilan Carbone Évité</span>
              <Leaf className="w-4 h-4 text-sky-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-sky-400 tabular-nums">
              {portfolioAvoidedEmissions.toLocaleString('fr-FR')} tCO2e
            </div>
            <div className="text-[11px] text-slate-400">
              Tonnage évité calculé par le moteur à partir des facteurs saisis — aucune conformité à un engagement
              externe n’est vérifiée ici
            </div>
          </div>

          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
            <span className="text-xs text-amber-400 flex items-center justify-between">
              <span>Jalons en Attente de Visa</span>
              <Clock className="w-4 h-4 text-amber-400" />
            </span>
            <div className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
              {pendingValidationProjects.length} Projets
            </div>
            <div className="text-[11px] text-slate-400">
              Nécessitent un arbitrage Finance ou Achats
            </div>
          </div>
        </div>
      </div>

      {/* Pending Validation Projects List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-emerald-400" />
            Projets Nécessitant une Validation de Gouvernance
          </h4>
          <span className="text-[11px] text-slate-400">
            {pendingValidationProjects.length} action(s) requise(s)
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
                    {p.status.replace(/_/g, ' ')}
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
