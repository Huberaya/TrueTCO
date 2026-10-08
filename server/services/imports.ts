/**
 * TrueTCO — Service du Centre d'import
 * ---------------------------------------------------------------------------
 * Chaîne complète, dans cet ordre :
 *   upload → détection (format, encodage, séparateur) → lecture → analyse du
 *   mapping → prévisualisation avec statuts et qualité → arbitrages humains →
 *   écriture transactionnelle → traçabilité.
 *
 * Deux invariants :
 *   1. Les LIGNES BRUTES sont stockées en base (import_rows) et c'est d'elles que
 *      tout est recalculé. Le navigateur ne peut donc pas décider de la validité
 *      d'un import, ni envoyer une analyse falsifiée.
 *   2. Un lot est explicable : quel fichier (empreinte), quelle feuille, quel
 *      encodage, quel mapping validé, quelles lignes écartées, quel score de
 *      qualité, quelle entrée d'audit.
 *
 * Ce module ne prétend PAS analyser le contenu au sens viral : aucun antivirus
 * n'est configuré dans ce déploiement, et la base l'indique explicitement
 * (`documents.scan_status = 'skipped_no_scanner'`), plutôt que d'écrire « clean »
 * sans l'avoir vérifié.
 */

import crypto from 'crypto';
import { Db, Executor } from '../db/types';
import { AuthContext } from '../auth/types';
import { actorFromContext, recordAudit } from '../audit';
import { HttpError, badRequest, notFound, requireUuid } from '../http';
import { detectDelimiter, detectFormat, decodeText } from '../import/detect';
import { parseCsv } from '../import/csv';
import { parseXlsx } from '../import/xlsx';
import { MappingAnalysis, analyzeColumns, validateMapping } from '../import/schema';
import { RECOGNIZED_COST_CATEGORIES, TCOEngine } from '../../src/engine/tcoEngine';
import { ImportMode, ImportPreview, prepareImport } from '../import/model';
import { commitImport } from '../import/commit';

const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);

/** Taille maximale acceptée pour un fichier d'import (10 Mo par défaut). */
export function maxImportBytes(): number {
  const raw = Number(process.env.TRUETCO_IMPORT_MAX_BYTES ?? 10 * 1024 * 1024);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 1024 * 1024;
}

export interface RequestMetaLike {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface UploadInput {
  projectId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
  mode: ImportMode;
  sheetName?: string | null;
  allowDuplicateContent?: boolean;
}

export interface ImportBatchView {
  batch: Record<string, unknown>;
  document: Record<string, unknown> | null;
  mapping: Record<string, string>;
  mode: ImportMode;
  preview: ImportPreview;
  rows: { rowNumber: number; cells: string[]; status: string; reasons: string[] }[];
  storedAnalysisAt: string | null;
}

type StoredBatch = {
  id: string;
  project_id: string | null;
  document_id: string | null;
  format: 'xlsx' | 'csv';
  status: string;
  mode: string | null;
  column_mapping: Record<string, string> | null;
  excluded_rows: number[] | null;
  category_overrides: Record<string, string> | null;
  offer_references: Record<string, string> | null;
  source_file_name: string | null;
  source_sheet_name: string | null;
  source_encoding: string | null;
  source_delimiter: string | null;
  source_columns: string[] | null;
  source_sha256: string | null;
  data_quality_score: number | null;
  analysis_snapshot: unknown;
  row_count: number;
  imported_offers: number;
  error_count: number;
  created_by: string | null;
  committed_at: string | null;
  created_at: string;
  updated_at: string;
};

async function loadBatch(tx: Executor, batchId: string): Promise<StoredBatch> {
  const rows = await tx.query<StoredBatch>(`SELECT * FROM import_batches WHERE id = $1`, [batchId]);
  if (rows.length === 0) throw notFound("Ce lot d'import est introuvable dans votre organisation.");
  return rows[0];
}

async function loadRawRows(tx: Executor, batchId: string): Promise<string[][]> {
  const rows = await tx.query<{ row_number: number; raw_data: string[] }>(
    `SELECT row_number, raw_data FROM import_rows WHERE batch_id = $1 ORDER BY row_number`,
    [batchId]
  );
  if (rows.length === 0) {
    throw conflict(
      'IMPORT_ROWS_MISSING',
      "Les lignes d'origine de ce lot sont introuvables : l'import ne peut pas être rejoué. Rechargez le fichier."
    );
  }
  return rows.map((row) => row.raw_data);
}

/** Reconstruit la vue complète d'un lot à partir des lignes stockées. */
async function buildView(db: Db, ctx: AuthContext, batchId: string): Promise<ImportBatchView> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const batch = await loadBatch(tx, batchId);
    const rawRows = await loadRawRows(tx, batchId);
    const project = await tx.query<{ currency: string }>(`SELECT currency FROM projects WHERE id = $1`, [
      batch.project_id,
    ]);
    const mode = (batch.mode as ImportMode | null) ?? 'costs';

    const mapping = batch.column_mapping ?? {};
    const preview = prepareImport(rawRows, {
      mode,
      fileName: batch.source_file_name ?? 'fichier importé',
      mimeType: batch.format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
      sizeBytes: 0,
      sha256: batch.source_sha256 ?? '',
      format: batch.format,
      sheetName: batch.source_sheet_name,
      delimiter: batch.source_delimiter,
      encoding: batch.source_encoding ?? 'utf-8',
      encodingGuessed: false,
      mapping,
      excludedRows: batch.excluded_rows ?? [],
      categoryOverrides: batch.category_overrides ?? {},
      offerReferences: batch.offer_references ?? {},
      defaultCurrency: project[0]?.currency ?? 'EUR',
    });

    const document = batch.document_id
      ? await tx.query<Record<string, unknown>>(
          `SELECT id, original_filename, mime_type, size_bytes, content_sha256, scan_status, scan_details, storage_backend, created_at
             FROM documents WHERE id = $1`,
          [batch.document_id]
        )
      : [];

    return {
      batch: { ...batch },
      document: document[0] ?? null,
      mapping,
      mode,
      preview,
      rows: preview.rows.map((row) => ({
        rowNumber: row.rowNumber,
        cells: row.cells,
        status: row.status,
        reasons: row.reasons,
      })),
      storedAnalysisAt: batch.updated_at,
    };
  });
}

/** Lecture d'un fichier, quelle que soit sa forme : XLSX (feuille) ou CSV. */
export async function readImportFile(
  content: Buffer,
  requestedSheet?: string | null
): Promise<{
  format: 'xlsx' | 'csv';
  rows: string[][];
  parseIssues: { rowNumber: number; kind: string; message: string }[];
  encoding: string;
  encodingGuessed: boolean;
  delimiter: string | null;
  sheetName: string | null;
  sheets: { name: string; rowCount: number; columnCount: number }[] | null;
}> {
  const detection = detectFormat(content);

  if (detection.format === 'unsupported') {
    throw new HttpError(415, 'UNSUPPORTED_FILE_FORMAT', detection.reason ?? 'Format de fichier non pris en charge.', {
      signature: detection.details.signature,
      sizeBytes: detection.details.sizeBytes,
    });
  }

  if (detection.format === 'xlsx') {
    let parsed;
    try {
      parsed = await parseXlsx(content, requestedSheet);
    } catch (error) {
      throw badRequest(
        'XLSX_UNREADABLE',
        `Le classeur n'a pas pu être lu : ${error instanceof Error ? error.message : 'erreur inconnue'}. ` +
          "Le fichier est peut-être protégé par mot de passe, corrompu, ou dans l'ancien format .xls."
      );
    }
    if (parsed.rows.length === 0) {
      throw badRequest('FILE_EMPTY', 'Le classeur ne contient aucune ligne de données exploitable.');
    }
    if (parsed.rows.length < 2) {
      throw badRequest(
        'NO_DATA_ROWS',
        "Le classeur ne contient qu'une seule ligne : il faut une ligne d'en-tête ET au moins une ligne de données."
      );
    }
    return {
      format: 'xlsx',
      rows: parsed.rows,
      parseIssues: parsed.issues,
      encoding: 'xlsx (interne)',
      encodingGuessed: false,
      delimiter: null,
      sheetName: parsed.sheetName,
      sheets: parsed.sheets,
    };
  }

  const text = decodeText(content, detection);
  const delimiterResult = detectDelimiter(text);
  if (!delimiterResult.delimiter) {
    throw badRequest('DELIMITER_NOT_DETECTED', delimiterResult.reason ?? "Séparateur de colonnes indétectable.");
  }
  const parsed = parseCsv(text, delimiterResult.delimiter);
  if (parsed.rows.length < 2) {
    throw badRequest(
      'NO_DATA_ROWS',
      "Le fichier ne contient pas de ligne de données après l'en-tête : rien à importer."
    );
  }
  return {
    format: 'csv',
    rows: parsed.rows,
    parseIssues: parsed.issues,
    encoding: detection.encoding ?? 'utf-8',
    encodingGuessed: detection.encodingGuessed ?? false,
    delimiter: delimiterResult.delimiter,
    sheetName: null,
    sheets: null,
  };
}

export interface UploadResult {
  batchId: string;
  documentId: string;
  projectId: string;
  mode: ImportMode;
  format: 'xlsx' | 'csv';
  sheetName: string | null;
  availableSheets: { name: string; rowCount: number; columnCount: number }[] | null;
  encoding: string;
  encodingGuessed: boolean;
  delimiter: string | null;
  sha256: string;
  sizeBytes: number;
  headers: string[];
  rowCount: number;
  mapping: MappingAnalysis & { applied: Record<string, string> };
  preview: ImportPreview;
  notes: string[];
}

export async function uploadImport(
  db: Db,
  ctx: AuthContext,
  input: UploadInput,
  meta: RequestMetaLike
): Promise<UploadResult> {
  if (input.content.length === 0) throw badRequest('FILE_EMPTY', 'Le fichier transmis est vide.');
  if (input.content.length > maxImportBytes()) {
    throw new HttpError(
      413,
      'FILE_TOO_LARGE',
      `Le fichier dépasse la taille maximale acceptée (${Math.round(maxImportBytes() / 1024 / 1024)} Mo). ` +
        'Scindez-le en plusieurs fichiers.'
    );
  }

  const parsed = await readImportFile(input.content, input.sheetName);
  const sha256 = crypto.createHash('sha256').update(input.content).digest('hex');

  return db.asOrganization(ctx.organization.id, async (tx) => {
    const project = await tx.query<{ id: string; currency: string; workflow_status: string }>(
      `SELECT id, currency, workflow_status FROM projects WHERE id = $1`,
      [input.projectId]
    );
    if (project.length === 0) throw notFound("Ce dossier est introuvable dans votre organisation.");
    if (project[0].workflow_status === 'locked') {
      throw conflict(
        'PROJECT_LOCKED',
        "Ce dossier est verrouillé : un import ne peut plus y être ajouté. Créez une nouvelle version du dossier, ou un nouveau dossier, pour intégrer ces données."
      );
    }
    const defaultCurrency = project[0].currency;

    const existingDocuments = await tx.query<{ id: string; original_filename: string; created_at: string }>(
      `SELECT id, original_filename, created_at FROM documents WHERE content_sha256 = $1`,
      [sha256]
    );

    const previousBatches = existingDocuments.length
      ? await tx.query<{ id: string; project_id: string | null; created_at: string; status: string }>(
          `SELECT id, project_id, created_at, status FROM import_batches WHERE document_id = ANY($1::uuid[]) ORDER BY created_at`,
          [existingDocuments.map((document) => document.id)]
        )
      : [];

    if (existingDocuments.length > 0 && !input.allowDuplicateContent) {
      throw conflict(
        'DOCUMENT_ALREADY_EXISTS',
        `Ce fichier exact a déjà été enregistré (même empreinte SHA-256) sous le nom « ${existingDocuments[0].original_filename} »` +
          (previousBatches.length
            ? `, et utilisé par ${previousBatches.length} lot(s) d'import (statut : ${previousBatches
                .map((batch) => batch.status)
                .join(', ')}).`
            : '.') +
          " Aucune écriture n'a été effectuée. Confirmez explicitement pour créer un nouveau lot à partir du même fichier.",
        {
          documentId: existingDocuments[0].id,
          importedAt: existingDocuments[0].created_at,
          batches: previousBatches.map((batch) => ({ id: batch.id, projectId: batch.project_id, status: batch.status })),
        }
      );
    }

    const documentId = existingDocuments[0]?.id ?? null;
    let resolvedDocumentId = documentId;

    if (!resolvedDocumentId) {
      const [document] = await tx.query<{ id: string }>(
        `INSERT INTO documents (
            organization_id, project_id, original_filename, mime_type, size_bytes, content_sha256,
            storage_key, storage_backend, scan_status, scan_details, uploaded_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,'database','skipped_no_scanner',$8,$9)
         RETURNING id`,
        [
          ctx.organization.id,
          input.projectId,
          input.fileName.slice(0, 255),
          detectFormat(input.content).format === 'xlsx'
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv',
          input.content.length,
          sha256,
          `db://documents/${sha256.slice(0, 2)}/${sha256}`,
          "Aucun antivirus n'est configuré dans ce déploiement : le fichier a été vérifié sur son format réel, sa taille et sa structure, mais son contenu n'a pas été analysé. La mention « clean » n'est jamais utilisée à tort.",
          ctx.user.id,
        ]
      );
      resolvedDocumentId = document.id;

      await tx.query(`INSERT INTO document_contents (document_id, content) VALUES ($1,$2)`, [
        resolvedDocumentId,
        input.content,
      ]);
    }

    const analysis = analyzeColumns(parsed.rows[0] ?? []);
    const [batch] = await tx.query<{ id: string }>(
      `INSERT INTO import_batches (
          organization_id, project_id, document_id, format, status, mode, column_mapping,
          source_file_name, source_sheet_name, source_encoding, source_delimiter, source_columns, source_sha256,
          row_count, created_by, updated_by
       ) VALUES ($1,$2,$3,$4,'mapped',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        ctx.organization.id,
        input.projectId,
        resolvedDocumentId,
        parsed.format,
        input.mode,
        JSON.stringify(analysis.suggestedMapping),
        input.fileName.slice(0, 255),
        parsed.sheetName,
        parsed.encoding,
        parsed.delimiter,
        JSON.stringify(parsed.rows[0] ?? []),
        sha256,
        parsed.rows.length - 1,
        ctx.user.id,
        ctx.user.id,
      ]
    );

    // Lignes brutes : c'est la source de vérité de tout le reste de la chaîne.
    for (const [index, cells] of parsed.rows.entries()) {
      await tx.query(
        `INSERT INTO import_rows (organization_id, batch_id, row_number, raw_data, status) VALUES ($1,$2,$3,$4,'pending')`,
        [ctx.organization.id, batch.id, index + 1, JSON.stringify(cells)]
      );
    }

    const preview = prepareImport(parsed.rows, {
      mode: input.mode,
      fileName: input.fileName,
      mimeType: parsed.format === 'xlsx' ? 'xlsx' : 'text/csv',
      sizeBytes: input.content.length,
      sha256,
      format: parsed.format,
      sheetName: parsed.sheetName,
      availableSheets: parsed.sheets ?? undefined,
      delimiter: parsed.delimiter,
      encoding: parsed.encoding,
      encodingGuessed: parsed.encodingGuessed,
      parseIssues: parsed.parseIssues,
      mapping: analysis.suggestedMapping,
      defaultCurrency,
    });

    await persistAnalysis(tx, batch.id, analysis.suggestedMapping, preview, ctx.user.id);

    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'import.uploaded',
      entityType: 'import_batch',
      entityId: batch.id,
      projectId: input.projectId,
      newValue: JSON.stringify({
        fileName: input.fileName,
        sha256,
        sizeBytes: input.content.length,
        format: parsed.format,
        sheetName: parsed.sheetName,
        encoding: parsed.encoding,
        encodingGuessed: parsed.encodingGuessed,
        delimiter: parsed.delimiter,
        mode: input.mode,
        rowCount: parsed.rows.length - 1,
        dataQualityScore: preview.dataQuality.score,
        blocking: preview.blocking.map((entry) => entry.code),
      }),
      ...meta,
    });

    const notes: string[] = [];
    if (parsed.encodingGuessed) {
      notes.push(
        `Encodage déduit sans marqueur explicite : « ${parsed.encoding} ». Si des accents sont mal affichés dans l'aperçu, exportez à nouveau le fichier en UTF-8.`
      );
    }
    if (parsed.format === 'xlsx' && (parsed.sheets?.length ?? 0) > 1) {
      notes.push(
        `Le classeur contient ${parsed.sheets!.length} feuilles ; la feuille « ${parsed.sheetName} » a été lue. Les autres feuilles ne sont pas importées.`
      );
    }
    if (parsed.parseIssues.length > 0) {
      notes.push(`${parsed.parseIssues.length} anomalie(s) de lecture détectée(s) et affichée(s) ligne par ligne.`);
    }

    return {
      batchId: batch.id,
      documentId: resolvedDocumentId,
      projectId: input.projectId,
      mode: input.mode,
      format: parsed.format,
      sheetName: parsed.sheetName,
      availableSheets: parsed.sheets,
      encoding: parsed.encoding,
      encodingGuessed: parsed.encodingGuessed,
      delimiter: parsed.delimiter,
      sha256,
      sizeBytes: input.content.length,
      headers: parsed.rows[0] ?? [],
      rowCount: parsed.rows.length - 1,
      mapping: { ...analysis, applied: analysis.suggestedMapping },
      preview,
      notes,
    };
  });
}

async function persistAnalysis(
  tx: Executor,
  batchId: string,
  mapping: Record<string, string>,
  preview: ImportPreview,
  userId: string
): Promise<void> {
  await tx.query(
    `UPDATE import_batches
        SET column_mapping = $2,
            analysis_snapshot = $3,
            data_quality_score = $4,
            row_count = $5,
            error_count = $6,
            updated_by = $7,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [
      batchId,
      JSON.stringify(mapping),
      JSON.stringify({
        presentedAt: new Date().toISOString(),
        presentedBy: userId,
        summary: preview.summary,
        dataQuality: preview.dataQuality,
        blocking: preview.blocking,
        offers: preview.offers.map((offer) => ({
          key: offer.key,
          reference: offer.reference,
          supplierName: offer.supplierName,
          totalsByCategory: offer.totalsByCategory,
          total: offer.total,
          statusCounts: offer.statusCounts,
          dataQualityScore: offer.dataQualityScore,
        })),
        unknownCategoryValues: preview.unknownCategoryValues,
        offersWithoutReference: preview.offersWithoutReference,
        unmappedColumns: preview.unmappedColumns,
        parseIssues: preview.parseIssues,
      }),
      preview.dataQuality.score,
      preview.summary.totalRows,
      preview.summary.statusCounts.ERROR,
      userId,
    ]
  );
}

export async function getImportBatch(db: Db, ctx: AuthContext, batchId: string): Promise<ImportBatchView> {
  requireUuid(batchId, 'batchId');
  return buildView(db, ctx, batchId);
}

export async function listImportBatches(
  db: Db,
  ctx: AuthContext,
  projectId: string,
  page: { limit: number; offset: number }
): Promise<{ items: Record<string, unknown>[]; total: number }> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    // Un dossier d'une autre organisation doit produire un 404, jamais une liste
    // vide : une liste vide laisserait croire que le dossier existe et n'a pas
    // d'import (et confirmerait son existence à un tiers).
    const project = await tx.query<{ id: string }>(`SELECT id FROM projects WHERE id = $1`, [projectId]);
    if (project.length === 0) throw notFound("Ce dossier est introuvable dans votre organisation.");

    const total = await tx.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM import_batches WHERE project_id = $1`, [
      projectId,
    ]);
    const items = await tx.query<Record<string, unknown>>(
      `SELECT id, project_id, document_id, format, status, mode, source_file_name, source_sheet_name,
              source_sha256, row_count, imported_offers, error_count, data_quality_score,
              created_by, committed_at, created_at, updated_at
         FROM import_batches
        WHERE project_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [projectId, page.limit, page.offset]
    );
    return { items, total: Number(total[0]?.count ?? 0) };
  });
}

export interface UpdateMappingInput {
  mapping?: Record<string, string>;
  excludedRows?: number[];
  categoryOverrides?: Record<string, string>;
  offerReferences?: Record<string, string>;
  sheetName?: string | null;
  mode?: ImportMode;
}

/** Mise à jour des arbitrages humains, puis nouvelle analyse complète. */
export async function updateImportMapping(
  db: Db,
  ctx: AuthContext,
  batchId: string,
  input: UpdateMappingInput,
  meta: RequestMetaLike
): Promise<ImportBatchView> {
  await db.asOrganization(ctx.organization.id, async (tx) => {
    const batch = await loadBatch(tx, batchId);
    if (batch.status === 'committed') {
      throw conflict(
        'IMPORT_ALREADY_COMMITTED',
        'Ce lot a déjà été importé : il n’est plus modifiable. Un lot importé est une pièce d’audit — repartez d’un nouveau fichier pour corriger.'
      );
    }

    let rows = await loadRawRows(tx, batchId);

    // Changement de feuille : on relit le fichier d'origine stocké, jamais une
    // copie envoyée par le navigateur.
    if (input.sheetName && input.sheetName !== batch.source_sheet_name) {
      if (!batch.document_id) throw badRequest('DOCUMENT_MISSING', "Le fichier d'origine de ce lot est introuvable.");
      const [content] = await tx.query<{ content: Buffer }>(
        `SELECT content FROM document_contents WHERE document_id = $1`,
        [batch.document_id]
      );
      if (!content) throw badRequest('DOCUMENT_MISSING', "Le contenu du fichier d'origine est introuvable.");
      const parsed = await readImportFile(content.content, input.sheetName);
      rows = parsed.rows;
      await tx.query(`DELETE FROM import_rows WHERE batch_id = $1`, [batchId]);
      for (const [index, cells] of rows.entries()) {
        await tx.query(
          `INSERT INTO import_rows (organization_id, batch_id, row_number, raw_data, status) VALUES ($1,$2,$3,$4,'pending')`,
          [ctx.organization.id, batchId, index + 1, JSON.stringify(cells)]
        );
      }
      await tx.query(
        `UPDATE import_batches SET source_sheet_name = $2, source_columns = $3, source_delimiter = $4 WHERE id = $1`,
        [batchId, parsed.sheetName, JSON.stringify(parsed.rows[0] ?? []), parsed.delimiter]
      );
    }

    // Les arbitrages de catégories sont vérifiés : une valeur arbitrée doit être
    // une catégorie RÉELLE du moteur. Sinon l'import écrirait une catégorie que
    // l'analyse ne saurait pas allouer, sans que personne ne s'en aperçoive.
    const overrides: Record<string, string> = {};
    for (const [declared, target] of Object.entries(input.categoryOverrides ?? batch.category_overrides ?? {})) {
      const canonical = TCOEngine.normalizeCostCategory(target);
      if (!canonical) {
        throw badRequest(
          'INVALID_CATEGORY_OVERRIDE',
          `Arbitrage refusé pour « ${declared} » : « ${target} » n'est pas une catégorie reconnue. ` +
            `Catégories reconnues : ${RECOGNIZED_COST_CATEGORIES.join(', ')}.`
        );
      }
      overrides[declared] = canonical;
    }

    // FUSION du mapping, et non remplacement.
    //
    // Défaut réel corrigé ici : un envoi partiel (une seule colonne tranchée)
    // ÉCRASAIT tout le mapping du lot. Les correspondances déjà proposées
    // disparaissaient, toutes les colonnes redevenaient « non tranchées » et
    // toutes les lignes basculaient en erreur : trancher une colonne détruisait
    // l'analyse en cours. Le comportement attendu d'un écran d'arbitrage est
    // additif. Pour retirer une correspondance, l'appelant transmet la valeur
    // vide (« ») pour cette colonne ; pour l'écarter nommément, « ignore ».
    const currentMapping: Record<string, string> = { ...((batch.column_mapping as Record<string, string> | null) ?? {}) };
    const mergedMapping: Record<string, string> = { ...currentMapping };
    for (const [header, field] of Object.entries(input.mapping ?? {})) {
      if (field === undefined || field === null || field === '') {
        delete mergedMapping[header];
      } else {
        mergedMapping[header] = field;
      }
    }

    const { headers: cleanMapping, errors } = validateMapping(mergedMapping);
    if (errors.length > 0) {
      throw badRequest('INVALID_MAPPING', `Le mapping est refusé : ${errors.join(' ')}`, { errors });
    }

    const mode = input.mode ?? (batch.mode as ImportMode | null) ?? 'costs';
    const project = await tx.query<{ currency: string }>(`SELECT currency FROM projects WHERE id = $1`, [batch.project_id]);
    const preview = prepareImport(rows, {
      mode,
      fileName: batch.source_file_name ?? 'fichier importé',
      mimeType: batch.format,
      sizeBytes: 0,
      sha256: batch.source_sha256 ?? '',
      format: batch.format,
      sheetName: batch.source_sheet_name,
      delimiter: batch.source_delimiter,
      encoding: batch.source_encoding ?? 'utf-8',
      encodingGuessed: false,
      mapping: cleanMapping,
      excludedRows: input.excludedRows ?? batch.excluded_rows ?? [],
      categoryOverrides: overrides,
      offerReferences: input.offerReferences ?? batch.offer_references ?? {},
      defaultCurrency: project[0]?.currency ?? 'EUR',
    });

    await tx.query(
      `UPDATE import_batches
          SET column_mapping = $2,
              excluded_rows = $3,
              category_overrides = $4,
              offer_references = $5,
              mode = $6,
              status = 'validated',
              updated_by = $7,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [
        batchId,
        JSON.stringify(cleanMapping),
        JSON.stringify(input.excludedRows ?? batch.excluded_rows ?? []),
        JSON.stringify(overrides),
        JSON.stringify(input.offerReferences ?? batch.offer_references ?? {}),
        mode,
        ctx.user.id,
      ]
    );

    await persistAnalysis(tx, batchId, cleanMapping, preview, ctx.user.id);

    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'import.mapping_updated',
      entityType: 'import_batch',
      entityId: batchId,
      projectId: batch.project_id,
      newValue: JSON.stringify({
        mapping: cleanMapping,
        excludedRows: input.excludedRows ?? batch.excluded_rows ?? [],
        categoryOverrides: overrides,
        offerReferences: input.offerReferences ?? batch.offer_references ?? {},
        blocking: preview.blocking.map((entry) => entry.code),
        canCommit: preview.canCommit,
        dataQualityScore: preview.dataQuality.score,
      }),
      ...meta,
    });
  });

  return buildView(db, ctx, batchId);
}

export async function commitImportBatch(
  db: Db,
  ctx: AuthContext,
  batchId: string,
  meta: RequestMetaLike
): Promise<{ batch: Record<string, unknown>; result: Awaited<ReturnType<typeof commitImport>>; preview: ImportPreview }> {
  const context = await db.asOrganization(ctx.organization.id, async (tx) => {
    const batch = await loadBatch(tx, batchId);
    if (batch.status === 'committed') {
      throw conflict('IMPORT_ALREADY_COMMITTED', 'Ce lot a déjà été importé. Un import ne peut pas être rejoué deux fois.');
    }
    if (!batch.project_id) {
      throw badRequest('PROJECT_REQUIRED', "Ce lot n'est rattaché à aucun dossier.");
    }
    if (!batch.document_id) {
      throw badRequest('DOCUMENT_MISSING', "Le fichier d'origine de ce lot est introuvable.");
    }
    if (!batch.source_sha256) {
      throw badRequest('SOURCE_FINGERPRINT_MISSING', "L'empreinte du fichier source est absente : import refusé faute de traçabilité.");
    }
    const rawRows = await loadRawRows(tx, batchId);
    const project = await tx.query<{ currency: string; workflow_status: string }>(
      `SELECT currency, workflow_status FROM projects WHERE id = $1`,
      [batch.project_id]
    );
    if (project[0]?.workflow_status === 'locked') {
      throw conflict(
        'PROJECT_LOCKED',
        "Ce dossier est verrouillé : l'import ne peut pas être écrit. Créez une nouvelle version du dossier pour intégrer ces données."
      );
    }
    return { batch, rawRows, currency: project[0]?.currency ?? 'EUR' };
  });

  const { batch, rawRows, currency } = context;
  const mode = (batch.mode as ImportMode | null) ?? 'costs';
  const format = batch.format;
  const projectId = batch.project_id as string;

  const result = await commitImport(
    db,
    ctx,
    rawRows,
    {
      fileName: batch.source_file_name ?? 'fichier importé',
      mimeType: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv',
      sizeBytes: 0,
      sha256: batch.source_sha256 as string,
      format,
      sheetName: batch.source_sheet_name,
      delimiter: batch.source_delimiter,
      encoding: batch.source_encoding ?? 'utf-8',
      encodingGuessed: false,
    },
    {
      projectId,
      documentId: batch.document_id as string,
      batchId,
      mode,
      mapping: batch.column_mapping ?? {},
      excludedRows: batch.excluded_rows ?? [],
      categoryOverrides: batch.category_overrides ?? {},
      offerReferences: batch.offer_references ?? {},
      defaultCurrency: currency,
      meta,
    }
  );

  const view = await buildView(db, ctx, batchId);
  return { batch: view.batch, result, preview: view.preview };
}
