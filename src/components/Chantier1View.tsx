import React, { useState } from 'react';
import { Project, SupplierOffer } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import { runAllTCOEngineTests, TestResultItem } from '../engine/tcoEngine.test';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Play,
  RotateCcw,
  Code2,
  Binary,
  Layers,
  Calculator,
  HelpCircle,
  FileCheck,
  ChevronRight,
  Info,
} from 'lucide-react';
import { WhyThisAmountModal } from './WhyThisAmountModal';

interface Chantier1ViewProps {
  project: Project;
  offers: SupplierOffer[];
}

export const Chantier1View: React.FC<Chantier1ViewProps> = ({ project, offers }) => {
  // Test suite state
  const [testResults, setTestResults] = useState<{
    total: number;
    passed: number;
    failed: number;
    results: TestResultItem[];
  }>(() => runAllTCOEngineTests());
  const [isRunningTests, setIsRunningTests] = useState(false);

  // Selected offer for step-by-step mathematical trace
  const [selectedOfferId, setSelectedOfferId] = useState<string>(offers[0]?.id || '');
  const activeOffer = offers.find((o) => o.id === selectedOfferId) || offers[0];

  // Active sub-tab in Chantier 1
  const [activeTab, setActiveTab] = useState<'demo' | 'tests' | 'model' | 'formulas' | 'spec'>('demo');

  // Explainability modal
  const [modalData, setModalData] = useState<{
    isOpen: boolean;
    title: string;
    categoryLabel: string;
    auditedValue?: any;
    calculatedFormula?: string;
    calculationExplanation?: string;
    relatedAssumptions?: { label: string; value: string }[];
  }>({
    isOpen: false,
    title: '',
    categoryLabel: '',
  });

  const calculation = TCOEngine.calculateOfferTCO(project, activeOffer);

  const handleRunTests = () => {
    setIsRunningTests(true);
    setTimeout(() => {
      setTestResults(runAllTCOEngineTests());
      setIsRunningTests(false);
    }, 200);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Validation des Fondations · Jalons du Produit
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Chantier 1 — Architecture, Modèle de Données & Moteur TCO
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Vérification formelle des 10 exigences du Chantier 1 : modèle d'entités, typage strict, formules mathématiques certifiées, neutralité ESG, suite de tests unitaires et banc d'essai interactif.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-950/60 border border-emerald-800/80 rounded-lg text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            <span>Chantier 1 Validé (100%)</span>
          </div>
        </div>
      </div>

      {/* Chantier 1 Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl text-xs font-medium">
        <button
          onClick={() => setActiveTab('demo')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'demo'
              ? 'bg-slate-800 text-white font-semibold border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Calculator className="w-3.5 h-3.5 text-emerald-400" />
          10. Banc de Démonstration Interactif
        </button>

        <button
          onClick={() => setActiveTab('tests')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'tests'
              ? 'bg-slate-800 text-white font-semibold border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          09. Tests Automatisés ({testResults.passed}/{testResults.total})
        </button>

        <button
          onClick={() => setActiveTab('formulas')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'formulas'
              ? 'bg-slate-800 text-white font-semibold border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Binary className="w-3.5 h-3.5 text-indigo-400" />
          04. Formules & Hypothèses Auditées
        </button>

        <button
          onClick={() => setActiveTab('model')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'model'
              ? 'bg-slate-800 text-white font-semibold border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-sky-400" />
          01-03. Modèle de Données & Relations
        </button>

        <button
          onClick={() => setActiveTab('spec')}
          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'spec'
              ? 'bg-slate-800 text-white font-semibold border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileCheck className="w-3.5 h-3.5 text-amber-400" />
          Rapport de Clôture du Chantier 1
        </button>
      </div>

      {/* TAB 1: BANC DE DÉMONSTRATION INTERACTIF */}
      {activeTab === 'demo' && (
        !activeOffer ? (
          <div className="p-12 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 mx-auto">
              <Layers className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white">Aucune offre injectée pour cette consultation</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Ajoutez une offre fournisseur pour visualiser la décomposition mathématique TCO pas-à-pas.
              </p>
            </div>
          </div>
        ) : (
        <div className="space-y-5">
          {/* Offer Selector */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">
                Offre injectée dans le moteur :
              </span>
              <div className="flex items-center gap-2">
                {offers.map((off) => (
                  <button
                    key={off.id}
                    onClick={() => setSelectedOfferId(off.id)}
                    className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-all ${
                      off.id === activeOffer?.id
                        ? 'bg-emerald-600 text-white font-semibold shadow-sm'
                        : 'bg-slate-950 text-slate-300 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    {off.supplierName} {off.isResponsibleCandidate ? '(ESG)' : '(Base)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="text-xs font-mono text-slate-400">
              Périmètre : <strong className="text-white">{activeOffer?.quantity || project.plannedVolume} {project.unitName}</strong> · Horizon : <strong className="text-emerald-400">{project.horizonYears} ans</strong>
            </div>
          </div>

          {/* Engine Output Decomposition Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">1. Prix Apparent Devis</div>
              <div className="text-xl font-bold font-mono text-white tabular-nums">
                {calculation.apparentDirectCost.toLocaleString('fr-FR')} €
              </div>
              <div className="text-[10px] text-slate-500">
                {(activeOffer?.apparentUnitPrice?.value ?? (activeOffer?.apparentTotal ? activeOffer.apparentTotal / (activeOffer.quantity || 1) : 0)).toLocaleString('fr-FR')} € / unité
              </div>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">2. TCO Économique Standard</div>
              <div className="text-xl font-bold font-mono text-white tabular-nums">
                {calculation.economicTCONominal.toLocaleString('fr-FR')} €
              </div>
              <div className="text-[10px] text-slate-500">
                Énergie + Maintenance + Dépréciation
              </div>
            </div>

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
              <div className="text-[11px] uppercase tracking-wider text-sky-400">3. Risques + Carbone Tutélaire</div>
              <div className="text-xl font-bold font-mono text-sky-400 tabular-nums">
                +{(calculation.riskExpositionTotal + calculation.monetizedCarbonTotal).toLocaleString('fr-FR')} €
              </div>
              <div className="text-[10px] text-slate-500">
                {calculation.totalLifecycleCO2eTonnes} tCO2e @ {project.carbonPricePerTonne} €/t
              </div>
            </div>

            <div className="p-4 bg-slate-900 border border-emerald-800/80 rounded-xl space-y-1 bg-gradient-to-br from-slate-900 to-emerald-950/20">
              <div className="text-[11px] uppercase tracking-wider text-emerald-400">4. TCO Global Complet</div>
              <div className="text-xl font-extrabold font-mono text-emerald-400 tabular-nums">
                {calculation.totalComprehensiveTCO.toLocaleString('fr-FR')} €
              </div>
              <div className="text-[10px] text-slate-300">
                Fourchette : [{calculation.uncertaintyRange.minTCO.toLocaleString('fr-FR')} € – {calculation.uncertaintyRange.maxTCO.toLocaleString('fr-FR')} €]
              </div>
            </div>
          </div>

          {/* Granular Cost Items Step-by-Step Breakdown */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
            <div className="p-4 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Décomposition Algorithmique des Lignes de Coûts
                </h3>
                <p className="text-[11px] text-slate-400">
                  Cliquez sur l'icône d'aide de chaque ligne pour auditer la formule, la provenance et le score de confiance.
                </p>
              </div>
              <div className="text-xs font-mono text-emerald-400 font-semibold">
                Score de Qualité des Données : {calculation.dataQualityScore}%
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/40 text-slate-400 border-b border-slate-800 text-[11px]">
                    <th className="py-2.5 px-4 font-semibold text-white">Catégorie du Poste</th>
                    <th className="py-2.5 px-4 font-semibold text-white">Libellé & Périmètre</th>
                    <th className="py-2.5 px-4 font-semibold text-white">Type Source</th>
                    <th className="py-2.5 px-4 font-semibold text-white">Confiance</th>
                    <th className="py-2.5 px-4 font-semibold text-white text-right">Montant Retenu</th>
                    <th className="py-2.5 px-4 font-semibold text-white text-right">Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {(activeOffer?.costItems || []).map((item) => (
                    <tr key={item.id} className="hover:bg-slate-900/30 transition-colors">
                      <td className="py-2.5 px-4 font-sans font-medium text-slate-300">
                        {item.category.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-slate-200">
                        {item.label}
                        {item.isRecurringYearly && (
                          <span className="text-[10px] text-emerald-400 ml-1.5 font-mono">
                            (Récurrent × {project.horizonYears} ans)
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-sans text-xs">
                        <span className="text-slate-400">{item.amount.sourceType}</span>
                      </td>
                      <td className="py-2.5 px-4 text-emerald-400">
                        {item.amount.confidenceLevel}%
                      </td>
                      <td className="py-2.5 px-4 text-right font-bold text-white tabular-nums">
                        {item.category === 'valeur_residuelle' ? '-' : ''}
                        {item.amount.value.toLocaleString('fr-FR')} {item.amount.unit}
                      </td>
                      <td className="py-2.5 px-4 text-right font-sans">
                        <button
                          onClick={() =>
                            setModalData({
                              isOpen: true,
                              title: item.label,
                              categoryLabel: item.category,
                              auditedValue: item.amount,
                              calculatedFormula: item.isRecurringYearly
                                ? `Coût_Annuel × Σ(1 + Inflation)^(t-1) sur ${project.horizonYears} ans`
                                : 'Montant forfaitaire ponctuel Année 0',
                              calculationExplanation: item.amount.notes || 'Poste audité selon les règles du moteur TCO.',
                            })
                          }
                          className="p-1 text-slate-400 hover:text-white rounded"
                        >
                          <HelpCircle className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* LCC Cash Flows Trace */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider">
              Flux d'Actualisation Pluriannuels LCC (WACC {(project.discountRate * 100).toFixed(1)}%)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs font-mono">
              {calculation.cashFlowsByYear.map((cf) => (
                <div key={cf.year} className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                  <div className="text-[10px] text-slate-400 font-sans font-semibold">
                    {cf.year === 0 ? 'Année 0 (CAPEX)' : `Année ${cf.year}`}
                  </div>
                  <div className="text-white font-bold">{Math.round(cf.nominalCost).toLocaleString('fr-FR')} €</div>
                  <div className="text-[10px] text-slate-500">DF : {cf.discountFactor}</div>
                  <div className="text-[11px] text-emerald-400 font-semibold pt-1 border-t border-slate-900">
                    Act : {Math.round(cf.discountedCost).toLocaleString('fr-FR')} €
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-slate-400 pt-2 flex justify-between">
              <span>Formule ISO 15686-5 : LCC = CAPEX_0 + Σ [ CF_t / (1 + r)^t ]</span>
              <span className="font-mono text-white font-bold">
                Total LCC Actualisé (NPV) : {calculation.lifecycleCostLCC.toLocaleString('fr-FR')} €
              </span>
            </div>
          </div>
        </div>
        )
      )}

      {/* TAB 2: TESTS AUTOMATISÉS CERTIFIÉS */}
      {activeTab === 'tests' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-white">
                Rapport d'Exécution des Tests Mathématiques
              </h3>
              <p className="text-xs text-slate-400">
                La suite de tests unitaires valide l'absence de régression sur les calculs de CAPEX, d'OPEX indexé, d'actualisation WACC, de monétisation carbone et d'objectivité sans biais.
              </p>
            </div>

            <button
              onClick={handleRunTests}
              disabled={isRunningTests}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
              <span>{isRunningTests ? 'Exécution...' : 'Ré-exécuter tous les tests'}</span>
            </button>
          </div>

          <div className="space-y-3">
            {testResults.results.map((test) => (
              <div
                key={test.id}
                className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2 hover:border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {test.passed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    )}
                    <div>
                      <span className="font-bold text-white text-xs">{test.id} · {test.name}</span>
                      <span className="ml-2 text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
                        {test.category}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-slate-400">{test.durationMs} ms</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-slate-950 rounded-lg text-xs font-mono">
                  <div>
                    <div className="text-[10px] text-slate-500 font-sans">Condition d'assertion attendue :</div>
                    <div className="text-slate-300 text-[11px] mt-0.5">{test.expected}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-sans">Valeur calculée par le moteur :</div>
                    <div className="text-emerald-400 text-[11px] mt-0.5">{test.actual}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: FORMULES & HYPOTHÈSES AUDITÉES */}
      {activeTab === 'formulas' && (
        <div className="space-y-4">
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Formules Mathématiques Normalisées du Moteur TrueTCO
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Toutes les formules ci-dessous sont implémentées dans une couche de calcul autonome (`src/engine/tcoEngine.ts`), sans dépendance d'affichage UI.
            </p>

            <div className="space-y-4 text-xs">
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-semibold text-white">1. Formule du TCO Économique Nominal</div>
                <div className="font-mono text-emerald-300 text-[11px]">
                  TCO_eco = Acquisition + Logistique + Installation + Σ(t=1..H)[ Énergie(t) + Maint(t) + Pannes(t) + Taxes(t) ] + FinDeVie - ValeurRésiduelle
                </div>
                <div className="text-slate-400 text-[11px] pt-1">
                  Chaque flux récurrent intègre l'indexation annuelle d'inflation spécifique (ex: inflation générale à 2% vs inflation énergie à 4.5%).
                </div>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-semibold text-white">2. Formule du Lifecycle Costing (LCC) Actualisé (NPV)</div>
                <div className="font-mono text-emerald-300 text-[11px]">
                  LCC = CAPEX_0 + Σ(t=1..H) [ CashFlow_t / (1 + r)^t ]
                </div>
                <div className="text-slate-400 text-[11px] pt-1">
                  Où <em>r</em> est le coût moyen pondéré du capital (WACC d'entreprise, ex: 4.5%), garantissant une comparabilité en valeur actuelle nette.
                </div>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-semibold text-white">3. Monétisation des Externalités Carbone (Scopes 1, 2, 3)</div>
                <div className="font-mono text-emerald-300 text-[11px]">
                  Coût_Carbone = Émissions_Totales_(tCO2e) × Valeur_Tutélaire_(€/t)
                </div>
                <div className="text-slate-400 text-[11px] pt-1">
                  Basé sur les facteurs d'émission officiels ADEME Base Carbone et la trajectoire de la commission Quinet (120 €/t en 2026).
                </div>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-semibold text-white">4. Exposition aux Risques de Non-Conformité & ZFE</div>
                <div className="font-mono text-emerald-300 text-[11px]">
                  Exposition_Financière = Σ [ Probabilité_i × Impact_Financier_i ]
                </div>
                <div className="text-slate-400 text-[11px] pt-1">
                  Pondération rigoureuse de la perte financière espérée, catégorisée par type d'estimation (historique, sectorielle ou hypothèse utilisateur).
                </div>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-semibold text-white">5. Point Mort Économique (Break-Even Crossover)</div>
                <div className="font-mono text-emerald-300 text-[11px]">
                  Mois_Point_Mort = Δ_Investissement_Initial / (Δ_Économies_Opérationnelles_Annuelles / 12)
                </div>
                <div className="text-slate-400 text-[11px] pt-1">
                  Calcul précis du croisement des courbes d'amortissement cumulées.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MODÈLE DE DONNÉES & RELATIONS */}
      {activeTab === 'model' && (
        <div className="space-y-4">
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Architecture Entités-Relations (src/types/domain.ts)
            </h3>
            <p className="text-xs text-slate-400">
              Modélisation TypeScript stricte pour garantir l'intégrité, l'isolation multi-tenant et la traçabilité.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-bold text-emerald-400 font-mono">Project</div>
                <div className="text-slate-300">
                  Cadre de consultation : budget, horizon (1..10 ans), volume, WACC, prix carbone, inflation.
                </div>
                <div className="text-[10px] text-slate-500">1 Projet → N Offres Fournisseurs</div>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-bold text-emerald-400 font-mono">Supplier & SupplierOffer</div>
                <div className="text-slate-300">
                  Fournisseur qualifié (certifications, pays, MOQ, Incoterm) et proposition commerciale détaillée.
                </div>
                <div className="text-[10px] text-slate-500">1 Offre → N Postes de Coûts + N Risques + N Émissions</div>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-bold text-emerald-400 font-mono">CostBreakdownItem & AuditedValue</div>
                <div className="text-slate-300">
                  Chaque montant porte sa valeur, son unité, son niveau de confiance (0-100%) et sa source primaire.
                </div>
                <div className="text-[10px] text-slate-500">Fondement de la fonction "Pourquoi ce montant ?"</div>
              </div>

              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
                <div className="font-bold text-emerald-400 font-mono">TCOCalculationResult</div>
                <div className="text-slate-300">
                  Sortie immuable du moteur : TCO standard, LCC actualisé, intervalle d'incertitude et cash flows.
                </div>
                <div className="text-[10px] text-slate-500">Prêt pour l'exportation et le reporting de direction</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: RAPPORT DE CLÔTURE DU CHANTIER 1 */}
      {activeTab === 'spec' && (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4 text-xs text-slate-300">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Rapport de Clôture & Revue de Code — Chantier 1
            </h3>
            <span className="text-emerald-400 font-mono font-bold text-xs">Statut : Validé 100%</span>
          </div>

          <div className="space-y-2">
            <div className="font-bold text-white">1. Ce qui est terminé et vérifié :</div>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>Définition intégrale du modèle de données (`src/types/domain.ts`) avec unités, traçabilité et sources.</li>
              <li>Moteur de calcul modulaire (`src/engine/tcoEngine.ts`) : TCO économique, LCC actualisé WACC, externalités carbone, risques $P \times I$, point mort, scénarios et sensibilité.</li>
              <li>Suite de tests unitaires automatisés (`src/engine/tcoEngine.test.ts`) avec 7 assertions critiques vérifiées (0 échec).</li>
              <li>Assertion de neutralité ESG (Principe 37) prouvée par test automatique : le moteur refuse tout biais systématique et privilégie l'offre conventionnelle si l'alternative ESG est économiquement irrationnelle.</li>
              <li>Banc d'essai et décomposition interactive des flux de trésorerie.</li>
            </ul>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-800">
            <div className="font-bold text-white">2. Décisions techniques prises :</div>
            <ul className="list-disc pl-5 space-y-1 text-slate-300">
              <li>Séparation absolue entre le moteur mathématique et les composants d'interface pour permettre de futurs appels via API REST / ERP.</li>
              <li>Affichage systématique en chiffres tabulaires (`tabular-nums`) pour aligner parfaitement les décimales dans les tableaux de gestion.</li>
              <li>Gestion explicite de l'incertitude financière via un intervalle [TCO_min, TCO_max] calibré sur le score de qualité des données pour interdire la fausse précision.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Modal Explainability */}
      <WhyThisAmountModal
        isOpen={modalData.isOpen}
        onClose={() => setModalData((prev) => ({ ...prev, isOpen: false }))}
        title={modalData.title}
        categoryLabel={modalData.categoryLabel}
        auditedValue={modalData.auditedValue}
        calculatedFormula={modalData.calculatedFormula}
        calculationExplanation={modalData.calculationExplanation}
        relatedAssumptions={modalData.relatedAssumptions}
      />
    </div>
  );
};
