/**
 * TrueTCO — Modélisation et validation d'un import
 * ---------------------------------------------------------------------------
 * Transforme des lignes BRUTES en un modèle d'offres vérifié, en gardant la
 * trace de chaque décision prise. Règles non négociables appliquées ici :
 *
 *   1. Aucune valeur manquante n'est remplacée par zéro. Une cellule vide donne
 *      une donnée ABSENTE, avec le statut MISSING.
 *   2. Une ligne dont une valeur reconnue est invalide porte le statut ERROR et
 *      bloque l'import : la corriger ou l'écarter, jamais la recalculer.
 *   3. Une valeur présente sans source est UNSOURCED (jamais « vérifiée »).
 *   4. Une catégorie de coût non reconnue n'est PAS devinée : la ligne est en
 *      ERROR, la valeur inconnue est listée avec son nombre d'occurrences, et
 *      l'utilisateur peut l'arbitrer explicitement (categoryOverrides).
 *   5. Une offre sans référence exploitable n'est pas baptisée d'office : la
 *      référence doit être fournie par l'utilisateur (offerReferences).
 *   6. Le score de qualité des données est CALCULÉ par des règles écrites et
 *      affiché avec le détail de ses quatre composantes — il n'est jamais décoré.
 */

import { ImportField, ImportFieldType, IMPORT_FIELDS, fieldLabel } from './schema';
import { ParsedValue, ValueStatus, parseByType } from './values';

export type RowStatus = 'VALID' | 'WARNING' | 'ERROR' | 'MISSING' | 'UNSOURCED' | 'ESTIMATED' | 'DEMO';
export type ImportMode = 'costs' | 'carbon' | 'risks';

const QUALITY_TOKENS: Record<string, RowStatus> = {
  valid: 'VALID',
  valide: 'VALID',
  verifie: 'VALID',
  verified: 'VALID',
  warning: 'WARNING',
  avertissement: 'WARNING',
  error: 'ERROR',
  erreur: 'ERROR',
  missing: 'MISSING',
  manquant: 'MISSING',
  unsourced: 'UNSOURCED',
  non_source: 'UNSOURCED',
  estimated: 'ESTIMATED',
  estime: 'ESTIMATED',
  estimation: 'ESTIMATED',
  demo: 'DEMO',
  exemple: 'DEMO',
};

const STATUS_PRIORITY: Record<RowStatus, number> = {
  VALID: 0,
  WARNING: 1,
  UNSOURCED: 2,
  ESTIMATED: 3,
  DEMO: 4,
  MISSING: 5,
  ERROR: 6,
};

export interface PreparedRow {
  /** Numéro de ligne dans le fichier d'origine (1 = en-tête). */
  rowNumber: number;
  cells: string[];
  values: Record<string, ParsedValue>;
  status: RowStatus;
  reasons: string[];
  offerKey: string;
  offerReference: string | null;
  supplierName: string | null;
  isDuplicateOf: number | null;
}

export interface CategoryCount {
  declared: string;
  occurrences: number;
  rows: number[];
}

export interface PreparedOffer {
  key: string;
  reference: string | null;
  supplierName: string | null;
  currency: string | null;
  lifespanYears: number | null;
  rows: PreparedRow[];
  totalsByCategory: { category: string; amount: number; rows: number }[];
  total: number;
  statusCounts: Record<RowStatus, number>;
  dataQualityScore: number;
  blockers: string[];
  warnings: string[];
}

export interface QualityDimension {
  key: string;
  label: string;
  earned: number;
  max: number;
  detail: string;
}

export interface ImportPreview {
  mode: ImportMode;
  source: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    format: 'xlsx' | 'csv';
    sheetName?: string | null;
    availableSheets?: { name: string; rowCount: number; columnCount: number }[];
    delimiter?: string | null;
    encoding: string;
    encodingGuessed: boolean;
  };
  headers: string[];
  columnCount: number;
  rowCount: number;
  mapping: Record<string, string>;
  ambiguousColumns: { header: string; candidates: string[]; note: string }[];
  unknownColumns: { header: string; candidates: string[]; note: string }[];
  unmappedColumns: string[];
  missingRequired: { field: string; label: string; why: string }[];
  rows: PreparedRow[];
  offers: PreparedOffer[];
  summary: {
    totalRows: number;
    includedRows: number;
    statusCounts: Record<RowStatus, number>;
    totalAmount: number;
    offersCount: number;
    totalByCurrency: { currency: string; amount: number }[];
  };
  unknownCategoryValues: CategoryCount[];
  offersWithoutReference: string[];
  duplicates: { rowNumber: number; duplicateOf: number; label: string }[];
  parseIssues: { rowNumber: number; kind: string; message: string }[];
  dataQuality: {
    score: number;
    gross: number;
    confidenceInSourceData: number;
    dimensions: QualityDimension[];
    explanation: string;
  };
  blocking: { code: string; message: string; rows?: number[] }[];
  /** Vrai si l'import peut être lancé tel quel. */
  canCommit: boolean;
  /** Ce que l'utilisateur doit faire pour débloquer, en une phrase par blocage. */
  nextActions: string[];
}

export interface PrepareOptions {
  mode: ImportMode;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  format: 'xlsx' | 'csv';
  sheetName?: string | null;
  availableSheets?: { name: string; rowCount: number; columnCount: number }[];
  delimiter?: string | null;
  encoding: string;
  encodingGuessed: boolean;
  parseIssues?: { rowNumber: number; kind: string; message: string }[];
  /** Mapping validé (colonne source → champ cible, ou « ignore »). */
  mapping: Record<string, string>;
  /** Lignes explicitement écartées par l'utilisateur. */
  excludedRows?: number[];
  /** Arbitrages de catégories de coût non reconnues (libellé source → catégorie canonique). */
  categoryOverrides?: Record<string, string>;
  /** Références d'offres fournies par l'utilisateur, par clé de regroupement. */
  offerReferences?: Record<string, string>;
  /** Devise par défaut du dossier, utilisée seulement si le fichier n'en déclare pas. */
  defaultCurrency: string;
}

function emptyStatusCounts(): Record<RowStatus, number> {
  return { VALID: 0, WARNING: 0, ERROR: 0, MISSING: 0, UNSOURCED: 0, ESTIMATED: 0, DEMO: 0 };
}

function isRowEmpty(cells: string[]): boolean {
  return cells.every((cell) => (cell ?? '').trim() === '');
}

/** Clé de regroupement d'une offre : jamais inventée, toujours dérivée du fichier. */
function offerKeyOf(reference: string | null, supplier: string | null): string {
  const ref = (reference ?? '').trim().toLowerCase();
  const sup = (supplier ?? '').trim().toLowerCase();
  if (ref) return `ref:${ref}|sup:${sup}`;
  if (sup) return `sup:${sup}`;
  return '';
}

/**
 * Champs sans lesquels l'import n'a pas de sens, PAR MODE.
 * Un import d'émissions n'attend pas de montant ; un import de coûts n'attend pas
 * d'émissions. Exiger le mauvais champ bloquerait un fichier pourtant correct.
 */
function requiredFieldsForMode(mode: ImportMode): string[] {
  if (mode === 'carbon') return ['carbonTonnes'];
  if (mode === 'risks') return ['riskProbability', 'riskImpact'];
  return ['amount'];
}

export function prepareImport(rawRows: string[][], options: PrepareOptions): ImportPreview {
  const headers = (rawRows[0] ?? []).map((header) => (header ?? '').trim());
  const dataRows = rawRows.slice(1);
  const mapping = options.mapping;
  const excluded = new Set(options.excludedRows ?? []);
  const overrides = options.categoryOverrides ?? {};
  const providedReferences = options.offerReferences ?? {};

  // Champs réellement alimentés par une colonne (hors « ignore »).
  const mappedFields = new Map<string, string[]>(); // champ → colonnes sources
  for (const [header, field] of Object.entries(mapping)) {
    if (!field || field === 'ignore') continue;
    mappedFields.set(field, [...(mappedFields.get(field) ?? []), header]);
  }

  const fieldByKey = new Map(IMPORT_FIELDS.map((field) => [field.key, field]));
  const unknownCategoryCounts = new Map<string, CategoryCount>();
  const rows: PreparedRow[] = [];
  const reasonsByRow = new Map<number, string[]>();

  dataRows.forEach((cells, index) => {
    const rowNumber = index + 2; // ligne 1 = en-tête
    if (isRowEmpty(cells ?? [])) return;

    const values: Record<string, ParsedValue> = {};
    const reasons: string[] = [];
    let status: RowStatus = 'VALID';

    const bump = (candidate: RowStatus, reason: string) => {
      reasons.push(reason);
      if (STATUS_PRIORITY[candidate] > STATUS_PRIORITY[status]) status = candidate;
    };

    for (const [fieldKey, sourceHeaders] of mappedFields) {
      const field = fieldByKey.get(fieldKey);
      if (!field) continue;

      // Une seule colonne par champ (garanti par validateMapping), mais on reste
      // défensif : si plusieurs colonnes alimentaient le même champ, on refuse
      // d'en choisir une au hasard.
      if (sourceHeaders.length > 1) {
        bump('ERROR', `Le champ « ${field.label} » est alimenté par plusieurs colonnes : impossible de trancher.`);
        continue;
      }

      const columnIndex = headers.indexOf(sourceHeaders[0]);
      const raw = columnIndex >= 0 ? cells[columnIndex] : undefined;
      let parsed = parseByType(raw, field.type);

      if (fieldKey === 'category' && parsed.value === null && parseStatusIsError(parsed.status)) {
        const declared = String(raw ?? '').trim();
        const override = overrides[declared];
        if (override) {
          parsed = {
            value: override,
            status: 'ambiguous',
            raw: declared,
            note: `Catégorie « ${declared} » arbitrée manuellement en « ${override} » (libellé d'origine conservé).`,
          };
        } else {
          const existing = unknownCategoryCounts.get(declared) ?? { declared, occurrences: 0, rows: [] };
          existing.occurrences += 1;
          existing.rows.push(rowNumber);
          unknownCategoryCounts.set(declared, existing);
        }
      }

      values[fieldKey] = parsed;

      const requiredHere = requiredFieldsForMode(options.mode);
      if (parsed.status === 'invalid') {
        bump('ERROR', `${field.label} : ${parsed.note ?? 'valeur invalide.'}`);
      } else if (parsed.status === 'missing') {
        if (requiredHere.includes(fieldKey)) {
          bump('MISSING', `${field.label} manquant : ${parsed.note ?? 'cellule vide.'} La ligne ne peut pas être importée en l’état.`);
        }
      } else if (parsed.status === 'ambiguous') {
        bump('WARNING', `${field.label} : ${parsed.note ?? 'valeur ambiguë.'}`);
      }
    }

    // Champs obligatoires non mappés du tout : la ligne ne peut pas être produite.
    for (const requiredField of requiredFieldsForMode(options.mode)) {
      if (!mappedFields.has(requiredField)) {
        bump('ERROR', `Le champ « ${fieldLabel(requiredField)} » n'est pas alimenté par ce mapping.`);
      }
    }

    // Statut de qualité : déclaré s'il existe, sinon DÉDUIT par des règles écrites.
    const declaredStatusRaw = values.qualityStatus?.value;
    const sourceName = (values.sourceName?.value as string | undefined) ?? null;
    const isDemo = values.isDemo?.value === true;
    let resolvedStatus: RowStatus;

    if (typeof declaredStatusRaw === 'string') {
      const token = normalizeToken(declaredStatusRaw);
      const declared = QUALITY_TOKENS[token];
      if (!declared) {
        bump('ERROR', `Statut de qualité « ${declaredStatusRaw} » inconnu. Valeurs attendues : VALID, WARNING, ERROR, MISSING, UNSOURCED, ESTIMATED, DEMO.`);
        resolvedStatus = status;
      } else if (declared === 'VALID' && !sourceName && options.mode !== 'carbon') {
        // Règle produit : « validé » sans source nommée n'est pas vérifiable.
        resolvedStatus = 'UNSOURCED';
        reasons.push(
          "Statut « VALID » déclaré sans source : ramené à UNSOURCED. Une donnée ne peut pas être qualifiée de vérifiée sans justificatif."
        );
      } else {
        resolvedStatus = declared;
      }
    } else if (options.mode === 'carbon') {
      resolvedStatus = sourceName ? 'VALID' : 'UNSOURCED';
      if (!sourceName) {
        reasons.push(
          "Aucune source de facteur d'émission : les émissions sont conservées mais marquées non sourcées, jamais vérifiées."
        );
      }
    } else if (isDemo) {
      resolvedStatus = 'DEMO';
    } else if (sourceName) {
      resolvedStatus = 'VALID';
    } else {
      resolvedStatus = 'UNSOURCED';
      reasons.push(
        'Aucune source déclarée pour ce montant : il est conservé mais marqué UNSOURCED (confiance nulle) et n’est pas considéré comme vérifié.'
      );
    }

    const finalStatus: RowStatus =
      STATUS_PRIORITY[resolvedStatus] > STATUS_PRIORITY[status] ? resolvedStatus : status;

    const reference = (values.offerReference?.value as string | undefined) ?? null;
    const supplier = (values.supplierName?.value as string | undefined) ?? null;
    const key = offerKeyOf(reference, supplier);
    if (!key) {
      bump('ERROR', "Ni référence d'offre ni fournisseur sur cette ligne : impossible de la rattacher à une offre.");
    }

    const row: PreparedRow = {
      rowNumber,
      cells: cells ?? [],
      values,
      status: STATUS_PRIORITY[finalStatus] > STATUS_PRIORITY[status] ? finalStatus : status,
      reasons,
      offerKey: key,
      offerReference: reference,
      supplierName: supplier,
      isDuplicateOf: null,
    };
    if (row.status === 'ERROR' || row.status === 'MISSING') {
      reasonsByRow.set(rowNumber, row.reasons);
    }
    rows.push(row);
  });

  // Détection des doublons EXACTS : mêmes offre, libellé, catégorie et montant.
  // Aucune suppression automatique : le doublon est signalé, l'utilisateur décide.
  const seen = new Map<string, number>();
  const duplicates: { rowNumber: number; duplicateOf: number; label: string }[] = [];
  for (const row of rows) {
    const label = String(row.values.label?.value ?? '').trim().toLowerCase();
    const amount = row.values.amount?.value;
    if (!label || amount === undefined || amount === null) continue;
    const signature = `${row.offerKey}|${label}|${row.values.category?.value ?? ''}|${amount}`;
    const previous = seen.get(signature);
    if (previous !== undefined) {
      row.isDuplicateOf = previous;
      duplicates.push({ rowNumber: row.rowNumber, duplicateOf: previous, label: String(row.values.label?.value ?? '') });
    } else {
      seen.set(signature, row.rowNumber);
    }
  }

  // Regroupement en offres.
  const offerMap = new Map<string, PreparedOffer>();
  for (const row of rows) {
    if (excluded.has(row.rowNumber)) continue;
    if (!row.offerKey) continue;
    let offer = offerMap.get(row.offerKey);
    if (!offer) {
      const providedReference = providedReferences[row.offerKey] ?? null;
      offer = {
        key: row.offerKey,
        reference: row.offerReference ?? providedReference,
        supplierName: row.supplierName,
        currency: (row.values.currency?.value as string | undefined) ?? options.defaultCurrency,
        lifespanYears: (row.values.lifespanYears?.value as number | undefined) ?? null,
        rows: [],
        totalsByCategory: [],
        total: 0,
        statusCounts: emptyStatusCounts(),
        dataQualityScore: 0,
        blockers: [],
        warnings: [],
      };
      offerMap.set(row.offerKey, offer);
    }
    const providedReference = providedReferences[row.offerKey] ?? null;
    if (!offer.reference && providedReference) offer.reference = providedReference;
    if (!offer.supplierName && row.supplierName) offer.supplierName = row.supplierName;
    if (!offer.currency && row.values.currency?.value) offer.currency = row.values.currency.value as string;
    if (offer.lifespanYears === null && typeof row.values.lifespanYears?.value === 'number') {
      offer.lifespanYears = row.values.lifespanYears.value;
    }
    offer.rows.push(row);
  }

  const offers = [...offerMap.values()].map((offer) => finalizeOffer(offer, options));

  // Colonnes non résolues : celles que ni le mapping automatique ni l'utilisateur
  // n'ont attribuées. Elles doivent tous être tranchées (mappées ou « ignore »).
  const assigned = new Set(Object.keys(mapping));
  const unmappedColumns = headers.filter((header) => header !== '' && !assigned.has(header));

  const statusCounts = emptyStatusCounts();
  let totalAmount = 0;
  for (const row of rows) {
    if (excluded.has(row.rowNumber)) continue;
    statusCounts[row.status] += 1;
    if (row.status === 'ERROR' || row.status === 'MISSING') continue;
    const amount = row.values.amount?.value;
    if (typeof amount === 'number') totalAmount += amount;
  }

  const totalByCurrency = new Map<string, number>();
  for (const offer of offers) {
    const currency = offer.currency ?? options.defaultCurrency;
    totalByCurrency.set(currency, (totalByCurrency.get(currency) ?? 0) + offer.total);
  }

  const blocking: { code: string; message: string; rows?: number[] }[] = [];
  const missingRequired = requiredFieldsForMode(options.mode)
    .filter((fieldKey) => !mappedFields.has(fieldKey))
    .map((fieldKey) => {
      const field = IMPORT_FIELDS.find((candidate) => candidate.key === fieldKey);
      return { field: fieldKey, label: field?.label ?? fieldKey, why: field?.why ?? '' };
    });

  if (!mappedFields.has('offerReference') && !mappedFields.has('supplierName')) {
    missingRequired.push({
      field: 'offerReference|supplierName',
      label: "Référence de l'offre ou nom du fournisseur",
      why: "Sans au moins l'un des deux, impossible de savoir quelles lignes appartiennent à la même offre — le classement serait arbitraire.",
    });
  }

  if (missingRequired.length > 0) {
    blocking.push({
      code: 'MISSING_REQUIRED_FIELD',
      message:
        'Colonnes obligatoires absentes : ' +
        missingRequired.map((field) => `${field.label} (${field.why})`).join(' '),
    });
  }

  if (unknownCategoryCounts.size > 0 && Object.keys(overrides).length === 0) {
    blocking.push({
      code: 'UNKNOWN_COST_CATEGORY',
      message:
        'Catégories de coût non reconnues : ' +
        [...unknownCategoryCounts.values()]
          .map((entry) => `« ${entry.declared} » (${entry.occurrences} ligne(s))`)
          .join(', ') +
        ". Rapprochez chacune d'une catégorie reconnue (le produit ne devine pas), ou écartez les lignes concernées.",
      rows: [...unknownCategoryCounts.values()].flatMap((entry) => entry.rows),
    });
  }

  const missingRows = rows
    .filter((row) => !excluded.has(row.rowNumber) && row.status === 'MISSING')
    .map((row) => row.rowNumber);
  if (missingRows.length > 0) {
    blocking.push({
      code: 'MISSING_VALUES',
      message:
        `${missingRows.length} ligne(s) sans valeur obligatoire (montant, émission ou impact selon le mode d'import). ` +
        "Deux issues, aucune automatique : complétez la cellule dans le fichier d'origine et rechargé-le, ou écartez explicitement ces lignes — " +
        "le produit ne remplit jamais une valeur manquante, et ne la compte jamais 0 €.",
      rows: missingRows,
    });
  }

  const errorRows = rows.filter((row) => !excluded.has(row.rowNumber) && row.status === 'ERROR').map((row) => row.rowNumber);
  if (errorRows.length > 0) {
    blocking.push({
      code: 'INVALID_ROWS',
      message:
        `${errorRows.length} ligne(s) en erreur : une valeur reconnue comme invalide ne peut pas être importée. ` +
        'Corrigez la cellule d’origine ou écartez la ligne — le produit ne remplace jamais une valeur invalide.',
      rows: errorRows,
    });
  }

  const offersWithoutReference = offers.filter((offer) => !offer.reference).map((offer) => offer.key);
  if (offersWithoutReference.length > 0) {
    const keys = offers
      .filter((offer) => !offer.reference)
      .map((offer) => `« ${offer.supplierName ?? offer.key} » (${offer.rows.length} ligne(s))`);
    blocking.push({
      code: 'OFFER_REFERENCE_REQUIRED',
      message:
        `Référence absente pour ${offersWithoutReference.length} offre(s) : ${keys.join(', ')}. ` +
        'Indiquez la référence de votre choix (elle sera enregistrée telle quelle et conservée dans la traçabilité).',
    });
  }

  if (unmappedColumns.length > 0) {
    blocking.push({
      code: 'UNRESOLVED_COLUMNS',
      message:
        `Colonnes non tranchées : ${unmappedColumns.join(', ')}. Pour chacune, choisissez le champ correspondant ou marquez-la « à ignorer ». ` +
        "Une colonne inconnue n'est ni devinée ni ignorée en silence.",
    });
  }

  if (offers.length === 0) {
    blocking.push({
      code: 'NO_OFFER_DETECTED',
      message: "Aucune offre n'a pu être constituée : vérifiez le mapping et le contenu du fichier.",
    });
  }

  const dataQuality = computeDataQuality(rows, offers, excluded, mappedFields, options);

  const preview: ImportPreview = {
    mode: options.mode,
    source: {
      fileName: options.fileName,
      mimeType: options.mimeType,
      sizeBytes: options.sizeBytes,
      sha256: options.sha256,
      format: options.format,
      sheetName: options.sheetName ?? null,
      availableSheets: options.availableSheets,
      delimiter: options.delimiter ?? null,
      encoding: options.encoding,
      encodingGuessed: options.encodingGuessed,
    },
    headers,
    columnCount: headers.length,
    rowCount: dataRows.length,
    mapping,
    ambiguousColumns: [],
    unknownColumns: [],
    unmappedColumns,
    missingRequired,
    rows,
    offers,
    summary: {
      totalRows: rows.length,
      includedRows: rows.filter((row) => !excluded.has(row.rowNumber)).length,
      statusCounts,
      totalAmount,
      offersCount: offers.length,
      totalByCurrency: [...totalByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
    },
    unknownCategoryValues: [...unknownCategoryCounts.values()],
    offersWithoutReference,
    duplicates,
    parseIssues: options.parseIssues ?? [],
    dataQuality,
    blocking,
    canCommit: blocking.length === 0,
    nextActions: blocking.map((entry) => entry.message),
  };

  return preview;
}

function parseStatusIsError(status: ValueStatus): boolean {
  return status === 'invalid';
}

function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();
}

function finalizeOffer(offer: PreparedOffer, options: PrepareOptions): PreparedOffer {
  const byCategory = new Map<string, { amount: number; rows: number }>();
  let total = 0;

  for (const row of offer.rows) {
    offer.statusCounts[row.status] += 1;

    // Les lignes en erreur ou sans montant ne contribuent PAS au total : elles ne
    // sont pas comptées zéro, elles sont exclues du total et signalées.
    if (row.status === 'ERROR' || row.status === 'MISSING') continue;
    const amount = row.values.amount?.value;
    if (typeof amount !== 'number') continue;

    const category = (row.values.category?.value as string | undefined) ?? 'autre';
    const categoryKey = category === 'autre' ? 'autre (non arbitré)' : category;
    const existing = byCategory.get(categoryKey) ?? { amount: 0, rows: 0 };
    existing.amount += amount;
    existing.rows += 1;
    byCategory.set(categoryKey, existing);
    total += amount;
  }

  offer.totalsByCategory = [...byCategory.entries()]
    .map(([category, entry]) => ({ category, amount: entry.amount, rows: entry.rows }))
    .sort((a, b) => b.amount - a.amount);
  offer.total = total;

  if (offer.statusCounts.ERROR > 0) {
    offer.blockers.push(`${offer.statusCounts.ERROR} ligne(s) en erreur dans cette offre : l'import de l'offre est bloqué.`);
  }
  if (offer.statusCounts.MISSING > 0) {
    offer.blockers.push(`${offer.statusCounts.MISSING} ligne(s) sans montant : elles sont exclues du total (jamais comptées 0 €).`);
  }
  if (offer.statusCounts.UNSOURCED > 0) {
    offer.warnings.push(
      `${offer.statusCounts.UNSOURCED} poste(s) sans source : conservés au total mais marqués non sourcés dans l'analyse.`
    );
  }
  if (offer.statusCounts.ESTIMATED > 0) {
    offer.warnings.push(`${offer.statusCounts.ESTIMATED} poste(s) déclarés comme estimés : à confirmer avant décision.`);
  }
  if (offer.statusCounts.DEMO > 0) {
    offer.warnings.push(
      `${offer.statusCounts.DEMO} poste(s) marqués comme données de démonstration : ils resteront identifiables comme tels et ne doivent pas servir une décision réelle.`
    );
  }
  if (!offer.lifespanYears) {
    offer.warnings.push(
      "Durée de vie non déclarée : le coût complet sera calculé sur l'horizon du dossier, sans renouvellement implicite."
    );
  }
  if (offer.currency && offer.currency !== options.defaultCurrency) {
    offer.warnings.push(
      `Devise « ${offer.currency} » différente de celle du dossier (« ${options.defaultCurrency} ») : aucune conversion automatique n'est appliquée, la devise est enregistrée telle quelle.`
    );
  }

  offer.dataQualityScore = scoreOffer(offer);
  return offer;
}

/**
 * Score de qualité d'une offre : part des lignes exploitables et sourcées.
 * Une offre dont la moitié des montants ne vient d'aucune source ne peut pas
 * afficher une bonne qualité de données, même si le fichier est bien formé.
 */
function scoreOffer(offer: PreparedOffer): number {
  const total = offer.rows.length;
  if (total === 0) return 0;
  const usable = offer.rows.filter((row) => row.status !== 'ERROR' && row.status !== 'MISSING').length;
  const sourced = offer.rows.filter((row) => row.status === 'VALID' || row.status === 'WARNING').length;
  return Math.round((usable / total) * 60 + (sourced / total) * 40);
}

/**
 * Score de qualité des données — quatre composantes de 25 points, chacune
 * calculée par une règle explicitée dans le détail affiché à l'utilisateur.
 */
export function computeDataQuality(
  rows: PreparedRow[],
  offers: PreparedOffer[],
  excluded: Set<number>,
  mappedFields: Map<string, string[]>,
  options: PrepareOptions
): ImportPreview['dataQuality'] {
  const included = rows.filter((row) => !excluded.has(row.rowNumber));
  const dimensions: QualityDimension[] = [];

  if (included.length === 0) {
    return {
      score: 0,
      gross: 0,
      confidenceInSourceData: 0,
      dimensions: [
        { key: 'completeness', label: 'Complétude', earned: 0, max: 25, detail: 'Aucune ligne à évaluer.' },
      ],
      explanation: 'Aucune ligne exploitable : le score de qualité est nul, il n’est pas « neutre ».',
    };
  }

  // 1. Complétude : part des cellules renseignées parmi les cellules attendues.
  let expected = 0;
  let filled = 0;
  for (const row of included) {
    for (const fieldKey of mappedFields.keys()) {
      const field = IMPORT_FIELDS.find((candidate) => candidate.key === fieldKey);
      if (!field) continue;
      if (!requiredFieldsForMode(options.mode).includes(fieldKey)) continue;
      expected += 1;
      const value = row.values[fieldKey];
      if (value && (value.status === 'ok' || value.status === 'ambiguous')) filled += 1;
    }
  }
  const completeness = expected === 0 ? 0 : (filled / expected) * 25;
  dimensions.push({
    key: 'completeness',
    label: 'Complétude',
    earned: Math.round(completeness * 10) / 10,
    max: 25,
    detail:
      expected === 0
        ? 'Aucun champ obligatoire mappé : rien à mesurer.'
        : `${filled} valeur(s) renseignée(s) sur ${expected} attendue(s) pour les champs obligatoires.`,
  });

  // 2. Traçabilité des sources : part des lignes avec source nommée.
  const withSource = included.filter((row) => Boolean(row.values.sourceName?.value)).length;
  const sourceMapped = mappedFields.has('sourceName');
  const sourcing = sourceMapped ? (withSource / included.length) * 25 : 0;
  dimensions.push({
    key: 'sourcing',
    label: 'Traçabilité des sources',
    earned: Math.round(sourcing * 10) / 10,
    max: 25,
    detail: sourceMapped
      ? `${withSource} ligne(s) sur ${included.length} portent une source nommée.`
      : "Aucune colonne « source » n'est mappée : aucune ligne ne peut être reliée à un justificatif, le score de traçabilité est donc nul.",
  });

  // 3. Cohérence : lignes sans valeur invalide + offres dont le total est exploitable.
  const validRows = included.filter((row) => row.status !== 'ERROR' && row.status !== 'MISSING').length;
  const rowConsistency = (validRows / included.length) * 12.5;
  const offersWithTotal = offers.filter((offer) => offer.total > 0).length;
  const offerConsistency = offers.length === 0 ? 0 : (offersWithTotal / offers.length) * 12.5;
  dimensions.push({
    key: 'consistency',
    label: 'Cohérence',
    earned: Math.round((rowConsistency + offerConsistency) * 10) / 10,
    max: 25,
    detail:
      `${validRows} ligne(s) sur ${included.length} sans valeur invalide ou manquante ; ` +
      `${offersWithTotal} offre(s) sur ${offers.length} avec un total calculable.`,
  });

  // 4. Identification : lignes rattachables à une offre identifiée (référence ou fournisseur).
  const identified = included.filter((row) => row.offerKey !== '').length;
  const identification = (identified / included.length) * 25;
  dimensions.push({
    key: 'identification',
    label: 'Identification des offres',
    earned: Math.round(identification * 10) / 10,
    max: 25,
    detail: `${identified} ligne(s) sur ${included.length} rattachables à une offre identifiée (référence ou fournisseur).`,
  });

  const gross = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.earned, 0));
  const score = Math.max(0, Math.min(100, gross));

  // Confiance dans les données source : part des lignes vérifiables (sourcées et
  // non estimées) — distincte du score de qualité, qui mesure aussi la forme.
  const solidRows = included.filter((row) => row.status === 'VALID').length;
  const confidenceInSourceData = Math.round((solidRows / included.length) * 100);

  const weakest = [...dimensions].sort((a, b) => a.earned / a.max - b.earned / b.max)[0];
  const explanation =
    `Score ${score}/100 : complétude ${dimensions[0].earned}/25, sources ${dimensions[1].earned}/25, ` +
    `cohérence ${dimensions[2].earned}/25, identification ${dimensions[3].earned}/25. ` +
    `Pénalité principale : ${weakest.label} (${weakest.detail})`;

  return { score, gross, confidenceInSourceData, dimensions, explanation };
}
