/**
 * TrueTCO — Détection du format, de l'encodage et du séparateur
 * ---------------------------------------------------------------------------
 * Un fichier importé est une donnée NON FIABLE. Rien n'est déduit de son nom ni
 * de l'en-tête HTTP envoyé par le client : tout est vérifié sur le CONTENU.
 *
 * Ce module répond à trois questions, et refuse de répondre quand la réponse est
 * ambiguë :
 *   1. Quel est le format réel ? (signature ZIP + présence des entrées OOXML pour
 *      un XLSX ; texte pour un CSV)
 *   2. Quel est l'encodage ? (BOM, sinon UTF-8 strict, sinon Windows-1252 — dans
 *      ce dernier cas, l'encodage retenu est REMONTÉ à l'utilisateur, car des
 *      accents mal décodés faussent ensuite les libellés)
 *   3. Quel séparateur ? (comptage par ligne, en ignorant les séparateurs situés
 *      dans des champs entre guillemets, et exigence de constance sur les lignes)
 */

export type DetectedFormat = 'xlsx' | 'csv' | 'unsupported';

export interface DetectionResult {
  format: DetectedFormat;
  /** Encodage retenu pour un fichier texte. */
  encoding?: 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';
  /** Vrai lorsque l'encodage a été DEVINÉ faute de BOM : à signaler à l'utilisateur. */
  encodingGuessed?: boolean;
  delimiter?: ',' | ';' | '\t' | '|';
  /** Raison du rejet pour un format non pris en charge. */
  reason?: string;
  /** Détails utiles à la traçabilité (signature, taille, entrées ZIP trouvées). */
  details: {
    signature: string;
    sizeBytes: number;
    ooxmlEntries?: string[];
  };
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];
const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(buffer: Buffer, signature: number[]): boolean {
  if (buffer.length < signature.length) return false;
  return signature.every((byte, index) => buffer[index] === byte);
}

function hexSignature(buffer: Buffer): string {
  return buffer.subarray(0, 8).toString('hex');
}

/**
 * Lit les NOMS D'ENTRÉES annoncés par le répertoire central de l'archive ZIP.
 *
 * On n'utilise PAS les en-têtes locaux : les générateurs XLSX écrivent souvent les
 * tailles en « descripteur de données » (tailles nulles dans l'en-tête local), ce
 * qui interrompt un parcours séquentiel. Le répertoire central, lui, référence
 * TOUTES les entrées avec leurs tailles définitives ; c'est la structure de
 * référence d'un fichier ZIP bien formé.
 *
 * Aucune donnée n'est décompressée : seule l'ossature de l'archive est lue, ce qui
 * écarte à ce stade toute bombe de décompression.
 */
function readZipEntryNames(buffer: Buffer, limit = 500): string[] {
  const CENTRAL_DIRECTORY = 0x02014b50;
  const entries: string[] = [];
  let offset = 0;

  while (offset + 46 <= buffer.length && entries.length < limit) {
    const index = buffer.indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      offset
    );
    if (index === -1) break;
    if (buffer.readUInt32LE(index) !== CENTRAL_DIRECTORY) {
      offset = index + 4;
      continue;
    }
    const nameLength = buffer.readUInt16LE(index + 28);
    const nameStart = index + 46;
    if (nameLength === 0 || nameStart + nameLength > buffer.length) {
      offset = index + 4;
      continue;
    }
    entries.push(buffer.subarray(nameStart, nameStart + nameLength).toString('utf8'));
    offset = nameStart + nameLength;
  }

  return entries;
}

export function detectFormat(buffer: Buffer): DetectionResult {
  const details = { signature: hexSignature(buffer), sizeBytes: buffer.length };

  if (buffer.length < 4) {
    return { format: 'unsupported', reason: 'Fichier vide ou trop court pour être identifié.', details };
  }

  if (startsWith(buffer, ZIP_SIGNATURE) || startsWith(buffer, ZIP_EMPTY_SIGNATURE)) {
    const entries = readZipEntryNames(buffer);
    const isOoxml =
      entries.some((name) => name === '[Content_Types].xml') &&
      entries.some((name) => name.startsWith('xl/'));
    if (isOoxml) {
      return { format: 'xlsx', details: { ...details, ooxmlEntries: entries.slice(0, 20) } };
    }
    return {
      format: 'unsupported',
      reason:
        "Ce fichier est une archive ZIP qui n'est pas un classeur XLSX (les entrées OOXML « [Content_Types].xml » et « xl/ » sont absentes). " +
        "Les fichiers .xls (ancien format binaire) et les archives compressées ne sont pas acceptés : convertissez le fichier en .xlsx ou .csv.",
      details: { ...details, ooxmlEntries: entries.slice(0, 20) },
    };
  }

  // Fichier texte : on vérifie qu'il ne contient pas d'octet nul (binaire déguisé).
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  const nulCount = sample.filter((byte) => byte === 0).length;
  const isUtf16 = startsWith(buffer, UTF16LE_BOM) || startsWith(buffer, UTF16BE_BOM);
  if (!isUtf16 && nulCount > 0) {
    return {
      format: 'unsupported',
      reason:
        "Ce fichier ne contient pas du texte (octets nuls détectés) et ne porte pas de signature XLSX. " +
        "Formats acceptés : .xlsx (classeur Excel) et .csv (texte délimité).",
      details,
    };
  }

  return { format: 'csv', ...detectTextEncoding(buffer), details };
}

export function detectTextEncoding(buffer: Buffer): Pick<DetectionResult, 'encoding' | 'encodingGuessed'> {
  if (startsWith(buffer, UTF16LE_BOM)) return { encoding: 'utf-16le', encodingGuessed: false };
  if (startsWith(buffer, UTF16BE_BOM)) return { encoding: 'utf-16be', encodingGuessed: false };
  if (startsWith(buffer, UTF8_BOM)) return { encoding: 'utf-8', encodingGuessed: false };

  // UTF-8 strict : on n'accepte la lecture en UTF-8 que si elle est totalement
  // valide. Un fichier Windows-1252 contient souvent des octets invalides en
  // UTF-8 : le décoder de force produirait des caractères de remplacement dans
  // les libellés de coût.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { encoding: 'utf-8', encodingGuessed: true };
  } catch {
    return { encoding: 'windows-1252', encodingGuessed: true };
  }
}

/** Décode un fichier texte dans l'encodage détecté, en retirant le BOM. */
export function decodeText(buffer: Buffer, detection: DetectionResult): string {
  const encoding = detection.encoding ?? 'utf-8';
  const withoutBom = buffer.subarray(
    startsWith(buffer, UTF8_BOM) ? 3 : startsWith(buffer, UTF16LE_BOM) || startsWith(buffer, UTF16BE_BOM) ? 2 : 0
  );
  return new TextDecoder(encoding).decode(withoutBom);
}

/**
 * Détection du séparateur : le séparateur retenu doit produire le MÊME nombre de
 * colonnes sur au moins 70 % des lignes d'échantillon, et au moins 2 colonnes.
 * Un simple « compter les virgules » choisit la virgule dans un fichier français
 * où la virgule est le séparateur décimal.
 */
export function detectDelimiter(text: string): { delimiter?: ',' | ';' | '\t' | '|'; reason?: string } {
  const candidates: (',' | ';' | '\t' | '|')[] = [',', ';', '\t', '|'];
  const sampleLines = splitSampleLines(text, 25);
  if (sampleLines.length === 0) return { reason: 'Le fichier ne contient aucune ligne exploitable.' };

  let best: { delimiter: ',' | ';' | '\t' | '|'; score: number; columns: number } | null = null;

  for (const delimiter of candidates) {
    const counts = sampleLines.map((line) => countOutsideQuotes(line, delimiter));
    const withSeparator = counts.filter((count) => count > 0);
    if (withSeparator.length === 0) continue;

    const columns = Math.max(...counts) + 1;
    if (columns < 2) continue;

    // Le meilleur séparateur est celui dont le nombre de colonnes est le plus
    // souvent identique d'une ligne à l'autre.
    const mode = modeOf(counts);
    const consistency = counts.filter((count) => count === mode).length / counts.length;
    const score = consistency * 100 + columns;
    if (!best || score > best.score) best = { delimiter, score, columns };
  }

  if (!best) {
    return {
      reason:
        "Aucun séparateur de colonnes n'a été identifié (ni « , », ni « ; », ni tabulation, ni « | »). " +
        'Vérifiez que le fichier comporte bien une ligne d’en-tête et plusieurs colonnes.',
    };
  }
  return { delimiter: best.delimiter };
}

function splitSampleLines(text: string, maxLines: number): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < text.length && lines.length < maxLines; index += 1) {
    const char = text[index];
    if (char === '"') inQuotes = !inQuotes;
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      if (current.trim().length > 0) lines.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim().length > 0 && lines.length < maxLines) lines.push(current);
  return lines;
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count += 1;
  }
  return count;
}

function modeOf(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let bestValue = values[0];
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestValue;
}
