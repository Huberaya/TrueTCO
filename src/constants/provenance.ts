/**
 * Niveaux de confiance PROVISOIRES attribués selon la provenance d'une donnée.
 * Ce ne sont pas des mesures : c'est une règle de gestion transitoire, en attendant le Data Confidence Score
 * (formule documentée, pondérée par source, fraîcheur et complétude — évolution prévue).
 *  - une valeur extraite par IA mais non validée n'a AUCUNE confiance (elle n'entre pas dans un calcul) ;
 *  - une valeur contrôlée par un humain par rapport au document source reçoit ce niveau intermédiaire.
 */
export const PROVENANCE_CONFIDENCE = {
  aiUnvalidated: 0,
  /** Valeur saisie à la main ou importée d'un fichier par l'utilisateur, sans pièce justificative rattachée dans l'outil. */
  userEntered: 50,
  humanValidatedFromDocument: 60,
} as const;
