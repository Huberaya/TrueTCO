import type { Project, SupplierOffer, AuditLogEntry } from '../types/domain';

/**
 * Browser-side persistence is disabled until a verified server identity,
 * membership, authorization and tenant-safe API are implemented. These methods
 * intentionally make no network requests and do not accept tenant authority.
 */
export class NeonService {
  public static async saveProject(_project: Project): Promise<boolean> {
    return false;
  }

  public static async saveOffer(_offer: SupplierOffer): Promise<boolean> {
    return false;
  }

  public static async saveAuditLog(_log: AuditLogEntry): Promise<boolean> {
    return false;
  }

  public static async saveSupplier(_supplier: unknown): Promise<boolean> {
    return false;
  }

  public static async fetchSuppliers(): Promise<null> {
    return null;
  }

  public static async fetchAuditLogs(): Promise<null> {
    return null;
  }

  public static async saveBenchmark(_benchmark: unknown): Promise<boolean> {
    return false;
  }

  public static async fetchBenchmarks(): Promise<null> {
    return null;
  }

  public static async fetchProjects(): Promise<null> {
    return null;
  }
}
