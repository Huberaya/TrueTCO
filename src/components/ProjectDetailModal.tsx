import React, { useState } from 'react';
import { Project, ProjectStatus, HorizonYears, SupplierOffer } from '../types/domain';
import {
  X,
  FolderKanban,
  CheckCircle2,
  Clock,
  Save,
  Copy,
  ChevronRight,
  AlertCircle,
  TrendingUp,
  Scale,
  Calendar,
  Building,
  ShieldCheck,
  Zap,
  ArrowRight,
  Database,
} from 'lucide-react';

interface ProjectDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  offers: SupplierOffer[];
  onUpdateProject: (updated: Project) => void;
  onDuplicateProject: (p: Project) => void;
  onSelectProject: (p: Project) => void;
  isActive: boolean;
}

const LIFECYCLE_STEPS: { id: ProjectStatus; label: string; desc: string }[] = [
  { id: 'brouillon', label: '1. Brouillon', desc: 'Définition du besoin et cadrage budgétaire' },
  { id: 'collecte_offres', label: '2. Collecte Offres', desc: 'RFP envoyé aux fournisseurs qualifiés' },
  { id: 'analyse', label: '3. Analyse TCO', desc: 'Calcul des coûts complets, LCC et CO2' },
  { id: 'validation_finance', label: '4. Visa Finance', desc: 'Revue du WACC et respect du budget cap' },
  { id: 'validation_achats', label: '5. Visa Achats', desc: 'Audit des incoterms et risques tiers' },
  { id: 'decision', label: '6. Comité Décision', desc: 'Arbitrage DG / COPIL sur matrice 360°' },
  { id: 'termine', label: '7. Arbitré / Signé', desc: 'Attribution du marché et contractualisation' },
  { id: 'archive', label: '8. Archivé', desc: 'Clôture et capitalisation des REX' },
];

export const ProjectDetailModal: React.FC<ProjectDetailModalProps> = ({
  isOpen,
  onClose,
  project,
  offers,
  onUpdateProject,
  onDuplicateProject,
  onSelectProject,
  isActive,
}) => {
  // Local edit state
  const [name, setName] = useState(project.name);
  const [budgetCap, setBudgetCap] = useState(project.budgetCap);
  const [horizonYears, setHorizonYears] = useState<HorizonYears>(project.horizonYears);
  const [plannedVolume, setPlannedVolume] = useState(project.plannedVolume);
  const [unitName, setUnitName] = useState(project.unitName);
  const [discountRate, setDiscountRate] = useState(project.discountRate);
  const [energyInflationRate, setEnergyInflationRate] = useState(project.energyInflationRate);
  const [inflationRate, setInflationRate] = useState(project.inflationRate);
  const [carbonPrice, setCarbonPrice] = useState(project.carbonPricePerTonne);
  const [objective, setObjective] = useState(project.objective);
  const [status, setStatus] = useState<ProjectStatus>(project.status);

  const [activeTab, setActiveTab] = useState<'lifecycle' | 'hypotheses' | 'offers'>('lifecycle');
  const [isSavedNotice, setIsSavedNotice] = useState(false);

  if (!isOpen) return null;

  const currentStepIdx = LIFECYCLE_STEPS.findIndex((s) => s.id === status);
  const projectOffers = offers.filter((o) => o.projectId === project.id);

  const handleSave = () => {
    const updated: Project = {
      ...project,
      name: name.trim(),
      budgetCap: Number(budgetCap),
      horizonYears,
      plannedVolume: Number(plannedVolume),
      unitName: unitName.trim(),
      discountRate: Number(discountRate),
      energyInflationRate: Number(energyInflationRate),
      inflationRate: Number(inflationRate),
      carbonPricePerTonne: Number(carbonPrice),
      objective: objective.trim(),
      status,
      updatedAt: new Date().toISOString(),
    };

    onUpdateProject(updated);
    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 3000);
  };

  const handleAdvanceStep = () => {
    if (currentStepIdx < LIFECYCLE_STEPS.length - 1) {
      const nextStatus = LIFECYCLE_STEPS[currentStepIdx + 1].id;
      setStatus(nextStatus);
      const updated: Project = {
        ...project,
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      };
      onUpdateProject(updated);
      setIsSavedNotice(true);
      setTimeout(() => setIsSavedNotice(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-950/60 border border-emerald-800/60 rounded-xl text-emerald-400">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-tight">{project.name}</h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {project.reference}
                </span>
                {isActive && (
                  <span className="text-[10px] text-emerald-400 font-mono font-semibold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                    Projet Actif
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Cadrage, gouvernance des statuts et hypothèses financières
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isActive && (
              <button
                onClick={() => {
                  onSelectProject(project);
                }}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700"
              >
                Définir comme actif
              </button>
            )}
            <button
              onClick={() => onDuplicateProject(project)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition-colors border border-slate-700 flex items-center gap-1.5"
              title="Dupliquer ce projet d'achat avec ses hypothèses"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Dupliquer</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800 bg-slate-900/50 text-xs">
          <button
            onClick={() => setActiveTab('lifecycle')}
            className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'lifecycle'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Cycle de Vie & Workflow (8 Statuts)
          </button>
          <button
            onClick={() => setActiveTab('hypotheses')}
            className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'hypotheses'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Hypothèses Financières & WACC
          </button>
          <button
            onClick={() => setActiveTab('offers')}
            className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'offers'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            Offres Associées ({projectOffers.length})
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs text-slate-300">
          {/* TAB 1: WORKFLOW & LIFECYCLE */}
          {activeTab === 'lifecycle' && (
            <div className="space-y-6">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white text-sm flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Progression du Projet : Étape {currentStepIdx + 1} / {LIFECYCLE_STEPS.length}
                  </div>
                  {currentStepIdx < LIFECYCLE_STEPS.length - 1 && (
                    <button
                      onClick={handleAdvanceStep}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <span>Passer à l'étape suivante</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Stepper bar */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-2">
                  {LIFECYCLE_STEPS.map((s, idx) => {
                    const isDone = idx < currentStepIdx;
                    const isCurrent = idx === currentStepIdx;

                    return (
                      <button
                        key={s.id}
                        onClick={() => setStatus(s.id)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          isCurrent
                            ? 'bg-emerald-950/70 border-emerald-600 ring-1 ring-emerald-500/40'
                            : isDone
                            ? 'bg-slate-900 border-emerald-900/60 text-slate-300'
                            : 'bg-slate-950/60 border-slate-800 text-slate-500 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`font-bold ${
                              isCurrent ? 'text-emerald-400' : isDone ? 'text-emerald-300' : 'text-slate-400'
                            }`}
                          >
                            {s.label}
                          </span>
                          {isDone ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : isCurrent ? (
                            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-tight">{s.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scope & Context Card */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                  <div className="text-slate-500 text-[10px] uppercase font-semibold">Entité Juridique</div>
                  <div className="text-white font-medium flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-slate-400" />
                    {project.companyName || 'Acme Group Europe'}
                  </div>
                </div>

                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                  <div className="text-slate-500 text-[10px] uppercase font-semibold">Calendrier Consultation</div>
                  <div className="text-white font-medium flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    Début : {project.startDate || project.createdAt.split('T')[0]} ({project.analysisDurationMonths || 3} mois)
                  </div>
                </div>

                <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                  <div className="text-slate-500 text-[10px] uppercase font-semibold">Fréquence d'Achat</div>
                  <div className="text-white font-medium capitalize">
                    {project.purchaseFrequency || 'Marché unique'}
                  </div>
                </div>
              </div>

              {/* Project Objective Text */}
              <div className="space-y-1.5">
                <label className="block text-slate-400 font-semibold">Objectif Stratégique du Marché</label>
                <textarea
                  rows={3}
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-emerald-500 text-xs leading-relaxed"
                  placeholder="Objectif de la consultation..."
                />
              </div>
            </div>
          )}

          {/* TAB 2: HYPOTHESES FINANCIERES */}
          {activeTab === 'hypotheses' && (
            <div className="space-y-5">
              <div className="p-3.5 bg-sky-950/30 border border-sky-900/60 rounded-xl flex items-start gap-2.5 text-sky-300">
                <AlertCircle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  Conformément au <strong>Principe 37 (Neutralité ESG)</strong> et aux standards ISO 20400,
                  les paramètres financiers (WACC, inflation, prix tutélaire carbone) s'appliquent de manière rigoureusement
                  identique à toutes les offres en concurrence afin d'interdire tout biais méthodologique.
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-400 mb-1">Budget Plafond (Budget Cap) *</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={budgetCap}
                      onChange={(e) => setBudgetCap(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <span className="absolute right-3 top-2 text-slate-500 font-mono">€</span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Horizon d'Analyse (ISO 20400) *</label>
                  <select
                    value={horizonYears}
                    onChange={(e) => setHorizonYears(Number(e.target.value) as HorizonYears)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  >
                    <option value={1}>1 an (Court terme)</option>
                    <option value={2}>2 ans</option>
                    <option value={3}>3 ans (IT / Matériel bureautique)</option>
                    <option value={4}>4 ans</option>
                    <option value={5}>5 ans (Flotte Véhicules VUL)</option>
                    <option value={7}>7 ans (Bâtiment & Énergie)</option>
                    <option value={10}>10 ans (Machines & Industrie)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Volume Prévu & Unité *</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={plannedVolume}
                      onChange={(e) => setPlannedVolume(Number(e.target.value))}
                      className="w-24 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="text"
                      value={unitName}
                      onChange={(e) => setUnitName(e.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Taux d'Actualisation WACC (%) *</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.001"
                      value={discountRate}
                      onChange={(e) => setDiscountRate(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <span className="absolute right-3 top-2 text-slate-500 font-mono">
                      {(discountRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Inflation Énergétique Annuelle (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.001"
                      value={energyInflationRate}
                      onChange={(e) => setEnergyInflationRate(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <span className="absolute right-3 top-2 text-slate-500 font-mono">
                      {(energyInflationRate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Prix Carbone Tutélaire (€/tCO2e)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={carbonPrice}
                      onChange={(e) => setCarbonPrice(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <span className="absolute right-3 top-2 text-slate-500 font-mono">€/t</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: OFFRES RATTACHÉES */}
          {activeTab === 'offers' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="font-semibold text-white">
                  Fournisseurs & Candidats Référencés ({projectOffers.length})
                </div>
                <div className="text-[11px] text-slate-400">
                  Budget plafond : <span className="font-mono text-emerald-400">{budgetCap.toLocaleString('fr-FR')} €</span>
                </div>
              </div>

              {projectOffers.length === 0 ? (
                <div className="p-8 text-center bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <Scale className="w-8 h-8 text-slate-600 mx-auto" />
                  <div className="text-slate-300 font-semibold">Aucune offre fournisseur rattachée</div>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                    Utilisez le module d'importation d'offres pour intégrer les devis dans cette consultation.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {projectOffers.map((o) => {
                    const isWithinBudget = o.apparentTotal <= budgetCap;
                    return (
                      <div
                        key={o.id}
                        className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">{o.supplierName}</span>
                            {o.isResponsibleCandidate && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300">
                                Candidat Responsable ESG
                              </span>
                            )}
                          </div>
                          <div className="text-slate-400 text-[11px]">
                            {o.quantity} {unitName} · Délai : {o.deliveryLeadTimeWeeks} sem. · Garantie : {o.warrantyMonths} mois
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-slate-500 text-[10px] uppercase font-semibold">Prix Facial Apparent</div>
                            <div className="font-mono font-bold text-white text-sm">
                              {o.apparentTotal.toLocaleString('fr-FR')} €
                            </div>
                            <span
                              className={`text-[10px] font-mono font-medium ${
                                isWithinBudget ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {isWithinBudget ? '✓ Sous le plafond' : '⚠️ Dépassement budget'}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            {isSavedNotice && (
              <span className="text-emerald-400 font-mono flex items-center gap-1.5 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4" />
                Modifications enregistrées dans Neon DB avec succès !
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-xs transition-colors"
            >
              Fermer
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs transition-colors shadow-sm flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Enregistrer les Modifications</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
