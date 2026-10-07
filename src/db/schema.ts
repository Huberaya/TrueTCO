import {
  pgTable,
  text,
  varchar,
  integer,
  numeric,
  timestamp,
  boolean,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

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
    index('org_name_idx').on(table.name),
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
    uniqueIndex('user_org_email_idx').on(table.organizationId, table.email),
    index('user_role_idx').on(table.role),
    index('user_clerk_id_idx').on(table.clerkId),
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
    horizonYears: integer('horizon_years').notNull(), // 1 to 10 years
    status: varchar('status', { length: 50 }).default('Brouillon').notNull(), // 'Brouillon' | 'Cahier des charges' | 'Consultation' | 'Analyse' | 'Décision' | 'Contractualisé' | 'En exploitation' | 'Archivé'
    discountRate: numeric('discount_rate', { precision: 6, scale: 4 }).notNull(), // WACC, e.g. 0.0450 (4.5%)
    energyInflationRate: numeric('energy_inflation_rate', { precision: 6, scale: 4 }).notNull(), // e.g. 0.0550 (5.5%)
    generalInflationRate: numeric('general_inflation_rate', { precision: 6, scale: 4 }).notNull(), // e.g. 0.0200 (2.0%)
    carbonPricePerTonne: numeric('carbon_price_per_tonne', { precision: 10, scale: 2 }).notNull(), // Quinet €/tCO2e (e.g. 120.00)
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('project_org_ref_idx').on(table.organizationId, table.reference),
    index('project_status_idx').on(table.status),
    index('project_category_idx').on(table.category),
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
    incoterm: varchar('incoterm', { length: 10 }).notNull(), // 'DDP', 'FCA', 'EXW', 'CIP'
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
    uniqueIndex('supplier_org_name_idx').on(table.organizationId, table.name),
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
    uniqueIndex('offer_project_ref_idx').on(table.projectId, table.offerReference),
    index('offer_project_id_idx').on(table.projectId),
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
    index('cost_items_offer_id_idx').on(table.offerId),
    index('cost_items_category_idx').on(table.category),
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
    index('carbon_items_offer_id_idx').on(table.offerId),
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
    index('risk_items_offer_id_idx').on(table.offerId),
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
    uniqueIndex('bench_org_name_idx').on(table.organizationId, table.name),
  ]
);

/**
 * =========================================================================
 * 10. AUDIT LOGS (Journal d'Audit Immuable Légal / CAC)
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
    newValue: text('newValue').notNull(),
    justification: text('justification').notNull(),
  },
  (table) => [
    index('audit_org_timestamp_idx').on(table.organizationId, table.timestamp),
    index('audit_project_id_idx').on(table.projectId),
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
  offer: one(supplierOffers, {
    fields: [costItems.offerId],
    references: [supplierOffers.id],
  }),
}));

export const carbonItemsRelations = relations(carbonItems, ({ one }) => ({
  offer: one(supplierOffers, {
    fields: [carbonItems.offerId],
    references: [supplierOffers.id],
  }),
}));

export const riskItemsRelations = relations(riskItems, ({ one }) => ({
  offer: one(supplierOffers, {
    fields: [riskItems.offerId],
    references: [supplierOffers.id],
  }),
}));
