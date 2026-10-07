import { z } from 'zod';

/**
 * =============================================================================
 * TRUETCO - RUNTIME VALIDATION SCHEMAS & DTOs (ZOD)
 * =============================================================================
 */

// 1. Common Value & Source Types
export const DataSourceTypeSchema = z.enum([
  'verifiee',
  'estimee',
  'utilisateur',
  'source_externe',
  'donnee_sectorielle',
  'historique',
  'estimation',
  'manquante',
]);

export const AuditedValueSchema = z.object({
  value: z.number({ message: 'La valeur numérique est obligatoire.' }),
  unit: z.string().min(1, 'L\'unité est requise.'),
  sourceType: DataSourceTypeSchema,
  sourceName: z.string().min(1, 'Le nom de la source est obligatoire.'),
  sourceUrl: z.string().url('URL invalide').optional().or(z.literal('')),
  confidenceLevel: z
    .number()
    .min(0, 'Le niveau de confiance ne peut être inférieur à 0%')
    .max(100, 'Le niveau de confiance ne peut excéder 100%'),
  lastUpdated: z.string().min(1, 'Date de mise à jour requise.'),
  updatedBy: z.string().min(1, 'Auteur de mise à jour requis.'),
  notes: z.string().optional(),
});

// 2. Cost Breakdown Structure Item
export const CostBreakdownCategorySchema = z.enum([
  'acquisition',
  'logistique_douanes',
  'installation_mise_en_service',
  'energie_consommables',
  'maintenance_reparations',
  'remplacement_pannes',
  'couts_administratifs_conformite',
  'risques_operationnels',
  'externalite_carbone',
  'fin_de_vie_recyclage',
  'valeur_residuelle',
]);

export const CostBreakdownItemSchema = z.object({
  id: z.string().min(1, 'Identifiant requis'),
  category: CostBreakdownCategorySchema,
  label: z.string().min(2, 'Le libellé du poste de coût doit comporter au moins 2 caractères.'),
  amount: AuditedValueSchema,
  isRecurringYearly: z.boolean(),
  yearlyInflationType: z.enum(['general', 'energy', 'maintenance', 'none']).optional(),
  yearOccurrences: z.array(z.number()).optional(),
});

// 3. Carbon Item
export const CarbonScopeSchema = z.enum([
  'Scope 1',
  'Scope 2',
  'Scope 3 - Amont',
  'Scope 3 - Fin de vie',
]);

export const LifecyclePhaseSchema = z.enum([
  'fabrication',
  'transport',
  'utilisation_annuelle',
  'fin_de_vie',
]);

export const CarbonFootprintItemSchema = z.object({
  scope: CarbonScopeSchema,
  lifecyclePhase: LifecyclePhaseSchema,
  emissionsPerUnitTonneCO2e: AuditedValueSchema,
  totalLifecycleEmissions: z.number().min(0, 'Les émissions carbone doivent être positives.'),
  emissionFactorSource: z.string().min(1, 'La source du facteur d\'émission est requise.'),
});

// 4. Risk Item
export const RiskCategorySchema = z.enum([
  'reglementaire',
  'retrait_rappel',
  'interruption_service',
  'reputationnel',
]);

export const RiskExpositionItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(2, 'Libellé de risque requis'),
  category: RiskCategorySchema,
  probability: AuditedValueSchema.refine((v) => v.value >= 0 && v.value <= 1, {
    message: 'La probabilité de risque doit être comprise entre 0 et 1 (ex: 0.05).',
  }),
  financialImpact: AuditedValueSchema.refine((v) => v.value >= 0, {
    message: 'L\'impact financier doit être positif.',
  }),
  expectedLoss: z.number().min(0),
  probabilityType: z.enum(['historique', 'hypothese_utilisateur', 'donnee_sectorielle', 'estimation']),
  mitigationNotes: z.string().optional(),
});

// 5. Supplier Offer
export const SupplierOfferSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1, 'L\'offre doit être rattachée à un projet.'),
  supplierId: z.string().min(1, 'Fournisseur obligatoire.'),
  supplierName: z.string().min(1, 'Nom du fournisseur obligatoire.'),
  offerReference: z.string().min(2, 'La référence de l\'offre doit comporter au moins 2 caractères.'),
  isResponsibleCandidate: z.boolean(),
  apparentUnitPrice: AuditedValueSchema,
  quantity: z.number().int().positive('La quantité doit être un entier supérieur à 0.'),
  apparentTotal: z.number().positive('Le prix facial total doit être supérieur à 0.'),
  deliveryLeadTimeWeeks: z.number().min(0, 'Le délai de livraison doit être positif ou nul.'),
  warrantyMonths: z.number().int().min(0, 'La durée de garantie doit être positive ou nulle.'),
  expectedLifespanYears: z.number().positive('La durée de vie utile doit être supérieure à 0.'),
  costItems: z.array(CostBreakdownItemSchema).min(1, 'L\'offre doit comporter au moins un poste de coût.'),
  carbonItems: z.array(CarbonFootprintItemSchema),
  riskItems: z.array(RiskExpositionItemSchema),
  technicalSuitabilityScore: z
    .number()
    .min(0, 'La note technique ne peut être inférieure à 0')
    .max(100, 'La note technique ne peut excéder 100'),
  notes: z.string().optional(),
});

// 6. Project Schema & Creation DTO
export const ProcurementCategorySchema = z.enum([
  'flotte_automobile',
  'informatique_it',
  'equipements_industriels',
  'packaging',
  'energie_batiment',
]);

export const HorizonYearsSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(7),
  z.literal(10),
]);

export const ProjectSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(3, 'Le nom du projet doit comporter au moins 3 caractères.'),
  companyName: z.string().optional(),
  reference: z.string().min(2, 'La référence de la consultation est obligatoire (ex: AO-2026-IT).'),
  category: ProcurementCategorySchema,
  budgetCap: z.number().positive('Le budget plafond (CAPEX) doit être supérieur à 0 €.'),
  currency: z.string().default('EUR'),
  startDate: z.string().optional(),
  analysisDurationMonths: z.number().optional(),
  horizonYears: HorizonYearsSchema,
  plannedVolume: z.number().int().positive('Le volume prévisionnel doit être supérieur à 0.'),
  unitName: z.string().min(1, 'L\'unité physique est obligatoire (ex: véhicules, serveurs).'),
  purchaseFrequency: z.enum(['unique', 'annuel', 'pluriannuel']),
  objective: z.string().min(5, 'L\'objectif stratégique d\'achat doit comporter au moins 5 caractères.'),
  ownerId: z.string().min(1),
  ownerName: z.string().min(1),
  status: z.enum([
    'brouillon',
    'collecte_offres',
    'analyse',
    'validation_finance',
    'validation_achats',
    'decision',
    'adjudique',
    'termine',
    'archive',
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
  discountRate: z
    .number()
    .min(0, 'Le taux WACC doit être positif ou nul.')
    .max(0.3, 'Le taux WACC ne peut excéder 30%.'),
  carbonScenario: z.enum(['bas', 'central', 'haut']),
  carbonPricePerTonne: z.number().min(0, 'Le prix de la tonne de carbone doit être positif.'),
  inflationRate: z
    .number()
    .min(0, 'Le taux d\'inflation doit être positif.')
    .max(0.2, 'Le taux d\'inflation ne peut excéder 20%.'),
  energyInflationRate: z
    .number()
    .min(0, 'L\'inflation énergétique doit être positive.')
    .max(0.3, 'L\'inflation énergétique ne peut excéder 30%.'),
});

// Form Creation DTO
export const CreateProjectDTOSchema = ProjectSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// 7. Supplier Schema
export const SupplierSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  name: z.string().min(2, 'La raison sociale du fournisseur doit comporter au moins 2 caractères.'),
  country: z.string().min(2, 'Le pays d\'implantation est requis.'),
  sector: z.string().min(2, 'Le secteur d\'activité est requis.'),
  contactName: z.string().optional(),
  contactEmail: z.string().email('Format d\'adresse email invalide.'),
  contactPhone: z.string().optional(),
  certifications: z.array(z.string()),
  defaultIncoterm: z.string().min(2, 'Incoterm requis (ex: DDP, FCA).'),
  currency: z.string().default('EUR'),
  paymentTerms: z.string().min(1, 'Conditions de règlement requises.'),
  moq: z.number().int().min(1, 'La quantité minimale de commande doit être au moins 1.'),
  leadTimeDays: z.number().int().min(0, 'Le délai de livraison doit être positif ou nul.'),
  historicalDefectRate: z
    .number()
    .min(0, 'Le taux de défaut doit être positif.')
    .max(1, 'Le taux de défaut ne peut excéder 100% (1.0).'),
  warrantyMonths: z.number().int().min(0, 'La durée de garantie doit être positive ou nulle.'),
  performanceScore: z.number().min(0).max(100),
  esgScore: z.number().min(0).max(100),
  environmentalDataAvailable: z.array(z.string()),
  dataQualityScore: z.number().min(0).max(100),
});

// 8. Reference Benchmark Schema
export const ExternalityReferenceBenchmarkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(2, 'Nom du facteur de référence requis.'),
  category: z.enum(['carbone', 'wacc', 'energie_kwh', 'recyclage', 'energie', 'dechets', 'pollution_locale']),
  value: z.number(),
  unit: z.string().min(1, 'Unité requise.'),
  source: z.string().min(2, 'Source certifiée obligatoire (ex: ADEME, Quinet).'),
  sourceUrl: z.string().url().optional().or(z.literal('')),
  documentRef: z.string().min(1, 'Référence documentaire requise.'),
  lastUpdated: z.string().min(1),
  countryScope: z.string().min(1),
  methodology: z.string().min(1),
  valueRange: z.tuple([z.number(), z.number()]).optional(),
  confidenceLevel: z.number().min(0).max(100),
});

// 9. Audit Log Schema
export const AuditLogEntrySchema = z.object({
  id: z.string().min(1),
  timestamp: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().min(1),
  userRole: z.enum([
    'admin',
    'directeur_achats',
    'acheteur',
    'finance_controleur',
    'rse_esg',
    'direction_generale',
  ]),
  projectId: z.string().optional(),
  offerId: z.string().optional(),
  entityName: z.string().min(1, 'Élément audité obligatoire.'),
  fieldChanged: z.string().min(1, 'Champ révisé obligatoire.'),
  oldValue: z.string(),
  newValue: z.string(),
  unit: z.string().optional(),
  justification: z.string().min(3, 'La justification de la modification est obligatoire pour la piste d\'audit.'),
});

// 10. Complete Backup / Import Payload Schema
export const TrueTCOBackupPayloadSchema = z.object({
  version: z.string(),
  exportedAt: z.string(),
  organization: z.string(),
  projects: z.array(ProjectSchema).min(1, 'Le fichier doit contenir au moins un projet valide.'),
  offers: z.array(SupplierOfferSchema),
  suppliers: z.array(SupplierSchema),
  benchmarks: z.array(ExternalityReferenceBenchmarkSchema),
  auditLogs: z.array(AuditLogEntrySchema),
});

// Inferred TypeScript Types
export type ValidatedProject = z.infer<typeof ProjectSchema>;
export type CreateProjectDTO = z.infer<typeof CreateProjectDTOSchema>;
export type ValidatedSupplierOffer = z.infer<typeof SupplierOfferSchema>;
export type ValidatedSupplier = z.infer<typeof SupplierSchema>;
export type ValidatedAuditLog = z.infer<typeof AuditLogEntrySchema>;
export type ValidatedBackupPayload = z.infer<typeof TrueTCOBackupPayloadSchema>;

/**
 * Helper to extract formatted French error messages from a ZodError
 */
export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? `[${issue.path.join('.')}] ` : '';
    return `${path}${issue.message}`;
  });
}
