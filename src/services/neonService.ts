import { AuditLogEntry, ExternalityReferenceBenchmark, Project, Supplier, SupplierOffer } from '../types/domain';
import { apiFetch } from './apiClient';

/**
 * Client des données serveur (source de vérité en mode connecté).
 *
 * - Les erreurs sont EXPLICITES (ApiError) : l'interface peut distinguer « liste vide » de « échec ».
 * - Sauvegarde sans perte : l'objet complet est envoyé dans `document` ; à la relecture, `document`
 *   l'emporte sur les colonnes normalisées (seul l'identifiant reste celui de la base).
 */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly requestId?: string) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}, tenantId?: string): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(url, init, { tenantId });
  } catch {
    throw new ApiError('Serveur injoignable', 0, 'network');
  }
  if (res.status === 401 && !res.headers.get('x-request-id')) throw new ApiError('Session expirée ou absente', 401, 'unauthorized');
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const fields = body?.details?.fields ? ` (champs : ${body.details.fields.join(', ')})` : '';
    throw new ApiError(`${body?.message ?? `Erreur HTTP ${res.status}`}${fields}`, res.status, body?.error, body?.requestId);
  }
  return body as T;
}

const post = (url: string, payload: unknown, tenantId?: string) =>
  request<unknown>(url, { method: 'POST', body: JSON.stringify(payload) }, tenantId);

export class NeonService {
  static async saveProject(project: Project, tenantId?: string): Promise<void> {
    await post('/api/projects', { ...project, document: project }, tenantId);
  }

  static async saveOffer(offer: SupplierOffer, tenantId?: string): Promise<void> {
    await post('/api/offers', { ...offer, document: offer }, tenantId);
  }

  static async saveSupplier(supplier: Supplier, tenantId?: string): Promise<void> {
    await post('/api/suppliers', { ...supplier, document: supplier }, tenantId);
  }

  static async saveBenchmark(benchmark: ExternalityReferenceBenchmark, tenantId?: string): Promise<void> {
    await post('/api/benchmarks', { ...benchmark, document: benchmark }, tenantId);
  }

  /** Justification saisie par l'utilisateur ; auteur, rôle et date sont ceux du serveur. */
  static async saveAuditNote(note: AuditLogEntry, tenantId?: string): Promise<void> {
    await post('/api/audit-logs', {
      projectId: note.projectId,
      entityName: note.entityName,
      fieldChanged: note.fieldChanged,
      oldValue: note.oldValue == null ? null : String(note.oldValue),
      newValue: note.newValue == null ? null : String(note.newValue),
      justification: note.justification,
    }, tenantId);
  }

  static async fetchProjects(tenantId?: string): Promise<Project[]> {
    const rows = await request<any[]>('/api/projects', {}, tenantId);
    return rows.map(({ document, ...cols }) => ({ ...cols, ...(document ?? {}), id: cols.id }) as Project);
  }

  static async fetchSuppliers(tenantId?: string): Promise<Supplier[]> {
    const rows = await request<any[]>('/api/suppliers', {}, tenantId);
    return rows.map(({ document, ...cols }) => ({ ...cols, ...(document ?? {}), id: cols.id }) as Supplier);
  }

  static async fetchBenchmarks(tenantId?: string): Promise<ExternalityReferenceBenchmark[]> {
    const rows = await request<any[]>('/api/benchmarks', {}, tenantId);
    return rows.map(({ document, ...cols }) => ({ ...cols, ...(document ?? {}), id: cols.id }) as ExternalityReferenceBenchmark);
  }

  /** Les offres sans document (lignes antérieures à la sauvegarde sans perte) sont ignorées : incomplètes pour l'interface. */
  static async fetchOffers(tenantId?: string): Promise<SupplierOffer[]> {
    const rows = await request<any[]>('/api/offers', {}, tenantId);
    return rows
      .filter((r) => r.document && Object.keys(r.document).length > 0)
      .map((r) => ({ ...r.document, id: r.id, projectId: r.projectId, supplierId: r.supplierId }) as SupplierOffer);
  }

  static async fetchAuditLogs(tenantId?: string): Promise<AuditLogEntry[]> {
    return request<AuditLogEntry[]>('/api/audit-logs?limit=1000', {}, tenantId);
  }
}
