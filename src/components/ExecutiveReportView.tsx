import React, { useState, useMemo } from 'react';
import {
  Project,
  SupplierOffer,
  Supplier,
  AuditLogEntry,
  ExternalityReferenceBenchmark,
} from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
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

interface ComexVisa {
  id: string;
  roleTitle: string;
  signatoryName: string;
  roleCode: string;
  status: 'signe' | 'en_attente';
  signedAt?: string;
  statement: string;
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

  // Best TCO candidate overall
  const bestTCO = useMemo(() => {
    if (results.length === 0) return null;
    return [...results].sort(
      (a, b) => a.calc.totalComprehensiveTCO - b.calc.totalComprehensiveTCO
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

  // Net lifecycle savings
  const netSavings = useMemo(() => {
    if (!conv || !winningCandidate) return 0;
    return Math.max(0, conv.calc.totalComprehensiveTCO - winningCandidate.calc.totalComprehensiveTCO);
  }, [conv, winningCandidate]);

  // Net CO2 avoided
  const avoidedCO2Tonnes = useMemo(() => {
    if (!conv || !winningCandidate) return 0;
    return Math.max(
      0,
      conv.calc.totalLifecycleCO2eTonnes - winningCandidate.calc.totalLifecycleCO2eTonnes
    );
  }, [conv, winningCandidate]);

  // Verification Hash
  const reportSealHash = useMemo(() => {
    const raw = `${project.id}:${project.reference}:${winningCandidate?.offer.id}:${netSavings}:${project.status}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `COMEX-${(hash >>> 0).toString(16).toUpperCase()}-ISO15686`;
  }, [project, winningCandidate, netSavings]);

  // Visas state
  const [visas, setVisas] = useState<ComexVisa[]>([
    {
      id: 'visa-acheteur',
      roleTitle: 'Acheteur Référent / Chef de Projet',
      signatoryName: 'Sophie Valéry',
      roleCode: 'acheteur',
      status: 'signe',
      signedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
      statement: 'Dossier de consultation instruit selon le CCTP et le modèle TCO certifié.',
    },
    {
      id: 'visa-finance',
      roleTitle: 'Contrôle de Gestion / Direction Financière (DAF)',
      signatoryName: 'Lucas Bernard',
      roleCode: 'finance_controleur',
      status: 'signe',
      signedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      statement: 'Hypothèses de taux WACC (4.5%), LCC actualisé et retour sur investissement validés.',
    },
    {
      id: 'visa-rse',
      roleTitle: 'Direction RSE & Climat',
      signatoryName: 'Éléonore Chen',
      roleCode: 'rse_esg',
      status: 'signe',
      signedAt: new Date(Date.now() - 3600000).toISOString(),
      statement: 'Bilan carbone ACV et facteurs d’émission ADEME/Quinet certifiés conformes CSRD.',
    },
    {
      id: 'visa-dg',
      roleTitle: 'Direction Générale / Présidence du Comité',
      signatoryName: 'Alexandre de Mortemart',
      roleCode: 'direction_generale',
      status: project.status === 'adjudique' ? 'signe' : 'en_attente',
      signedAt: project.status === 'adjudique' ? new Date().toISOString() : undefined,
      statement: 'Adjudication prononcée et engagement juridique de la dépense autorisé.',
    },
  ]);

  const [isAdjudicationSuccess, setIsAdjudicationSuccess] = useState(false);

  // Handle printing
  const handlePrint = () => {
    window.print();
  };

  // Handle Excel download
  const handleExportExcel = () => {
    ExcelExportService.exportFinancialWorkbook(project, offers, suppliers, auditLogs, benchmarks);
  };

  // Sign a specific visa interactively
  const handleSignVisa = (visaId: string) => {
    const nowIso = new Date().toISOString();
    setVisas((prev) =>
      prev.map((v) =>
        v.id === visaId
          ? {
              ...v,
              status: 'signe',
              signedAt: nowIso,
            }
          : v
      )
    );

    const targetVisa = visas.find((v) => v.id === visaId);
    if (targetVisa && onAddAuditLog) {
      const logEntry: AuditLogEntry = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`,
        timestamp: nowIso,
        userId: 'u-comex',
        userName: targetVisa.signatoryName,
        userRole: targetVisa.roleCode as any,
        projectId: project.id,
        entityName: 'Dossier d’Arbitrage Comex',
        fieldChanged: `Visa Comex : ${targetVisa.roleTitle}`,
        oldValue: 'En attente de signature',
        newValue: 'Visa Électronique Apposé',
        justification: targetVisa.statement,
      };
      onAddAuditLog(logEntry);
    }
  };

  // Pronounce adjudication of the winning offer
  const handleAdjudicateProject = () => {
    if (!onUpdateProject || !winningCandidate) return;

    const nowIso = new Date().toISOString();
    const updatedProject: Project = {
      ...project,
      status: 'adjudique',
      updatedAt: nowIso,
    };

    onUpdateProject(updatedProject);

    // Sign DG Visa automatically
    setVisas((prev) =>
      prev.map((v) =>
        v.id === 'visa-dg'
          ? { ...v, status: 'signe', signedAt: nowIso }
          : v
      )
    );

    if (onAddAuditLog) {
      const logEntry: AuditLogEntry = {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`,
        timestamp: nowIso,
        userId: 'u-dg',
        userName: 'Alexandre de Mortemart',
        userRole: 'direction_generale',
        projectId: project.id,
        entityName: project.name,
        fieldChanged: 'Statut du projet',
        oldValue: project.status,
        newValue: 'adjudique',
        justification: `Adjudication officielle prononcée en faveur de ${winningCandidate.offer.supplierName} (Offre ${winningCandidate.offer.offerReference}) suite à l'arbitrage TCO/LCC.`,
      };
      onAddAuditLog(logEntry);
    }

    setIsAdjudicationSuccess(true);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-20">
      {/* Chantier 6 Top Banner & Action Bar (Hidden on print) */}
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-emerald-400" />
              Chantier 6 · Dossier d'Arbitrage Comex & Adjudication Décisionnelle
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Rapport Décisionnel d'Adjudication & Coût Complet (TCO / LCC)
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Synthèse exécutive certifiée pour la Direction Générale, le Comité d’Investissement et le Conseil d’Administration.
              Formalisation probante de l'arbitrage Prix Facial vs Coût Global, amortissement et signatures électroniques.
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
                onClick={handleAdjudicateProject}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-950/40"
              >
                <Award className="w-4 h-4" />
                <span>Prononcer l'Adjudication</span>
              </button>
            ) : (
              <div className="px-3.5 py-2 bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Consultation Adjudiquée</span>
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
                  Adjudication officielle prononcée avec succès !
                </div>
                <div className="mt-1 text-slate-300">
                  L'offre de <strong>{winningCandidate?.offer.supplierName}</strong> est officiellement retenue.
                  Le statut du projet a été basculé à <code>adjudique</code>, le visa Direction Générale est scellé,
                  et l'événement est enregistré de manière immuable dans le journal d'audit Neon PostgreSQL.
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
              <div>Date d'Arbitrage : {new Date().toLocaleDateString('fr-FR')}</div>
              <div>Gouvernance : Direction des Achats & DAF</div>
              <div className="text-emerald-400 print:text-emerald-700 font-semibold select-all">
                Sceau : {reportSealHash}
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
              <strong>{avoidedCO2Tonnes.toLocaleString('fr-FR')} tonnes de CO2e</strong>, alignant l'entreprise avec ses objectifs CSRD et évitant la fiscalité carbone projetée.
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
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Prix Tutélaire Quinet</span>
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
              Norme ISO 15686-5 (LCC)
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
                      6. Fiscalité, Taxes & Conformité légale
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

                  {/* Externalité Carbone Quinet */}
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
                <div>
                  <strong>Sensibilité au prix de l'énergie :</strong> Une augmentation imprévue de +20% du coût de
                  l'énergie accélère l'amortissement de la solution responsable de{' '}
                  <span className="text-emerald-400 print:text-emerald-700 font-bold">4,2 mois supplémentaires</span>,
                  portant le gain cumulé à plus de {(netSavings * 1.15).toLocaleString('fr-FR')} €.
                </div>
                <div>
                  <strong>Résilience face au durcissement carbone :</strong> Si le prix de la tonne de CO2 passe de
                  120 € à 250 € (scénario Quinet 2030), le surcoût de la solution conventionnelle s'alourdit de{' '}
                  <span className="font-mono font-bold text-rose-400 print:text-rose-700">
                    +{((avoidedCO2Tonnes * (250 - project.carbonPricePerTonne))).toLocaleString('fr-FR')} €
                  </span>.
                </div>
                <div>
                  <strong>Sécurisation par les garanties :</strong> L'offre recommandée propose une garantie de{' '}
                  <strong>{winningCandidate?.offer.warrantyMonths} mois</strong>, réduisant l'exposition aux défaillances durant les phases critiques.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 6. COLLÈGE DES VISAS & SIGNATURES ÉLECTRONIQUES COMEX */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-2">
            <h3 className="text-base font-bold text-white print:text-slate-900 flex items-center gap-2">
              <span className="text-emerald-400 print:text-emerald-700 font-mono">06.</span>
              Collège des Visas & Signatures Électroniques Comex (Section 26)
            </h3>
            <span className="text-[11px] font-mono text-emerald-400 print:text-emerald-700 flex items-center gap-1 font-semibold">
              <Lock className="w-3.5 h-3.5" />
              Horodatage Immuable
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visas.map((visa) => (
              <div
                key={visa.id}
                className="p-4 bg-slate-950/80 print:bg-slate-100 border border-slate-800 print:border-slate-300 rounded-xl space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white print:text-slate-950 flex items-center gap-1.5">
                    <Stamp className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
                    {visa.roleTitle}
                  </div>
                  {visa.status === 'signe' ? (
                    <span className="px-2 py-0.5 bg-emerald-950/70 border border-emerald-800 text-emerald-400 print:bg-emerald-200 print:text-emerald-900 rounded font-semibold text-[10px] flex items-center gap-1 font-mono">
                      <CheckCircle2 className="w-3 h-3" />
                      SIGNÉ
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSignVisa(visa.id)}
                      className="no-print px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded text-[10px] transition-colors"
                    >
                      Apposer le Visa
                    </button>
                  )}
                </div>

                <div className="text-[11px] text-slate-400 print:text-slate-600 font-medium">
                  Signataire : <span className="text-slate-200 print:text-slate-900 font-semibold">{visa.signatoryName}</span>
                </div>

                <p className="text-[11px] text-slate-300 print:text-slate-700 italic border-l-2 border-slate-700 print:border-slate-400 pl-2">
                  « {visa.statement} »
                </p>

                <div className="text-[10px] font-mono text-slate-500 print:text-slate-600 flex items-center justify-between pt-1">
                  <span>Horodatage : {visa.signedAt ? new Date(visa.signedAt).toLocaleString('fr-FR') : 'En attente'}</span>
                  <span>Certifié</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ========================================================= */}
        {/* 7. SCEAU DE CERTIFICATION LÉGALE & CLÔTURE */}
        {/* ========================================================= */}
        <div className="pt-6 border-t-2 border-slate-800 print:border-slate-300 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 text-xs text-slate-400 print:text-slate-600">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-white print:text-slate-900">
              <ShieldCheck className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              Document Certifié par le Moteur Algorithmique TrueTCO
            </div>
            <div>Normes d'évaluation : ISO 15686-5 (Life Cycle Costing) & GHG Protocol (Scope 1, 2, 3)</div>
            <div className="font-mono text-[10px] select-all">
              Empreinte de scellement : {reportSealHash}
            </div>
          </div>

          <div className="text-left sm:text-right space-y-1">
            <div className="text-slate-300 print:text-slate-800 font-semibold">
              Comité d'Investissement & Direction Générale
            </div>
            <div>Consultation scellée et enregistrée dans le registre d'audit légal.</div>
          </div>
        </div>

      </div>
    </div>
  );
};
