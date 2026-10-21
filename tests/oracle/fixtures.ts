import type { CostBreakdownItem, Project, RiskExpositionItem, CarbonFootprintItem, SupplierOffer } from '../../src/types/domain';

let n = 0;
const av = (value: number, unit = '€', confidenceLevel = 80) => ({ value, unit, sourceType: 'utilisateur' as const, sourceName: 'test', confidenceLevel, lastUpdated: '2026-01-01', updatedBy: 'test' });

export const item = (category: CostBreakdownItem['category'], value: number, o: { recurring?: boolean; unit?: string; occ?: number[]; conf?: number } = {}): CostBreakdownItem => ({
  id: `ci-${++n}`, category, label: `${category}#${n}`, amount: av(value, o.unit ?? (o.recurring ? '€/an' : '€'), o.conf ?? 80),
  isRecurringYearly: !!o.recurring, yearOccurrences: o.occ,
});
export const risk = (p: number, impact: number): RiskExpositionItem => ({
  id: `r-${++n}`, label: 'risque', category: 'interruption_service', probability: av(p, 'proba'), financialImpact: av(impact), expectedLoss: p * impact, probabilityType: 'hypothese_utilisateur',
});
export const carbon = (phase: CarbonFootprintItem['lifecyclePhase'], totalTonnes: number): CarbonFootprintItem => ({
  id: `c-${++n}`, label: `carbone ${phase}`, scope: 'Scope 3 - Amont', lifecyclePhase: phase, totalLifecycleEmissions: totalTonnes,
  emissionsPerUnitTonneCO2e: av(totalTonnes, 'tCO2e'),
});

export const project = (o: Partial<Project> = {}): Project => ({
  id: 'p', organizationId: 'o', name: 'P', reference: 'R', category: 'flotte_automobile', budgetCap: 1e6, currency: 'EUR', horizonYears: 3, plannedVolume: 1, unitName: 'u',
  purchaseFrequency: 'unique', objective: '', ownerId: 'u', ownerName: 'u', status: 'analyse', createdAt: '', updatedAt: '',
  discountRate: 0.1, carbonScenario: 'central', carbonPricePerTonne: 100, inflationRate: 0, energyInflationRate: 0,
  modelAssumptions: { maintenanceWearRate: 0, failureAgingStartYear: 3, failureAgingRate: 0, carbonPriceGrowthRate: 0 }, ...o,
} as Project);

export const offer = (o: { id?: string; items?: CostBreakdownItem[]; risks?: RiskExpositionItem[]; carbons?: CarbonFootprintItem[]; quantity?: number; unitPrice?: number; lifespan?: number; name?: string } = {}): SupplierOffer => ({
  id: o.id ?? `o-${++n}`, projectId: 'p', supplierId: 's', supplierName: o.name ?? 'F', offerReference: 'REF', isResponsibleCandidate: false,
  apparentUnitPrice: av(o.unitPrice ?? 0, '€/unité'), quantity: o.quantity ?? 1, apparentTotal: (o.unitPrice ?? 0) * (o.quantity ?? 1),
  deliveryLeadTimeWeeks: 4, warrantyMonths: 12, expectedLifespanYears: o.lifespan ?? 10,
  costItems: o.items ?? [], carbonItems: o.carbons ?? [], riskItems: o.risks ?? [], technicalSuitabilityScore: 70,
});

/** Gèle récursivement : toute mutation lève une TypeError (modules ES = mode strict). */
export function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) { Object.freeze(x); for (const v of Object.values(x as object)) deepFreeze(v); }
  return x;
}

/** PRNG déterministe pour les tests de propriétés. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
