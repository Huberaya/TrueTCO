/**
 * TrueTCO — Lecture des valeurs d'une cellule
 * ---------------------------------------------------------------------------
 * Chaque conversion rend un RÉSULTAT TYPÉ avec son statut et sa note. Une valeur
 * illisible n'est jamais remplacée par 0, une valeur locale ambiguë est signalée
 * avec l'interprétation retenue, et aucun arrondi silencieux n'est appliqué.
 *
 * Exemples de pièges traités :
 *   - « 1 234,56 € » (format français) et « $1,234.56 » (format anglo-saxon) ;
 *   - « 1,234 » : séparateur de milliers ou virgule décimale ? Le produit tranche
 *     par une règle explicite ET le signale comme ambigu ;
 *   - « 3,5% » vs « 0,035 » vs « 3,5 » pour une probabilité ;
 *   - cellules « N/A », « non communiqué », « - » : donnée ABSENTE, pas zéro.
 */

import { TCOEngine, RECOGNIZED_COST_CATEGORIES } from '../../src/engine/tcoEngine';
import { ImportFieldType } from './schema';

export type ValueStatus = 'ok' | 'missing' | 'invalid' | 'ambiguous';

export interface ParsedValue<T = unknown> {
  value: T | null;
  status: ValueStatus;
  note?: string;
  /**
   * Contenu d'origine de la cellule, quand il diffère de la valeur retenue.
   * Indispensable à la traçabilité : on doit pouvoir vérifier ce que
   * l'utilisateur avait RÉELLEMENT écrit (« energie », « opex »…) et à quoi
   * cela a été rattaché, sans jamais avoir à le deviner.
   */
  raw?: string;
}

const MISSING_TOKENS = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'nd',
  'n.d.',
  'non communique',
  'non communiqué',
  'non renseigne',
  'non renseigné',
  'inconnu',
  'a definir',
  'à définir',
  'tbd',
  '?',
]);

function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNumber(raw: unknown): ParsedValue<number> {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: null, status: 'invalid', note: 'Valeur numérique non finie.' };
    return { value: raw, status: 'ok' };
  }
  if (raw === null || raw === undefined) return { value: null, status: 'missing', note: 'Cellule vide.' };

  const text = String(raw).trim();
  if (MISSING_TOKENS.has(normalizeToken(text))) {
    return { value: null, status: 'missing', note: `Valeur absente déclarée (« ${text} ») : elle ne sera pas comptée comme 0.` };
  }

  // Nettoyage : espaces (y compris insécables), symboles monétaires, lettres de code devise.
  const cleaned = text
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/[€$£¥]/g, '')
    .replace(/^(EUR|USD|GBP|CHF|CAD)/i, '')
    .replace(/(EUR|USD|GBP|CHF|CAD)$/i, '')
    .replace(/%$/, '');

  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');
  let normalized = cleaned;
  let ambiguity: string | undefined;

  if (hasComma && hasDot) {
    // Le séparateur le plus à DROITE est le séparateur décimal.
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = cleaned.split(',');
    if (parts.length > 2) {
      // « 1,234,567 » : virgules de milliers.
      normalized = cleaned.replace(/,/g, '');
    } else if (/^\d{1,3}(,\d{3})$/.test(cleaned)) {
      // « 1,234 » : ambigu (1 234 en anglais ou 1,234 en français).
      normalized = cleaned.replace(',', '');
      ambiguity =
        `« ${text} » est ambigu (séparateur de milliers ou virgule décimale ?). ` +
        `Interprétation retenue : ${normalized} (séparateur de milliers).`;
    } else {
      normalized = cleaned.replace(',', '.');
    }
  }

  if (!/^[+-]?\d*\.?\d+$|^[+-]?\.\d+$/.test(normalized)) {
    return { value: null, status: 'invalid', note: `« ${text} » n'est pas un nombre exploitable.` };
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return { value: null, status: 'invalid', note: `« ${text} » n'est pas un nombre fini.` };
  return ambiguity ? { value, status: 'ambiguous', note: ambiguity } : { value, status: 'ok' };
}

export function parseInteger(raw: unknown): ParsedValue<number> {
  const parsed = parseNumber(raw);
  if (parsed.value === null) return parsed;
  if (!Number.isInteger(parsed.value)) {
    const rounded = Math.round(parsed.value);
    return {
      value: rounded,
      status: 'ambiguous',
      note: `Valeur décimale « ${parsed.value} » arrondie à ${rounded} pour un champ attendu en nombre entier.`,
    };
  }
  return parsed;
}

export function parsePercent(raw: unknown): ParsedValue<number> {
  if (raw === null || raw === undefined) return { value: null, status: 'missing', note: 'Cellule vide.' };
  const text = String(raw).trim();
  if (MISSING_TOKENS.has(normalizeToken(text))) return { value: null, status: 'missing', note: `Valeur absente (« ${text} »).` };

  if (typeof raw === 'number') {
    // Un nombre sans symbole % : Excel stocke souvent 0,95 pour 95 %.
    if (raw <= 1 && raw >= 0) {
      return {
        value: raw * 100,
        status: 'ambiguous',
        note: `« ${raw} » interprété comme une fraction (${raw * 100} %). Si le fichier exprime déjà un pourcentage, corrigez la valeur.`,
      };
    }
    if (raw < 0 || raw > 100) return { value: null, status: 'invalid', note: `« ${raw} » hors de la plage 0–100 %.` };
    return { value: raw, status: 'ok' };
  }

  const explicitPercent = text.includes('%');
  const parsed = parseNumber(explicitPercent ? text.replace('%', '') : text);
  if (parsed.value === null) return parsed;

  if (explicitPercent) {
    if (parsed.value < 0 || parsed.value > 100) {
      return { value: null, status: 'invalid', note: `« ${text} » hors de la plage 0–100 %.` };
    }
    return { value: parsed.value, status: 'ok' };
  }

  if (parsed.value > 0 && parsed.value <= 1) {
    return {
      value: parsed.value * 100,
      status: 'ambiguous',
      note: `« ${text} » interprété comme une fraction (${parsed.value * 100} %).`,
    };
  }
  if (parsed.value < 0 || parsed.value > 100) {
    return { value: null, status: 'invalid', note: `« ${text} » hors de la plage 0–100 %.` };
  }
  return parsed;
}

const TRUE_TOKENS = new Set(['oui', 'yes', 'y', 'true', 'vrai', 'v', 'x', '1', 'o']);
const FALSE_TOKENS = new Set(['non', 'no', 'n', 'false', 'faux', 'f', '0', '']);

export function parseBoolean(raw: unknown): ParsedValue<boolean> {
  if (raw === null || raw === undefined) return { value: null, status: 'missing', note: 'Cellule vide.' };
  if (typeof raw === 'boolean') return { value: raw, status: 'ok' };
  if (typeof raw === 'number') {
    if (raw === 1) return { value: true, status: 'ok' };
    if (raw === 0) return { value: false, status: 'ok' };
    return { value: null, status: 'invalid', note: `« ${raw} » n'est pas un booléen (attendu : oui/non, 1/0).` };
  }
  const token = normalizeToken(String(raw));
  if (TRUE_TOKENS.has(token)) return { value: true, status: 'ok' };
  if (FALSE_TOKENS.has(token)) return { value: false, status: 'ok' };
  return { value: null, status: 'invalid', note: `« ${raw} » n'est pas un booléen (attendu : oui/non, 1/0).` };
}

export function parseText(raw: unknown, maxLength = 255): ParsedValue<string> {
  if (raw === null || raw === undefined) return { value: null, status: 'missing', note: 'Cellule vide.' };
  const text = String(raw).trim();
  if (text === '') return { value: null, status: 'missing', note: 'Cellule vide.' };
  if (text.length > maxLength) {
    return {
      value: text.slice(0, maxLength),
      status: 'ambiguous',
      note: `Texte tronqué à ${maxLength} caractères (longueur d'origine : ${text.length}).`,
    };
  }
  return { value: text, status: 'ok' };
}

export function parseDate(raw: unknown): ParsedValue<string> {
  if (raw === null || raw === undefined) return { value: null, status: 'missing', note: 'Cellule vide.' };

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { value: null, status: 'invalid', note: 'Date illisible dans le classeur.' };
    return { value: raw.toISOString().slice(0, 10), status: 'ok' };
  }

  const text = String(raw).trim();
  if (MISSING_TOKENS.has(normalizeToken(text))) return { value: null, status: 'missing', note: `Date absente (« ${text} »).` };

  // ISO 8601 d'abord : aucune ambiguïté.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) {
    const [, year, month, day] = iso;
    const date = `${year}-${month}-${day}`;
    return Number.isNaN(Date.parse(date))
      ? { value: null, status: 'invalid', note: `Date invalide « ${text} ».` }
      : { value: date, status: 'ok', note: 'Format ISO 8601 : jour/mois non ambigus.' };
  }

  const parts = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(text);
  if (!parts) return { value: null, status: 'invalid', note: `« ${text} » n'est pas une date reconnue (formats acceptés : AAAA-MM-JJ, JJ/MM/AAAA).` };

  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];

  // Résolution de l'ambiguïté jour/mois : impossible uniquement lorsque les deux
  // nombres sont ≤ 12.
  if (first <= 12 && second <= 12) {
    const day = String(first).padStart(2, '0');
    const month = String(second).padStart(2, '0');
    const date = `${year}-${month}-${day}`;
    return {
      value: date,
      status: 'ambiguous',
      note:
        `« ${text} » est ambigu (jour/mois inversables). Interprétation retenue : jour/mois (format français), soit ${date}. ` +
        'Corrigez la valeur si le fichier suit le format anglo-saxon.',
    };
  }

  const dayValue = first > 12 ? first : second;
  const monthValue = first > 12 ? second : first;
  if (monthValue < 1 || monthValue > 12 || dayValue < 1 || dayValue > 31) {
    return { value: null, status: 'invalid', note: `« ${text} » n'est pas une date valide.` };
  }
  const date = `${year}-${String(monthValue).padStart(2, '0')}-${String(dayValue).padStart(2, '0')}`;
  return Number.isNaN(Date.parse(date)) ? { value: null, status: 'invalid', note: `Date invalide « ${text} ».` } : { value: date, status: 'ok' };
}

/**
 * Conversion d'une catégorie de coût déclarée vers la catégorie canonique.
 * Aucune proposition approximative : une catégorie inconnue est refusée avec la
 * liste des catégories reconnues et des rapprochements à confirmer.
 */
export function parseCostCategory(raw: unknown): ParsedValue<string> {
  const text = parseText(raw, 100);
  if (text.value === null) {
    return { value: null, status: 'missing', note: "Aucune catégorie déclarée : le montant sera conservé comme coût non arbitré ('autre')." };
  }

  const normalized = TCOEngine.normalizeCostCategory(text.value);
  if (normalized) {
    const isAlias = normalized !== text.value.toLowerCase().trim();
    // Un libellé connu (« energie », « transport », « energy »…) est une lecture
    // NORMALE : la correspondance est certaine. Ce n'est pas une ambiguïté — une
    // ambiguïté serait un libellé qui peut désigner plusieurs catégories, et ce
    // cas n'est pas reconnu ici (il donnera lieu à un arbitrage humain).
    return {
      value: normalized,
      status: 'ok',
      raw: text.value,
      note: isAlias ? `Libellé « ${text.value} » rattaché à la catégorie « ${normalized} » (libellé conservé).` : undefined,
    };
  }

  return {
    value: null,
    status: 'invalid',
    note:
      `Catégorie « ${text.value} » non reconnue. Catégories reconnues : ${RECOGNIZED_COST_CATEGORIES.join(', ')}. ` +
      'Cette ligne doit être rapprochée manuellement ou écartée.',
  };
}

/** Conversion d'une cellule selon le type attendu du champ. */
export function parseByType(raw: unknown, type: ImportFieldType): ParsedValue<unknown> {
  switch (type) {
    case 'number':
      return parseNumber(raw);
    case 'integer':
      return parseInteger(raw);
    case 'percent':
      return parsePercent(raw);
    case 'boolean':
      return parseBoolean(raw);
    case 'date':
      return parseDate(raw);
    case 'category':
      return parseCostCategory(raw);
    case 'text':
    default:
      return parseText(raw);
  }
}
