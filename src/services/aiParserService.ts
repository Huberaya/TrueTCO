import { ApiError } from './neonService';
import { apiFetch } from './apiClient';

export type Evidence = 'verified_in_document' | 'quote_not_in_document' | 'value_not_in_quote' | 'no_quote' | 'not_found';

export interface Checked<T> { value: T | null; quote: string | null; evidence: Evidence }

/** Proposition de l'IA : JAMAIS une donnée validée. Voir server/ai.ts pour les garanties. */
export interface AiExtraction {
  extractionId: string;
  filename: string;
  docCategory: string;
  parsedAt: string;
  engine: { provider: string; model: string };
  requiresHumanValidation: true;
  supplier: { name: string | null; siren: string | null; country: string | null };
  offerReference: string | null;
  currency: string | null;
  fields: {
    quantity: Checked<number>; apparentUnitPrice: Checked<number>; apparentTotal: Checked<number>;
    deliveryLeadTimeWeeks: Checked<number>; warrantyMonths: Checked<number>; expectedLifespanYears: Checked<number>;
    unitName: Checked<string>;
  };
  costItems: { tempId: string; category: string; label: string; amount: number; amountBasis: 'total' | 'per_unit' | 'per_year' | null; quote: string | null; evidence: Evidence }[];
  carbonItems: { tempId: string; scope: string; label: string; emissionsTCO2e: number | null; emissionsPerUnit: number | null; factorSource: string | null; quote: string | null; evidence: Evidence }[];
  missingInformation: string[];
  inconsistencies: string[];
  summary: string;
  warnings: string[];
}

export interface FictionalSample { id: string; title: string; content: string }

/**
 * Exemples d'entrée FICTIFS : entreprises, SIREN et montants inventés pour la démonstration.
 * Ils ne servent qu'à tester le flux de revue ; l'extraction, elle, est toujours réalisée par le serveur.
 */
export const FICTIONAL_SAMPLES: FictionalSample[] = [
  {
    id: 'sample-1',
    title: 'Exemple fictif — devis flotte de véhicules',
    content: `DEVIS N° EX-2026-0412 — Mobilité Exemple SAS (entreprise fictive, SIREN 000 000 000)
Objet : fourniture de 20 véhicules utilitaires électriques.
Quantité : 20 véhicules
Prix unitaire : 38 000,00 € HT
Total HT : 760 000,00 € HT
Garantie constructeur : 36 mois
Délai de livraison : 12 semaines
Contrat d'entretien optionnel : 1 200 € HT par véhicule et par an
Valeur de reprise non communiquée.`,
  },
  {
    id: 'sample-2',
    title: 'Exemple fictif — devis parc informatique reconditionné',
    content: `OFFRE EX-IT-77 — ReconditionIT Exemple (entreprise fictive)
200 postes portables reconditionnés, grade A
Prix unitaire : 410,00 € HT
Montant total : 82 000,00 € HT
Garantie : 24 mois
Livraison sous 3 semaines.
Reprise en fin de vie : non précisée.`,
  },
];

export class AiParserService {
  /**
   * Analyse un document via le serveur. AUCUN repli local : en cas d'indisponibilité, l'erreur est remontée
   * telle quelle et aucune donnée n'est fabriquée.
   */
  static async parseDocument(params: { filename: string; category: string; text: string }): Promise<AiExtraction> {
    const res = await apiFetch('/api/ai/parse-document', {
      method: 'POST',
      body: JSON.stringify({ filename: params.filename, category: params.category, text: params.text }),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 401) throw new ApiError("L'extraction IA nécessite une session connectée (indisponible en mode démonstration).", 401, 'unauthorized');
    if (!res.ok) throw new ApiError(body?.message ?? `Erreur HTTP ${res.status}`, res.status, body?.error, body?.requestId);
    return body.extraction as AiExtraction;
  }
}
