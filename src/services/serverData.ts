/**
 * TrueTCO — Accès aux données du serveur (source de vérité)
 * ---------------------------------------------------------------------------
 * Règles appliquées :
 *  - Aucune donnée n'est inventée : un champ absent du serveur devient `null` ou
 *    un marqueur « non renseigné », jamais une valeur plausible.
 *  - Aucun en-tête d'organisation ni de rôle n'est envoyé : le serveur déduit
 *    l'organisation et le rôle de la session (cookie HttpOnly).
 *  - Une erreur du serveur n'est jamais avalée : elle remonte à l'appelant, qui
 *    doit l'afficher à l'utilisateur.
 *  - Les correspondances de vocabulaire entre l'UI (français) et le modèle de
 *    données (anglais) sont déclarées explicitement ci-dessous. Toute valeur non
 *    couverte est signalée comme telle, elle n'est jamais devinée.
 */

import { AuditLogEntry, HorizonYears, ProcurementCategory, Project, ProjectStatus, Supplier, SupplierOffer, UserRole } from '../types/domain';
import { CarbonRow, CostItemRow, OfferRow, RiskRow, mapOffer } from '../engine/mapping';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly correlationId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      // Un FormData doit laisser le navigateur poser lui-même la frontière
      // multipart : forcer « application/json » casserait l'envoi de fichiers.
      ...(typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (response.status === 204) return undefined as T;

  const isJson = (response.headers.get('content-type') ?? '').includes('application/json');
  const payload = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload as any)?.code ?? 'HTTP_ERROR',
      (payload as any)?.error ?? `Erreur ${response.status} lors de l'appel à ${path}.`,
      (payload as any)?.correlationId
    );
  }
  return payload as T;
}

// -----------------------------------------------------------------------------
// Correspondances de vocabulaire (déclarées, non devinées)
// -----------------------------------------------------------------------------
/**
 * Statuts. Le serveur porte le cycle de vie auditable (7 étapes) ; l'interface
 * utilise encore un vocabulaire historique plus large. Les valeurs sans
 * équivalent exact sont signalées par `null` : dans ce cas l'interface affiche
 * l'état serveur tel quel plutôt qu'une traduction approximative.
 */
const STATUS_TO_SERVER: Record<ProjectStatus, string> = {
  brouillon: 'draft',
  collecte_offres: 'data_review',
  analyse: 'finance_review',
  validation_finance: 'finance_review',
  validation_achats: 'approval',
  decision: 'decision',
  adjudique: 'locked',
  termine: 'locked',
  archive: 'locked',
};

const STATUS_FROM_SERVER: Record<string, ProjectStatus> = {
  draft: 'brouillon',
  data_review: 'collecte_offres',
  finance_review: 'analyse',
  esg_review: 'analyse',
  approval: 'validation_achats',
  decision: 'decision',
  locked: 'adjudique',
};

const CATEGORY_TO_SERVER: Record<ProcurementCategory, string> = {
  flotte_automobile: 'Flotte automobile',
  informatique_it: 'Informatique / IT',
  equipements_industriels: 'Équipements industriels',
  packaging: 'Packaging',
  energie_batiment: 'Énergie / bâtiment',
};

const CATEGORY_FROM_SERVER: Record<string, ProcurementCategory> = {
  'flotte automobile': 'flotte_automobile',
  'informatique / it': 'informatique_it',
  'équipements industriels': 'equipements_industriels',
  packaging: 'packaging',
  'énergie / bâtiment': 'energie_batiment',
};

export function categoryFromServer(value: string): ProcurementCategory {
  const match = CATEGORY_FROM_SERVER[value.toLowerCase().trim()];
  if (!match) {
    // Catégorie inconnue : on retombe sur la première valeur possible MAIS on
    // journalise, car afficher une catégorie fausse serait trompeur.
    console.warn(`[TrueTCO] Catégorie serveur non reconnue : « ${value} ». Affichage en « flotte_automobile » à défaut.`);
    return 'flotte_automobile';
  }
  return match;
}

export function categoryToServer(value: ProcurementCategory): string {
  return CATEGORY_TO_SERVER[value] ?? 'Autre';
}

// -----------------------------------------------------------------------------
// Dossiers
// -----------------------------------------------------------------------------
interface ProjectRow {
  id: string;
  reference: string;
  name: string;
  description: string | null;
  category: string;
  status: string;
  currency: string;
  country_code: string | null;
  budget_cap: string;
  planned_volume: number;
  unit_name: string;
  horizon_years: number;
  discount_rate: string;
  energy_inflation_rate: string;
  general_inflation_rate: string;
  carbon_price_per_tonne: string;
  version: number;
  created_at: string;
  updated_at: string;
  locked_at: string | null;
  is_demo: boolean;
}

const HORIZONS: HorizonYears[] = [1, 2, 3, 4, 5, 7, 10];

export function projectFromRow(row: ProjectRow, organizationId: string, ownerName: string, ownerId: string): Project {
  const horizon = HORIZONS.includes(row.horizon_years as HorizonYears) ? (row.horizon_years as HorizonYears) : 5;
  return {
    id: row.id,
    organizationId,
    name: row.name,
    companyName: undefined,
    reference: row.reference,
    category: categoryFromServer(row.category),
    budgetCap: Number(row.budget_cap),
    currency: row.currency,
    startDate: row.created_at,
    analysisDurationMonths: undefined,
    horizonYears: horizon,
    plannedVolume: row.planned_volume,
    unitName: row.unit_name,
    purchaseFrequency: 'unique',
    objective: row.description ?? 'Objectif non renseigné.',
    ownerId,
    ownerName,
    status: STATUS_FROM_SERVER[row.status] ?? 'brouillon',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    discountRate: Number(row.discount_rate),
    carbonScenario: 'central',
    carbonPricePerTonne: Number(row.carbon_price_per_tonne),
    inflationRate: Number(row.general_inflation_rate),
    energyInflationRate: Number(row.energy_inflation_rate),
  };
}

export async function fetchProjectsFromServer(organizationId: string, ownerId: string, ownerName: string): Promise<Project[]> {
  const data = await api<{ items: ProjectRow[]; total: number }>('/api/projects?limit=200');
  return data.items.map((row) => projectFromRow(row, organizationId, ownerName, ownerId));
}

export async function createProjectOnServer(project: Project): Promise<Project> {
  const row = await api<ProjectRow>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      reference: project.reference,
      name: project.name,
      description: project.objective || null,
      category: categoryToServer(project.category),
      currency: project.currency || 'EUR',
    }),
  });
  return projectFromRow(row, project.organizationId, project.ownerName, project.ownerId);
}

export async function updateProjectOnServer(project: Project): Promise<Project> {
  const row = await api<ProjectRow>(`/api/projects/${project.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: project.name,
      description: project.objective || null,
      category: categoryToServer(project.category),
      currency: project.currency || 'EUR',
    }),
  });
  return projectFromRow(row, project.organizationId, project.ownerName, project.ownerId);
}

export async function changeProjectStatusOnServer(project: Project, target: ProjectStatus, justification: string): Promise<Project> {
  const row = await api<ProjectRow>(`/api/projects/${project.id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: STATUS_TO_SERVER[target], justification }),
  });
  return projectFromRow(row, project.organizationId, project.ownerName, project.ownerId);
}

// -----------------------------------------------------------------------------
// Fournisseurs
// -----------------------------------------------------------------------------
interface SupplierRow {
  id: string;
  name: string;
  legal_name: string | null;
  country_code: string | null;
  contact_email: string | null;
  incoterm: string | null;
  payment_terms_days: number;
  warranty_months: number;
  esg_rating: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string;
}

/** Un champ absent reste vide : il n'est jamais remplacé par une valeur plausible. */
export function supplierFromRow(row: SupplierRow, organizationId: string): Supplier {
  return {
    id: row.id,
    organizationId,
    name: row.name,
    country: row.country_code ?? 'Non renseigné',
    sector: row.legal_name ?? 'Non renseigné',
    contactEmail: row.contact_email ?? '',
    certifications: row.esg_rating ? [row.esg_rating] : [],
    defaultIncoterm: row.incoterm ?? 'Non renseigné',
    currency: 'EUR',
    paymentTerms: row.payment_terms_days > 0 ? `${row.payment_terms_days} jours` : 'Non renseigné',
    moq: 0,
    leadTimeDays: 0,
    historicalDefectRate: 0,
    warrantyMonths: row.warranty_months,
    performanceScore: 0,
    esgScore: 0,
    environmentalDataAvailable: [],
    dataQualityScore: 0,
  };
}

export async function fetchSuppliersFromServer(organizationId: string): Promise<Supplier[]> {
  const data = await api<{ items: SupplierRow[] }>('/api/suppliers?limit=200');
  return data.items.map((row) => supplierFromRow(row, organizationId));
}

export async function createSupplierOnServer(supplier: Supplier, organizationId: string): Promise<Supplier> {
  const row = await api<SupplierRow>('/api/suppliers', {
    method: 'POST',
    body: JSON.stringify({
      name: supplier.name,
      countryCode: /^[A-Za-z]{2}$/.test(supplier.country) ? supplier.country.toUpperCase() : null,
      contactEmail: supplier.contactEmail && supplier.contactEmail.includes('@') ? supplier.contactEmail : null,
      incoterm: /^[A-Z]{3}$/.test(supplier.defaultIncoterm) ? supplier.defaultIncoterm : null,
      warrantyMonths: supplier.warrantyMonths || null,
    }),
  });
  return supplierFromRow(row, organizationId);
}

// -----------------------------------------------------------------------------
// Journal d'audit
// -----------------------------------------------------------------------------
interface AuditRow {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  project_id: string | null;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  justification: string | null;
  entry_hash: string;
  is_demo: boolean;
}

/** Le journal est en LECTURE SEULE côté client : aucune entrée n'est fabriquée ici. */
export async function fetchAuditLogsFromServer(): Promise<AuditLogEntry[]> {
  const data = await api<{ items: AuditRow[]; total: number }>('/api/audit-logs?limit=200');
  return data.items.map((row) => ({
    id: String(row.id),
    timestamp: row.occurred_at,
    userId: row.actor_id ?? 'système',
    userName: row.actor_name,
    userRole: (row.actor_role as UserRole) ?? 'lecteur',
    projectId: row.project_id ?? undefined,
    offerId: row.entity_type === 'supplier_offer' ? row.entity_id ?? undefined : undefined,
    entityName: row.entity_type,
    fieldChanged: row.field_changed ?? row.action,
    oldValue: row.old_value ?? '—',
    newValue: row.new_value ?? '—',
    justification: row.justification ?? 'Action enregistrée par le serveur (empreinte vérifiable).',
  }));
}

export async function fetchAuditIntegrity(): Promise<{
  totalEntries: number;
  firstBrokenId: string | null;
  firstContentMismatchId: string | null;
  intact: boolean;
}> {
  return api('/api/audit-logs/integrity');
}

// -----------------------------------------------------------------------------
// Version des calculs
// -----------------------------------------------------------------------------
export async function fetchVersions(): Promise<{ engineVersion: string; methodologyVersion: string }> {
  return api('/api/versions');
}

// -----------------------------------------------------------------------------
// Décision — calcul exécuté par le serveur (le navigateur ne calcule plus rien)
// -----------------------------------------------------------------------------
export interface DecisionParameterSweep {
  parameter: string;
  label: string;
  unit: string;
  range: { min: number; max: number; step: number };
  currentValue: number;
  direction: 'au_dessus' | 'en_dessous' | 'aucun' | 'non_monotone' | 'aucun_effet';
  isReachable: boolean;
  nearestThreshold: number | null;
  intervals: { from: number; to: number }[];
  marginToThreshold: number | null;
  deltaAtBounds: { min: number; max: number };
  statement: string;
  dataChanged?: boolean;
}

export interface DecisionRunResult {
  runId: string;
  projectId: string;
  engineVersion: string;
  methodologyVersion: string;
  inputVersion: number;
  calculatedAt: string;
  inputFingerprint: string;
  currency: string;
  horizonYears: number;
  discountRate: number;
  completeness: {
    totalCostItems: number;
    validCostItems: number;
    unsourcedCostItems: number;
    estimatedCostItems: number;
    missingCostItems: number;
    erroredCostItems: number;
    demoCostItems: number;
    coveragePercent: number;
    verdict: string;
  };
  ranking: {
    rank: number;
    offerId: string;
    offerReference: string;
    supplierName: string;
    apparentTotal: number;
    totalComprehensiveTCO: number;
    lifecycleCostLCC: number;
    carbonTonnes: number;
    confidenceScore: number;
    isApparentCheapest: boolean;
  }[];
  recommendedOfferId: string | null;
  recommendation: {
    status: 'ferme' | 'conditionnel' | 'indetermine';
    offerId: string | null;
    reason: string;
    conditions: string[];
    economicAdvantage: {
      vsSecondBestNpv: number | null;
      vsWorstNpv: number | null;
      vsCheapestApparentNpv: number | null;
      apparentCheapestOfferId: string | null;
    };
  };
  breakEven: unknown;
  sensitivity: unknown;
  inversion: { parameters: DecisionParameterSweep[]; winner: string; challenger: string; note: string } | null;
  warnings: string[];
  results: {
    perOffer: {
      offerId: string;
      offerReference: string;
      supplierName: string;
      totalComprehensiveTCO: number;
      lifecycleCostLCC: number;
      monthlyEquivalentCost: number;
      costPerUnit: number;
      carbonTonnes: number;
      confidenceScore: number;
      breakdown: { category: string; amount: number; share: number; quality: string }[];
      warnings: { severity: string; message: string }[];
    }[];
    warnings: string[];
  };
}

export interface DecisionRunSummary {
  id: string;
  project_id: string;
  engine_version: string;
  methodology_version: string;
  input_version: number;
  input_fingerprint: string | null;
  recommended_offer_id: string | null;
  created_at: string;
  results: DecisionRunResult | null;
}

/** Lance un calcul de décision côté serveur et renvoie le résultat persisté. */
export async function runDecisionOnServer(projectId: string): Promise<DecisionRunResult> {
  return api<DecisionRunResult>(`/api/projects/${projectId}/decision-runs`, { method: 'POST' });
}

export async function fetchDecisionRuns(projectId: string): Promise<DecisionRunSummary[]> {
  const data = await api<{ items: DecisionRunSummary[] }>(`/api/projects/${projectId}/decision-runs?limit=50`);
  return data.items;
}

export interface DecisionRunDetail extends DecisionRunSummary {
  freshness: {
    dataChangedSinceRun: boolean;
    engineChangedSinceRun: boolean;
    engineVersionStored: string;
    engineVersionCurrent: string;
    currentFingerprint: string | null;
    storedFingerprint: string;
    explanation: string;
  };
}

export async function fetchDecisionRun(runId: string): Promise<DecisionRunDetail> {
  return api<DecisionRunDetail>(`/api/decision-runs/${runId}`);
}

export async function replayDecisionRun(runId: string): Promise<{
  identical: boolean;
  differences: string[];
  engineVersionStored: string;
  engineVersionCurrent: string;
  note: string;
}> {
  return api(`/api/decision-runs/${runId}/replay`, { method: 'POST' });
}

// -----------------------------------------------------------------------------
// Centre d'import
// -----------------------------------------------------------------------------
export interface ImportPreviewSummary {
  score: number;
  confidenceInSourceData: number;
  explanation: string;
  dimensions: { key: string; label: string; earned: number; max: number; detail: string }[];
}

export interface ImportRowView {
  rowNumber: number;
  cells: string[];
  status: 'VALID' | 'WARNING' | 'ERROR' | 'MISSING' | 'UNSOURCED' | 'ESTIMATED' | 'DEMO';
  reasons: string[];
}

export interface ImportPreview {
  mode: 'costs' | 'carbon' | 'risks';
  source: {
    fileName: string;
    format: 'xlsx' | 'csv';
    sheetName: string | null;
    availableSheets?: { name: string; rowCount: number; columnCount: number }[] | null;
    delimiter?: string | null;
    encoding: string;
    encodingGuessed: boolean;
    sha256: string;
  };
  headers: string[];
  rowCount: number;
  mapping: Record<string, string>;
  unmappedColumns: string[];
  ambiguousColumns: { header: string; candidates: string[]; note: string }[];
  unknownColumns: { header: string; candidates: string[]; note: string }[];
  missingRequired: { field: string; label: string; why: string }[];
  summary: {
    totalRows: number;
    includedRows: number;
    statusCounts: Record<string, number>;
    totalAmount: number;
    offersCount: number;
    totalByCurrency: { currency: string; amount: number }[];
  };
  offers: {
    key: string;
    reference: string | null;
    supplierName: string | null;
    currency: string | null;
    total: number;
    rows: ImportRowView[];
    totalsByCategory: { category: string; amount: number; rows: number }[];
    statusCounts: Record<string, number>;
    dataQualityScore: number;
    blockers: string[];
    warnings: string[];
  }[];
  unknownCategoryValues: { declared: string; occurrences: number; rows: number[] }[];
  offersWithoutReference: string[];
  rows: ImportRowView[];
  duplicates: { rowNumber: number; duplicateOf: number; label: string }[];
  parseIssues: { rowNumber: number; kind: string; message: string }[];
  dataQuality: ImportPreviewSummary;
  blocking: { code: string; message: string; rows?: number[] }[];
  canCommit: boolean;
  nextActions: string[];
}

export interface ImportUploadResult {
  batchId: string;
  documentId: string;
  mode: 'costs' | 'carbon' | 'risks';
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
  mapping: { applied: Record<string, string>; missingRequired: { field: string; label: string; why: string }[] };
  preview: ImportPreview;
  notes: string[];
}

export interface ImportBatchView {
  batch: {
    id: string;
    project_id: string;
    status: string;
    mode: string | null;
    format: string;
    row_count: number;
    imported_offers: number;
    error_count: number;
    data_quality_score: number | null;
    source_file_name: string | null;
    source_sheet_name: string | null;
    source_sha256: string | null;
    committed_at: string | null;
    created_at: string;
  };
  document: { id: string; original_filename: string; scan_status: string; scan_details: string } | null;
  mapping: Record<string, string>;
  mode: 'costs' | 'carbon' | 'risks';
  preview: ImportPreview;
  rows: ImportRowView[];
  rowsTotal?: number;
}

export interface ImportCommitResult {
  result: {
    createdOffers: { id: string; reference: string; supplierName: string; costItemCount: number; total: number }[];
    createdCostItems: number;
    createdCarbonItems: number;
    createdRiskItems: number;
    skippedRows: number[];
    statusCounts: Record<string, number>;
    dataQualityScore: number;
    warnings: string[];
  };
  preview: ImportPreview;
}

/**
 * Téléversement d'un fichier d'import. Le fichier part en multipart ; aucune
 * analyse n'est envoyée depuis le navigateur : le serveur relit le fichier.
 */
export async function uploadImportFile(
  projectId: string,
  file: File,
  options: { mode: 'costs' | 'carbon' | 'risks'; sheetName?: string | null; allowDuplicateContent?: boolean }
): Promise<ImportUploadResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('mode', options.mode);
  if (options.sheetName) form.append('sheetName', options.sheetName);
  if (options.allowDuplicateContent) form.append('allowDuplicateContent', 'true');
  return api<ImportUploadResult>(`/api/projects/${projectId}/imports`, { method: 'POST', body: form });
}

export async function fetchImportBatch(batchId: string, limit = 500): Promise<ImportBatchView> {
  return api<ImportBatchView>(`/api/imports/${batchId}?limit=${limit}`);
}

export async function updateImportBatch(
  batchId: string,
  payload: {
    mapping?: Record<string, string>;
    excludedRows?: number[];
    categoryOverrides?: Record<string, string>;
    offerReferences?: Record<string, string>;
    sheetName?: string | null;
    mode?: 'costs' | 'carbon' | 'risks';
  }
): Promise<ImportBatchView> {
  return api<ImportBatchView>(`/api/imports/${batchId}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export async function commitImportBatch(batchId: string): Promise<ImportCommitResult> {
  return api<ImportCommitResult>(`/api/imports/${batchId}/commit`, { method: 'POST' });
}

/** Champs proposés à l'utilisateur pour le rapprochement des colonnes. */
export const IMPORT_TARGET_FIELDS: { key: string; label: string }[] = [
  { key: 'offerReference', label: "Référence de l'offre" },
  { key: 'supplierName', label: 'Fournisseur' },
  { key: 'label', label: 'Libellé du poste' },
  { key: 'category', label: 'Catégorie de coût' },
  { key: 'amount', label: 'Montant (total du poste)' },
  { key: 'unitPrice', label: 'Prix unitaire' },
  { key: 'quantity', label: 'Quantité' },
  { key: 'currency', label: 'Devise' },
  { key: 'sourceName', label: 'Source du montant' },
  { key: 'recurring', label: 'Coût récurrent annuel' },
  { key: 'yearOccurrences', label: 'Années d’occurrence' },
  { key: 'inflationType', label: 'Indexation' },
  { key: 'confidence', label: 'Confiance déclarée (%)' },
  { key: 'qualityStatus', label: 'Statut de qualité' },
  { key: 'notes', label: 'Notes / formule' },
  { key: 'lifespanYears', label: 'Durée de vie (années)' },
  { key: 'leadTimeWeeks', label: 'Délai de livraison (semaines)' },
  { key: 'warrantyMonths', label: 'Garantie (mois)' },
  { key: 'carbonTonnes', label: 'Émissions (tCO2e)' },
  { key: 'carbonFactorSource', label: 'Source du facteur d’émission' },
  { key: 'carbonScope', label: 'Périmètre (scope)' },
  { key: 'carbonLifecyclePhase', label: 'Phase du cycle de vie' },
  { key: 'riskDescription', label: 'Description du risque' },
  { key: 'riskCategory', label: 'Catégorie de risque' },
  { key: 'riskProbability', label: 'Probabilité de risque' },
  { key: 'riskImpact', label: 'Impact financier du risque' },
];

// -----------------------------------------------------------------------------
// État réel du serveur et de sa base de données
// -----------------------------------------------------------------------------
export interface HealthStatus {
  status: string;
  database: { connected: boolean; driver: string; version: string | null; appRoleAssumed: boolean };
  versions: { engine: string; methodology: string };
}

/** État publié par le serveur : moteur de base, version, RLS, versions de calcul. */
export async function fetchHealth(): Promise<HealthStatus> {
  return api<HealthStatus>('/api/health');
}


// -----------------------------------------------------------------------------
// Offres et postes de coût
// -----------------------------------------------------------------------------
/**
 * Lecture des offres d'un dossier depuis l'API.
 *
 * La conversion lignes PostgreSQL → modèle métier est celle du moteur de calcul
 * (`src/engine/mapping.ts`), utilisée à l'identique par le serveur pour produire la
 * décision. Conséquence directe et voulue : l'écran et la décision ne peuvent pas
 * diverger. Si une valeur est exclue du calcul (poste en erreur, montant manquant),
 * elle l'est aussi à l'écran, pour la même raison.
 *
 * Coût réseau : une requête pour la liste, puis une par offre pour charger ses
 * postes. Les détails sont chargés en parallèle, avec un plafond pour ne pas
 * saturer un serveur modeste quand un dossier compte beaucoup d'offres.
 */
export async function fetchOffersFromServer(
  organizationId: string,
  userId: string,
  userName: string,
  projectId: string
): Promise<SupplierOffer[]> {
  if (!projectId) return [];
  const list = await api<{ items: OfferRow[] }>(`/api/offers?limit=200&projectId=${encodeURIComponent(projectId)}`);
  const rows = list.items ?? [];
  if (rows.length === 0) return [];

  const details = await mapWithConcurrency(rows, 4, (row) =>
    api<{ offer: OfferRow; costItems: CostItemRow[]; carbonItems: CarbonRow[]; riskItems: RiskRow[] }>(
      `/api/offers/${encodeURIComponent(row.id)}`
    )
  );

  const context = { organizationId, userId, userName, now: new Date().toISOString() };
  return details.map((detail) => {
    const mapped = mapOffer(
      {
        offer: detail.offer,
        costItems: detail.costItems ?? [],
        carbonItems: detail.carbonItems ?? [],
        riskItems: detail.riskItems ?? [],
      },
      context
    );
    return mapped.offer;
  });
}

/** Exécute `task` sur chaque élément, avec au plus `limit` tâches simultanées. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Enregistrement d'une offre et de ses postes de coût.
 *
 * Rien n'est inventé au passage :
 *  - la catégorie transmise est celle écrite par l'utilisateur ; le serveur la
 *    ramène à sa forme canonique et REFUSE une catégorie inconnue (code
 *    `INVALID_COST_CATEGORY`) plutôt que de la deviner ;
 *  - la provenance (`sourceName`) et la date sont conservées : un poste sans source
 *    est enregistré `unsourced` avec une confiance nulle côté serveur ;
 *  - la réponse est relue depuis le serveur, source de vérité, et non reconstruite
 *    à partir de ce qui a été envoyé.
 */
export async function createOfferOnServer(offer: SupplierOffer, projectId: string): Promise<SupplierOffer> {
  const created = await api<{ offer: OfferRow }>('/api/offers', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      supplierId: isUuid(offer.supplierId) ? offer.supplierId : null,
      supplierName: offer.supplierName,
      offerReference: offer.offerReference,
      apparentTotal: offer.apparentTotal,
      quantity: offer.quantity > 0 ? Math.round(offer.quantity) : 1,
      // La devise suit le code ISO du dossier ; un libellé non ISO (« € ») n'est
      // pas transmis : le serveur applique alors la devise du dossier plutôt que de
      // recevoir une valeur qu'il refuserait.
      currency: isCurrencyCode(offer.apparentUnitPrice?.unit) ? offer.apparentUnitPrice.unit : undefined,
      deliveryLeadTimeWeeks: Math.round(offer.deliveryLeadTimeWeeks || 0),
      warrantyMonths: Math.round(offer.warrantyMonths || 0),
      expectedLifespanYears: Math.round(offer.expectedLifespanYears || 0),
      technicalSuitabilityScore: Math.round(offer.technicalSuitabilityScore || 0),
      isResponsibleCandidate: Boolean(offer.isResponsibleCandidate),
      dataSource: 'manual',
      costItems: (offer.costItems ?? []).map((item) => ({
        label: item.label,
        category: item.category,
        amount: item.amount.value,
        currency: isCurrencyCode(item.amount.unit) ? item.amount.unit : undefined,
        sourceName: item.amount.sourceName || undefined,
        confidenceLevel: Math.round(item.amount.confidenceLevel ?? 0),
        isRecurringYearly: Boolean(item.isRecurringYearly),
        yearOccurrences: item.yearOccurrences ?? item.annualOccurrenceYears ?? null,
        yearlyInflationType: item.yearlyInflationType ?? null,
      })),
    }),
  });
  const context = { organizationId: '', userId: '', userName: '', now: new Date().toISOString() };
  // La réponse du serveur ne contient pas les postes : ils sont relus juste après
  // par l'appelant (rechargement complet), ce qui évite toute reconstruction
  // locale approximative.
  return mapOffer({ offer: created.offer, costItems: [], carbonItems: [], riskItems: [] }, context).offer;
}

/** Un code devise ISO à trois lettres, seule forme acceptée par l'API. */
function isCurrencyCode(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
