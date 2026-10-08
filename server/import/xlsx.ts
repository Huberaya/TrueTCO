/**
 * TrueTCO — Lecture des classeurs XLSX
 * ---------------------------------------------------------------------------
 * DÉCISION DE SÉCURITÉ DOCUMENTÉE
 * Le paquet `xlsx` (SheetJS), présent dans le projet pour l'export côté client,
 * cumule deux avis de sécurité de gravité haute SANS CORRECTIF disponible
 * (prototype pollution et ReDoS). L'utiliser pour lire des fichiers ENVOYÉS PAR
 * UN UTILISATEUR reviendrait à exposer le serveur à une entrée hostile connue
 * comme dangereuse. La lecture des imports est donc confiée à ExcelJS, qui est
 * maintenue et ne présente pas cet historique.
 *
 * Mesures complémentaires appliquées à une entrée non fiable :
 *   - aucune formule n'est évaluée (seule la valeur mise en cache par Excel est
 *     lue, et elle est marquée comme telle) ;
 *   - nombre de lignes, de colonnes et longueur de cellule bornés ;
 *   - les erreurs de cellule (#N/A, #REF!…) ne deviennent JAMAIS des zéros :
 *     elles sont transmises comme valeurs manquantes avec leur motif ;
 *   - les dates sont converties en ISO 8601, jamais en numéro de série Excel.
 *
 * LIMITE ASSUMÉE : la décompression du conteneur ZIP est faite en mémoire par la
 * bibliothèque, sans plafond de taille décompressée. La protection repose sur la
 * taille maximale du fichier accepté (voir TRUETCO_IMPORT_MAX_BYTES, 10 Mo par
 * défaut) et sur les bornes ci-dessous. Un service exposé à des fichiers très
 * volumineux doit déporter la lecture dans un processus isolé : ce n'est pas
 * encore le cas, et c'est écrit ici plutôt que passé sous silence.
 */

import ExcelJS from 'exceljs';
import { CsvParseIssue } from './csv';

export interface XlsxSheetInfo {
  name: string;
  rowCount: number;
  columnCount: number;
}

export interface XlsxParseResult {
  sheets: XlsxSheetInfo[];
  sheetName: string;
  rows: string[][];
  issues: CsvParseIssue[];
  detectedColumnCount: number;
  /** Cellules dont la formule a été rencontrée : valeur mise en cache utilisée. */
  formulaCells: number;
}

const MAX_ROWS = 20_000;
const MAX_COLUMNS = 200;
const MAX_CELL_LENGTH = 4_000;

function isCellError(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>);
}

function isFormulaValue(value: unknown): value is { formula: string; result?: unknown } {
  return typeof value === 'object' && value !== null && 'formula' in (value as Record<string, unknown>);
}

function isRichText(value: unknown): value is { richText: { text: string }[] } {
  return typeof value === 'object' && value !== null && Array.isArray((value as any).richText);
}

function isHyperlink(value: unknown): value is { text: string; hyperlink: string } {
  return typeof value === 'object' && value !== null && 'hyperlink' in (value as Record<string, unknown>);
}

export interface CellConversion {
  text: string;
  /** Motif lorsque la cellule ne contient pas de valeur exploitable. */
  missingReason?: string;
  /** Vrai lorsque la valeur provient d'une formule (valeur mise en cache). */
  fromFormula?: boolean;
}

export function convertCell(value: unknown): CellConversion {
  if (value === null || value === undefined) return { text: '' };

  if (isCellError(value)) {
    return {
      text: '',
      missingReason: `Cellule en erreur dans le classeur source (${value.error}). Aucune valeur ne peut en être déduite.`,
    };
  }

  if (isFormulaValue(value)) {
    const conversion = convertCell(value.result);
    return { ...conversion, fromFormula: true };
  }

  if (value instanceof Date) {
    // Date réelle : convertie en ISO 8601. Aucun numéro de série Excel n'est
    // exposé, car il serait incompréhensible et dépendant du calendrier du classeur.
    return { text: value.toISOString() };
  }

  if (isRichText(value)) return { text: value.richText.map((part) => part.text).join('') };
  if (isHyperlink(value)) return { text: value.text };

  if (typeof value === 'object') {
    // Format numérique personnalisé, formule non calculée, objet inconnu : on ne
    // devine pas. La cellule est considérée comme non exploitable.
    const raw = JSON.stringify(value);
    return { text: raw.length > 200 ? raw.slice(0, 200) : raw, missingReason: 'Cellule au format non exploitable.' };
  }

  const text = String(value);
  return { text: text.length > MAX_CELL_LENGTH ? text.slice(0, MAX_CELL_LENGTH) : text };
}

/**
 * Lit un classeur XLSX à partir de son contenu binaire.
 * @param buffer contenu du fichier
 * @param requestedSheet nom de feuille demandé ; la première feuille non vide est
 *        utilisée par défaut. Aucune feuille n'est choisie au hasard.
 */
export async function parseXlsx(buffer: Buffer, requestedSheet?: string | null): Promise<XlsxParseResult> {
  if (buffer.length === 0) {
    throw new Error('Le fichier est vide.');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);

  const sheets: XlsxSheetInfo[] = workbook.worksheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
  }));

  if (workbook.worksheets.length === 0) {
    throw new Error("Le classeur ne contient aucune feuille.");
  }

  let sheet = requestedSheet ? workbook.worksheets.find((candidate) => candidate.name === requestedSheet) : undefined;
  if (requestedSheet && !sheet) {
    throw new Error(
      `La feuille « ${requestedSheet} » n'existe pas dans ce classeur. Feuilles disponibles : ${sheets
        .map((s) => s.name)
        .join(', ')}.`
    );
  }
  if (!sheet) {
    // Par défaut : la première feuille contenant au moins une cellule non vide.
    sheet = workbook.worksheets.find((candidate) => candidate.actualRowCount > 0) ?? workbook.worksheets[0];
  }

  const rows: string[][] = [];
  const issues: CsvParseIssue[] = [];
  let formulaCells = 0;
  let maxColumn = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rows.length >= MAX_ROWS) {
      if (!issues.some((issue) => issue.kind === 'ragged_row' && issue.rowNumber === 0)) {
        issues.push({
          rowNumber: 0,
          kind: 'ragged_row',
          message: `Le classeur contient plus de ${MAX_ROWS} lignes : l'import s'arrête à cette limite. Scindez le fichier.`,
        });
      }
      return;
    }

    const cells: string[] = [];
    const rowMissingReasons: string[] = [];
    let empty = true;

    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (columnNumber > MAX_COLUMNS) return;
      const conversion = convertCell(cell.value);
      if (conversion.fromFormula) formulaCells += 1;
      if (conversion.missingReason) rowMissingReasons.push(`colonne ${columnNumber} : ${conversion.missingReason}`);
      if (conversion.text.trim() !== '') empty = false;
      cells[columnNumber - 1] = conversion.text;
    });

    if (empty) return;
    maxColumn = Math.max(maxColumn, cells.length);
    while (cells.length < maxColumn) cells.push('');

    if (rowMissingReasons.length > 0) {
      issues.push({
        rowNumber,
        kind: 'ragged_row',
        message: `Valeurs non exploitables sur cette ligne — ${rowMissingReasons.join(' ; ')}.`,
      });
    }

    rows.push(cells.map((cell) => cell ?? ''));
  });

  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index].length < maxColumn) {
      issues.push({
        rowNumber: index + 1,
        kind: 'ragged_row',
        message: `Ligne de ${rows[index].length} colonne(s) alors que la feuille en utilise ${maxColumn} : les colonnes absentes resteront vides.`,
      });
    }
  }

  return {
    sheets,
    sheetName: sheet.name,
    rows,
    issues,
    detectedColumnCount: maxColumn,
    formulaCells,
  };
}
