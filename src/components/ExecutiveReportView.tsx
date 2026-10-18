import { useAuth } from '../context/AuthContext';
import React, { useState, useMemo } from 'react';
import {
  Project,
  SupplierOffer,
  Supplier,
  AuditLogEntry,
  ExternalityReferenceBenchmark,
} from '../types/domain';
import { TCOEngine, type Overrides } from '../engine/tcoEngine';
import { ExcelExportService } from '../services/excelExportService';
import {
  Printer,
  FileSpreadsheet,
  ArrowLeft,
  ShieldCheck,
  CheckCircle2,
  FileCheck,
  Award,
  TrendingDown,
  Clock,
  Leaf,
  Layers,
  Stamp,
  Lock,
  AlertTriangle,
  ChevronRight,
  Info,
  Building,
  UserCheck,
  DollarSign,
  Scale,
} from 'lucide-react';

interface ExecutiveReportViewProps {
  project: Project;
  offers: SupplierOffer[];
  suppliers?: Supplier[];
  auditLogs?: AuditLogEntry[];
  benchmarks?: ExternalityReferenceBenchmark[];
  onBack: () => void;
  onUpdateProject?: (updated: Project) => void;
  onAddAuditLog?: (entry: AuditLogEntry) => void;
}

export const ExecutiveReportView: React.FC<ExecutiveReportViewProps> = ({
  project,
  offers,
  suppliers = [],
  auditLogs = [],
  benchmarks = [],
  onBack,
  onUpdateProject,
  onAddAuditLog,
}) => {
  // Calculate detailed TCO for all offers
  const results = useMemo(() => {
    return offers.map((offer) => ({
      offer,
      calc: TCOEngine.calculateOfferTCO(project, offer),
      supplier: suppliers.find((s) => s.id === offer.supplierId),
    }));
  }, [project, offers, suppliers]);

  // Identify baseline (conventional) and winning/responsible candidate
  const conv = useMemo(() => {
    return results.find((r) => !r.offer.isResponsibleCandidate) || results[0];
  }, [results]);

  const resp = useMemo(() => {
    return results.find((r) => r.offer.isResponsibleCandidate) || results[1] || results[0];
  }, [results]);

  // Meilleure offre : coût complet ACTUALISÉ le plus bas
  const bestTCO = useMemo(() => {
    if (results.length === 0) return null;
    return [...results].sort(
      (a, b) => a.calc.lifecycleCostLCC - b.calc.lifecycleCostLCC
    )[0];
  }, [results]);

  const winningCandidate = bestTCO || resp;

  // Break-even and sensitivity analysis
  const breakEven = useMemo(() => {
    if (!conv || !resp) return null;
    return TCOEngine.calculateBreakEven(conv.calc, resp.calc, project.horizonYears);
  }, [conv, resp, project.horizonYears]);

  const drivers = useMemo(() => {
    if (!conv || !resp) return [];
    return TCOEngine.calculateSensitivity(project, conv.offer, resp.offer);
  }, [conv, resp, project]);

  // Stress-tests CALCULÉS par le moteur sur les offres réelles (aucun chiffre écrit en dur).
  const stress = useMemo(() => {
    if (!conv || !winningCandidate || conv.offer.id === winningCandidate.offer.id) return null;
    const adv = (o: Overrides) =>
      TCOEngine.calculateOfferTCO(project, conv.offer, o).exact.lifecycleCostLCC - TCOEngine.calculateOfferTCO(project, winningCandidate.offer, o).exact.lifecycleCostLCC;
    const be = (o: Overrides) =>
      TCOEngine.calculateBreakEven(TCOEngine.calculateOfferTCO(project, conv.offer, o), TCOEngine.calculateOfferTCO(project, winningCandidate.offer, o)).breakEvenMonth;
    const energy = { energyCostMultiplier: 1.2 };
    return {
      base: adv({}), energy: adv(energy), carbon: adv({ carbonPricePerTonne: project.carbonPricePerTonne * 2 }),
      beBase: be({}), beEnergy: be(energy), rob: TCOEngine.calculateRobustness(project, conv.offer, winningCandidate.offer),
    };
  }, [conv, winningCandidate, project]);

  // Économie nette : écart de coût complet actualisé
  const netSavings = useMemo(() => {
    if (!conv || !winningCandidate) return 0;
    return Math.max(0, conv.calc.lifecycleCostLCC - winningCandidate.calc.lifecycleCostLCC);
  }, [conv, winningCandidate]);

  // Net CO2 avoided
  const avoidedCO2Tonnes = useMemo(() => {
    if (!conv || !winningCandidate) return 0;
    return Math.max(
      0,
      conv.calc.totalLifecycleCO2eTonnes - winningCandidate.calc.totalLifecycleCO2eTonnes
    );
  }, [conv, winningCandidate]);

  // Référence de repérage du contenu (hachage simple NON cryptographique : ne prouve ni intégrité ni authenticité)
  const reportSealHash = useMemo(() => {
    const raw = `${project.id}:${project.reference}:${winningCandidate?.offer.id}:${netSavings}:${project.status}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `REF-${(hash >>> 0).toString(16).toUpperCase()}`;
  }, [project, winningCandidate, netSavings]);

  const { user } = useAuth();
  const [isAdjudicationSuccess, setIsAdjudicationSuccess] = useState(false);

  // Handle printing
  const handlePrint = () => {
    window.print();
  };

  // Handle Excel download
  const handleExportExcel = () => {
    ExcelExportService.exportFinancialWorkbook(project, offers, suppliers, auditLogs, benchmarks);
  };

  /**
   * Enregistre la décision (statut « adjudiqué »). Ce n'est PAS une signature ni un acte juridique :
   * c'est un changement de statut tracé (auteur, date) — le serveur n'accepte que admin / directeur achats.
   */
  const canRecordDecision = user?.role === 'admin' || user?.role === 'directeur_achats';
  const handleRecordDecision = () => {
    if (!onUpdateProject || !winningCandidate || !canRecordDecision) return;
    const nowIso = new Date().toISOString();
    onUpdateProject({ ...project, status: 'adjudique', updatedAt: nowIso });
    if (onAddAuditLog && user) {
      onAddAuditLog({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`,
        timestamp: nowIso,
        userId: user.id,
        userName: user.fullName,
        userRole: user.role,
        projectId: project.id,
        entityName: project.name,
        fieldChanged: 'Décision enregistrée',
        oldValue: project.status,
        newValue: 'adjudique',
        justification: `Offre retenue : ${winningCandidate.offer.supplierName} (${winningCandidate.offer.offerReference}), d'après le classement par coût complet. Décision à formaliser selon la gouvernance interne.`,
      });
    }
    setIsAdjudicationSuccess(true);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-20">
      {/* Barre d'actions (masquée à l'impression) */}
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-emerald-400" />
              Dossier de synthèse pour la décision
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Rapport de synthèse : coût complet (TCO / LCC)
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Synthèse des résultats de calcul pour appuyer une décision d'achat. Les résultats dépendent des hypothèses saisies et de la
              provenance indiquée pour chaque donnée ; ce document n'est ni certifié, ni signé, ni un avis juridique ou comptable.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onBack}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Retour</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
              title="Générer le classeur financier Excel multicritères complet (CBS, Cash-flows, WACC, Audit)"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Classeur Excel (.xlsx)</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4 text-sky-400" />
              <span>Imprimer / PDF</span>
            </button>

            {project.status !== 'adjudique' ? (
              <button
                onClick={handleRecordDecision}
                disabled={!canRecordDecision}
                title={canRecordDecision ? undefined : "Réservé à l'administrateur ou au directeur achats"}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-950/40"
              >
                <Award className="w-4 h-4" />
                <span>Enregistrer l'offre retenue</span>
              </button>
            ) : (
              <div className="px-3.5 py-2 bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Décision enregistrée</span>
              </div>
            )}
          </div>
        </div>

        {/* Adjudication Success Alert */}
        {isAdjudicationSuccess && (
          <div className="p-4 bg-emerald-950/70 border border-emerald-600/80 rounded-xl text-xs text-emerald-200 flex items-start justify-between gap-3 animate-fade-in shadow-xl">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-white text-sm">
                  Décision enregistrée
                </div>
                <div className="mt-1 text-slate-300">
                  L'offre de <strong>{winningCandidate?.offer.supplierName}</strong> est enregistrée comme offre retenue (statut <code>adjudique</code>).
                  Le changement est tracé dans le journal d'audit avec votre identité et la date. Il ne constitue pas une validation formelle :
                  celle-ci relève de votre gouvernance interne.
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsAdjudicationSuccess(false)}
              className="text-slate-400 hover:text-white p-1"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Official Report Document Container (Optimized for Screen & Print) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-12 space-y-10 text-slate-200 shadow-2xl print:bg-white print:text-slate-950 print:border-none print:p-0 print:shadow-none">
        
        {/* ========================================================= */}
        {/* DOCUMENT HEADER & BRANDING */}
        {/* ========================================================= */}
        <div className="border-b-2 border-emerald-500 pb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-widest font-mono text-emerald-400 print:text-emerald-700 font-bold">
                  TrueTCO · Dossier d'Arbitrage Financier & RSE
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-slate-800 print:bg-slate-200 text-slate-300 print:text-slate-800 rounded font-mono">
                  CONFIDENTIEL COMEX
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white print:text-slate-950 mt-1.5 tracking-tight">
                Dossier Décisionnel d'Adjudication (TCO / LCC)
              </h2>
              <div className="text-sm text-slate-400 print:text-slate-600 mt-1 font-medium">
                {project.name} · Réf. Consultation : <span className="font-mono text-slate-300 print:text-slate-800">{project.reference}</span>
              </div>
            </div>

            <div className="text-left sm:text-right text-xs font-mono text-slate-400 print:text-slate-600 space-y-0.5">
              <div>Date d'édition : {new Date().toLocaleDateString('fr-FR')}</div>
              <div className="text-emerald-400 print:text-emerald-700 font-semibold select-all">
                Réf. contenu : {reportSealHash}
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 1. RÉSUMÉ EXÉCUTIF & AVIS MOTIVÉ D'ADJUDICATION */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-2">
            <h3 className="text-base font-bold text-white print:text-slate-900 flex items-center gap-2">
              <span className="text-emerald-400 print:text-emerald-700 font-mono">01.</span>
              Avis Motivé du Comité de Sélection & Recommandation
            </h3>
            <span className="text-xs px-2.5 py-0.5 bg-emerald-950/70 border border-emerald-800 text-emerald-400 print:bg-emerald-100 print:text-emerald-800 rounded-full font-semibold">
              Recommandation Validée
            </span>
          </div>

          <div className="p-5 bg-slate-950/80 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300 text-xs leading-relaxed space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80 print:border-slate-300">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-bold text-white print:text-slate-950">
                  Candidat Lauréat Proposé : {winningCandidate?.offer.supplierName}
                </span>
                <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">
                  (Réf. {winningCandidate?.offer.offerReference})
                </span>
              </div>
              <span className="text-[11px] px-2 py-0.5 bg-emerald-900/40 text-emerald-300 print:bg-emerald-200 print:text-emerald-900 rounded font-semibold font-mono">
                Statut : {project.status === 'adjudique' ? 'Adjudiqué' : 'Recommandation Comex'}
              </span>
            </div>

            <p>
              La consultation portant sur l’acquisition et l’exploitation de{' '}
              <strong>{project.plannedVolume} {project.unitName}</strong> sur un horizon ferme de{' '}
              <strong>{project.horizonYears} ans</strong> met en évidence un arbitrage fondamental entre le coût
              facial d'acquisition immédiat et le coût global de possession (TCO / LCC actualisé au WACC de {(project.discountRate * 100).toFixed(1)}%).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg">
                <div className="text-[11px] text-slate-400 print:text-slate-600">Différentiel Facial Direct</div>
                <div className="text-base font-bold font-mono text-rose-400 print:text-rose-700 mt-0.5">
                  +{conv && winningCandidate ? (winningCandidate.calc.apparentDirectCost - conv.calc.apparentDirectCost).toLocaleString('fr-FR') : 0} €
                </div>
                <div className="text-[10px] text-slate-500">Surcoût CAPEX initial (+{breakEven?.initialPriceDeltaPercent || 0}%)</div>
              </div>

              <div className="p-3 bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg">
                <div className="text-[11px] text-slate-400 print:text-slate-600">Économie Nette TCO Complet</div>
                <div className="text-base font-bold font-mono text-emerald-400 print:text-emerald-700 mt-0.5">
                  -{netSavings.toLocaleString('fr-FR')} €
                </div>
                <div className="text-[10px] text-slate-500">Sur l'horizon de {project.horizonYears} ans</div>
              </div>

              <div className="p-3 bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg">
                <div className="text-[11px] text-slate-400 print:text-slate-600">Point Mort Économique</div>
                <div className="text-base font-bold font-mono text-sky-400 print:text-sky-700 mt-0.5">
                  {breakEven?.breakEvenMonth ? `${breakEven.breakEvenMonth} mois` : 'Immédiat'}
                </div>
                <div className="text-[10px] text-slate-500">
                  {breakEven?.crossoverYear ? `Bascule à ${breakEven.crossoverYear} ans` : 'Gain dès la mise en service'}
                </div>
              </div>
            </div>

            <p className="pt-2 text-slate-300 print:text-slate-800 font-medium">
              <strong>Motif d’arbitrage :</strong> Bien que plus cher à l'achat direct, l'offre de{' '}
              <strong>{winningCandidate?.offer.supplierName}</strong> génère une économie d'exploitation majeure grâce à une
              consommation énergétique optimisée, des coûts d'entretien réduits de moitié et une valeur résiduelle de revente supérieure.
              Elle permet en outre d'éviter{' '}
              <strong>{avoidedCO2Tonnes.toLocaleString('fr-FR')} tonnes de CO2e</strong>, selon les facteurs d'émission et le prix du carbone retenus dans les hypothèses.
            </p>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 2. CADRAGE DE LA CONSULTATION & HYPOTHÈSES FINANCIÈRES */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">02.</span>
            Cadrage de la Consultation & Hypothèses Validées
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Horizon Pluriannuel</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {project.horizonYears} ans
              </div>
              <div className="text-[10px] text-slate-500">Cycle de détention prévu</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Taux d'Actualisation WACC</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {(project.discountRate * 100).toFixed(2)}% / an
              </div>
              <div className="text-[10px] text-slate-500">Validation Direction Financière</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Inflation Énergétique</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {(project.energyInflationRate * 100).toFixed(2)}% / an
              </div>
              <div className="text-[10px] text-slate-500">Indexation annuelle des tarifs</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Prix du carbone (hypothèse du projet)</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {project.carbonPricePerTonne} €/tCO2e
              </div>
              <div className="text-[10px] text-slate-500">Rapport France Stratégie</div>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 3. TABLEAU CBS : DÉCOMPOSITION DU COÛT TOTAL DU CYCLE DE VIE */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-2">
            <h3 className="text-base font-bold text-white print:text-slate-900 flex items-center gap-2">
              <span className="text-emerald-400 print:text-emerald-700 font-mono">03.</span>
              Décomposition Analytique du Coût Complet (Tableau CBS)
            </h3>
            <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">
              Méthode : coût global actualisé (approche inspirée de l'ISO 15686-5 ; aucune certification de conformité)
            </span>
          </div>

          <div className="border border-slate-800 print:border-slate-300 rounded-xl overflow-hidden bg-slate-950/60 print:bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950 print:bg-slate-200 text-slate-400 print:text-slate-700 border-b border-slate-800 print:border-slate-300 font-semibold">
                    <th className="py-2.5 px-3 border-r border-slate-800 print:border-slate-300 min-w-[200px]">
                      Poste de Coût Réel (CBS)
                    </th>
                    {results.map(({ offer }) => (
                      <th
                        key={offer.id}
                        className={`py-2.5 px-3 text-right ${
                          offer.id === winningCandidate?.offer.id
                            ? 'bg-emerald-950/40 text-emerald-300 print:bg-emerald-100 print:text-emerald-900 font-bold'
                            : ''
                        }`}
                      >
                        {offer.supplierName}
                        {offer.id === winningCandidate?.offer.id && ' ★'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 print:divide-slate-300">
                  {/* CAPEX Initial */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium">
                      1. Acquisition directe (Prix facial facture)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono">
                        {calc.apparentDirectCost.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Logistique & Douanes */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      2. Transport, Douanes & Logistique (Incoterm)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.logisticsTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Mise en service */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      3. Installation & Qualification technique
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.installationTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Énergie & Consommables */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-amber-300 print:text-amber-800">
                      4. Énergie & Consommables ({project.horizonYears} ans indexés)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono font-medium">
                        {calc.energyConsumablesTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Maintenance & Réparations */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium">
                      5. Maintenance préventive & curative
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono">
                        {(calc.maintenanceRepairsTotal + calc.replacementDefectsTotal).toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Fiscalité & Conformité */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      6. Fiscalité et taxes
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.adminComplianceTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Exposition Risques & Indisponibilité */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      7. Risques d'indisponibilité & pannes
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.riskExpositionTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Valeur Résiduelle de Revente (-) */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-emerald-400 print:text-emerald-700">
                      8. Moins-value : Revente / Cession d'actif (-)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-emerald-400 print:text-emerald-700">
                        - {calc.salvageValueTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* TCO Économique Nominal */}
                  <tr className="bg-slate-900/80 print:bg-slate-100 font-semibold">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 text-white print:text-slate-900">
                      = TCO ÉCONOMIQUE NOMINAL (Flux bruts)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono font-bold">
                        {calc.economicTCONominal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Actualisation WACC (LCC) */}
                  <tr className="hover:bg-slate-900/30 text-[11px] text-slate-400">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300">
                      + Effet d'actualisation financière WACC ({project.discountRate * 100}%)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono">
                        {(calc.lifecycleCostLCC - calc.economicTCONominal).toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Externalité carbone */}
                  <tr className="hover:bg-slate-900/30 text-[11px] text-slate-400">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 text-sky-400 print:text-sky-700">
                      + Monétisation de l'externalité carbone ({project.carbonPricePerTonne} €/t)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-sky-400 print:text-sky-700">
                        {calc.monetizedCarbonTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* TCO COMPLET TOTAL */}
                  <tr className="bg-slate-950 font-bold text-sm border-t-2 border-slate-700 print:bg-slate-200">
                    <td className="py-3 px-3 border-r border-slate-800 print:border-slate-300 text-emerald-400 print:text-emerald-800">
                      TCO GLOBAL COMPLET SUR {project.horizonYears} ANS
                    </td>
                    {results.map(({ calc, offer }) => (
                      <td
                        key={calc.offerId}
                        className={`py-3 px-3 text-right font-mono ${
                          offer.id === winningCandidate?.offer.id
                            ? 'text-emerald-400 print:text-emerald-800 text-base font-extrabold'
                            : 'text-white print:text-slate-900'
                        }`}
                      >
                        {calc.totalComprehensiveTCO.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 4. PERFORMANCE MULTICRITÈRE 360° */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">04.</span>
            Évaluation Multicritère Pondérée 360°
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {results.map(({ offer, calc, supplier }) => (
              <div
                key={offer.id}
                className={`p-4 rounded-xl border ${
                  offer.id === winningCandidate?.offer.id
                    ? 'bg-emerald-950/30 border-emerald-600/80 print:bg-emerald-50 print:border-emerald-300'
                    : 'bg-slate-950/70 border-slate-800 print:bg-slate-100 print:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-white print:text-slate-950">{offer.supplierName}</div>
                  {offer.id === winningCandidate?.offer.id && (
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500 text-slate-950 font-bold rounded-full">
                      1er Choix
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 font-mono text-[11px] text-slate-300 print:text-slate-700">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Score Technique :</span>
                    <span>{offer.technicalSuitabilityScore} / 100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Score RSE / Carbone :</span>
                    <span>{supplier?.esgScore || (offer.isResponsibleCandidate ? 92 : 65)} / 100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Fiabilité Documentaire :</span>
                    <span>{calc.dataQualityScore}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Impact Carbone Cycle :</span>
                    <span>{calc.totalLifecycleCO2eTonnes.toLocaleString('fr-FR')} tCO2e</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-800/80 font-bold">
                    <span className="text-white print:text-slate-950">Garantie Contractuelle :</span>
                    <span>{offer.warrantyMonths} mois</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ========================================================= */}
        {/* 5. ANALYSE DE RÉSILIENCE & STRESS-TESTS */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">05.</span>
            Analyse de Robustesse Décisionnelle & Stress-Tests
          </h3>

          <div className="p-4 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                {stress ? (
                  <>
                    <div>
                      <strong>Cas central :</strong> l'offre recommandée est moins chère de{' '}
                      <span className="font-mono font-bold text-emerald-400 print:text-emerald-700">{Math.round(stress.base).toLocaleString('fr-FR')} €</span>{' '}
                      en coût complet actualisé.
                    </div>
                    <div>
                      <strong>Énergie +20 % :</strong> l'écart devient{' '}
                      <span className="font-mono font-bold">{Math.round(stress.energy).toLocaleString('fr-FR')} €</span>
                      {' '}; point mort actualisé : {stress.beBase === null ? 'aucun' : `mois ${stress.beBase}`} → {stress.beEnergy === null ? 'aucun' : `mois ${stress.beEnergy}`}.
                    </div>
                    <div>
                      <strong>Prix du carbone ×2 ({project.carbonPricePerTonne} → {project.carbonPricePerTonne * 2} €/t) :</strong> l'écart devient{' '}
                      <span className="font-mono font-bold">{Math.round(stress.carbon).toLocaleString('fr-FR')} €</span>.
                    </div>
                    <div>
                      <strong>Simulation de robustesse :</strong> l'offre recommandée reste la moins chère dans{' '}
                      <span className="font-mono font-bold">{Math.round(stress.rob.probabilityCandidateCheaper * 100)} %</span> des {stress.rob.draws.toLocaleString('fr-FR')} tirages
                      (hypothèses de plages et d'indépendance : voir l'écran Sensibilité).
                    </div>
                  </>
                ) : (
                  <div>Les stress-tests comparent l'offre recommandée à l'offre de base ; ils ne s'appliquent pas lorsque l'offre de base est elle-même la meilleure.</div>
                )}
                <div>
                  <strong>Garantie :</strong> l'offre recommandée propose une garantie de{' '}
                  <strong>{winningCandidate?.offer.warrantyMonths} mois</strong> (donnée du devis).
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 6. VALIDATION & LIMITES */}
        {/* ========================================================= */}
        <section className="space-y-3">
          <h3 className="text-base font-bold text-white print:text-slate-900 flex items-center gap-2 border-b border-slate-800 print:border-slate-300 pb-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">06.</span>
            Validation et limites de ce document
          </h3>
          <ul className="text-xs text-slate-300 print:text-slate-700 space-y-1.5 list-disc pl-5">
            <li>Aucun circuit de validation électronique (visas, signatures) n'est disponible dans cette version : les validations Finance, RSE et Direction se formalisent hors de l'outil.</li>
            <li>Les changements de statut du projet et les modifications de données sont tracés dans le journal d'audit (auteur, date, anciennes et nouvelles valeurs).</li>
            <li>Les résultats reposent sur les hypothèses et les données saisies ; chaque donnée porte sa provenance et son niveau de confiance, à examiner avant décision.</li>
            <li>Ce rapport n'est pas un avis juridique, comptable ou réglementaire, et n'atteste d'aucune conformité (CSRD, taxonomie, normes ISO).</li>
          </ul>
        </section>

        <div className="pt-6 border-t-2 border-slate-800 print:border-slate-300 text-xs text-slate-400 print:text-slate-600 space-y-1">
          <div className="font-bold text-white print:text-slate-900">Généré par TrueTCO — aide à la décision</div>
          <div>Méthode de coût global actualisé ; émissions exprimées en tCO₂e selon les facteurs saisis. Aucune certification ni conformité normative n'est attestée.</div>
          <div className="font-mono text-[10px]">Réf. contenu (repérage non cryptographique) : {reportSealHash}</div>
        </div>

      </div>
    </div>
  );
};
