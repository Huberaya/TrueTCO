import {
  Project,
  SupplierOffer,
  Supplier,
  ExternalityReferenceBenchmark,
  AuditLogEntry,
} from '../types/domain';
import {
  SEED_PROJECTS,
  SEED_OFFERS,
  SEED_SUPPLIERS,
  SEED_BENCHMARKS,
  SEED_AUDIT_LOGS,
} from '../data/seedData';
import { TrueTCOBackupPayloadSchema, formatZodError } from '../schemas/validationSchemas';

const STORAGE_KEYS = {
  PROJECTS: 'truetco_projects_v1',
  OFFERS: 'truetco_offers_v1',
  SUPPLIERS: 'truetco_suppliers_v1',
  BENCHMARKS: 'truetco_benchmarks_v1',
  AUDIT_LOGS: 'truetco_audit_logs_v1',
  CURRENT_PROJECT_ID: 'truetco_current_project_id_v1',
};

export interface TrueTCOBackupPayload {
  version: string;
  exportedAt: string;
  organization: string;
  projects: Project[];
  offers: SupplierOffer[];
  suppliers: Supplier[];
  benchmarks: ExternalityReferenceBenchmark[];
  auditLogs: AuditLogEntry[];
}

export class StorageService {
  /**
   * Safely load items from localStorage or fallback to initial seed
   */
  private static load<T>(key: string, fallback: T): T {
    try {
      const serialized = localStorage.getItem(key);
      if (!serialized) return fallback;
      return JSON.parse(serialized) as T;
    } catch (e) {
      console.warn(`[TrueTCO Storage] Failed to load key "${key}" from localStorage:`, e);
      return fallback;
    }
  }

  /**
   * Safely save items to localStorage
   */
  private static save<T>(key: string, data: T): void {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn(`[TrueTCO Storage] Failed to save key "${key}" to localStorage:`, e);
    }
  }

  // --- Projects ---
  public static getProjects(): Project[] {
    return this.load<Project[]>(STORAGE_KEYS.PROJECTS, SEED_PROJECTS);
  }

  public static saveProjects(projects: Project[]): void {
    this.save(STORAGE_KEYS.PROJECTS, projects);
  }

  // --- Offers ---
  public static getOffers(): SupplierOffer[] {
    const stored = this.load<SupplierOffer[]>(STORAGE_KEYS.OFFERS, SEED_OFFERS);
    if (!Array.isArray(stored) || stored.length === 0) return SEED_OFFERS;
    const existingIds = new Set(stored.map((o) => o.id));
    const missing = SEED_OFFERS.filter((o) => !existingIds.has(o.id));
    if (missing.length > 0) {
      const merged = [...stored, ...missing];
      this.save(STORAGE_KEYS.OFFERS, merged);
      return merged;
    }
    return stored;
  }

  public static saveOffers(offers: SupplierOffer[]): void {
    this.save(STORAGE_KEYS.OFFERS, offers);
  }

  // --- Suppliers ---
  public static getSuppliers(): Supplier[] {
    return this.load<Supplier[]>(STORAGE_KEYS.SUPPLIERS, SEED_SUPPLIERS);
  }

  public static saveSuppliers(suppliers: Supplier[]): void {
    this.save(STORAGE_KEYS.SUPPLIERS, suppliers);
  }

  // --- Benchmarks ---
  /**
   * Identifiants du jeu de démonstration historique dont les valeurs étaient
   * présentées comme des références institutionnelles (« Commission Quinet
   * 2026 », « Enquête taux de hurdle BdB 2026 ») alors qu'aucune publication
   * correspondante n'existe. Ils sont remplacés par le jeu corrigé, qui
   * marque explicitement ces valeurs comme hypothèses de démonstration.
   */
  private static readonly LEGACY_FABRICATED_BENCHMARK_IDS = [
    'bm-quinet-2026',
    'bm-wacc-corporate',
    'bm-ademe-elec-fr',
    'bm-ademe-diesel',
    'bm-ademe-it-recond',
  ];

  public static getBenchmarks(): ExternalityReferenceBenchmark[] {
    const stored = this.load<ExternalityReferenceBenchmark[]>(STORAGE_KEYS.BENCHMARKS, SEED_BENCHMARKS);
    if (!Array.isArray(stored) || stored.length === 0) return SEED_BENCHMARKS;

    const correctedById = new Map(SEED_BENCHMARKS.map((b) => [b.id, b]));
    let migrated = false;
    const sanitized = stored.map((b) => {
      const corrected = correctedById.get(b.id);
      if (corrected) {
        migrated = true;
        return corrected;
      }
      if (b.isDemoHypothesis === undefined && !b.sourceUrl && !b.documentRef) {
        // Valeur importée sans provenance : elle reste utilisable, mais elle est
        // désormais signalée comme non vérifiable au lieu d'être présentée
        // comme une donnée officielle.
        migrated = true;
        return {
          ...b,
          isDemoHypothesis: true,
          verificationNote:
            'Provenance incomplète : aucune URL ni référence documentaire vérifiable. À confirmer avant usage décisionnel.',
        };
      }
      return b;
    });

    if (migrated) this.save(STORAGE_KEYS.BENCHMARKS, sanitized);
    return sanitized;
  }

  public static saveBenchmarks(benchmarks: ExternalityReferenceBenchmark[]): void {
    this.save(STORAGE_KEYS.BENCHMARKS, benchmarks);
  }

  // --- Audit Logs ---
  public static getAuditLogs(): AuditLogEntry[] {
    return this.load<AuditLogEntry[]>(STORAGE_KEYS.AUDIT_LOGS, SEED_AUDIT_LOGS);
  }

  public static saveAuditLogs(logs: AuditLogEntry[]): void {
    this.save(STORAGE_KEYS.AUDIT_LOGS, logs);
  }

  // --- Current Project Selection ---
  public static getCurrentProjectId(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEYS.CURRENT_PROJECT_ID);
    } catch {
      return null;
    }
  }

  public static saveCurrentProjectId(id: string): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CURRENT_PROJECT_ID, id);
    } catch {
      // ignore
    }
  }

  // --- Backup & Restore (Portabilité des dossiers) ---
  public static exportFullBackup(
    projects: Project[],
    offers: SupplierOffer[],
    suppliers: Supplier[],
    benchmarks: ExternalityReferenceBenchmark[],
    auditLogs: AuditLogEntry[]
  ): void {
    const payload: TrueTCOBackupPayload = {
      version: '1.2.0',
      exportedAt: new Date().toISOString(),
      organization: 'Acme Group Europe',
      projects,
      offers,
      suppliers,
      benchmarks,
      auditLogs,
    };

    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dossier_truetco_backup_${new Date().toISOString().split('T')[0]}.truetco.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  public static parseBackupFile(jsonString: string): TrueTCOBackupPayload {
    let raw: unknown;
    try {
      raw = JSON.parse(jsonString);
    } catch {
      throw new Error('Le contenu du fichier n\'est pas un JSON valide.');
    }

    const result = TrueTCOBackupPayloadSchema.safeParse(raw);
    if (!result.success) {
      const issues = formatZodError(result.error);
      throw new Error(`Validation Zod échouée (${issues.length} erreur(s)) : ${issues.slice(0, 3).join(' ; ')}${issues.length > 3 ? '...' : ''}`);
    }

    return result.data as unknown as TrueTCOBackupPayload;
  }

  /**
   * Reset all data back to baseline seed demonstration values
   */
  public static resetToSeed(): void {
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    } catch (e) {
      console.warn('Failed to clear storage:', e);
    }
  }
}
