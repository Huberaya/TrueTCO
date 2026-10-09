/**
 * TrueTCO — Centre d'import (Phase 2)
 * ---------------------------------------------------------------------------
 * Le parcours suit exactement la chaîne du serveur :
 *   fichier → détection → mapping assisté → aperçu → corrections → import tracé.
 *
 * Ce que l'interface REFUSE de faire :
 *   - deviner une colonne inconnue (elle doit être rapprochée ou écartée) ;
 *   - inventer une référence d'offre ;
 *   - remplacer une valeur manquante par 0 ;
 *   - masquer un blocage : les points à corriger sont listés en clair, avec ce que
 *     chaque correction débloque.
 * Aucune analyse n'est calculée dans le navigateur : tout vient du serveur, qui
 * relit le fichier stocké.
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  ShieldAlert,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  ApiError,
  IMPORT_TARGET_FIELDS,
  ImportBatchView,
  ImportCommitResult,
  ImportPreview,
  ImportRowView,
  commitImportBatch,
  updateImportBatch,
  uploadImportFile,
} from '../services/serverData';

interface ImportCenterViewProps {
  projectId: string | null;
  projectName: string;
  projectCurrency: string;
  canImport: boolean;
  onImported?: () => void;
}

type ImportMode = 'costs' | 'carbon' | 'risks';

const MODE_LABEL: Record<ImportMode, string> = {
  costs: 'Postes de coût',
  carbon: 'Émissions (tCO2e)',
  risks: 'Risques',
};

const STATUS_STYLE: Record<ImportRowView['status'], string> = {
  VALID: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  WARNING: 'bg-amber-950 text-amber-300 border-amber-800',
  ERROR: 'bg-rose-950 text-rose-300 border-rose-800',
  MISSING: 'bg-rose-950 text-rose-300 border-rose-800',
  UNSOURCED: 'bg-slate-800 text-slate-300 border-slate-600',
  ESTIMATED: 'bg-sky-950 text-sky-300 border-sky-800',
  DEMO: 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-800',
};

const STATUS_MEANING: Record<ImportRowView['status'], string> = {
  VALID: 'Valeur déclarée avec une source nommée.',
  WARNING: 'Valeur lisible mais ambiguë ou incomplète : l’interprétation retenue est affichée.',
  ERROR: 'Valeur reconnue comme invalide : à corriger dans le fichier ou à écarter.',
  MISSING: 'Valeur obligatoire absente : jamais remplacée par zéro.',
  UNSOURCED: 'Valeur présente mais sans source : conservée, jamais considérée comme vérifiée.',
  ESTIMATED: 'Valeur déclarée comme estimée : à confirmer avant décision.',
  DEMO: 'Donnée de démonstration : elle restera marquée comme telle.',
};

export const ImportCenterView: React.FC<ImportCenterViewProps> = ({
  projectId,
  projectName,
  projectCurrency,
  canImport,
  onImported,
}) => {
  const [mode, setMode] = useState<ImportMode>('costs');
  const [file, setFile] = useState<File | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);
  const [upload, setUpload] = useState<ImportBatchView | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [excludedRows, setExcludedRows] = useState<number[]>([]);
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});
  const [offerReferences, setOfferReferences] = useState<Record<string, string>>({});
  const [commit, setCommit] = useState<ImportCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

  const preview: ImportPreview | null = upload?.preview ?? null;

  const reset = () => {
    setUpload(null);
    setMapping({});
    setExcludedRows([]);
    setCategoryOverrides({});
    setOfferReferences({});
    setCommit(null);
    setError(null);
    setNotice(null);
    setDuplicateWarning(null);
    setDuplicateConfirmed(false);
  };

  const doUpload = async () => {
    if (!projectId || !file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setCommit(null);
    try {
      const result = await uploadImportFile(projectId, file, {
        mode,
        allowDuplicateContent: duplicateConfirmed,
      });
      const view: ImportBatchView = {
        batch: {
          id: result.batchId,
          project_id: projectId,
          status: 'mapped',
          mode: result.mode,
          format: result.format,
          row_count: result.rowCount,
          imported_offers: 0,
          error_count: 0,
          data_quality_score: result.preview.dataQuality.score,
          source_file_name: file.name,
          source_sheet_name: result.sheetName,
          source_sha256: result.sha256,
          committed_at: null,
          created_at: new Date().toISOString(),
        },
        document: null,
        mapping: result.mapping.applied,
        mode: result.mode,
        preview: result.preview,
        rows: result.preview.rows.map((row) => ({
          rowNumber: row.rowNumber,
          cells: row.cells,
          status: row.status,
          reasons: row.reasons,
        })),
      };
      setUpload(view);
      setMapping(result.mapping.applied);
      setNotice(result.notes.length ? result.notes.join(' ') : null);
      setDuplicateWarning(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'DOCUMENT_ALREADY_EXISTS') {
        setDuplicateWarning(caught.message);
      } else {
        setError(caught instanceof ApiError ? caught.message : "Le fichier n'a pas pu être analysé.");
      }
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (payload: Parameters<typeof updateImportBatch>[1]) => {
    if (!upload) return;
    setBusy(true);
    setError(null);
    try {
      const view = await updateImportBatch(upload.batch.id, payload);
      setUpload(view);
      setNotice(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "L'analyse n'a pas pu être recalculée.");
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async () => {
    if (!upload) return;
    setBusy(true);
    setError(null);
    try {
      const result = await commitImportBatch(upload.batch.id);
      setCommit(result);
      setNotice(
        `Import terminé : ${result.result.createdOffers.length} offre(s) créée(s), ${result.result.createdCostItems} poste(s) de coût enregistré(s).`
      );
      onImported?.();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "L'import a échoué.");
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) {
    return (
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-300 flex items-start gap-2">
        <Info className="w-4 h-4 text-emerald-400 mt-0.5" />
        <span>Sélectionnez d'abord un dossier : un import alimente toujours un dossier précis.</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
          <Upload className="w-4 h-4" />
          Centre d'import
        </div>
        <h2 className="text-2xl font-bold text-white tracking-tight">Importer un devis, un fichier de coûts ou d'émissions</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Dossier « {projectName} » (devise {projectCurrency}). Formats acceptés : XLSX et CSV. Le format réel du fichier est
          vérifié sur son contenu, pas sur son extension. Rien n'est écrit tant que vous n'avez pas validé l'aperçu.
        </p>
      </div>

      {/* Étape 1 — fichier */}
      <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="text-sm font-bold text-white">1. Fichier et nature des données</div>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Nature</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as ImportMode)}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white"
            >
              {(Object.keys(MODE_LABEL) as ImportMode[]).map((key) => (
                <option key={key} value={key}>
                  {MODE_LABEL[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-slate-400">Fichier (.xlsx ou .csv)</span>
            <input
              type="file"
              accept=".xlsx,.csv,text/csv"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                reset();
                setFile(event.target.files?.[0] ?? null);
              }}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white file:mr-2 file:bg-slate-800 file:border-0 file:text-white file:px-2 file:py-1 file:rounded"
            />
          </label>
          <button
            onClick={doUpload}
            disabled={!file || busy || !canImport}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1.5"
            title={canImport ? 'Analyser le fichier' : "Votre rôle ne permet pas d'importer des données"}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Analyser le fichier
          </button>
        </div>

        {!canImport && (
          <div className="text-[11px] text-slate-400">
            Votre rôle autorise la lecture des imports, mais pas leur exécution (permission « import:write » requise).
          </div>
        )}

        {duplicateWarning && (
          <div className="p-3 bg-amber-950/50 border border-amber-800 rounded-lg text-[11px] text-amber-100 space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{duplicateWarning}</span>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={duplicateConfirmed}
                onChange={(event) => setDuplicateConfirmed(event.target.checked)}
              />
              <span>Je confirme vouloir créer un nouveau lot à partir de ce même fichier.</span>
            </label>
          </div>
        )}

        {notice && <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-300">{notice}</div>}
        {error && (
          <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-lg text-[11px] text-rose-100 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </section>

      {preview && upload && (
        <>
          {/* Étape 2 — aperçu */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold text-white">2. Aperçu de ce qui sera importé</div>
              <div className="text-[11px] text-slate-400 flex flex-wrap gap-3">
                <span>
                  {preview.source.fileName} · {preview.source.format.toUpperCase()}
                  {preview.source.sheetName ? ` · feuille « ${preview.source.sheetName} »` : ''}
                </span>
                <span>Encodage {preview.source.encoding}{preview.source.encodingGuessed ? ' (déduit)' : ''}</span>
                {preview.source.delimiter && <span>Séparateur « {preview.source.delimiter} »</span>}
                <span className="font-mono text-[10px]">SHA-256 {preview.source.sha256.slice(0, 16)}…</span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <ScoreCard label="Score de qualité des données" value={`${preview.dataQuality.score}/100`} detail={preview.dataQuality.explanation} />
              <ScoreCard
                label="Lignes retenues"
                value={`${preview.summary.includedRows}/${preview.summary.totalRows}`}
                detail={`${preview.summary.offersCount} offre(s) identifiée(s)`}
              />
              <ScoreCard
                label="Somme des montants saisis"
                value={new Intl.NumberFormat('fr-FR', { style: 'currency', currency: projectCurrency, maximumFractionDigits: 0 }).format(
                  preview.summary.totalAmount
                )}
                detail="Somme brute des cellules mappées au montant, avant fréquence annuelle, horizon et actualisation TCO"
              />
              <ScoreCard
                label="Lignes non sourcées"
                value={String(preview.summary.statusCounts.UNSOURCED ?? 0)}
                detail="Conservées, mais jamais présentées comme vérifiées"
              />
            </div>

            <div className="grid gap-1.5 text-[11px]">
              {Object.entries(preview.summary.statusCounts)
                .filter(([, count]) => count > 0)
                .map(([status, count]) => (
                  <div key={status} className="flex items-start gap-2">
                    <span className={`px-2 py-0.5 rounded border font-semibold ${STATUS_STYLE[status as ImportRowView['status']]}`}>
                      {status} · {count}
                    </span>
                    <span className="text-slate-400">{STATUS_MEANING[status as ImportRowView['status']]}</span>
                  </div>
                ))}
            </div>

            <div className="grid gap-2 text-[11px]">
              {preview.dataQuality.dimensions.map((dimension) => (
                <div key={dimension.key} className="flex items-center gap-2">
                  <span className="w-44 text-slate-300">{dimension.label}</span>
                  <span className="font-mono text-white">
                    {dimension.earned}/{dimension.max}
                  </span>
                  <span className="text-slate-500">{dimension.detail}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Étape 3 — mapping */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-sm font-bold text-white">3. Rapprochement des colonnes</div>
            <p className="text-[11px] text-slate-400">
              Chaque colonne du fichier est rattachée à un champ, ou explicitement écartée. Une colonne inconnue n'est
              jamais devinée : sans votre décision, l'import reste bloqué.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-slate-400">
                  <tr>
                    <th className="text-left py-1.5 font-semibold">Colonne du fichier</th>
                    <th className="text-left py-1.5 font-semibold">Champ cible</th>
                    <th className="text-left py-1.5 font-semibold">Remarque</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {preview.headers.map((header, index) => {
                    const current = mapping[header] ?? 'ignore';
                    const unknown = preview.unmappedColumns.includes(header);
                    return (
                      <tr key={`${header}-${index}`}>
                        <td className="py-1.5 text-slate-200">
                          {header || <em className="text-slate-500">(sans intitulé)</em>}
                          {unknown && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 text-[10px]">
                              non tranchée
                            </span>
                          )}
                        </td>
                        <td className="py-1.5">
                          <select
                            value={current}
                            disabled={!canImport}
                            onChange={(event) => {
                              const next = { ...mapping, [header]: event.target.value };
                              setMapping(next);
                              void refresh({ mapping: next });
                            }}
                            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white w-full max-w-[240px]"
                          >
                            <option value="ignore">— à ignorer —</option>
                            {IMPORT_TARGET_FIELDS.map((field) => (
                              <option key={field.key} value={field.key}>
                                {field.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1.5 text-slate-500">
                          {current === 'occurrencesPerYear' && (
                            <p className="mb-1 text-amber-300">
                              Le montant est alors interprété par événement et multiplié par cette fréquence à chaque année d’occurrence. Si le montant est déjà un total annuel, choisissez « à ignorer ».
                            </p>
                          )}
                          {preview.ambiguousColumns.find((column) => column.header === header)?.note ??
                            preview.unknownColumns.find((column) => column.header === header)?.note ??
                            ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Étape 4 — corrections ciblées */}
          {(preview.blocking.length > 0 ||
            preview.unknownCategoryValues.length > 0 ||
            preview.offersWithoutReference.length > 0 ||
            preview.duplicates.length > 0) && (
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-sm font-bold text-white">4. Points à trancher</div>

              {preview.blocking.length > 0 && (
                <div className="space-y-2">
                  {preview.blocking.map((entry) => (
                    <div key={entry.code} className="p-3 bg-rose-950/40 border border-rose-900 rounded-lg text-[11px] text-rose-100">
                      <div className="font-semibold flex items-center gap-2">
                        <XCircle className="w-3.5 h-3.5" />
                        {entry.code}
                      </div>
                      <div className="mt-1">{entry.message}</div>
                    </div>
                  ))}
                </div>
              )}

              {preview.unknownCategoryValues.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-white">
                    Catégories non reconnues : rattachez-les à une catégorie réelle
                  </div>
                  {preview.unknownCategoryValues.map((entry) => (
                    <div key={entry.declared} className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-slate-200">
                        « {entry.declared} » ({entry.occurrences} ligne(s))
                      </span>
                      <select
                        value={categoryOverrides[entry.declared] ?? ''}
                        disabled={!canImport}
                        onChange={(event) => {
                          const next = { ...categoryOverrides, [entry.declared]: event.target.value };
                          setCategoryOverrides(next);
                          if (event.target.value) void refresh({ categoryOverrides: next });
                        }}
                        className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white"
                      >
                        <option value="">— choisir —</option>
                        {IMPORT_TARGET_FIELDS.filter((field) => field.key === 'category').length === 0 && null}
                        <CategoryOptions />
                      </select>
                      <button
                        disabled={!canImport}
                        onClick={() => {
                          const next = [...new Set([...excludedRows, ...entry.rows])];
                          setExcludedRows(next);
                          void refresh({ excludedRows: next });
                        }}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-white"
                      >
                        Écarter ces lignes
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {preview.offersWithoutReference.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-white">
                    Offres sans référence : indiquez la référence de votre choix
                  </div>
                  {preview.offers
                    .filter((offer) => !offer.reference)
                    .map((offer) => (
                      <div key={offer.key} className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="text-slate-200">
                          {offer.supplierName ?? offer.key} ({offer.rows.length} ligne(s))
                        </span>
                        <input
                          value={offerReferences[offer.key] ?? ''}
                          disabled={!canImport}
                          onChange={(event) => setOfferReferences({ ...offerReferences, [offer.key]: event.target.value })}
                          onBlur={() => void refresh({ offerReferences })}
                          placeholder="Référence de l'offre"
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white"
                        />
                      </div>
                    ))}
                </div>
              )}

              {preview.duplicates.length > 0 && (
                <div className="p-3 bg-amber-950/40 border border-amber-900 rounded-lg text-[11px] text-amber-100">
                  <div className="font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {preview.duplicates.length} ligne(s) identique(s) détectée(s)
                  </div>
                  <div className="mt-1">
                    Exemple : ligne {preview.duplicates[0].rowNumber} identique à la ligne {preview.duplicates[0].duplicateOf}.
                    Rien n'est supprimé automatiquement : si ces doublons sont légitimes (deux factures distinctes),
                    conservez-les ; sinon écartez-les à l'étape 4.
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Étape 5 — lignes */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="text-sm font-bold text-white">5. Lignes du fichier</div>
              <div className="text-[11px] text-slate-400">
                {preview.summary.totalRows} ligne(s) · {excludedRows.length} écartée(s) manuellement
              </div>
            </header>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-[11px]">
                <thead className="bg-slate-950/60 text-slate-400 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-2 font-semibold">Ligne</th>
                    <th className="text-left px-2 py-2 font-semibold">Statut</th>
                    {preview.headers.map((header) => (
                      <th key={header} className="text-left px-2 py-2 font-semibold whitespace-nowrap">
                        {header}
                      </th>
                    ))}
                    <th className="text-left px-2 py-2 font-semibold">Motifs</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {upload.rows.map((row) => {
                    const isExcluded = excludedRows.includes(row.rowNumber);
                    return (
                      <tr key={row.rowNumber} className={isExcluded ? 'opacity-40 line-through' : ''}>
                        <td className="px-2 py-1.5 font-mono text-slate-400">{row.rowNumber}</td>
                        <td className="px-2 py-1.5">
                          <button
                            disabled={!canImport}
                            title={isExcluded ? 'Réintégrer cette ligne' : 'Écarter cette ligne'}
                            onClick={async () => {
                              const next = isExcluded
                                ? excludedRows.filter((value) => value !== row.rowNumber)
                                : [...excludedRows, row.rowNumber];
                              setExcludedRows(next);
                              await refresh({ excludedRows: next });
                            }}
                            className={`px-2 py-0.5 rounded border font-semibold ${STATUS_STYLE[row.status]}`}
                          >
                            {row.status}
                          </button>
                        </td>
                        {row.cells.map((cell, index) => (
                          <td key={index} className="px-2 py-1.5 text-slate-300 whitespace-nowrap">
                            {cell === '' ? <span className="text-slate-600">(vide)</span> : cell}
                          </td>
                        ))}
                        <td className="px-2 py-1.5 text-slate-500 max-w-[360px]">{row.reasons.join(' ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Étape 6 — validation */}
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="text-sm font-bold text-white">6. Validation et import</div>
            {preview.canCommit ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={doCommit}
                  disabled={busy || !canImport}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2"
                >
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  Importer {preview.summary.offersCount} offre(s) et {preview.summary.includedRows} ligne(s)
                </button>
                <span className="text-[11px] text-slate-400">
                  L'import écrit les offres, leurs postes et la provenance (fichier, empreinte, ligne source) dans une seule
                  transaction, et journalise l'opération.
                </span>
              </div>
            ) : (
              <div className="p-3 bg-rose-950/40 border border-rose-900 rounded-lg text-[11px] text-rose-100 space-y-1">
                <div className="font-semibold">Import bloqué : {preview.blocking.length} point(s) à corriger.</div>
                <ul className="list-disc pl-4 space-y-0.5">
                  {preview.nextActions.map((action, index) => (
                    <li key={index}>{action}</li>
                  ))}
                </ul>
              </div>
            )}

            {commit && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-900 rounded-lg text-[11px] text-emerald-100 space-y-1">
                <div className="font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Import terminé et journalisé
                </div>
                <ul className="list-disc pl-4">
                  {commit.result.createdOffers.map((offer) => (
                    <li key={offer.id}>
                      {offer.reference} — {offer.supplierName} · {offer.costItemCount} poste(s) ·{' '}
                      {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: projectCurrency, maximumFractionDigits: 0 }).format(offer.total)}
                    </li>
                  ))}
                </ul>
                {commit.result.skippedRows.length > 0 && (
                  <div>Lignes non importées : {commit.result.skippedRows.join(', ')}</div>
                )}
                {commit.result.warnings.length > 0 && (
                  <ul className="list-disc pl-4">
                    {commit.result.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Download className="w-3.5 h-3.5" />
                  <span>L'offre importée est visible dans le comparateur et exploitable par le calcul de décision.</span>
                </div>
              </div>
            )}
          </section>
        </>
      )}

      <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] text-slate-500 flex items-start gap-2">
        <FileSpreadsheet className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Le contenu du fichier est stocké avec son empreinte SHA-256 et son numéro de ligne d'origine pour chaque montant.
          Aucun antivirus n'est configuré dans ce déploiement : le fichier est contrôlé sur son format, sa taille et sa
          structure, et cette limite est enregistrée avec le document.
        </span>
      </div>
    </div>
  );
};

const ScoreCard: React.FC<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
    <div className="text-slate-400 text-[10px] uppercase tracking-wide">{label}</div>
    <div className="text-lg font-bold font-mono text-white mt-0.5">{value}</div>
    <div className="text-[10px] text-slate-500 mt-1 leading-snug">{detail}</div>
  </div>
);

/** Catégories canoniques du moteur, proposées à l'arbitrage humain. */
const CategoryOptions: React.FC = () => (
  <>
    {[
      'acquisition',
      'installation_mise_en_service',
      'maintenance_reparations',
      'energie_consommables',
      'logistique_douanes',
      'formation',
      'deploiement',
      'indisponibilite_operationnelle',
      'remplacement_pannes',
      'couts_administratifs_conformite',
      'externalite_carbone',
      'fin_de_vie_recyclage',
      'fiscalite_taxes',
      'valeur_residuelle',
      'autre',
    ].map((category) => (
      <option key={category} value={category}>
        {category}
      </option>
    ))}
  </>
);
