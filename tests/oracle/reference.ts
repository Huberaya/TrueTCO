/**
 * IMPLÉMENTATION DE RÉFÉRENCE — écrite à partir de docs/METHODOLOGIE-TCO.md, volontairement naïve et indépendante
 * du moteur (aucun import de src/engine). Sert d'oracle pour le test différentiel.
 */
import type { Project, SupplierOffer } from '../../src/types/domain';

export interface Ref { nominal: number; economic: number; risk: number; carbon: number; npv: number; npvDirect: number; npvExCarbon: number; flows: number[] }

export function reference(p: Project, o: SupplierOffer, ov: { r?: number; carbonPrice?: number; infl?: number; einfl?: number; failMult?: number } = {}): Ref {
  const N = p.horizonYears;
  const r = ov.r ?? p.discountRate, cp = ov.carbonPrice ?? p.carbonPricePerTonne, infl = ov.infl ?? p.inflationRate, ei = ov.einfl ?? p.energyInflationRate, fm = ov.failMult ?? 1;
  // Conventions neutres : le périmètre comparé exclut la maintenance et les remplacements (coefficients propres à chaque moteur).
  const A = { maintenanceWearRate: 0, failureAgingStartYear: 3, failureAgingRate: 0, carbonPriceGrowthRate: 0 };
  const direct: number[] = new Array(N + 1).fill(0), riskF: number[] = new Array(N + 1).fill(0), carbF: number[] = new Array(N + 1).fill(0);

  let acq = 0;
  for (const it of o.costItems) {
    const v = it.amount.value;
    const years = it.isRecurringYearly ? Array.from({ length: N }, (_, i) => i + 1) : (it.yearOccurrences?.length ? it.yearOccurrences : null);
    switch (it.category) {
      case 'acquisition': acq += v; direct[0] += v; break;
      case 'logistique_douanes': case 'installation_mise_en_service': direct[0] += v; break;
      case 'energie_consommables': for (const y of years ?? [1]) direct[y] += v * (1 + ei) ** Math.max(0, y - 1); break;
      case 'maintenance_reparations': for (const y of years ?? [1]) direct[y] += v * (1 + infl) ** Math.max(0, y - 1) * (1 + Math.max(0, y - 1) * A.maintenanceWearRate); break;
      case 'remplacement_pannes': for (const y of years ?? [1]) direct[y] += v * fm * (1 + infl) ** Math.max(0, y - 1) * (1 + Math.max(0, y - A.failureAgingStartYear) * A.failureAgingRate); break;
      case 'couts_administratifs_conformite': for (const y of years ?? [0]) direct[y] += v * (1 + infl) ** Math.max(0, y - 1); break;
      case 'fin_de_vie_recyclage': direct[N] += v; break;
      case 'valeur_residuelle': direct[N] -= Math.abs(v); break;
      default: break; // risques_operationnels / externalite_carbone : ignorés (double comptage)
    }
  }
  if (acq === 0) direct[0] += o.apparentUnitPrice.value * o.quantity;

  for (const k of o.riskItems) for (let y = 1; y <= N; y++) riskF[y] += (Math.min(1, Math.max(0, k.probability.value)) * k.financialImpact.value) / N;

  for (const c of o.carbonItems) {
    const T = c.totalLifecycleEmissions;
    if (c.lifecyclePhase === 'utilisation_annuelle') for (let y = 1; y <= N; y++) carbF[y] += (T / N) * cp * (1 + A.carbonPriceGrowthRate) ** y;
    else if (c.lifecyclePhase === 'fin_de_vie') carbF[N] += T * cp * (1 + A.carbonPriceGrowthRate) ** N;
    else carbF[0] += T * cp;
  }

  const PV = (a: number[]) => a.reduce((s, x, t) => s + x / (1 + r) ** t, 0);
  const full = direct.map((x, t) => x + riskF[t] + carbF[t]);
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  return { nominal: sum(full), economic: sum(direct), risk: sum(riskF), carbon: sum(carbF), npv: PV(full), npvDirect: PV(direct), npvExCarbon: PV(direct.map((x, t) => x + riskF[t])), flows: full };
}
