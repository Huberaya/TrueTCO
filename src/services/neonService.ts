import { Project, SupplierOffer, AuditLogEntry, UserRole } from '../types/domain';
import { TenantService } from './tenantService';

export interface NeonUserRecord {
  id: string;
  organizationId: string;
  clerkId: string | null;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export class NeonService {
  /**
   * Helper to construct headers with tenant and auth context
   */
  private static getHeaders(extraHeaders: Record<string, string> = {}, explicitTenantId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    if (typeof window !== 'undefined') {
      const tenantId = explicitTenantId || TenantService.getActiveTenantId();
      if (tenantId) {
        headers['x-tenant-id'] = tenantId;
      }
      const token = localStorage.getItem('truetco_enterprise_sso_token');
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * Synchronize the authenticated user with the Neon `users` table
   */
  public static async syncClerkUser(params: {
    clerkId: string;
    email: string;
    fullName?: string | null;
    role: UserRole;
  }): Promise<NeonUserRecord | null> {
    try {
      const res = await fetch('/api/users/sync', {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        console.warn('[NeonService] User sync responded with error status:', res.status);
        return null;
      }

      const data = await res.json();
      return data.user as NeonUserRecord;
    } catch (err) {
      console.warn('[NeonService] Failed to sync user with Neon:', err);
      return null;
    }
  }

  /**
   * Persist a project to Neon PostgreSQL (Hermetically partitioned by tenant)
   */
  public static async saveProject(project: Project, tenantId?: string): Promise<boolean> {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: this.getHeaders({}, tenantId),
        body: JSON.stringify(project),
      });
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
      const res = await fetch('/api/offers', {
        method: 'POST',
        headers: this.getHeaders({}, tenantId),
        body: JSON.stringify(offer),
      });
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
      const res = await fetch('/api/audit-logs', {
        method: 'POST',
        headers: this.getHeaders({}, tenantId),
        body: JSON.stringify(log),
      });
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
      const res = await fetch('/api/suppliers', {
        method: 'POST',
        headers: this.getHeaders({}, tenantId),
        body: JSON.stringify(supplier),
      });
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
      const res = await fetch('/api/suppliers', {
        headers: this.getHeaders({}, tenantId),
      });
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
      const res = await fetch('/api/audit-logs', {
        headers: this.getHeaders({}, tenantId),
      });
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
      const res = await fetch('/api/benchmarks', {
        method: 'POST',
        headers: this.getHeaders({}, tenantId),
        body: JSON.stringify(benchmark),
      });
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
      const res = await fetch('/api/benchmarks', {
        headers: this.getHeaders({}, tenantId),
      });
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
      const res = await fetch('/api/projects', {
        headers: this.getHeaders({}, tenantId),
      });
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
