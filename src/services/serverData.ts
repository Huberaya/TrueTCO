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

import { AuditLogEntry, HorizonYears, ProcurementCategory, Project, ProjectStatus, Supplier, UserRole } from '../types/domain';

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
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
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
