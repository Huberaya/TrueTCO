/**
 * TrueTCO — Modèle de cycle de vie d'un dossier (vue unique côté interface)
 * ---------------------------------------------------------------------------
 * Le cycle de vie est décidé par le SERVEUR (`PROJECT_TRANSITIONS` dans
 * `server/repositories/projects.ts`) :
 *
 *   draft → data_review → finance_review → esg_review → approval → decision → locked
 *
 * Ce module ne réimplémente AUCUNE règle : il ne sert qu'à nommer les étapes pour
 * l'utilisateur et à savoir quelle étape la permission accordée autorise. La
 * transition réellement appliquée est toujours celle que le serveur accepte ; si
 * l'interface propose une étape refusée, le serveur répond `INVALID_TRANSITION` et
 * l'écran affiche ce refus tel quel.
 *
 * Il existe deux correspondances à ne pas confondre :
 *   - le statut SERVEUR (`draft`, `data_review`, …) : seule vérité pour les transitions ;
 *   - le statut d'AFFICHAGE (`ProjectStatus` : `brouillon`, `analyse`, …) utilisé par
 *     les écrans historiques. Plusieurs statuts d'affichage retombent sur le même
 *     statut serveur (`analyse` couvre `finance_review` ET `esg_review`) : d'où
 *     l'intérêt de porter le statut serveur jusque dans l'interface
 *     (`Project.serverWorkflowStatus`) plutôt que de le deviner.
 */

import { Project, ProjectStatus } from '../types/domain';

export interface WorkflowStep {
  /** Statut tel que le serveur le nomme. */
  serverStatus: string;
  /** Libellé affiché à l'utilisateur. */
  label: string;
  /** Ce que l'étape engage concrètement — jamais un simple numéro d'ordre. */
  meaning: string;
  /** Permission serveur exigée pour franchir l'étape. */
  requires: string;
}

/**
 * Les étapes, dans l'ordre. « requires » reprend la règle appliquée par l'API :
 * faire avancer un dossier relève de la saisie (`project:write`), le verrouiller
 * relève de l'approbation (`project:lock`).
 */
export const WORKFLOW_STEPS: WorkflowStep[] = [
  {
    serverStatus: 'draft',
    label: 'Rédaction',
    meaning: 'Le dossier se construit. Aucune donnée n’est engagée.',
    requires: 'project:write',
  },
  {
    serverStatus: 'data_review',
    label: 'Revue des données',
    meaning: 'Les offres et leurs sources sont vérifiées ; les données manquantes ou non sourcées sont listées.',
    requires: 'project:write',
  },
  {
    serverStatus: 'finance_review',
    label: 'Revue financière',
    meaning: 'Les hypothèses économiques et les résultats du moteur de calcul sont validés.',
    requires: 'project:write',
  },
  {
    serverStatus: 'esg_review',
    label: 'Revue ESG',
    meaning: 'Le périmètre carbone, les facteurs employés et leurs sources sont validés.',
    requires: 'project:write',
  },
  {
    serverStatus: 'approval',
    label: 'Approbation',
    meaning: 'Un responsable engage l’organisation sur la recommandation proposée.',
    requires: 'project:write',
  },
  {
    serverStatus: 'decision',
    label: 'Décision actée',
    meaning: 'L’option retenue est consignée ; le dossier peut être figé.',
    requires: 'project:write',
  },
  {
    serverStatus: 'locked',
    label: 'Verrouillé',
    meaning: 'Le dossier est figé : toute correction ultérieure passe par une nouvelle version.',
    requires: 'project:lock',
  },
];

/**
 * Correspondance utilisée UNIQUEMENT en repli, quand le dossier affiché n'a pas
 * été relu depuis le serveur (mode démonstration locale). Elle reproduit la table
 * `STATUS_FROM_SERVER` / `STATUS_TO_SERVER` de `serverData.ts`.
 */
export const FALLBACK_SERVER_STATUS: Record<ProjectStatus, string> = {
  brouillon: 'draft',
  collecte_offres: 'data_review',
  analyse: 'finance_review',
  validation_finance: 'finance_review',
  validation_achats: 'approval',
  decision: 'decision',
  adjudique: 'locked',
  termine: 'locked',
  archive: 'locked',
};

/** Statut serveur d'un dossier : celui qu'il porte, sinon la correspondance de repli. */
export function resolveServerWorkflowStatus(
  project: Pick<Project, 'status' | 'serverWorkflowStatus'>
): string {
  return project.serverWorkflowStatus ?? FALLBACK_SERVER_STATUS[project.status] ?? 'draft';
}

/** Index de l'étape courante ; `-1` si le statut serveur est inconnu de cette table. */
export function workflowStepIndex(serverStatus: string): number {
  return WORKFLOW_STEPS.findIndex((step) => step.serverStatus === serverStatus);
}

/** Étape suivante autorisée, ou `null` si le dossier est verrouillé (fin de cycle). */
export function nextWorkflowStep(serverStatus: string): WorkflowStep | null {
  const index = workflowStepIndex(serverStatus);
  if (index < 0) return null;
  return WORKFLOW_STEPS[index + 1] ?? null;
}
