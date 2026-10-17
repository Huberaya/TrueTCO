import { PROVENANCE_CONFIDENCE } from '../constants/provenance';
import type { AuditedValue, CostBreakdownItem, Project, Supplier, SupplierOffer } from '../types/domain';

/** Données d'une offre telles que saisies ou importées : TOUTES obligatoires, aucune valeur présumée. */
export interface OfferInputValues {
  supplierId: string;
  offerReference: string;
  unitPrice: number;
  quantity: number;
  annualEnergy: number;
  annualMaintenance: number;
  salvageValue: number;
  warrantyMonths: number;
  deliveryLeadTimeWeeks: number;
  expectedLifespanYears: number;
  technicalSuitabilityScore: number;
  isResponsibleCandidate: boolean;
  /** Optionnel : tCO2e par unité et par an, si l'utilisateur dispose d'une valeur. */
  carbonTonnePerUnitYear?: number;
}

export const CSV_COLUMNS = [
  'fournisseur', 'reference', 'prix_unitaire', 'quantite', 'energie_annuelle', 'maintenance_annuelle', 'valeur_residuelle',
  'garantie_mois', 'delai_semaines', 'duree_vie_ans', 'adequation_technique', 'responsable', 'co2_unitaire_an',
] as const;
const REQUIRED_NUMERIC = ['prix_unitaire', 'quantite', 'energie_annuelle', 'maintenance_annuelle', 'valeur_residuelle', 'garantie_mois', 'delai_semaines', 'duree_vie_ans', 'adequation_technique'] as const;

export interface CsvRowResult { line: number; values?: OfferInputValues; supplierName?: string; errors: string[] }

const toNumber = (raw: string): number | null => {
  const t = raw.trim().replace(/\s/g, '').replace(',', '.');
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : null;
};

/** Analyse réelle d'un CSV (séparateur « ; » ou « , »). Aucune cellule vide n'est complétée : elle est signalée. */
export function parseOfferCsv(csv: string, suppliers: Supplier[]): CsvRowResult[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [{ line: 1, errors: ['Fournissez un en-tête et au moins une ligne de données.'] }];
  const sep = lines[0].includes(';') ? ';' : ',';
  const header = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const missingCols = REQUIRED_NUMERIC.concat(['fournisseur', 'reference'] as never).filter((c) => !header.includes(c as string));
  if (missingCols.length) return [{ line: 1, errors: [`Colonnes manquantes : ${missingCols.join(', ')}`] }];

  return lines.slice(1).map((l, i): CsvRowResult => {
    const cells = l.split(sep).map((c) => c.trim());
    const get = (k: string) => cells[header.indexOf(k)] ?? '';
    const errors: string[] = [];
    const supplierName = get('fournisseur');
    const supplier = suppliers.find((s) => s.name.trim().toLowerCase() === supplierName.toLowerCase());
    if (!supplier) errors.push(`Fournisseur « ${supplierName} » non référencé : créez-le d'abord dans « Fournisseurs ».`);
    const n: Record<string, number> = {};
    for (const k of REQUIRED_NUMERIC) {
      const v = toNumber(get(k));
      if (v === null) errors.push(`« ${k} » absent ou non numérique.`); else n[k] = v;
    }
    if (n.quantite !== undefined && (!Number.isInteger(n.quantite) || n.quantite < 1)) errors.push('« quantite » doit être un entier ≥ 1.');
    if (n.adequation_technique !== undefined && (n.adequation_technique < 0 || n.adequation_technique > 100)) errors.push('« adequation_technique » doit être entre 0 et 100.');
    const co2raw = header.includes('co2_unitaire_an') ? get('co2_unitaire_an') : '';
    const co2 = co2raw === '' ? undefined : toNumber(co2raw);
    if (co2raw !== '' && co2 === null) errors.push('« co2_unitaire_an » non numérique.');
    if (errors.length || !supplier) return { line: i + 2, supplierName, errors };
    return {
      line: i + 2, supplierName, errors,
      values: {
        supplierId: supplier.id, offerReference: get('reference') || `CSV-${i + 1}`, unitPrice: n.prix_unitaire, quantity: n.quantite,
        annualEnergy: n.energie_annuelle, annualMaintenance: n.maintenance_annuelle, salvageValue: n.valeur_residuelle,
        warrantyMonths: n.garantie_mois, deliveryLeadTimeWeeks: n.delai_semaines, expectedLifespanYears: n.duree_vie_ans,
        technicalSuitabilityScore: n.adequation_technique, isResponsibleCandidate: /^(true|oui|1)$/i.test(get('responsable')),
        carbonTonnePerUnitYear: co2 ?? undefined,
      },
    };
  });
}

/**
 * Construit l'offre à partir des seules valeurs fournies. Toute valeur est marquée « fournie par l'utilisateur »
 * avec son nom ; AUCUN risque, facteur d'émission ou score n'est généré.
 */
export function buildOffer(v: OfferInputValues, project: Project, supplier: Supplier, authorName: string, origin: string): SupplierOffer {
  const today = new Date().toISOString().split('T')[0];
  const prov = (value: number, unit: string): AuditedValue => ({
    value, unit, sourceType: 'utilisateur', sourceName: `${origin} — ${authorName}`,
    confidenceLevel: PROVENANCE_CONFIDENCE.userEntered, lastUpdated: today, updatedBy: authorName,
  });
  const years = Array.from({ length: project.horizonYears }, (_, k) => k + 1);
  const costItems: CostBreakdownItem[] = [
    { id: crypto.randomUUID(), category: 'acquisition', label: 'Acquisition', amount: prov(v.unitPrice * v.quantity, '€'), isRecurringYearly: false },
    { id: crypto.randomUUID(), category: 'energie_consommables', label: 'Énergie et consommables (annuel)', amount: prov(v.annualEnergy, '€/an'), isRecurringYearly: true, yearlyInflationType: 'energy', yearOccurrences: years },
    { id: crypto.randomUUID(), category: 'maintenance_reparations', label: 'Maintenance (annuel)', amount: prov(v.annualMaintenance, '€/an'), isRecurringYearly: true, yearlyInflationType: 'maintenance', yearOccurrences: years },
    { id: crypto.randomUUID(), category: 'valeur_residuelle', label: 'Valeur résiduelle', amount: prov(-Math.abs(v.salvageValue), '€'), isRecurringYearly: false },
  ];
  const carbonItems = v.carbonTonnePerUnitYear && v.carbonTonnePerUnitYear > 0
    ? [{
        scope: 'Scope 1' as const, lifecyclePhase: 'utilisation_annuelle' as const,
        emissionsPerUnitTonneCO2e: prov(v.carbonTonnePerUnitYear, 'tCO2e/unité/an'),
        totalLifecycleEmissions: v.carbonTonnePerUnitYear * v.quantity * project.horizonYears,
        emissionFactorSource: 'Valeur saisie par l\'utilisateur (source non précisée)',
      }]
    : [];
  return {
    id: crypto.randomUUID(), projectId: project.id, supplierId: supplier.id, supplierName: supplier.name,
    offerReference: v.offerReference, isResponsibleCandidate: v.isResponsibleCandidate,
    apparentUnitPrice: prov(v.unitPrice, '€/unité'), quantity: v.quantity, apparentTotal: v.unitPrice * v.quantity,
    deliveryLeadTimeWeeks: v.deliveryLeadTimeWeeks, warrantyMonths: v.warrantyMonths, expectedLifespanYears: v.expectedLifespanYears,
    costItems, carbonItems, riskItems: [], technicalSuitabilityScore: v.technicalSuitabilityScore,
  } as SupplierOffer;
}
