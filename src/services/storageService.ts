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

export interface PostgresSqlExportOrganizationContext {
  /** Must come from server-verified membership; never derive from browser selection. */
  organizationId: string;
  name: string;
  legalRegistrationNumber?: string | null;
  countryCode: string;
  defaultCurrency: string;
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
  public static getBenchmarks(): ExternalityReferenceBenchmark[] {
    return this.load<ExternalityReferenceBenchmark[]>(STORAGE_KEYS.BENCHMARKS, SEED_BENCHMARKS);
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
      organization: 'Organisation de démonstration',
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
   * Generates a tenant-scoped data script only when the caller supplies an
   * explicit organization context and every row can be scoped consistently.
   * The current browser UI has no verified tenant context and therefore fails closed.
   */
  public static generatePostgresMigrationSql(
    projects: Project[],
    offers: SupplierOffer[],
    suppliers: Supplier[],
    benchmarks: ExternalityReferenceBenchmark[],
    auditLogs: AuditLogEntry[],
    organizationContext?: PostgresSqlExportOrganizationContext,
  ): string {
    const reject = (reason: string): never => {
      throw new Error(`Export SQL refusé : ${reason}`);
    };
    if (!organizationContext) throw new Error('Export SQL refusé : aucun contexte organisationnel vérifié n’est disponible.');
    const context = organizationContext;

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const validateUuid = (value: unknown, label: string): string => {
      if (typeof value !== 'string' || !uuidPattern.test(value)) return reject(`${label} doit être un UUID valide.`);
      return value;
    };
    const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
    const sqlText = (value: unknown, label: string): string => {
      if (typeof value !== 'string') return reject(`${label} doit être du texte explicite.`);
      return quote(value);
    };
    const nullableText = (value: unknown): string => value === null || value === undefined ? 'NULL' : sqlText(value, 'champ');
    const sqlNumber = (value: unknown, label: string): string => {
      if (typeof value !== 'number' || !Number.isFinite(value)) reject(`${label} doit être un nombre fini.`);
      return String(value);
    };
    const sqlInteger = (value: unknown, label: string): string => {
      if (typeof value !== 'number' || !Number.isInteger(value)) reject(`${label} doit être un entier.`);
      return String(value);
    };
    const sqlDate = (value: unknown, label: string): string => {
      if (typeof value !== 'string' || value.trim().length === 0 || !Number.isFinite(Date.parse(value))) {
        return reject(`${label} doit être une date explicite et valide.`);
      }
      return quote(value);
    };
    const uniqueById = <T extends { id: string }>(rows: T[], label: string): Map<string, T> => {
      const map = new Map<string, T>();
      for (const row of rows) {
        validateUuid(row.id, `${label}.id`);
        if (map.has(row.id)) reject(`${label} contient un identifiant dupliqué (${row.id}).`);
        map.set(row.id, row);
      }
      return map;
    };

    const organizationId = validateUuid(context.organizationId, 'context.organizationId');
    const organizationName = context.name.trim();
    if (!organizationName) reject('le nom de l’organisation est absent.');
    if (!/^[A-Z]{2}$/.test(context.countryCode)) reject('le code pays de l’organisation doit être ISO alpha-2.');
    if (!/^[A-Z]{3}$/.test(context.defaultCurrency)) reject('la devise de l’organisation doit être ISO alpha-3.');

    const projectById = uniqueById(projects, 'projects');
    const supplierById = uniqueById(suppliers, 'suppliers');
    for (const project of projects) validateUuid(project.organizationId, `projects.${project.id}.organizationId`);
    for (const supplier of suppliers) validateUuid(supplier.organizationId, `suppliers.${supplier.id}.organizationId`);

    const scopedProjects = projects.filter((project) => project.organizationId === organizationId);
    const scopedSuppliers = suppliers.filter((supplier) => supplier.organizationId === organizationId);
    const scopedOffers: SupplierOffer[] = [];
    const offerIds = new Set<string>();
    for (const offer of offers) {
      validateUuid(offer.id, 'offers.id');
      const project = projectById.get(offer.projectId);
      const supplier = supplierById.get(offer.supplierId);
      if (!project || !supplier) return reject(`l’offre ${offer.id} référence un projet ou fournisseur absent.`);
      if (project.organizationId !== supplier.organizationId) {
        reject(`l’offre ${offer.id} relie un projet et un fournisseur d’organisations différentes.`);
      }
      if (project.organizationId !== organizationId) continue;
      if (offerIds.has(offer.id)) reject(`offers contient un identifiant dupliqué (${offer.id}).`);
      offerIds.add(offer.id);
      scopedOffers.push(offer);
    }

    const requireTenantTag = (value: unknown, label: string): string => {
      const taggedOrganizationId = validateUuid(value, `${label}.organizationId`);
      return taggedOrganizationId;
    };
    const scopedBenchmarks = benchmarks.filter((benchmark) =>
      requireTenantTag(benchmark.organizationId, `benchmarks.${benchmark.id}`) === organizationId,
    );
    const scopedAuditLogs = auditLogs.filter((entry) =>
      requireTenantTag(entry.organizationId, `auditLogs.${entry.id}`) === organizationId,
    );
    const projectIds = new Set(scopedProjects.map((project) => project.id));
    for (const entry of scopedAuditLogs) {
      if (entry.projectId && !projectIds.has(entry.projectId)) {
        reject(`l’événement d’audit ${entry.id} référence un projet absent ou d’une autre organisation.`);
      }
    }

    const lines: string[] = [
      '-- TrueTCO — export de données pour une seule organisation.',
      '-- Le contexte d’organisation doit provenir d’un appelant vérifié; aucune organisation par défaut.',
      '-- Les memberships utilisateurs ne sont pas exportés: created_by_user_id et audit_logs.user_id sont explicitement NULL.',
      '-- Export de données seulement, pas une migration de schéma ni une preuve d’exactitude métier.',
      'BEGIN;',
      `INSERT INTO organizations (id, name, legal_registration_number, country_code, default_currency) VALUES (${quote(organizationId)}, ${quote(organizationName)}, ${nullableText(context.legalRegistrationNumber)}, ${quote(context.countryCode)}, ${quote(context.defaultCurrency)}) ON CONFLICT (id) DO NOTHING;`,
    ];

    for (const supplier of scopedSuppliers) {
      if (!/^[A-Z]{2}$/.test(supplier.country)) reject(`le fournisseur ${supplier.id} n’a pas de code pays ISO alpha-2; aucun code n’est deviné.`);
      if (!/^[A-Z]{3}$/.test(supplier.currency)) reject(`la devise du fournisseur ${supplier.id} n’est pas ISO alpha-3.`);
      const paymentTermsDays = Number(supplier.paymentTerms);
      if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0) {
        reject(`les conditions de paiement du fournisseur ${supplier.id} ne sont pas convertibles en jours sans hypothèse.`);
      }
      lines.push(
        `INSERT INTO suppliers (id, organization_id, name, country_code, incoterm, payment_terms_days, standard_lead_time_days, minimum_order_quantity, warranty_months, historical_defect_rate, esg_score, has_verified_environmental_data, environmental_data_source, certifications, data_quality_score) VALUES (${quote(supplier.id)}, ${quote(organizationId)}, ${sqlText(supplier.name, 'supplier.name')}, ${quote(supplier.country)}, ${sqlText(supplier.defaultIncoterm, 'supplier.defaultIncoterm')}, ${paymentTermsDays}, ${sqlInteger(supplier.leadTimeDays, 'supplier.leadTimeDays')}, ${sqlInteger(supplier.moq, 'supplier.moq')}, ${sqlInteger(supplier.warrantyMonths, 'supplier.warrantyMonths')}, ${sqlNumber(supplier.historicalDefectRate, 'supplier.historicalDefectRate')}, ${sqlInteger(supplier.esgScore, 'supplier.esgScore')}, FALSE, ${supplier.environmentalDataAvailable.length ? quote(supplier.environmentalDataAvailable.join('; ')) : 'NULL'}, ARRAY[${supplier.certifications.map((certification) => quote(certification)).join(', ')}]::text[], ${sqlInteger(supplier.dataQualityScore, 'supplier.dataQualityScore')}) ON CONFLICT (id) DO NOTHING;`,
      );
    }

    for (const project of scopedProjects) {
      if (!/^[A-Z]{3}$/.test(project.currency)) reject(`la devise du projet ${project.id} n’est pas ISO alpha-3.`);
      lines.push(
        `INSERT INTO projects (id, organization_id, reference, name, company_name, budget_cap, currency, planned_volume, unit_name, horizon_years, status, discount_rate, energy_inflation_rate, general_inflation_rate, carbon_price_per_tonne, category, created_by_user_id) VALUES (${quote(project.id)}, ${quote(organizationId)}, ${sqlText(project.reference, 'project.reference')}, ${sqlText(project.name, 'project.name')}, ${quote(project.companyName || organizationName)}, ${sqlNumber(project.budgetCap, 'project.budgetCap')}, ${quote(project.currency)}, ${sqlInteger(project.plannedVolume, 'project.plannedVolume')}, ${sqlText(project.unitName, 'project.unitName')}, ${sqlInteger(project.horizonYears, 'project.horizonYears')}, ${sqlText(project.status, 'project.status')}, ${sqlNumber(project.discountRate, 'project.discountRate')}, ${sqlNumber(project.energyInflationRate, 'project.energyInflationRate')}, ${sqlNumber(project.inflationRate, 'project.inflationRate')}, ${sqlNumber(project.carbonPricePerTonne, 'project.carbonPricePerTonne')}, ${sqlText(project.category, 'project.category')}, NULL) ON CONFLICT (id) DO NOTHING;`,
      );
    }

    const emittedOfferIds = new Set<string>();
    const emittedCostIds = new Set<string>();
    const emittedRiskIds = new Set<string>();
    for (const offer of scopedOffers) {
      const project = projectById.get(offer.projectId)!;
      const supplier = supplierById.get(offer.supplierId)!;
      if (project.organizationId !== organizationId || supplier.organizationId !== organizationId) {
        reject(`l’offre ${offer.id} n’appartient pas entièrement à l’organisation demandée.`);
      }
      if (emittedOfferIds.has(offer.id)) reject(`l’offre ${offer.id} est dupliquée.`);
      emittedOfferIds.add(offer.id);
      lines.push(
        `INSERT INTO supplier_offers (id, organization_id, project_id, supplier_id, offer_reference, apparent_total, is_responsible_candidate) VALUES (${quote(offer.id)}, ${quote(organizationId)}, ${quote(offer.projectId)}, ${quote(offer.supplierId)}, ${sqlText(offer.offerReference, 'offer.offerReference')}, ${sqlNumber(offer.apparentTotal, 'offer.apparentTotal')}, ${offer.isResponsibleCandidate ? 'TRUE' : 'FALSE'}) ON CONFLICT (id) DO NOTHING;`,
      );

      for (const item of offer.costItems) {
        validateUuid(item.id, 'costItem.id');
        if (emittedCostIds.has(item.id)) reject(`costItems contient un identifiant dupliqué (${item.id}).`);
        emittedCostIds.add(item.id);
        if (!['verifiee', 'calculee', 'estimee'].includes(item.amount.sourceType)) {
          reject(`le type de source du poste ${item.id} n’est pas accepté par le schéma SQL.`);
        }
        lines.push(
          `INSERT INTO cost_items (id, organization_id, offer_id, category, label, amount, currency, unit, source_name, source_type, confidence_level, is_recurring_yearly) VALUES (${quote(item.id)}, ${quote(organizationId)}, ${quote(offer.id)}, ${sqlText(item.category, 'costItem.category')}, ${sqlText(item.label, 'costItem.label')}, ${sqlNumber(item.amount.value, 'costItem.amount')}, ${quote(project.currency)}, ${sqlText(item.amount.unit, 'costItem.unit')}, ${sqlText(item.amount.sourceName, 'costItem.sourceName')}, ${quote(item.amount.sourceType)}, ${sqlInteger(item.amount.confidenceLevel, 'costItem.confidenceLevel')}, ${item.isRecurringYearly ? 'TRUE' : 'FALSE'}) ON CONFLICT (id) DO NOTHING;`,
        );
      }

      for (const item of offer.carbonItems) {
        const scope = item.scope === 'Scope 3 - Amont' ? 'Scope 3 Amont'
          : item.scope === 'Scope 3 - Fin de vie' ? 'Scope 3 Aval'
            : item.scope;
        if (!['Scope 1', 'Scope 2', 'Scope 3 Amont', 'Scope 3 Aval'].includes(scope)) {
          reject(`le périmètre carbone de l’offre ${offer.id} n’est pas accepté par le schéma SQL.`);
        }
        if (!item.emissionsPerUnitTonneCO2e || !item.emissionFactorSource || !item.lifecyclePhase) {
          return reject(`l’élément carbone de l’offre ${offer.id} ne contient pas le facteur, sa source et sa phase explicites.`);
        }
        lines.push(
          `INSERT INTO carbon_items (organization_id, offer_id, scope, lifecycle_phase, emissions_per_unit_tonne_co2e, total_lifecycle_emissions, emission_factor_source, confidence_level) VALUES (${quote(organizationId)}, ${quote(offer.id)}, ${quote(scope)}, ${sqlText(item.lifecyclePhase ?? '', 'carbonItem.lifecyclePhase')}, ${sqlNumber(item.emissionsPerUnitTonneCO2e.value, 'carbonItem.emissionsPerUnit')}, ${sqlNumber(item.totalLifecycleEmissions, 'carbonItem.totalLifecycleEmissions')}, ${sqlText(item.emissionFactorSource, 'carbonItem.emissionFactorSource')}, ${sqlInteger(item.emissionsPerUnitTonneCO2e.confidenceLevel, 'carbonItem.confidenceLevel')});`,
        );
      }

      for (const item of offer.riskItems) {
        validateUuid(item.id, 'riskItem.id');
        if (emittedRiskIds.has(item.id)) reject(`riskItems contient un identifiant dupliqué (${item.id}).`);
        emittedRiskIds.add(item.id);
        lines.push(
          `INSERT INTO risk_items (id, organization_id, offer_id, description, probability, financial_impact) VALUES (${quote(item.id)}, ${quote(organizationId)}, ${quote(offer.id)}, ${sqlText(item.label, 'riskItem.label')}, ${sqlNumber(item.probability.value, 'riskItem.probability')}, ${sqlNumber(item.financialImpact.value, 'riskItem.financialImpact')}) ON CONFLICT (id) DO NOTHING;`,
        );
      }
    }

    const benchmarkCategories = new Set(['energie', 'carbone', 'financier', 'social', 'dechets', 'wacc', 'pollution_locale', 'main_d_oeuvre', 'taux_interet']);
    for (const benchmark of scopedBenchmarks) {
      validateUuid(benchmark.id, 'benchmark.id');
      if (!benchmarkCategories.has(benchmark.category)) reject(`la catégorie du benchmark ${benchmark.id} n’est pas acceptée par le schéma SQL.`);
      lines.push(
        `INSERT INTO reference_benchmarks (id, organization_id, name, category, source, value, unit, valid_until, confidence_score, last_audit_date, legal_reference) VALUES (${quote(benchmark.id)}, ${quote(organizationId)}, ${sqlText(benchmark.name, 'benchmark.name')}, ${quote(benchmark.category)}, ${sqlText(benchmark.source, 'benchmark.source')}, ${sqlNumber(benchmark.value, 'benchmark.value')}, ${sqlText(benchmark.unit, 'benchmark.unit')}, ${sqlDate(benchmark.validUntil, 'benchmark.validUntil')}, ${sqlInteger(benchmark.confidenceLevel, 'benchmark.confidenceLevel')}, ${sqlDate(benchmark.lastAuditDate, 'benchmark.lastAuditDate')}, ${nullableText(benchmark.documentRef)}) ON CONFLICT (id) DO NOTHING;`,
      );
    }

    for (const entry of scopedAuditLogs) {
      validateUuid(entry.id, 'auditLog.id');
      if (entry.projectId) validateUuid(entry.projectId, `auditLog.${entry.id}.projectId`);
      lines.push(
        `INSERT INTO audit_logs (id, organization_id, timestamp, user_id, user_name, user_role, project_id, entity_name, field_changed, old_value, new_value, justification) VALUES (${quote(entry.id)}, ${quote(organizationId)}, ${sqlDate(entry.timestamp, 'auditLog.timestamp')}, NULL, ${sqlText(entry.userName, 'auditLog.userName')}, ${sqlText(entry.userRole, 'auditLog.userRole')}, ${entry.projectId ? quote(entry.projectId) : 'NULL'}, ${sqlText(entry.entityName, 'auditLog.entityName')}, ${sqlText(entry.fieldChanged, 'auditLog.fieldChanged')}, ${sqlText(entry.oldValue, 'auditLog.oldValue')}, ${sqlText(entry.newValue, 'auditLog.newValue')}, ${sqlText(entry.justification, 'auditLog.justification')}) ON CONFLICT (id) DO NOTHING;`,
      );
    }

    lines.push('COMMIT;');
    return lines.join('\n');
  }

  public static downloadSqlMigrationDump(
    projects: Project[],
    offers: SupplierOffer[],
    suppliers: Supplier[],
    benchmarks: ExternalityReferenceBenchmark[],
    auditLogs: AuditLogEntry[],
    organizationContext?: PostgresSqlExportOrganizationContext,
  ): void {
    // Validation completes before Blob/object URL creation; invalid scope creates no file.
    const sql = this.generatePostgresMigrationSql(projects, offers, suppliers, benchmarks, auditLogs, organizationContext);
    const blob = new Blob([sql], { type: 'application/sql' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `truetco_migration_postgresql_${new Date().toISOString().split('T')[0]}.sql`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
