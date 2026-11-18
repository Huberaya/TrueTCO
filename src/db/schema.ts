import {
  pgTable,
  text,
  varchar,
  integer,
  numeric,
  timestamp,
  boolean,
  uuid,
  check,
  index,
  unique,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/**
 * =========================================================================
 * 1. ORGANIZATIONS (Multi-Tenant Root)
 * =========================================================================
 */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    legalRegistrationNumber: varchar('legal_registration_number', { length: 50 }), // SIRET / VAT
    countryCode: varchar('country_code', { length: 2 }).default('FR').notNull(),
    defaultCurrency: varchar('default_currency', { length: 3 }).default('EUR').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_organizations_name').on(table.name),
  ]
);

/**
 * =========================================================================
 * 2. USERS & ROLES (RBAC)
 * =========================================================================
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    clerkId: varchar('clerk_id', { length: 255 }),
    role: varchar('role', { length: 50 }).notNull(), // 'directeur_achats' | 'acheteur' | 'finance_controleur' | 'rse_esg' | 'direction_generale' | 'admin'
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_users_org_email').on(table.organizationId, table.email),
    index('idx_users_org').on(table.organizationId),
    index('idx_users_role').on(table.role),
    uniqueIndex('uq_users_clerk_id').on(table.clerkId).where(sql`${table.clerkId} IS NOT NULL`),
    unique('uq_users_org_id').on(table.organizationId, table.id),
    check('users_role_check', sql`${table.role} IN ('directeur_achats', 'acheteur', 'finance_controleur', 'rse_esg', 'direction_generale', 'admin')`),
  ]
);

/**
 * =========================================================================
 * 3. PROJECTS (Consultations d'Achats & Marchés)
 * =========================================================================
 */
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    reference: varchar('reference', { length: 100 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 100 }).notNull(), // 'Flotte Automobile', 'IT & Datacenter', 'Machinisme', etc.
    companyName: varchar('company_name', { length: 255 }).notNull(),
    budgetCap: numeric('budget_cap', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
    plannedVolume: integer('planned_volume').notNull(),
    unitName: varchar('unit_name', { length: 50 }).notNull(), // 'véhicules', 'postes de travail', 'serveurs'
    horizonYears: integer('horizon_years').notNull(), // 1 to 15 years
    status: varchar('status', { length: 50 }).default('Brouillon').notNull(), // 'Brouillon' | 'Cahier des charges' | 'Consultation' | 'Analyse' | 'Décision' | 'Contractualisé' | 'En exploitation' | 'Archivé'
    discountRate: numeric('discount_rate', { precision: 6, scale: 4 }).notNull(), // WACC, e.g. 0.0450 (4.5%)
    energyInflationRate: numeric('energy_inflation_rate', { precision: 6, scale: 4 }).notNull(), // e.g. 0.0550 (5.5%)
    generalInflationRate: numeric('general_inflation_rate', { precision: 6, scale: 4 }).notNull(), // e.g. 0.0200 (2.0%)
    carbonPricePerTonne: numeric('carbon_price_per_tonne', { precision: 10, scale: 2 }).default('120.00').notNull(), // Quinet €/tCO2e (e.g. 120.00)
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_projects_org_ref').on(table.organizationId, table.reference),
    unique('uq_projects_org_id').on(table.organizationId, table.id),
    foreignKey({ name: 'fk_projects_creator_tenant', columns: [table.organizationId, table.createdByUserId], foreignColumns: [users.organizationId, users.id] }),
    index('idx_projects_org').on(table.organizationId),
    index('idx_projects_status').on(table.status),
    index('idx_projects_category').on(table.category),
    check('projects_budget_cap_check', sql`${table.budgetCap} > 0`),
    check('projects_planned_volume_check', sql`${table.plannedVolume} > 0`),
    check('projects_horizon_years_check', sql`${table.horizonYears} BETWEEN 1 AND 15`),
    check('projects_status_check', sql`${table.status} IN ('brouillon', 'collecte_offres', 'analyse', 'validation_finance', 'validation_achats', 'decision', 'termine', 'archive', 'Brouillon', 'Cahier des charges', 'Consultation', 'Analyse', 'Validation Finance', 'Validation Achats', 'Décision', 'Contractualisé', 'En exploitation', 'Archivé', 'Terminé / Arbitré')`),
    check('projects_discount_rate_check', sql`${table.discountRate} >= 0`),
  ]
);

/**
 * =========================================================================
 * 4. SUPPLIERS (Référentiel Fournisseurs & Qualification)
 * =========================================================================
 */
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    countryCode: varchar('country_code', { length: 2 }).notNull(),
    incoterm: varchar('incoterm', { length: 10 }).default('DDP').notNull(), // 'DDP', 'FCA', 'EXW', 'CIP'
    paymentTermsDays: integer('payment_terms_days').default(30).notNull(),
    standardLeadTimeDays: integer('standard_lead_time_days').notNull(),
    minimumOrderQuantity: integer('minimum_order_quantity').default(1).notNull(),
    warrantyMonths: integer('warranty_months').default(24).notNull(),
    historicalDefectRate: numeric('historical_defect_rate', { precision: 6, scale: 4 }).default('0.0200').notNull(),
    esgScore: integer('esg_score').default(70).notNull(), // 0 to 100
    hasVerifiedEnvironmentalData: boolean('has_verified_environmental_data').default(false).notNull(),
    environmentalDataSource: text('environmental_data_source'),
    certifications: text('certifications').array(), // ['ISO 14001', 'EcoVadis Gold', 'B-Corp']
    dataQualityScore: integer('data_quality_score').default(85).notNull(), // 0 to 100
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_suppliers_org_name').on(table.organizationId, table.name),
    unique('uq_suppliers_org_id').on(table.organizationId, table.id),
    index('idx_suppliers_org').on(table.organizationId),
    check('suppliers_esg_score_check', sql`${table.esgScore} BETWEEN 0 AND 100`),
    check('suppliers_data_quality_score_check', sql`${table.dataQualityScore} BETWEEN 0 AND 100`),
  ]
);

/**
 * =========================================================================
 * 5. SUPPLIER OFFERS (Offres Candidates par Consultation)
 * =========================================================================
 */
export const supplierOffers = pgTable(
  'supplier_offers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id'),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    offerReference: varchar('offer_reference', { length: 100 }).notNull(),
    apparentTotal: numeric('apparent_total', { precision: 14, scale: 2 }).notNull(), // Prix facial devis
    isResponsibleCandidate: boolean('is_responsible_candidate').default(false).notNull(),
    economicTCONominal: numeric('economic_tco_nominal', { precision: 14, scale: 2 }),
    lifecycleCostLCC: numeric('lifecycle_cost_lcc', { precision: 14, scale: 2 }),
    totalLifecycleCO2eTonnes: numeric('total_lifecycle_co2e_tonnes', { precision: 10, scale: 3 }),
    monetizedCarbonTotal: numeric('monetized_carbon_total', { precision: 14, scale: 2 }),
    riskExpositionTotal: numeric('risk_exposition_total', { precision: 14, scale: 2 }),
    totalComprehensiveTCO: numeric('total_comprehensive_tco', { precision: 14, scale: 2 }),
    confidenceScore: integer('confidence_score').default(85).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_offers_project_ref').on(table.projectId, table.offerReference),
    unique('uq_supplier_offers_org_id').on(table.organizationId, table.id),
    index('idx_offers_org').on(table.organizationId),
    foreignKey({ name: 'fk_supplier_offers_project_tenant', columns: [table.organizationId, table.projectId], foreignColumns: [projects.organizationId, projects.id] }),
    foreignKey({ name: 'fk_supplier_offers_supplier_tenant', columns: [table.organizationId, table.supplierId], foreignColumns: [suppliers.organizationId, suppliers.id] }),
    index('idx_offers_project').on(table.projectId),
    index('idx_offers_supplier').on(table.supplierId),
    check('supplier_offers_apparent_total_check', sql`${table.apparentTotal} >= 0`),
    check('supplier_offers_confidence_score_check', sql`${table.confidenceScore} BETWEEN 0 AND 100`),
  ]
);

/**
 * =========================================================================
 * 6. COST ITEMS (Lignes Analytiques du TCO / CBS)
 * =========================================================================
 */
export const costItems = pgTable(
  'cost_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id'),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => supplierOffers.id, { onDelete: 'cascade' }),
    category: varchar('category', { length: 100 }).notNull(), // 'acquisition', 'energie', 'maintenance', 'indisponibilite', 'fiscalite', 'deploiement', 'fin_de_vie', 'valeur_residuelle'
    label: varchar('label', { length: 255 }).notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).default('EUR').notNull(),
    unit: varchar('unit', { length: 50 }).notNull(), // '€/an', '€/lot', '€/mois'
    sourceName: varchar('source_name', { length: 255 }).notNull(),
    sourceType: varchar('source_type', { length: 50 }).notNull(), // 'verifiee', 'calculee', 'estimee'
    confidenceLevel: integer('confidence_level').notNull(), // 0 to 100
    isRecurringYearly: boolean('is_recurring_yearly').default(false).notNull(),
    calculationFormula: text('calculation_formula'),
    explanationNotes: text('explanation_notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_cost_items_offer').on(table.offerId),
    index('idx_cost_items_org').on(table.organizationId),
    foreignKey({ name: 'fk_cost_items_offer_tenant', columns: [table.organizationId, table.offerId], foreignColumns: [supplierOffers.organizationId, supplierOffers.id] }),
    index('idx_cost_items_category').on(table.category),
    check('cost_items_source_type_check', sql`${table.sourceType} IN ('verifiee', 'calculee', 'estimee')`),
    check('cost_items_confidence_level_check', sql`${table.confidenceLevel} BETWEEN 0 AND 100`),
  ]
);

/**
 * =========================================================================
 * 7. CARBON ITEMS (Émissions ACV Scopes 1, 2, 3)
 * =========================================================================
 */
export const carbonItems = pgTable(
  'carbon_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id'),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => supplierOffers.id, { onDelete: 'cascade' }),
    scope: varchar('scope', { length: 20 }).notNull(), // 'Scope 1', 'Scope 2', 'Scope 3 Amont', 'Scope 3 Aval'
    lifecyclePhase: varchar('lifecycle_phase', { length: 100 }).notNull(), // 'Fabrication', 'Usage annuel', 'Fin de vie'
    emissionsPerUnitTonneCO2e: numeric('emissions_per_unit_tonne_co2e', { precision: 10, scale: 4 }).notNull(),
    totalLifecycleEmissions: numeric('total_lifecycle_emissions', { precision: 12, scale: 3 }).notNull(),
    emissionFactorSource: varchar('emission_factor_source', { length: 255 }).notNull(), // 'Base Empreinte ADEME', 'Constructeur ACV'
    confidenceLevel: integer('confidence_level').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_carbon_items_offer').on(table.offerId),
    index('idx_carbon_items_org').on(table.organizationId),
    foreignKey({ name: 'fk_carbon_items_offer_tenant', columns: [table.organizationId, table.offerId], foreignColumns: [supplierOffers.organizationId, supplierOffers.id] }),
    check('carbon_items_scope_check', sql`${table.scope} IN ('Scope 1', 'Scope 2', 'Scope 3 Amont', 'Scope 3 Aval')`),
    check('carbon_items_confidence_level_check', sql`${table.confidenceLevel} BETWEEN 0 AND 100`),
  ]
);

/**
 * =========================================================================
 * 8. RISK ITEMS (Événements de Risque P x I)
 * =========================================================================
 */
export const riskItems = pgTable(
  'risk_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id'),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => supplierOffers.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    probability: numeric('probability', { precision: 5, scale: 4 }).notNull(), // 0.0000 to 1.0000
    financialImpact: numeric('financial_impact', { precision: 14, scale: 2 }).notNull(), // €
    sourceEvidence: text('source_evidence'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_risk_items_offer').on(table.offerId),
    index('idx_risk_items_org').on(table.organizationId),
    foreignKey({ name: 'fk_risk_items_offer_tenant', columns: [table.organizationId, table.offerId], foreignColumns: [supplierOffers.organizationId, supplierOffers.id] }),
    check('risk_items_probability_check', sql`${table.probability} BETWEEN 0 AND 1`),
    check('risk_items_financial_impact_check', sql`${table.financialImpact} >= 0`),
  ]
);

/**
 * =========================================================================
 * 9. REFERENCE BENCHMARKS (Référentiel Institutionnel des Hypothèses)
 * =========================================================================
 */
export const referenceBenchmarks = pgTable(
  'reference_benchmarks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(), // 'energie', 'carbone', 'financier', 'social'
    source: varchar('source', { length: 255 }).notNull(), // 'ADEME Base Empreinte', 'Commission Quinet', 'CRE'
    value: numeric('value', { precision: 14, scale: 4 }).notNull(),
    unit: varchar('unit', { length: 50 }).notNull(),
    validUntil: timestamp('valid_until', { withTimezone: true }).notNull(),
    confidenceScore: integer('confidence_score').notNull(),
    lastAuditDate: timestamp('last_audit_date', { withTimezone: true }).notNull(),
    legalReference: text('legal_reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uq_benchmarks_org_name').on(table.organizationId, table.name),
    index('idx_benchmarks_org').on(table.organizationId),
    index('idx_benchmarks_category').on(table.category),
    check('reference_benchmarks_category_check', sql`${table.category} IN ('energie', 'carbone', 'financier', 'social', 'dechets', 'wacc', 'pollution_locale', 'main_d_oeuvre', 'taux_interet')`),
    check('reference_benchmarks_confidence_score_check', sql`${table.confidenceScore} BETWEEN 0 AND 100`),
  ]
);

/**
 * =========================================================================
 * 10. AUDIT LOGS (événements applicatifs ; non immuables / non certifiés)
 * =========================================================================
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow().notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    userName: varchar('user_name', { length: 255 }).notNull(),
    userRole: varchar('user_role', { length: 50 }).notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    entityName: varchar('entity_name', { length: 255 }).notNull(),
    fieldChanged: varchar('field_changed', { length: 255 }).notNull(),
    oldValue: text('old_value').notNull(),
    newValue: text('new_value').notNull(),
    justification: text('justification').notNull(),
  },
  (table) => [
    index('idx_audit_logs_org_timestamp').on(table.organizationId, table.timestamp.desc()),
    index('idx_audit_logs_project').on(table.projectId),
    foreignKey({ name: 'fk_audit_logs_user_tenant', columns: [table.organizationId, table.userId], foreignColumns: [users.organizationId, users.id] }),
    foreignKey({ name: 'fk_audit_logs_project_tenant', columns: [table.organizationId, table.projectId], foreignColumns: [projects.organizationId, projects.id] }),
  ]
);

/**
 * =========================================================================
 * DRIZZLE RELATIONS DEFINITIONS
 * =========================================================================
 */
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  projects: many(projects),
  suppliers: many(suppliers),
  benchmarks: many(referenceBenchmarks),
  auditLogs: many(auditLogs),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  createdBy: one(users, {
    fields: [projects.createdByUserId],
    references: [users.id],
  }),
  offers: many(supplierOffers),
  auditLogs: many(auditLogs),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [suppliers.organizationId],
    references: [organizations.id],
  }),
  offers: many(supplierOffers),
}));

export const supplierOffersRelations = relations(supplierOffers, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [supplierOffers.organizationId],
    references: [organizations.id],
  }),
  project: one(projects, {
    fields: [supplierOffers.projectId],
    references: [projects.id],
  }),
  supplier: one(suppliers, {
    fields: [supplierOffers.supplierId],
    references: [suppliers.id],
  }),
  costItems: many(costItems),
  carbonItems: many(carbonItems),
  riskItems: many(riskItems),
}));

export const costItemsRelations = relations(costItems, ({ one }) => ({
  organization: one(organizations, {
    fields: [costItems.organizationId],
    references: [organizations.id],
  }),
  offer: one(supplierOffers, {
    fields: [costItems.offerId],
    references: [supplierOffers.id],
  }),
}));

export const carbonItemsRelations = relations(carbonItems, ({ one }) => ({
  organization: one(organizations, {
    fields: [carbonItems.organizationId],
    references: [organizations.id],
  }),
  offer: one(supplierOffers, {
    fields: [carbonItems.offerId],
    references: [supplierOffers.id],
  }),
}));

export const riskItemsRelations = relations(riskItems, ({ one }) => ({
  organization: one(organizations, {
    fields: [riskItems.organizationId],
    references: [organizations.id],
  }),
  offer: one(supplierOffers, {
    fields: [riskItems.offerId],
    references: [supplierOffers.id],
  }),
}));
