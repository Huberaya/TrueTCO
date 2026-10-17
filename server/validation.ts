import { z } from 'zod';
import { HttpError } from './errors';
import { ROLES } from './types';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valide une entrée : 400 avec les chemins fautifs uniquement (jamais de valeur renvoyée). */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(racine)'))];
    throw new HttpError(400, 'validation_error', 'Données invalides', { fields });
  }
  return r.data;
}

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const num = z.coerce.number().refine(Number.isFinite, 'nombre fini requis');
const clientId = z.string().trim().min(1).max(128);

/** « € » / « $ » / « £ » (symboles utilisés par l'UI) normalisés en codes ISO 4217. */
const SYMBOLS: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };
const currency = z
  .string()
  .trim()
  .transform((v) => SYMBOLS[v] ?? v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, 'code devise ISO 4217'));

export const PROJECT_STATUSES = [
  'brouillon', 'collecte_offres', 'analyse', 'validation_finance', 'validation_achats', 'decision', 'adjudique', 'termine', 'archive',
  'Brouillon', 'Cahier des charges', 'Consultation', 'Analyse', 'Validation Finance', 'Validation Achats', 'Décision',
  'Contractualisé', 'En exploitation', 'Archivé', 'Terminé / Arbitré',
] as const;

/**
 * Les hypothèses financières n'ont AUCUNE valeur par défaut silencieuse : l'ancien code remplaçait
 * un taux de 0 % par 5 % (`Number(x) || 0.05`). Un champ absent est une erreur, un 0 est un 0.
 * Les clés inconnues sont ignorées ; organizationId / tenantId / role fournis par le client ne sont jamais lus.
 */
/**
 * Objet applicatif complet, conservé tel quel (sauvegarde sans perte). Jamais interprété par le serveur.
 * Optionnel : absent => le document existant est conservé (pas d'écrasement par {}).
 */
const documentField = z
  .record(z.string(), z.unknown())
  .refine((d) => JSON.stringify(d).length <= 200_000, 'document trop volumineux')
  .optional();

export const ProjectInput = z.object({
  document: documentField,
  id: clientId.optional(),
  reference: text(1, 100),
  name: text(1, 255),
  description: z.string().max(5000).default(''),
  category: text(1, 100).default('flotte_automobile'),
  companyName: text(1, 255).optional(),
  budgetCap: num.pipe(z.number().positive().max(1e12)),
  currency: currency.default('EUR'),
  plannedVolume: num.pipe(z.number().int().min(1).max(1e9)),
  unitName: text(1, 50).default('unités'),
  horizonYears: num.pipe(z.number().int().min(1).max(15)),
  status: z.enum(PROJECT_STATUSES).default('brouillon'),
  discountRate: num.pipe(z.number().min(0).max(1)),
  energyInflationRate: num.pipe(z.number().min(-0.5).max(1)),
  inflationRate: num.pipe(z.number().min(-0.5).max(1)),
  carbonPricePerTonne: num.pipe(z.number().min(0).max(10000)),
});

export const SOURCE_TYPES = [
  'verifiee', 'estimee', 'utilisateur', 'source_externe', 'donnee_sectorielle', 'historique', 'estimation', 'manquante',
  'devis_fournisseur', 'contrat', 'calculee',
] as const;

const CostItemInput = z.object({
  id: clientId.optional(),
  category: text(1, 100),
  label: text(1, 255),
  isRecurringYearly: z.boolean().default(false),
  amount: z.object({
    value: num.pipe(z.number().min(-1e12).max(1e12)),
    unit: text(1, 50).default('€'),
    sourceName: text(1, 255).optional(),
    // Sans provenance déclarée, la donnée est « manquante » avec confiance 0 : jamais 85 % par défaut.
    sourceType: z.enum(SOURCE_TYPES).default('manquante'),
    confidenceLevel: num.pipe(z.number().min(0).max(100)).default(0),
  }),
});

export const OfferInput = z.object({
  document: documentField,
  id: clientId,
  projectId: clientId,
  supplierId: clientId,
  offerReference: text(1, 100).optional(),
  apparentTotal: num.pipe(z.number().min(0).max(1e12)),
  quantity: num.pipe(z.number().int().min(1).max(1e9)),
  deliveryLeadTimeWeeks: num.pipe(z.number().int().min(0).max(520)).optional(),
  warrantyMonths: num.pipe(z.number().int().min(0).max(600)).optional(),
  technicalSuitabilityScore: num.pipe(z.number().min(0).max(100)).optional(),
  isResponsibleCandidate: z.boolean().default(false),
  costItems: z.array(CostItemInput).max(200).default([]),
});

export const SupplierInput = z.object({
  document: documentField,
  id: clientId.optional(),
  name: text(1, 255),
  country: z.string().trim().length(2).transform((s) => s.toUpperCase()).default('FR'),
  defaultIncoterm: text(1, 10).default('DDP'),
  paymentTermsDays: num.pipe(z.number().int().min(0).max(365)).default(30),
  leadTimeDays: num.pipe(z.number().int().min(0).max(3650)).default(30),
  moq: num.pipe(z.number().int().min(1).max(1e9)).default(1),
  warrantyMonths: num.pipe(z.number().int().min(0).max(600)).default(24),
  historicalDefectRate: num.pipe(z.number().min(0).max(1)).default(0.02),
  esgScore: num.pipe(z.number().int().min(0).max(100)).default(70),
  dataQualityScore: num.pipe(z.number().int().min(0).max(100)).default(85),
  certifications: z.array(text(1, 100)).max(50).default([]),
});

export const BENCHMARK_CATEGORIES = [
  'energie', 'carbone', 'financier', 'social', 'dechets', 'wacc', 'pollution_locale', 'main_d_oeuvre', 'taux_interet',
  'energie_kwh', 'recyclage',
] as const;

export const BenchmarkInput = z.object({
  id: clientId.optional(),
  document: documentField,
  name: text(1, 255),
  category: z.enum(BENCHMARK_CATEGORIES).default('carbone'),
  source: text(1, 255),
  value: num.pipe(z.number().min(-1e12).max(1e12)),
  unit: text(1, 50),
  confidenceLevel: num.pipe(z.number().min(0).max(100)),
  documentRef: z.string().trim().max(2000).optional(),
  methodology: z.string().trim().max(2000).optional(),
  validUntil: z.coerce.date().optional(),
});

/** Contenu déclaré par l'utilisateur ; identité, rôle, organisation et date sont imposés par le serveur. */
export const AuditNoteInput = z.object({
  projectId: clientId.optional(),
  entityName: text(1, 255),
  fieldChanged: text(1, 255),
  oldValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  newValue: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
  justification: text(1, 2000),
});

export const TenantCreateInput = z.object({
  name: text(2, 120),
  countryCode: z.string().trim().length(2).transform((s) => s.toUpperCase()).default('FR'),
  defaultCurrency: currency.default('EUR'),
  legalRegistrationNumber: z.string().trim().max(50).optional(),
});

export const TenantUpdateInput = z.object({
  name: text(2, 120).optional(),
  countryCode: z.string().trim().length(2).transform((s) => s.toUpperCase()).optional(),
  defaultCurrency: currency.optional(),
  legalRegistrationNumber: z.string().trim().max(50).nullable().optional(),
});

export const InvitationInput = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  fullName: text(1, 255),
  role: z.enum(ROLES as [string, ...string[]]),
  department: z.string().trim().max(255).optional(),
});

export const UserUpdateInput = z.object({
  role: z.enum(ROLES as [string, ...string[]]).optional(),
  isActive: z.boolean().optional(),
  fullName: text(1, 255).optional(),
  department: z.string().trim().max(255).nullable().optional(),
});

export const AiParseInput = z.object({
  filename: text(1, 255).default('document'),
  category: text(1, 50).optional(),
  // Pas de troncature silencieuse : un document trop long est refusé (400) plutôt que partiellement analysé.
  text: z.string().min(1).max(60_000),
});
