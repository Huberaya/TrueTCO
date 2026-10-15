import { Project, SupplierOffer, AuditLogEntry } from '../types/domain';
import { apiFetch } from './apiClient';

export class NeonService {
  /**
   * Persist a project to Neon PostgreSQL (Hermetically partitioned by tenant)
   */
  public static async saveProject(project: Project, tenantId?: string): Promise<boolean> {
    try {
      const res = await apiFetch('/api/projects', {
        method: 'POST',
        body: JSON.stringify(project),
      }, { tenantId });
      return res.ok;
    } catch (err) {
      console.warn('[NeonService] Could not persist project to Neon (offline fallback active):', err);
      return false;
    }
  }

  /**
   * Persist an offer and its cost items to Neon PostgreSQL
   */
  public static async saveOffer(offer: SupplierOffer, tenantId?: string): Promise<boolean> {
    try {
      const res = await apiFetch('/api/offers', {
        method: 'POST',
        body: JSON.stringify(offer),
      }, { tenantId });
      return res.ok;
    } catch (err) {
      console.warn('[NeonService] Could not persist offer to Neon:', err);
      return false;
    }
  }

  /**
   * Persist an audit log to Neon PostgreSQL (Hermetically partitioned by tenant)
   */
  public static async saveAuditLog(log: AuditLogEntry, tenantId?: string): Promise<boolean> {
    try {
      const res = await apiFetch('/api/audit-logs', {
        method: 'POST',
        body: JSON.stringify(log),
      }, { tenantId });
      return res.ok;
    } catch (err) {
      console.warn('[NeonService] Could not persist audit log to Neon:', err);
      return false;
    }
  }

  /**
   * Persist a supplier to Neon PostgreSQL (Hermetically partitioned by tenant)
   */
  public static async saveSupplier(supplier: any, tenantId?: string): Promise<boolean> {
    try {
      const res = await apiFetch('/api/suppliers', {
        method: 'POST',
        body: JSON.stringify(supplier),
      }, { tenantId });
      return res.ok;
    } catch (err) {
      console.warn('[NeonService] Could not persist supplier to Neon:', err);
      return false;
    }
  }

  /**
   * Load suppliers from Neon PostgreSQL for the active or specified tenant
   */
  public static async fetchSuppliers(tenantId?: string): Promise<any[] | null> {
    try {
      const res = await apiFetch('/api/suppliers', {}, { tenantId });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data;
    } catch (err) {
      console.warn('[NeonService] Fetching suppliers from Neon failed:', err);
      return null;
    }
  }

  /**
   * Load audit logs from Neon PostgreSQL for the active or specified tenant
   */
  public static async fetchAuditLogs(tenantId?: string): Promise<AuditLogEntry[] | null> {
    try {
      const res = await apiFetch('/api/audit-logs', {}, { tenantId });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data as AuditLogEntry[];
    } catch (err) {
      console.warn('[NeonService] Fetching audit logs from Neon failed:', err);
      return null;
    }
  }

  /**
   * Save an institutional benchmark to Neon PostgreSQL
   */
  public static async saveBenchmark(benchmark: any, tenantId?: string): Promise<boolean> {
    try {
      const res = await apiFetch('/api/benchmarks', {
        method: 'POST',
        body: JSON.stringify(benchmark),
      }, { tenantId });
      return res.ok;
    } catch (err) {
      console.warn('[NeonService] Could not persist benchmark to Neon:', err);
      return false;
    }
  }

  /**
   * Load institutional benchmarks from Neon PostgreSQL
   */
  public static async fetchBenchmarks(tenantId?: string): Promise<any[] | null> {
    try {
      const res = await apiFetch('/api/benchmarks', {}, { tenantId });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data;
    } catch (err) {
      console.warn('[NeonService] Fetching benchmarks from Neon failed:', err);
      return null;
    }
  }

  /**
   * Load all projects from Neon PostgreSQL for the active or specified tenant
   */
  public static async fetchProjects(tenantId?: string): Promise<Project[] | null> {
    try {
      const res = await apiFetch('/api/projects', {}, { tenantId });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) return null;
      return data as Project[];
    } catch (err) {
      console.warn('[NeonService] Fetching projects from Neon failed (using local cache):', err);
      return null;
    }
  }
}
