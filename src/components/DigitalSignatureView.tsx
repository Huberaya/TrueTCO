/**
 * TrueTCO — Approbations et verrouillage du dossier
 * ---------------------------------------------------------------------------
 * CE QUI A ÉTÉ SUPPRIMÉ, ET POURQUOI
 * Cet écran était auparavant intitulé « Signature électronique ». Il produisait, dans
 * le navigateur, un « certificat d'adjudication » : identifiant, empreintes calculées
 * localement, paraphe dessiné à la souris sur un canevas, enregistrement dans le
 * stockage local. Ce document ressemblait à une pièce signée. Il n'en était pas une :
 *   - rien n'était vérifié par le serveur ;
 *   - le paraphe n'établissait l'identité de personne ;
 *   - le certificat disparaissait avec le navigateur, ou y survivait en modifiable ;
 *   - il continuait d'afficher l'ancienne valeur si le dossier changeait.
 * Une signature qui n'engage personne est pire qu'aucune signature : elle fait croire
 * qu'une décision a été approuvée par quelqu'un. C'est exactement le type de fausse
 * preuve que ce produit s'interdit.
 *
 * CE QUI LE REMPLACE — des approbations réelles, tracées par le serveur
 *   1. Le dossier suit un cycle de vie contrôlé par l'API :
 *      draft → data_review → finance_review → esg_review → approval → decision → locked.
 *      Chaque transition exige une justification écrite (10 caractères minimum) et
 *      une permission précise ; le verrouillage exige `project:lock`, distincte du
 *      droit de saisie `project:write`.
 *   2. L'historique affiché est celui du JOURNAL D'AUDIT du serveur : identité de
 *      session, rôle, horodatage, justification. L'interface n'écrit jamais dans ce
 *      journal, elle le lit.
 *   3. L'écran dit ce qu'il ne fait pas : aucun certificat qualifié, aucun horodatage
 *      qualifié, aucune signature au sens du règlement eIDAS. Le branchement d'un
 *      prestataire de confiance reste à faire, et rien ici ne le simule.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileSignature,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { AuditLogEntry, Project } from '../types/domain';
import {
  ApiError,
  changeProjectWorkflowStatusOnServer,
  fetchProjectAuditLogsFromServer,
} from '../services/serverData';
import {
  WORKFLOW_STEPS,
  nextWorkflowStep,
  resolveServerWorkflowStatus,
  workflowStepIndex,
} from '../services/workflow';

interface ApprovalsViewProps {
  project: Project;
  /** Permissions réellement accordées à la session, telles que le serveur les a renvoyées. */
  permissions?: string[];
  onProjectUpdated?: (project: Project) => void;
}

export const DigitalSignatureView: React.FC<ApprovalsViewProps> = ({
  project,
  permissions = [],
  onProjectUpdated,
}) => {
  const [history, setHistory] = useState<AuditLogEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [justification, setJustification] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** Statut serveur affiché : mis à jour uniquement par une réponse du serveur. */
  const [serverStatus, setServerStatus] = useState<string>(resolveServerWorkflowStatus(project));

  const canWrite = permissions.includes('project:write');
  const canLock = permissions.includes('project:lock');

  useEffect(() => {
    setServerStatus(resolveServerWorkflowStatus(project));
  }, [project.serverWorkflowStatus, project.status]);

  /**
   * L'historique vient du serveur, jamais d'un journal local. En cas d'échec de
   * lecture, l'écran affiche l'erreur et se tait : il ne fabrique pas de lignes.
   */
  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchProjectAuditLogsFromServer(project.id, 100);
      setHistory(result.items);
      setHistoryTotal(result.total);
      setHistoryError(null);
    } catch (caught) {
      setHistory([]);
      setHistoryTotal(0);
      setHistoryError(
        caught instanceof ApiError
          ? `${caught.message} (${caught.code})`
          : "L'historique du dossier n'a pas pu être lu depuis le serveur."
      );
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const rawIndex = workflowStepIndex(serverStatus);
  /** Statut serveur absent de la table : on le DIT au lieu de le ranger au hasard. */
  const unknownStatus = rawIndex < 0;
  const currentIndex = unknownStatus ? 0 : rawIndex;
  const currentStep = WORKFLOW_STEPS[currentIndex];
  const nextStep = unknownStatus ? null : nextWorkflowStep(serverStatus);
  const isLocked = serverStatus === 'locked';

  /**
   * Une approbation sans motif écrit ne vaut rien : le motif est exigé par le
   * serveur, l'interface le vérifie aussi pour éviter un aller-retour inutile.
   */
  const applyTransition = async (target: string) => {
    const motive = justification.trim();
    if (motive.length < 10) {
      setActionError(
        'Une justification écrite d’au moins 10 caractères est exigée : sans motif, une approbation ne serait qu’un clic anonyme.'
      );
      return;
    }
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const updated = await changeProjectWorkflowStatusOnServer(project, target, motive);
      setServerStatus(updated.serverWorkflowStatus ?? target);
      onProjectUpdated?.(updated);
      // Relecture depuis le serveur : l'interface n'ajoute elle-même aucune ligne
      // à la chronologie du dossier.
      await loadHistory();
      setJustification('');
      setNotice(
        `Étape « ${WORKFLOW_STEPS.find((step) => step.serverStatus === target)?.label ?? target} » ` +
          'enregistrée par le serveur et inscrite au journal d’audit avec votre identité de session.'
      );
    } catch (caught) {
      setActionError(
        caught instanceof ApiError
          ? `${caught.message} (${caught.code})`
          : "Le changement de statut a échoué : l'étape n'a pas été enregistrée."
      );
    } finally {
      setBusy(false);
    }
  };

  const statusChanges = history.filter((entry) => entry.fieldChanged === 'workflow_status');

  return (
    <div className="space-y-4">
      {/* Bandeau de vérité : ce que cet écran fait, et ce qu'il ne fait pas */}
      <section className="bg-slate-900 border border-amber-800/60 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-bold text-amber-200">
          <ShieldAlert className="w-4 h-4" />
          Approbations tracées par le serveur — pas de signature qualifiée
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          Les approbations enregistrées ici sont des <strong>décisions horodatées et attribuées</strong> à une session
          authentifiée, conservées dans un journal d’audit en écriture serveur uniquement. Ce n’est <strong>pas</strong>{' '}
          une signature électronique qualifiée au sens du règlement eIDAS : aucun prestataire de confiance, aucun
          certificat d’identité et aucun horodatage qualifié ne sont raccordés sur cette instance. Le produit ne génère
          donc <strong>aucun certificat de signature</strong>. L’écran précédent en produisait un dans le navigateur :
          ce document n’avait aucune valeur probante et a été retiré.
        </p>
      </section>

      {/* Position du dossier dans le cycle de vie */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-sm font-bold text-white flex items-center gap-2">
          <FileSignature className="w-4 h-4 text-emerald-400" />
          Cycle de vie du dossier
        </div>
        <ol className="space-y-1.5">
          {WORKFLOW_STEPS.map((step, index) => {
            const state = index < currentIndex ? 'passe' : index === currentIndex ? 'courant' : 'a_venir';
            return (
              <li key={step.serverStatus} className="flex items-start gap-2 text-xs">
                {state === 'passe' ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                ) : state === 'courant' ? (
                  <Clock className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded-full border border-slate-700" />
                )}
                <span className={state === 'courant' ? 'text-white font-semibold' : 'text-slate-400'}>
                  {step.label}
                  <span className="block text-[11px] text-slate-500">{step.meaning}</span>
                </span>
              </li>
            );
          })}
        </ol>
        {unknownStatus && (
          <p className="text-[11px] text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-lg px-3 py-2">
            Le serveur rapporte le statut « {serverStatus} », que cette interface ne sait pas situer dans le cycle de
            vie. Aucune étape n’est proposée : mieux vaut ne rien proposer que proposer la mauvaise transition.
          </p>
        )}
        <p className="text-[11px] text-slate-400">
          État enregistré côté serveur :{' '}
          <span className="text-slate-200 font-semibold">
            {unknownStatus ? serverStatus : currentStep?.label}
          </span>
          {nextStep
            ? ` — étape suivante possible : ${nextStep.label} (permission ${nextStep.requires}).`
            : ' — le dossier est figé, aucune étape supplémentaire n’est autorisée.'}
        </p>
      </section>

      {/* Geste d'approbation */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-sm font-bold text-white">Enregistrer une étape</div>
        {isLocked ? (
          <p className="text-xs text-slate-300 flex items-start gap-2">
            <Lock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            Ce dossier est verrouillé : aucune étape supplémentaire ne peut être enregistrée. Une correction passe par
            une nouvelle version du dossier, afin que la décision approuvée reste consultable telle qu’elle a été
            validée.
          </p>
        ) : (
          <>
            <label className="block text-[11px] text-slate-400" htmlFor="approval-justification">
              Motif de la décision (obligatoire, 10 caractères minimum) — conservé dans le journal d’audit
            </label>
            <textarea
              id="approval-justification"
              value={justification}
              onChange={(event) => setJustification(event.target.value)}
              rows={3}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white"
              placeholder="Exemple : hypothèses vérifiées avec la direction financière le 08/10/2026 ; périmètre carbone validé par le service RSE."
            />
            <div className="flex flex-wrap gap-2">
              {nextStep && (
                <button
                  type="button"
                  disabled={busy || !permissions.includes(nextStep.requires)}
                  onClick={() => void applyTransition(nextStep.serverStatus)}
                  className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2"
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  Enregistrer : {nextStep.label}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void loadHistory()}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Recharger l’historique
              </button>
            </div>
            {nextStep && !permissions.includes(nextStep.requires) && (
              <p className="text-[11px] text-amber-300 flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                {nextStep.requires === 'project:lock'
                  ? 'Le verrouillage exige la permission d’approbation, distincte du droit de saisie : votre rôle ne la porte pas.'
                  : `Votre rôle ne porte pas la permission « ${nextStep.requires} » requise pour cette étape.`}
              </p>
            )}
            {nextStep?.requires === 'project:lock' && canLock && !canWrite && (
              <p className="text-[11px] text-slate-400">
                Votre rôle permet d’approuver et de figer, mais pas de modifier les données du dossier.
              </p>
            )}
          </>
        )}
        {notice && (
          <p className="text-xs text-emerald-300 bg-emerald-950/50 border border-emerald-800/60 rounded-lg px-3 py-2">
            {notice}
          </p>
        )}
        {actionError && (
          <p className="text-xs text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-lg px-3 py-2">
            {actionError}
          </p>
        )}
      </section>

      {/* Historique réel, lu depuis le journal d'audit du serveur */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-sm font-bold text-white">
          Journal d’audit du dossier
          <span className="ml-2 text-[11px] font-normal text-slate-400">
            {statusChanges.length} changement(s) de statut parmi {history.length} action(s) affichée(s)
            {historyTotal > history.length ? ` sur ${historyTotal} au total` : ''}
          </span>
        </div>
        {loading ? (
          <p className="text-xs text-slate-400 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lecture du journal d’audit…
          </p>
        ) : historyError ? (
          <p className="text-xs text-rose-300 bg-rose-950/50 border border-rose-800/60 rounded-lg px-3 py-2">
            {historyError}
          </p>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400">
            Aucune action n’est encore tracée pour ce dossier. Créations, modifications, imports, décisions et changements
            de statut apparaîtront ici, avec l’identité de la session qui les a effectués.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-400">
                <tr>
                  <th className="text-left py-1.5 font-semibold">Horodatage</th>
                  <th className="text-left py-1.5 font-semibold">Auteur (session)</th>
                  <th className="text-left py-1.5 font-semibold">Rôle</th>
                  <th className="text-left py-1.5 font-semibold">Action</th>
                  <th className="text-left py-1.5 font-semibold">Justification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-1.5 text-slate-400 whitespace-nowrap">
                      {entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString('fr-FR')
                        : 'horodatage non fourni'}
                    </td>
                    <td className="py-1.5 text-slate-200">{entry.userName}</td>
                    <td className="py-1.5 text-slate-400">{entry.userRole}</td>
                    <td className="py-1.5 text-slate-300 font-mono">
                      {entry.fieldChanged}
                      {entry.fieldChanged === 'workflow_status' && entry.oldValue && entry.newValue && (
                        <span className="block text-[10px] text-slate-500 font-sans">
                          {entry.oldValue} → {entry.newValue}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-slate-400 max-w-[420px]">{entry.justification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
