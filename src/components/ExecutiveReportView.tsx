import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Project,
  SupplierOffer,
  Supplier,
  AuditLogEntry,
} from '../types/domain';
import { DecisionRunResult } from '../services/serverData';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';
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
  decisionRun: DecisionRunResult | null;
  suppliers?: Supplier[];
  auditLogs?: AuditLogEntry[];
  onBack: () => void;
  onUpdateProject?: (updated: Project) => void;
}

export const ExecutiveReportView: React.FC<ExecutiveReportViewProps> = ({
  project,
  offers,
  decisionRun,
  suppliers = [],
  auditLogs = [],
  onBack,
  onUpdateProject,
}) => {
  // Détail par offre renvoyé dans l'exécution serveur persistée.
  const results = useMemo(() => {
    if (!decisionRun) return [];
    return decisionRun.ranking.flatMap(({ offerId }) => {
      const offer = offers.find((candidate) => candidate.id === offerId);
      const calc = decisionRun.calculationsByOfferId[offerId];
      return offer && calc ? [{ offer, calc, supplier: suppliers.find((s) => s.id === offer.supplierId) }] : [];
    });
  }, [decisionRun, offers, suppliers]);

  // Le rapport reprend exclusivement le classement et la recommandation du serveur.
  // Un rang 1 n'est pas transformé en recommandation lorsque le statut est indéterminé.
  const rankedLeader = useMemo(() => {
    const offerId = decisionRun?.ranking[0]?.offerId;
    return results.find((entry) => entry.offer.id === offerId) ?? null;
  }, [decisionRun, results]);
  const recommendedCandidate = useMemo(() => {
    if (!decisionRun || decisionRun.recommendation.status === 'indetermine') return null;
    return results.find((entry) => entry.offer.id === decisionRun.recommendation.offerId) ?? null;
  }, [decisionRun, results]);

  // Point mort et sensibilité : sorties calculées et persistées par le serveur.
  const breakEven = decisionRun?.breakEven ?? null;
  const drivers = decisionRun?.sensitivity ?? [];

  /** Message du serveur après une transition de cycle de vie réellement appliquée. */
  const [workflowNotice, setWorkflowNotice] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
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
    if (!decisionRun) {
      setExportError('Export bloqué : aucun résultat serveur n’est fourni.');
      return;
    }
    try {
      ExcelExportService.exportFinancialWorkbook(project, offers, decisionRun, auditLogs);
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Le classeur n’a pas pu être exporté.');
    }
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

  if (!decisionRun || results.length === 0) {
    return <ServerCalculationEmptyState title="Le rapport attend un résultat serveur à jour" />;
  }
  if (!rankedLeader) {
    return <ServerCalculationEmptyState title="Le rang 1 et les résultats détaillés ne correspondent pas dans cette exécution" />;
  }
  if (decisionRun.recommendation.status !== 'indetermine' && !recommendedCandidate) {
    return <ServerCalculationEmptyState title="L'option proposée par le moteur est absente des résultats détaillés" />;
  }

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

        {exportError && <div className="rounded-lg border border-rose-700 bg-rose-950/40 p-3 text-xs text-rose-200" role="alert">{exportError}</div>}

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
                  TrueTCO · Résultats de décision serveur
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-slate-800 print:bg-slate-200 text-slate-300 print:text-slate-800 rounded font-mono">
                  EXTRAIT D'EXÉCUTION
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white print:text-slate-950 mt-1.5 tracking-tight">
                Rapport des résultats TCO / LCC
              </h2>
              <div className="text-sm text-slate-400 print:text-slate-600 mt-1 font-medium">
                {project.name} · Réf. Consultation : <span className="font-mono text-slate-300 print:text-slate-800">{project.reference}</span>
              </div>
            </div>

            <div className="text-left sm:text-right text-xs font-mono text-slate-400 print:text-slate-600 space-y-0.5">
              <div>Généré (heure locale du navigateur) : {new Date().toLocaleString('fr-FR')}</div>
              <div>Porteur du dossier : {project.ownerName || 'non renseigné'}</div>
              <div className="select-all">Identifiant d'exécution serveur : {decisionRun.runId}</div>
              <div>Calcul serveur : {new Date(decisionRun.createdAt).toLocaleString('fr-FR')} · révision v{decisionRun.inputVersion}</div>
              <div>Moteur {decisionRun.engineVersion} · méthode {decisionRun.methodologyVersion}</div>
              <div className="break-all text-[10px]">Empreinte des entrées : {decisionRun.inputFingerprint}</div>
              <div>Fraîcheur : {decisionRun.freshness?.explanation ?? 'non fournie par cette exécution'}</div>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 1. RÉSULTAT SERVEUR & STATUT DE RECOMMANDATION */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2 print:border-slate-300">
            <h3 className="flex items-center gap-2 text-base font-bold text-white print:text-slate-900">
              <span className="font-mono text-emerald-400 print:text-emerald-700">01.</span>
              Résultat de l'exécution serveur
            </h3>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-xs font-semibold text-slate-200">
              {decisionRun.recommendation.status === 'indetermine'
                ? 'Aucune recommandation ferme'
                : decisionRun.recommendation.status === 'conditionnel'
                  ? 'Proposition conditionnelle — validation requise'
                  : 'Proposition du moteur — approbation requise'}
            </span>
          </div>

          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/80 p-5 text-xs leading-relaxed print:bg-slate-100 print:text-slate-900">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3 print:border-slate-300">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-slate-400">Classement communiqué par l'API</div>
                <div className="mt-1 text-sm font-bold text-white print:text-slate-950">
                  {recommendedCandidate
                    ? `Option proposée : ${recommendedCandidate.offer.supplierName} (${recommendedCandidate.offer.offerReference})`
                    : rankedLeader
                      ? `Rang 1 : ${rankedLeader.offer.supplierName} (${rankedLeader.offer.offerReference}) — aucune recommandation ferme`
                      : 'Aucune offre classée'}
                </div>
              </div>
              <div className="text-[11px] text-slate-400">
                Workflow serveur : <span className="font-mono text-slate-200">{serverStatus}</span>
              </div>
            </div>

            <p className="text-slate-300 print:text-slate-800">
              {decisionRun.recommendation.reason}
            </p>
            <p className="text-slate-400 print:text-slate-700">
              Dossier : {project.plannedVolume.toLocaleString('fr-FR')} {project.unitName} · horizon {project.horizonYears} ans · taux d'actualisation saisi {((project.discountRate ?? 0) * 100).toLocaleString('fr-FR')} %. Les montants sont ceux de l'exécution persistée ; ce rapport ne vaut ni approbation, ni conseil juridique ou obligation réglementaire.
            </p>

            <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
              <ReportMetricCard
                label="Écart initial (sortie serveur)"
                value={breakEven?.initialOutlayDelta === undefined ? 'Non disponible' : `${breakEven.initialOutlayDelta.toLocaleString('fr-FR')} €`}
                hint={breakEven?.method ? `Méthode : ${breakEven.method}` : 'Le serveur n’a pas fourni ce détail.'}
              />
              <ReportMetricCard
                label="Écart de VAN face au rang 2"
                value={decisionRun.recommendation.economicAdvantage
                  ? `${decisionRun.recommendation.economicAdvantage.vsSecondBestNpv.toLocaleString('fr-FR')} €`
                  : 'Non disponible'}
                hint="Valeur issue du résultat de décision serveur ; ce n'est pas une économie comptable réalisée."
              />
              <ReportMetricCard
                label="Point de bascule"
                value={breakEven
                  ? breakEven.hasBreakEven && breakEven.breakEvenMonth !== null
                    ? `${breakEven.breakEvenMonth} mois`
                    : 'Aucun croisement fourni'
                  : 'Non calculé'}
                hint={breakEven?.crossoverYear === null || breakEven?.crossoverYear === undefined
                  ? 'Aucun croisement annuel n’est renseigné.'
                  : `Année de croisement : ${breakEven.crossoverYear}.`}
              />
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 2. CADRAGE DE LA CONSULTATION & HYPOTHÈSES FINANCIÈRES */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">02.</span>
            Hypothèses enregistrées dans le dossier
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
              <div className="text-[10px] text-slate-500">Hypothèse d'inflation énergétique saisie au dossier</div>
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
        {/* 3. AGRÉGATS FINANCIERS DIRECTEMENT EXPOSÉS PAR L'API */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2 print:border-slate-300">
            <h3 className="flex items-center gap-2 text-base font-bold text-white print:text-slate-900">
              <span className="font-mono text-emerald-400 print:text-emerald-700">03.</span>
              Agrégats financiers de l'exécution serveur
            </h3>
            <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">Moteur {decisionRun.engineVersion} · méthode {decisionRun.methodologyVersion}</span>
          </div>

          <p className="text-[11px] text-slate-400 print:text-slate-600">
            Les montants ci-dessous sont repris des champs de résultat enregistrés, sans recomposition locale. Cette ventilation n'est pas exhaustive : certains postes restent agrégés dans les totaux ou ne sont pas encore exposés séparément par le contrat API. Le prix facial est un indicateur de référence et ne doit pas être ajouté au TCO sans vérifier le poste d'acquisition.
          </p>

          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 print:border-slate-300 print:bg-white">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950 font-semibold text-slate-400 print:border-slate-300 print:bg-slate-200 print:text-slate-700">
                    <th className="min-w-[240px] border-r border-slate-800 px-3 py-2.5 print:border-slate-300">Indicateur / poste exposé</th>
                    {results.map(({ offer }, index) => (
                      <th key={offer.id} className={`px-3 py-2.5 text-right ${offer.id === recommendedCandidate?.offer.id ? 'bg-emerald-950/40 font-bold text-emerald-300 print:bg-emerald-100 print:text-emerald-900' : ''}`}>
                        <span className="block">Rang {index + 1} · {offer.supplierName}</span>
                        <span className="font-mono text-[10px] font-normal text-slate-500">{offer.offerReference}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 print:divide-slate-300">
                  <ResultRow label="Prix facial de l'offre (indicateur, non additionné ici)" values={results.map(({ calc }) => calc.apparentDirectCost)} />
                  <ResultRow label="Acquisition intégrée au TCO (sortie moteur)" values={results.map(({ calc }) => calc.acquisitionTotal)} />
                  <ResultRow label="Logistique" values={results.map(({ calc }) => calc.logisticsTotal)} />
                  <ResultRow label="Installation" values={results.map(({ calc }) => calc.installationTotal)} />
                  <ResultRow label="Énergie / consommables" values={results.map(({ calc }) => calc.energyConsumablesTotal)} />
                  <ResultRow label="Maintenance" values={results.map(({ calc }) => calc.maintenanceRepairsTotal)} />
                  <ResultRow label="Remplacement / pannes" values={results.map(({ calc }) => calc.replacementDefectsTotal)} />
                  <ResultRow label="Frais administratifs / conformité" values={results.map(({ calc }) => calc.adminComplianceTotal)} />
                  <ResultRow label="Fiscalité / taxes" values={results.map(({ calc }) => typeof calc.taxesTotal === 'number' && Number.isFinite(calc.taxesTotal) ? calc.taxesTotal : null)} />
                  <ResultRow label="Exposition financière aux risques (sortie moteur)" values={results.map(({ calc }) => calc.riskExpositionTotal)} />
                  <ResultRow label="Coût carbone monétisé (prix saisi dans le dossier)" values={results.map(({ calc }) => calc.monetizedCarbonTotal)} />
                  <ResultRow label="Valeur résiduelle (crédit, valeur positive exposée)" values={results.map(({ calc }) => calc.salvageValueTotal)} />
                  <ResultRow label="Fin de vie / recyclage" values={results.map(({ calc }) => calc.endOfLifeRecyclingTotal)} />
                  <ResultRow label="Postes non alloués (si exposés)" values={results.map(({ calc }) => typeof calc.unallocatedCostTotal === 'number' ? calc.unallocatedCostTotal : null)} />
                  <ResultRow label="TCO économique nominal — résultat serveur" values={results.map(({ calc }) => calc.economicTCONominal)} emphasized />
                  <ResultRow label="LCC actualisé complet — résultat serveur" values={results.map(({ calc }) => calc.lifecycleCostLCC)} emphasized />
                  <tr className="border-t-2 border-emerald-700/60 bg-slate-950 font-bold print:bg-slate-200">
                    <td className="border-r border-slate-800 px-3 py-3 text-emerald-300 print:border-slate-300 print:text-emerald-900">TCO complet nominal — résultat serveur</td>
                    {results.map(({ calc, offer }) => (
                      <td key={calc.offerId} className={`px-3 py-3 text-right font-mono ${offer.id === recommendedCandidate?.offer.id ? 'text-emerald-300 print:text-emerald-900' : 'text-white print:text-slate-900'}`}>
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
        {/* 4. INDICATEURS DÉCLARÉS — SANS SCORE SYNTHÉTIQUE */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="border-b border-slate-800 pb-2 print:border-slate-300">
            <h3 className="flex items-center gap-2 text-base font-bold text-white print:text-slate-900">
              <span className="font-mono text-emerald-400 print:text-emerald-700">04.</span>
              Indicateurs déclarés par offre — non pondérés
            </h3>
            <p className="mt-1 text-[11px] text-slate-400 print:text-slate-600">Ces champs ne constituent pas un score multicritère et ne sont pas combinés en une recommandation RSE/technique.</p>
          </div>

          <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
            {results.map(({ offer, calc, supplier }) => (
              <article key={offer.id} className={`rounded-xl border p-4 ${offer.id === recommendedCandidate?.offer.id ? 'border-emerald-600/80 bg-emerald-950/30 print:border-emerald-300 print:bg-emerald-50' : 'border-slate-800 bg-slate-950/70 print:border-slate-300 print:bg-slate-100'}`}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="font-bold text-white print:text-slate-950">{offer.supplierName}</div>
                  {offer.id === recommendedCandidate?.offer.id && <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold text-slate-950">Proposition serveur</span>}
                </div>
                <dl className="space-y-1.5 font-mono text-[11px] text-slate-300 print:text-slate-700">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Score technique enregistré (source non exposée)</dt><dd>{typeof offer.technicalSuitabilityScore === 'number' ? `${offer.technicalSuitabilityScore} / 100` : 'Non renseigné'}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Score ESG fournisseur (source non exposée)</dt><dd>{typeof supplier?.esgScore === 'number' ? `${supplier.esgScore} / 100` : 'Non renseigné'}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Qualité des données (calcul serveur)</dt><dd>{calc.dataQualityScore} / 100</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Émissions quantifiées par le moteur</dt><dd>{calc.totalLifecycleCO2eTonnes.toLocaleString('fr-FR')} tCO2e</dd></div>
                  <div className="flex justify-between gap-3 border-t border-slate-800 pt-1"><dt className="text-slate-500">Garantie déclarée dans l'offre</dt><dd>{typeof offer.warrantyMonths === 'number' ? `${offer.warrantyMonths} mois` : 'Non renseignée'}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>

        {/* ========================================================= */}
        {/* 5. SENSIBILITÉ RENVOYÉE PAR LE SERVEUR */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="flex items-center gap-2 border-b border-slate-800 pb-2 text-base font-bold text-white print:border-slate-300 print:text-slate-900">
            <span className="font-mono text-emerald-400 print:text-emerald-700">05.</span>
            Sensibilité renvoyée par l'API
          </h3>

          <p className="text-[11px] text-slate-400 print:text-slate-600">
            Paire issue du classement serveur : {decisionRun.ranking[0]?.supplierName ?? 'rang 1 non fourni'} (rang 1) et {decisionRun.ranking[1]?.supplierName ?? 'rang 2 non fourni'} (rang 2). Le moteur exprime les impacts sur le différentiel de VAN rang 1 moins rang 2, par rapport aux hypothèses de base. Les bornes sont des perturbations internes au moteur, non des prévisions.
          </p>

          {drivers.length === 0 ? (
            <p className="text-xs text-slate-400">Aucun facteur de sensibilité n'est présent dans cette exécution.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 print:border-slate-300">
              <table className="w-full text-xs">
                <thead className="bg-slate-950/60 text-slate-400 print:bg-slate-100 print:text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Hypothèse</th>
                    <th className="px-3 py-2 text-left font-semibold">Valeur dossier</th>
                    <th className="px-3 py-2 text-left font-semibold">Borne basse · impact ΔVAN</th>
                    <th className="px-3 py-2 text-left font-semibold">Borne haute · impact ΔVAN</th>
                    <th className="px-3 py-2 text-left font-semibold">Amplitude renvoyée</th>
                    <th className="px-3 py-2 text-left font-semibold">Classe moteur</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 print:divide-slate-300">
                  {drivers.map((driver) => (
                    <tr key={driver.category}>
                      <td className="px-3 py-2 text-slate-200 print:text-slate-900">{driver.parameterName}</td>
                      <td className="px-3 py-2 font-mono text-slate-300 print:text-slate-800">{driver.baseValue.toLocaleString('fr-FR')} {driver.unit}</td>
                      <td className="px-3 py-2 font-mono text-slate-300 print:text-slate-800">{driver.lowValue !== undefined ? `${driver.lowValue.toLocaleString('fr-FR')} → ` : ''}{driver.lowValueImpactOnDeltaTCO.toLocaleString('fr-FR')} €</td>
                      <td className="px-3 py-2 font-mono text-slate-300 print:text-slate-800">{driver.highValue !== undefined ? `${driver.highValue.toLocaleString('fr-FR')} → ` : ''}{driver.highValueImpactOnDeltaTCO.toLocaleString('fr-FR')} €</td>
                      <td className="px-3 py-2 font-mono text-slate-200 print:text-slate-900">{typeof driver.spreadOnDeltaTCO === 'number' ? `${driver.spreadOnDeltaTCO.toLocaleString('fr-FR')} €` : 'Non disponible'}</td>
                      <td className="px-3 py-2 text-slate-400 print:text-slate-600">{driver.sensitivityRank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="space-y-0.5 border-t border-slate-800 px-3 py-2 text-[11px] text-slate-400 print:border-slate-300 print:text-slate-600">
                {drivers.map((driver) => <div key={`${driver.category}-expl`}>— Commentaire moteur non sourcé pour « {driver.parameterName} » : {driver.explanation}</div>)}
              </div>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs print:border-slate-300 print:bg-slate-100">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
              <div className="space-y-1 text-slate-300 print:text-slate-800">
                <div>
                  {recommendedCandidate
                    ? <><strong>Garantie déclarée dans l'offre proposée :</strong> {recommendedCandidate.offer.warrantyMonths} mois. La pièce contractuelle et la provenance de cette valeur ne sont pas présentées ici.</>
                    : 'Aucune garantie n’est attribuée à une offre retenue : le moteur n’a pas émis de recommandation ferme.'}
                </div>
                <div>Pour l'analyse des seuils d'inversion, consulter la sortie « Quand la décision change-t-elle ? » de l'écran Décision ; ce rapport n'en reconstruit pas les valeurs.</div>
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
              Transitions de workflow journalisées
            </h3>
            <span className="text-[11px] font-mono text-slate-400 print:text-slate-600 flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              Source : journal d’audit du serveur
            </span>
          </div>

          <p className="text-[11px] text-slate-400 print:text-slate-600">
            Chaque ligne ci-dessous est une transition de statut lue dans le journal du serveur, avec l’identité de session,
            le rôle, l’horodatage et le motif tels qu’ils sont renvoyés. Une transition de workflow ne constitue pas à elle
            seule une preuve d’approbation formelle ; ce rapport ne crée ni ne complète cette preuve.
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
              Aucune transition de statut n'est renvoyée par le journal pour ce dossier. Ce rapport ne permet donc pas d'établir qu'une approbation formelle a été enregistrée.
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
              Rapport généré à partir des résultats du moteur TrueTCO
            </div>
            <div>
              Cadre méthodologique : démarche de coût du cycle de vie inspirée d’ISO 15686-5 et comptabilité carbone de
              type GHG Protocol (scopes 1 à 3). Aucune certification de conformité à ces référentiels n’est délivrée.
            </div>
            <div className="font-mono text-[10px] select-all">
              Identifiant d'exécution serveur : {decisionRun.runId}
            </div>
          </div>

          <div className="text-left sm:text-right space-y-1">
            <div className="text-slate-300 print:text-slate-800 font-semibold">
              Instance actuelle : {serverStatus === 'locked' ? 'dossier verrouillé' : 'dossier non verrouillé'}
            </div>
            <div>
              Transitions journalisées : {approvalsLoading
                ? 'en cours de lecture depuis le journal du serveur…'
                : approvalsError
                  ? 'indisponibles (échec de lecture du journal)'
                  : approvals.length > 0
                    ? `${approvals.length} transition(s) de statut enregistrée(s) côté serveur.`
                    : 'aucune transition de statut renvoyée par le journal.'}
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

const ResultRow: React.FC<{ label: string; values: Array<number | null>; emphasized?: boolean }> = ({ label, values, emphasized = false }) => (
  <tr className={emphasized ? 'bg-slate-900/80 font-semibold' : 'hover:bg-slate-900/30'}>
    <td className={`border-r border-slate-800 px-3 py-2 print:border-slate-300 ${emphasized ? 'text-white print:text-slate-900' : 'text-slate-400 print:text-slate-700'}`}>{label}</td>
    {values.map((value, index) => (
      <td key={`${label}-${index}`} className={`px-3 py-2 text-right font-mono ${emphasized ? 'font-bold text-white print:text-slate-900' : 'text-slate-300 print:text-slate-700'}`}>
        {value === null || !Number.isFinite(value) ? 'Non disponible dans cette exécution' : `${value.toLocaleString('fr-FR')} €`}
      </td>
    ))}
  </tr>
);

const ReportMetricCard: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 print:border-slate-300 print:bg-white">
    <div className="text-[11px] text-slate-400 print:text-slate-600">{label}</div>
    <div className="mt-1 break-words font-mono text-base font-bold text-white print:text-slate-950">{value}</div>
    <div className="mt-1 text-[10px] text-slate-500 print:text-slate-600">{hint}</div>
  </div>
);
