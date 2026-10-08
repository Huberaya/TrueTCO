/**
 * TrueTCO — Mapping assisté des colonnes
 * ---------------------------------------------------------------------------
 * Principe : le produit PROPOSE, l'humain DÉCIDE.
 *
 *  - Une correspondance n'est appliquée automatiquement que si elle est exacte ou
 *    non ambiguë. Un libellé peut correspondre à plusieurs champs (« prix » peut
 *    être un prix unitaire ou un total) : dans ce cas, AUCUNE proposition n'est
 *    faite et la colonne est marquée « à arbitrer ».
 *  - Toute colonne non reconnue est conservée et affichée comme inconnue. Elle
 *    n'est jamais rattachée à un champ par ressemblance approximative, et jamais
 *    ignorée en silence.
 *  - Les colonnes obligatoires manquantes sont listées, avec l'explication de ce
 *    que leur absence empêche.
 */

export type ImportFieldType = 'text' | 'number' | 'date' | 'boolean' | 'category' | 'integer' | 'percent';

export interface ImportField {
  key: string;
  label: string;
  type: ImportFieldType;
  /** Vrai lorsque l'absence du champ empêche l'import. */
  required?: boolean;
  /** Explication affichée lorsque le champ obligatoire n'est pas mappé. */
  why: string;
  /** Libellés d'en-tête reconnus sans ambiguïté (comparés en forme normalisée). */
  synonyms: string[];
}

export const IMPORT_FIELDS: ImportField[] = [
  {
    key: 'offerReference',
    label: "Référence de l'offre",
    type: 'text',
    why: "Sans référence ni fournisseur, impossible de regrouper les lignes en offres distinctes : le classement serait faux.",
    synonyms: ['reference', 'ref', 'reference offre', 'n° offre', 'numero offre', 'offer', 'offer reference', 'devis', 'numero devis', 'reference devis'],
  },
  {
    key: 'supplierName',
    label: 'Fournisseur',
    type: 'text',
    why: "Sans nom de fournisseur, les offres seraient anonymes et la recommandation inexploitable.",
    synonyms: ['fournisseur', 'supplier', 'vendeur', 'prestataire', 'nom fournisseur', 'raison sociale', 'vendor'],
  },
  {
    key: 'label',
    label: 'Libellé du poste',
    type: 'text',
    why: "Le libellé permet de retrouver l'origine d'un montant dans l'analyse et dans l'audit.",
    synonyms: ['libelle', 'designation', 'poste', 'description', 'intitule', 'label', 'item', 'nature'],
  },
  {
    key: 'category',
    label: 'Catégorie de coût',
    type: 'category',
    why:
      "Sans catégorie, le montant est conservé mais compté comme coût non arbitré : l'analyse par nature de coût (énergie, maintenance…) ne peut pas être produite.",
    synonyms: ['categorie', 'category', 'type de cout', 'nature du cout', 'poste de cout', 'famille'],
  },
  {
    key: 'amount',
    label: 'Montant (total du poste)',
    type: 'number',
    required: true,
    why: 'Le montant est la donnée de base du calcul : sans lui, aucun TCO ne peut être établi.',
    synonyms: ['montant', 'amount', 'total', 'prix', 'cout', 'cost', 'valeur', 'montant ht', 'prix total'],
  },
  {
    key: 'unitPrice',
    label: 'Prix unitaire',
    type: 'number',
    why: "Le prix unitaire permet de vérifier la cohérence du total saisi, sans jamais le remplacer.",
    synonyms: ['prix unitaire', 'pu', 'unit price', 'prix ht unitaire', 'tarif unitaire'],
  },
  {
    key: 'quantity',
    label: 'Quantité',
    type: 'number',
    why: 'La quantité sert au calcul du coût par unité ; sans elle, le coût unitaire n’est pas produit.',
    synonyms: ['quantite', 'qte', 'quantity', 'qty', 'nombre', 'volume'],
  },
  {
    key: 'currency',
    label: 'Devise',
    type: 'text',
    why: "Sans devise explicite, la devise par défaut du dossier est retenue : c'est indiqué dans l'aperçu, jamais supposé en silence.",
    synonyms: ['devise', 'currency', 'monnaie'],
  },
  {
    key: 'sourceName',
    label: 'Source du montant',
    type: 'text',
    why: "Sans source, le poste est marqué « non sourcé » avec une confiance nulle (aucune donnée ne peut être qualifiée de vérifiée sans justificatif).",
    synonyms: ['source', 'justificatif', 'reference source', 'document', 'origine', 'piece jointe', 'source du montant'],
  },
  {
    key: 'recurring',
    label: 'Coût récurrent annuel',
    type: 'boolean',
    why: "Un poste récurrent mal repéré n'est compté qu'une fois : le coût complet serait sous-estimé.",
    synonyms: ['recurrent', 'annuel', 'recurring', 'par an', 'cout annuel', 'recurrent annuel'],
  },
  {
    key: 'yearOccurrences',
    label: 'Années d’occurrence',
    type: 'text',
    why: "Précise les années touchées par un poste (ex. 1,3,5) au lieu de supposer une périodicité régulière.",
    synonyms: ['annees', 'annee', 'occurrences', 'years', 'annees d occurrence', 'periodicite'],
  },
  {
    key: 'inflationType',
    label: 'Indexation',
    type: 'text',
    why: "L'indexation appliquée (énergie, générale, aucune) doit venir de la donnée, jamais d'une hypothèse cachée.",
    synonyms: ['indexation', 'inflation', 'type inflation', 'indice'],
  },
  {
    key: 'confidence',
    label: 'Confiance déclarée (%)',
    type: 'percent',
    why: "La confiance déclarée par le déclarant est reprise telle quelle, sans être confondue avec une vérification.",
    synonyms: ['confiance', 'fiabilite', 'confidence', 'niveau de confiance'],
  },
  {
    key: 'qualityStatus',
    label: 'Statut de qualité (VALID/WARNING/…)',
    type: 'text',
    why: "Le statut de qualité pilote la fiabilité du résultat ; il doit être déclaré ou déduit par des règles explicites.",
    synonyms: ['statut', 'statut qualite', 'quality', 'qualite', 'etat'],
  },
  {
    key: 'notes',
    label: 'Notes / formule',
    type: 'text',
    why: 'Les notes permettent de justifier un montant auprès d’un auditeur.',
    synonyms: ['notes', 'commentaire', 'remarque', 'formule', 'explication'],
  },
  {
    key: 'lifespanYears',
    label: 'Durée de vie (années)',
    type: 'integer',
    why: "La durée de vie conditionne le renouvellement et donc le coût complet.",
    synonyms: ['duree de vie', 'lifespan', 'duree', 'valeur de vie', 'life'],
  },
  {
    key: 'leadTimeWeeks',
    label: 'Délai de livraison (semaines)',
    type: 'integer',
    why: 'Le délai de livraison intervient dans l’analyse des risques opérationnels.',
    synonyms: ['delai', 'lead time', 'delai livraison', 'semaines', 'leadtime'],
  },
  {
    key: 'warrantyMonths',
    label: 'Garantie (mois)',
    type: 'integer',
    why: 'La garantie réduit le coût des pannes dans les premières années.',
    synonyms: ['garantie', 'warranty', 'mois garantie', 'garantie mois'],
  },
  {
    key: 'carbonTonnes',
    label: 'Émissions (tCO2e)',
    type: 'number',
    why: "Sans émissions déclarées, aucun coût carbone n'est calculé : le produit ne fabrique pas de facteur d'émission.",
    synonyms: ['emissions', 'co2', 'carbone', 'tco2e', 'tonnes co2', 'empreinte'],
  },
  {
    key: 'carbonFactorSource',
    label: 'Source du facteur d’émission',
    type: 'text',
    why: "Un facteur d'émission sans source est marqué non vérifié : la valeur reste affichée, jamais qualifiée d'officielle.",
    synonyms: [
      'source facteur',
      'source du facteur',
      'source du facteur d emission',
      'facteur emission',
      'source emissions',
      'base carbone',
    ],
  },
  {
    key: 'carbonScope',
    label: 'Périmètre des émissions (scope)',
    type: 'text',
    why: "Un périmètre non déclaré rend les émissions non comparables entre offres : le périmètre doit venir de la donnée.",
    synonyms: ['scope', 'perimetre', 'scope ges', 'perimetre emissions'],
  },
  {
    key: 'carbonLifecyclePhase',
    label: 'Phase du cycle de vie',
    type: 'text',
    why: "Sans phase (fabrication, usage, fin de vie), l'analyse ne peut pas distinguer les postes d'émissions.",
    synonyms: ['phase', 'phase cycle de vie', 'phase du cycle de vie', 'etape', 'lifecycle', 'phase du cycle'],
  },
  {
    key: 'riskDescription',
    label: 'Description du risque',
    type: 'text',
    why: "Un risque sans description ne peut pas être discuté ni vérifié en revue.",
    synonyms: ['description risque', 'risque', 'evenement', 'risk description'],
  },
  {
    key: 'riskProbability',
    label: 'Probabilité de risque',
    type: 'percent',
    why: "La probabilité d'un risque doit venir de la donnée ; une valeur par défaut inventée fausserait l'espérance de perte.",
    synonyms: ['probabilite', 'probability', 'occurrence risque'],
  },
  {
    key: 'riskImpact',
    label: 'Impact financier du risque',
    type: 'number',
    why: "L'impact financier d'un risque doit être déclaré, jamais estimé par défaut.",
    synonyms: ['impact', 'impact financier', 'cout risque', 'severite'],
  },
  {
    key: 'riskCategory',
    label: 'Catégorie de risque',
    type: 'text',
    why: "La catégorie de risque permet de regrouper les expositions (réglementaire, service, réputation…).",
    synonyms: ['categorie risque', 'type risque', 'risk category'],
  },
];

/** Normalisation d'un en-tête : minuscules, sans accents, sans ponctuation. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface ColumnProposal {
  header: string;
  columnIndex: number;
  field: string | null;
  /** 'exact' : intitulé identique ; 'synonyme' : libellé connu ; 'ambigu' : plusieurs champs possibles. */
  method: 'exact' | 'synonyme' | 'ambigu' | 'inconnu';
  candidates: string[];
  note: string;
}

export interface MappingAnalysis {
  proposals: ColumnProposal[];
  /** Mapping applicables sans intervention : exact ou synonyme non ambigu. */
  suggestedMapping: Record<string, string>;
  /** Colonnes qu'un humain doit trancher (plusieurs champs possibles). */
  ambiguousColumns: ColumnProposal[];
  /** Colonnes inconnues : elles ne seront pas importées tant qu'elles ne sont pas mappées. */
  unknownColumns: ColumnProposal[];
  /** Champs obligatoires absents du fichier (ou non mappés). */
  missingRequired: { field: string; label: string; why: string }[];
}

function synonymIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const field of IMPORT_FIELDS) {
    for (const synonym of field.synonyms) {
      const key = normalizeHeader(synonym);
      index.set(key, [...(index.get(key) ?? []), field.key]);
    }
    const labelKey = normalizeHeader(field.label);
    index.set(labelKey, [...(index.get(labelKey) ?? []), field.key]);
    index.set(field.key.toLowerCase(), [...(index.get(field.key.toLowerCase()) ?? []), field.key]);
  }
  return index;
}

const SYNONYMS = synonymIndex();

export function analyzeColumns(headers: string[], appliedMapping: Record<string, string> = {}): MappingAnalysis {
  const proposals: ColumnProposal[] = [];

  headers.forEach((header, columnIndex) => {
    const normalized = normalizeHeader(header ?? '');
    const explicit = appliedMapping[header];

    if (explicit) {
      proposals.push({
        header,
        columnIndex,
        field: explicit,
        method: 'exact',
        candidates: [explicit],
        note: 'Correspondance validée manuellement.',
      });
      return;
    }

    if (normalized === '') {
      proposals.push({
        header,
        columnIndex,
        field: null,
        method: 'inconnu',
        candidates: [],
        note: "Colonne sans intitulé : elle ne peut pas être rapprochée d'un champ.",
      });
      return;
    }

    const candidates = [...new Set(SYNONYMS.get(normalized) ?? [])];

    if (candidates.length === 1) {
      proposals.push({
        header,
        columnIndex,
        field: candidates[0],
        method: 'synonyme',
        candidates,
        note: `Correspondance proposée : « ${fieldLabel(candidates[0])} ».`,
      });
      return;
    }

    if (candidates.length > 1) {
      proposals.push({
        header,
        columnIndex,
        field: null,
        method: 'ambigu',
        candidates,
        note:
          `Cet intitulé peut désigner plusieurs champs (${candidates.map(fieldLabel).join(', ')}) : ` +
          'à vous de choisir, le produit ne tranche pas à votre place.',
      });
      return;
    }

    // Aucune correspondance connue : recherche d'une correspondance partielle pour
    // AIDER l'utilisateur — la proposition reste soumise à sa décision.
    const partial = IMPORT_FIELDS.filter((field) =>
      [...field.synonyms, field.label].some((synonym) => {
        const key = normalizeHeader(synonym);
        return key.length >= 5 && (normalized.includes(key) || key.includes(normalized));
      })
    );

    proposals.push({
      header,
      columnIndex,
      field: null,
      method: 'inconnu',
      candidates: partial.map((field) => field.key),
      note: partial.length
        ? `Colonne inconnue. Rapprochements possibles à confirmer : ${partial.map((f) => f.label).join(', ')}.`
        : "Colonne inconnue : elle ne sera pas importée tant que vous ne l'aurez pas rapprochée d'un champ (ou écartée explicitement).",
    });
  });

  const suggestedMapping: Record<string, string> = {};
  for (const proposal of proposals) {
    if (proposal.field) suggestedMapping[proposal.header] = proposal.field;
  }

  const mappedFields = new Set(Object.values(suggestedMapping));
  const missingRequired = IMPORT_FIELDS.filter((field) => field.required && !mappedFields.has(field.key)).map((field) => ({
    field: field.key,
    label: field.label,
    why: field.why,
  }));

  // Contrainte métier : sans référence d'offre NI fournisseur, les lignes ne
  // peuvent pas être regroupées en offres distinctes.
  if (!mappedFields.has('offerReference') && !mappedFields.has('supplierName')) {
    missingRequired.push({
      field: 'offerReference|supplierName',
      label: "Référence de l'offre ou nom du fournisseur",
      why: "Sans au moins l'un des deux, impossible de savoir quelles lignes appartiennent à la même offre — le classement serait arbitraire.",
    });
  }

  return {
    proposals,
    suggestedMapping,
    ambiguousColumns: proposals.filter((proposal) => proposal.method === 'ambigu'),
    unknownColumns: proposals.filter((proposal) => proposal.method === 'inconnu'),
    missingRequired,
  };
}

export function fieldLabel(key: string): string {
  return IMPORT_FIELDS.find((field) => field.key === key)?.label ?? key;
}

export function fieldType(key: string): ImportFieldType | null {
  return IMPORT_FIELDS.find((field) => field.key === key)?.type ?? null;
}

/** Valide un mapping fourni par l'utilisateur : aucun champ inexistant accepté. */
export function validateMapping(mapping: Record<string, string>): { headers: Record<string, string>; errors: string[] } {
  const valid = new Set(IMPORT_FIELDS.map((field) => field.key));
  const errors: string[] = [];
  const headers: Record<string, string> = {};

  for (const [header, field] of Object.entries(mapping)) {
    if (field === 'ignore') {
      headers[header] = 'ignore';
      continue;
    }
    if (!valid.has(field)) {
      errors.push(`Champ cible inconnu « ${field} » pour la colonne « ${header} ».`);
      continue;
    }
    headers[header] = field;
  }

  // Un même champ ne peut pas être alimenté par deux colonnes : la dernière
  // valeur écraserait la première sans que personne ne le sache.
  const used = new Map<string, string>();
  for (const [header, field] of Object.entries(headers)) {
    if (field === 'ignore') continue;
    if (used.has(field)) {
      errors.push(
        `Le champ « ${fieldLabel(field)} » est alimenté par deux colonnes (« ${used.get(field)} » et « ${header} »). ` +
          'Choisissez laquelle conserver.'
      );
      continue;
    }
    used.set(field, header);
  }

  return { headers, errors };
}
