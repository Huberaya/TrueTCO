/**
 * TrueTCO — Lecture CSV conforme RFC 4180
 * ---------------------------------------------------------------------------
 * Le lecteur est écrit ici plutôt que délégué à une dépendance non maintenue :
 *   - champs entre guillemets, guillemets doublés (« "" » → « " ») ;
 *   - retours à la ligne À L'INTÉRIEUR d'un champ entre guillemets ;
 *   - fins de ligne CRLF, LF et CR ;
 *   - BOM déjà retiré en amont ;
 *   - lignes de longueur incohérente SIGNALÉES (jamais complétées par des valeurs
 *     vides, ce qui décalerait silencieusement les colonnes).
 */

export interface CsvParseIssue {
  rowNumber: number;
  kind: 'ragged_row' | 'unclosed_quote' | 'empty_row';
  message: string;
}

export interface CsvParseResult {
  /** Lignes brutes, chaque ligne étant un tableau de cellules texte. */
  rows: string[][];
  issues: CsvParseIssue[];
  /** Nombre de colonnes le plus fréquent (référence des lignes cohérentes). */
  detectedColumnCount: number;
}

const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;
const MAX_CELL_LENGTH = 4_000;

export function parseCsv(text: string, delimiter: string): CsvParseResult {
  const rows: string[][] = [];
  const issues: CsvParseIssue[] = [];

  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let rowNumber = 1;
  let fieldWasQuoted = false;
  let unclosedQuoteRow: number | null = null;

  const pushField = () => {
    row.push(field.length > MAX_CELL_LENGTH ? field.slice(0, MAX_CELL_LENGTH) : field);
    field = '';
    fieldWasQuoted = false;
  };

  const pushRow = () => {
    pushField();
    // Une ligne vide (un seul champ vide) n'est pas une donnée : elle est ignorée
    // mais comptée, afin de ne pas décaler les numéros de ligne affichés.
    if (row.length === 1 && row[0].trim() === '') {
      issues.push({ rowNumber, kind: 'empty_row', message: 'Ligne vide ignorée.' });
      row = [];
      rowNumber += 1;
      return;
    }
    if (row.length > MAX_COLUMNS) {
      issues.push({
        rowNumber,
        kind: 'ragged_row',
        message: `Ligne ignorée : elle contient ${row.length} colonnes, au-delà de la limite de ${MAX_COLUMNS}.`,
      });
    } else {
      rows.push(row);
    }
    row = [];
    rowNumber += 1;
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += char;
      continue;
    }

    if (char === '"') {
      if (field === '') {
        inQuotes = true;
        fieldWasQuoted = true;
        continue;
      }
      // Guillemet au milieu d'un champ non cité : conservé littéralement (le
      // fichier est mal formé, mais perdre le caractère serait pire).
      field += char;
      continue;
    }

    if (char === delimiter) {
      pushField();
      continue;
    }

    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
      continue;
    }

    field += char;
  }

  if (inQuotes) unclosedQuoteRow = rowNumber;
  if (field.length > 0 || row.length > 0) pushRow();

  if (unclosedQuoteRow !== null) {
    issues.push({
      rowNumber: unclosedQuoteRow,
      kind: 'unclosed_quote',
      message:
        "Un champ entre guillemets n'a jamais été refermé à la fin du fichier : le contenu après l'ouverture a été rattaché au même champ. " +
        'Vérifiez le fichier source, une guillemet manquante décale toutes les colonnes suivantes.',
    });
  }

  // Colonnes de référence : la longueur la plus fréquente parmi les lignes non vides.
  const counts = new Map<number, number>();
  for (const dataRow of rows) counts.set(dataRow.length, (counts.get(dataRow.length) ?? 0) + 1);
  let detectedColumnCount = rows[0]?.length ?? 0;
  let bestCount = -1;
  for (const [count, occurrences] of counts) {
    if (occurrences > bestCount) {
      detectedColumnCount = count;
      bestCount = occurrences;
    }
  }

  for (const [index, dataRow] of rows.entries()) {
    if (dataRow.length !== detectedColumnCount) {
      issues.push({
        rowNumber: index + 1,
        kind: 'ragged_row',
        message:
          `Ligne de ${dataRow.length} colonne(s) alors que l'en-tête en déclare ${detectedColumnCount} : ` +
          'les colonnes manquantes resteront vides pour cette ligne (aucune valeur inventée).',
      });
    }
  }

  return { rows, issues, detectedColumnCount };
}
