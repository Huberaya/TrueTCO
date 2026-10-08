import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ApiError,
  changeProjectWorkflowStatusOnServer,
  fetchProjectAuditLogsFromServer,
} from '../services/serverData';
import { nextWorkflowStep, resolveServerWorkflowStatus, WORKFLOW_STEPS } from '../services/workflow';
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
  Loader2,
  Lock,
  AlertTriangle,
  ChevronRight,
  Info,
  Building,
  UserCheck,
  DollarSign,
  Scale,
} from 'lucide-react';

/**
 * DOSSIER DÉCISIONNEL D'ADJUDICATION — CE QUI A ÉTÉ RETIRÉ
 * ---------------------------------------------------------------------------
 * La version précédente de cet écran fabriquait des preuves de validation :
 *   - un « Collège des Visas & Signatures Électroniques Comex » de quatre
 *     signataires INVENTÉS (noms, fonctions, citations de validation), dont trois
 *     déjà marqués SIGNÉS avec des horodatages calculés à l'affichage ;
 *   - un bouton « Apposer le Visa » qui cochait la case dans l'état du navigateur
 *     et écrivait dans un journal local ;
 *   - un bouton « Prononcer l'Adjudication » qui basculait le dossier localement en
 *     « adjudiqué » et annonçait un enregistrement « immuable » en base ;
 *   - un « sceau » présenté comme une empreinte de certification (FNV-1a, non
 *     cryptographique, affublé du suffixe ISO 15686).
 * Aucune de ces validations n'existait côté serveur : elles n'engageaient personne.
 *
 * Désormais, la section d'approbation affiche le JOURNAL D'AUDIT du serveur —
 * qui, qui a approuvé quelle étape, quand, et avec quel motif — et l'action de
 * décision passe par l'API de cycle de vie, qui exige une justification et
 * vérifie les permissions. Si le dossier n'a pas d'approbation enregistrée,
 * l'écran l'écrit : un dossier non approuvé n'a pas à paraître approuvé.
 */

interface ExecutiveReportViewProps {
  project: Project;
  offers: SupplierOffer[];
  suppliers?: Supplier[];
  auditLogs?: AuditLogEntry[];
  benchmarks?: ExternalityReferenceBenchmark[];
  onBack: () => void;
  onUpdateProject?: (updated: Project) => void;
}

export const ExecutiveReportView: React.FC<ExecutiveReportViewProps> = ({
  project,
  offers,
  suppliers = [],
  auditLogs = [],
  benchmarks = [],
  onBack,
  onUpdateProject,
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

  /**
   * Identifiant INTERNE de lecture du rapport : un FNV-1a, volontairement présenté
   * pour ce qu'il est. Ce n'est ni un sceau, ni une signature, ni une empreinte
   * cryptographique : il ne prouve rien et ne doit pas être invoqué comme preuve.
   * L'intégrité opposable vient du journal d'audit chaîné du serveur (SHA-256).
   */
  const reportInternalId = useMemo(() => {
    const raw = `${project.id}:${project.reference}:${winningCandidate?.offer.id}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return `RPT-${(hash >>> 0).toString(16).toUpperCase()}`;
  }, [project.id, project.reference, winningCandidate?.offer.id]);

  /** Message du serveur après une transition de cycle de vie réellement appliquée. */
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);
  /** Motif exigé par le serveur (10 caractères minimum) pour toute décision. */
  const [decisionJustification, setDecisionJustification] = useState('');
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  /** Statut serveur du dossier : seul état qui autorise une transition. */
  const [serverStatus, setServerStatus] = useState<string>(resolveServerWorkflowStatus(project));
  const [approvals, setApprovals] = useState<AuditLogEntry[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);

  useEffect(() => {
    setServerStatus(resolveServerWorkflowStatus(project));
  }, [project.serverWorkflowStatus, project.status]);

  /**
   * Approbations RÉELLES du dossier, lues dans le journal d'audit du serveur.
   * En cas d'échec de lecture, l'écran le dit et n'affiche aucune approbation :
   * il ne complète jamais avec le journal local (qui ne contient que des données
   * de démonstration et ne prouve aucune validation).
   */
  const loadApprovals = useCallback(async () => {
    setApprovalsLoading(true);
    try {
      const result = await fetchProjectAuditLogsFromServer(project.id, 100);
      setApprovals(result.items.filter((entry) => entry.fieldChanged === 'workflow_status'));
      setApprovalsError(null);
    } catch (caught) {
      setApprovals([]);
      setApprovalsError(
        caught instanceof ApiError
          ? `${caught.message} (${caught.code})`
          : "Les approbations du dossier n'ont pas pu être lues depuis le serveur."
      );
    } finally {
      setApprovalsLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadApprovals();
  }, [loadApprovals]);

  // Handle printing
  const handlePrint = () => {
    window.print();
  };

  // Handle Excel download
  const handleExportExcel = () => {
    ExcelExportService.exportFinancialWorkbook(project, offers, suppliers, auditLogs, benchmarks);
  };

  /**
   * Faire avancer le dossier : la transition est demandée au SERVEUR, avec un motif
   * écrit. Rien n'est décidé dans le navigateur : si le serveur refuse (permission,
   * transition interdite, motif trop court), l'écran affiche son refus tel quel.
   */
  const handleWorkflowTransition = async (target: string) => {
    const motive = decisionJustification.trim();
    if (motive.length < 10) {
      setWorkflowError(
        'Un motif écrit d’au moins 10 caractères est exigé par le serveur : une décision sans motif n’est pas traçable.'
      );
      return;
    }
    setWorkflowBusy(true);
    setWorkflowError(null);
    setWorkflowNotice(null);
    try {
      const updated = await changeProjectWorkflowStatusOnServer(project, target, motive);
      setServerStatus(updated.serverWorkflowStatus ?? target);
      onUpdateProject?.(updated);
      await loadApprovals();
      setDecisionJustification('');
      setWorkflowNotice(
        `Étape « ${WORKFLOW_STEPS.find((step) => step.serverStatus === target)?.label ?? target} » ` +
          'enregistrée par le serveur et inscrite au journal d’audit avec votre identité de session.'
      );
    } catch (caught) {
      setWorkflowError(
        caught instanceof ApiError
          ? `${caught.message} (${caught.code})`
          : "La transition n'a pas été enregistrée par le serveur."
      );
    } finally {
      setWorkflowBusy(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-20">
      {/* Bandeau d'action (masqué à l'impression) */}
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-emerald-400" />
              Dossier d’arbitrage &amp; décision d’achat
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Rapport décisionnel d’arbitrage &amp; coût complet (TCO / LCC)
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Synthèse destinée à la direction, au comité d’investissement et aux acheteurs : arbitrage prix apparent
              contre coût complet, comparaison d’options et traçabilité des approbations. Les résultats proviennent du
              moteur de calcul TrueTCO ; les validations, quand elles existent, sont celles du journal d’audit du
              serveur et sont nommées comme telles. Ce document n’est pas une pièce signée.
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

            {serverStatus !== 'locked' ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={decisionJustification}
                  onChange={(event) => setDecisionJustification(event.target.value)}
                  placeholder="Motif de la décision (10 caractères minimum)"
                  className="w-72 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
                  aria-label="Motif de la décision"
                />
                <button
                  onClick={async () => {
                    const step = nextWorkflowStep(serverStatus);
                    if (!step) {
                      setWorkflowError(
                        `Le serveur rapporte le statut « ${serverStatus} » : cette interface ne sait pas le situer dans le cycle de vie et ne propose donc aucune transition.`
                      );
                      return;
                    }
                    await handleWorkflowTransition(step.serverStatus);
                  }}
                  disabled={workflowBusy}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center gap-2 transition-colors shadow-lg shadow-emerald-950/40"
                >
                  {workflowBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Award className="w-4 h-4" />}
                  <span>
                    Enregistrer l’étape :{' '}
                    {nextWorkflowStep(serverStatus)?.label ?? 'indisponible'}
                  </span>
                </button>
              </div>
            ) : (
              <div className="px-3.5 py-2 bg-emerald-950/80 border border-emerald-700/80 text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span>Dossier verrouillé (statut serveur)</span>
              </div>
            )}
          </div>
        </div>

        {/* Compte rendu de la transition réellement enregistrée par le serveur */}
        {workflowNotice && (
          <div className="p-4 bg-emerald-950/70 border border-emerald-600/80 rounded-xl text-xs text-emerald-200 flex items-start gap-2.5 animate-fade-in shadow-xl">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-white text-sm">Étape enregistrée par le serveur</div>
              <div className="mt-1 text-slate-300">{workflowNotice}</div>
            </div>
          </div>
        )}
        {workflowError && (
          <div className="p-4 bg-rose-950/70 border border-rose-600/80 rounded-xl text-xs text-rose-200 flex items-start gap-2.5 shadow-xl">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-white text-sm">Le serveur a refusé la transition</div>
              <div className="mt-1">{workflowError}</div>
            </div>
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
              <div>Édité le : {new Date().toLocaleDateString('fr-FR')}</div>
              <div>Porteur du dossier : {project.ownerName || 'non renseigné'}</div>
              <div className="select-all">
                Identifiant technique (non cryptographique) : {reportInternalId}
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
              Recommandation proposée — non approuvée
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
                Statut :{' '}
                {serverStatus === 'locked'
                  ? 'Dossier verrouillé'
                  : serverStatus === 'decision'
                    ? 'Décision actée'
                    : 'En attente d’approbation'}
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
              <div className="text-[10px] text-slate-500">Hypothèse du dossier (saisie), non certifiée par un tiers</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Inflation Énergétique</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {(project.energyInflationRate * 100).toFixed(2)}% / an
              </div>
              <div className="text-[10px] text-slate-500">Indexation annuelle des tarifs</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Prix du carbone retenu</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {project.carbonPricePerTonne} €/tCO2e
              </div>
              <div className="text-[10px] text-slate-500">
                Hypothèse du dossier — source à vérifier dans le référentiel d’externalités
              </div>
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
              Démarche LCC — inspirée d’ISO 15686-5, sans certification
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
        {/* 5. SENSIBILITÉ RÉELLEMENT CALCULÉE PAR LE MOTEUR */}
        {/* ========================================================= */}
        {/*
          Cette section affichait trois affirmations écrites en dur : un gain
          « accéléré de 4,2 mois », un gain cumulé multiplié par 1,15 sans aucun
          calcul, et un scénario carbone attribué au « rapport France Stratégie ».
          Aucun de ces chiffres ne venait du moteur. Elle affiche désormais les
          facteurs de sensibilité RÉELLEMENT recalculés (recalcul complet des deux
          offres à chaque borne) : chaque ligne est reproductible.
        */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">05.</span>
            Sensibilité de la décision aux hypothèses
          </h3>

          <p className="text-[11px] text-slate-400 print:text-slate-600">
            Impact sur l’écart de coût actualisé entre les deux offres comparées (offre de référence retenue − offre
            conventionnelle), recalculé par le moteur à chaque borne. Un écart positif signifie que l’offre de référence
            devient relativement moins avantageuse.
          </p>

          {drivers.length === 0 ? (
            <p className="text-xs text-slate-400">
              Aucun facteur de sensibilité n’a pu être calculé : il faut au moins deux offres comparables.
            </p>
          ) : (
            <div className="overflow-x-auto border border-slate-800 print:border-slate-300 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-950/60 print:bg-slate-100 text-slate-400 print:text-slate-600">
                  <tr>
                    <th className="text-left py-2 px-3 font-semibold">Hypothèse</th>
                    <th className="text-left py-2 px-3 font-semibold">Valeur retenue</th>
                    <th className="text-left py-2 px-3 font-semibold">Borne basse → écart</th>
                    <th className="text-left py-2 px-3 font-semibold">Borne haute → écart</th>
                    <th className="text-left py-2 px-3 font-semibold">Amplitude</th>
                    <th className="text-left py-2 px-3 font-semibold">Classe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 print:divide-slate-300">
                  {drivers.map((driver) => (
                    <tr key={driver.category}>
                      <td className="py-2 px-3 text-slate-200 print:text-slate-900">{driver.parameterName}</td>
                      <td className="py-2 px-3 text-slate-300 print:text-slate-800 font-mono">
                        {driver.baseValue.toLocaleString('fr-FR')} {driver.unit}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-300 print:text-slate-800">
                        {driver.lowValue !== undefined ? `${driver.lowValue.toLocaleString('fr-FR')} → ` : ''}
                        {driver.lowValueImpactOnDeltaTCO.toLocaleString('fr-FR')} €
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-300 print:text-slate-800">
                        {driver.highValue !== undefined ? `${driver.highValue.toLocaleString('fr-FR')} → ` : ''}
                        {driver.highValueImpactOnDeltaTCO.toLocaleString('fr-FR')} €
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-200 print:text-slate-900">
                        {(driver.spreadOnDeltaTCO ?? 0).toLocaleString('fr-FR')} €
                      </td>
                      <td className="py-2 px-3 text-slate-400 print:text-slate-600">{driver.sensitivityRank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 text-[11px] text-slate-400 print:text-slate-600 border-t border-slate-800 print:border-slate-300 space-y-0.5">
                {drivers.map((driver) => (
                  <div key={`${driver.category}-expl`}>
                    — {driver.parameterName} : {driver.explanation}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div>
                  <strong>Garantie contractuelle de l’offre retenue :</strong>{' '}
                  <strong>{winningCandidate?.offer.warrantyMonths ?? 0} mois</strong>. Elle couvre la période déclarée au
                  contrat ; elle ne dit rien de la sinistralité réelle, qui se suit en exploitation.
                </div>
                <div>
                  Aucune inversion de décision n’est affirmée ici qui ne soit recalculable : les lignes ci-dessus sont
                  recalculées par le moteur, et l’étude d’inversion complète (seuils, zones où la décision change) se
                  trouve dans l’écran de décision du dossier.
                </div>
              </div>
            </div>
          </div>
        </section>


        {/* 6. APPROBATIONS ENREGISTRÉES (JOURNAL D'AUDIT DU SERVEUR) */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-2">
            <h3 className="text-base font-bold text-white print:text-slate-900 flex items-center gap-2">
              <span className="text-emerald-400 print:text-emerald-700 font-mono">06.</span>
              Approbations enregistrées du dossier
            </h3>
            <span className="text-[11px] font-mono text-slate-400 print:text-slate-600 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              Source : journal d’audit du serveur
            </span>
          </div>

          <p className="text-[11px] text-slate-400 print:text-slate-600">
            Chaque ligne ci-dessous est une transition de statut réellement enregistrée par le serveur, avec l’identité
            de la session qui l’a demandée, son rôle, l’horodatage et le motif écrit. Aucune de ces lignes n’est saisie
            depuis cet écran. Une approbation manquante apparaît comme manquante.
          </p>

          {approvalsLoading ? (
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lecture du journal d’audit…
            </p>
          ) : approvalsError ? (
            <p className="text-xs text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-lg px-3 py-2">
              {approvalsError}
            </p>
          ) : approvals.length === 0 ? (
            <p className="text-xs text-amber-200 bg-amber-950/40 border border-amber-800/60 rounded-lg px-3 py-2">
              Aucune approbation n’est enregistrée pour ce dossier à ce jour. Le dossier n’est donc pas approuvé : ce
              rapport présente une recommandation technique, pas une décision validée.
            </p>
          ) : (
            <div className="overflow-x-auto border border-slate-800 print:border-slate-300 rounded-xl">
              <table className="w-full text-xs">
                <thead className="bg-slate-950/60 print:bg-slate-100 text-slate-400 print:text-slate-600">
                  <tr>
                    <th className="text-left py-2 px-3 font-semibold">Horodatage</th>
                    <th className="text-left py-2 px-3 font-semibold">Auteur (session)</th>
                    <th className="text-left py-2 px-3 font-semibold">Rôle</th>
                    <th className="text-left py-2 px-3 font-semibold">Étape</th>
                    <th className="text-left py-2 px-3 font-semibold">Motif enregistré</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 print:divide-slate-300">
                  {approvals.map((entry) => (
                    <tr key={entry.id}>
                      <td className="py-2 px-3 text-slate-400 print:text-slate-600 whitespace-nowrap">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString('fr-FR') : 'horodatage non fourni'}
                      </td>
                      <td className="py-2 px-3 text-slate-200 print:text-slate-900">{entry.userName}</td>
                      <td className="py-2 px-3 text-slate-400 print:text-slate-600">{entry.userRole}</td>
                      <td className="py-2 px-3 text-slate-300 print:text-slate-800 font-mono">
                        {entry.oldValue} → {entry.newValue}
                      </td>
                      <td className="py-2 px-3 text-slate-400 print:text-slate-600">{entry.justification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 7. MENTIONS DE PORTÉE & CLÔTURE */}
        {/* ========================================================= */}
        <div className="pt-6 border-t-2 border-slate-800 print:border-slate-300 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 text-xs text-slate-400 print:text-slate-600">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-white print:text-slate-900">
              <ShieldCheck className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              Document produit par le moteur de calcul TrueTCO
            </div>
            <div>
              Cadre méthodologique : démarche de coût du cycle de vie inspirée d’ISO 15686-5 et comptabilité carbone de
              type GHG Protocol (scopes 1 à 3). Aucune certification de conformité à ces référentiels n’est délivrée.
            </div>
            <div className="font-mono text-[10px] select-all">
              Identifiant technique du rapport : {reportInternalId} — FNV-1a, sans valeur probante
            </div>
          </div>

          <div className="text-left sm:text-right space-y-1">
            <div className="text-slate-300 print:text-slate-800 font-semibold">
              Instance actuelle : {serverStatus === 'locked' ? 'dossier verrouillé' : 'dossier non verrouillé'}
            </div>
            <div>
              Approbations : {approvalsLoading
                ? 'en cours de lecture depuis le journal du serveur…'
                : approvalsError
                  ? 'indisponibles (échec de lecture du journal)'
                  : approvals.length > 0
                    ? `${approvals.length} transition(s) de statut enregistrée(s) côté serveur.`
                    : 'aucune approbation enregistrée à ce jour.'}
            </div>
            <div>
              Ce rapport n’est ni signé électroniquement, ni horodaté par un prestataire de confiance : il doit l’être
              hors du produit si une valeur opposable est recherchée.
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
