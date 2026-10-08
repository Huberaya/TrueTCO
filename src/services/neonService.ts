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
   * En-têtes d'appel API.
   *
   * SÉCURITÉ : le tenant n'est plus transmis par le client. L'ancienne version
   * envoyait `x-tenant-id` (valeur du localStorage) et un jeton lu dans
   * localStorage ; le serveur acceptait cet en-tête comme source de vérité, ce
   * qui permettait d'écrire dans n'importe quelle organisation. Le serveur
   * déduit désormais l'organisation de la session (cookie HttpOnly) et rejette
   * toute valeur contradictoire avec un 403 TENANT_MISMATCH.
   */
  private static getHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
  }

  /** Vrai si une session est active (vérifiée par le serveur, jamais déduite localement). */
  public static async hasValidSession(): Promise<boolean> {
    try {
      const res = await this.request('/api/auth/me', { credentials: 'same-origin' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch authentifié : envoie systématiquement le cookie de session.
   * Aucune écriture n'est tentée sans session valide : en l'absence de session,
   * l'opération échoue explicitement au lieu d'être simulée localement.
   */
  private static async request(path: string, init: RequestInit): Promise<Response> {
    return fetch(path, { ...init, credentials: 'same-origin' });
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
      const res = await this.request('/api/users/sync', {
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
      const res = await this.request('/api/projects', {
        method: 'POST',
        headers: this.getHeaders(),
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
      const res = await this.request('/api/offers', {
        method: 'POST',
        headers: this.getHeaders(),
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
      const res = await this.request('/api/audit-logs', {
        method: 'POST',
        headers: this.getHeaders(),
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
      const res = await this.request('/api/suppliers', {
        method: 'POST',
        headers: this.getHeaders(),
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
      const res = await this.request('/api/suppliers', {
        headers: this.getHeaders(),
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
      const res = await this.request('/api/audit-logs', {
        headers: this.getHeaders(),
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
      const res = await this.request('/api/benchmarks', {
        method: 'POST',
        headers: this.getHeaders(),
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
      const res = await this.request('/api/benchmarks', {
        headers: this.getHeaders(),
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
      const res = await this.request('/api/projects', {
        headers: this.getHeaders(),
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
