/**
 * Feuille de calcul REPRODUCTIBLE : le calcul d'une offre exprimé en formules de tableur (hypothèses → flux annuels →
 * actualisation), pour qu'un contrôleur de gestion puisse l'auditer, le modifier et retrouver exactement les chiffres du moteur.
 *
 * Fonction pure, sans dépendance au navigateur : un test l'évalue avec un moteur de tableur INDÉPENDANT et compare
 * le résultat au moteur TrueTCO. Les conventions suivent docs/METHODOLOGIE-TCO.md.
 * Non inclus : les multiplicateurs d'analyse de sensibilité (ils ne font pas partie du cas central).
 */
import { DEFAULT_ASSUMPTIONS } from '../engine/tcoEngine';
import type { CostBreakdownItem, Project, SupplierOffer } from '../types/domain';

/**
 * Une cellule est une valeur, ou une FORMULE accompagnée de sa valeur calculée (`v`).
 * La valeur en cache est indispensable : sans elle, la bibliothèque d'export supprime silencieusement la formule.
 * Un test vérifie que chaque `v` égale l'évaluation de `f` par un tableur indépendant.
 */
export interface Formula { f: string; v: number }
export type Cell = string | number | null | Formula;
export const isFormula = (c: Cell): c is Formula => typeof c === 'object' && c !== null && 'f' in c;

export interface ReproducibleSheet {
  grid: Cell[][];
  /** Adresses (ligne, colonne) 0-indexées des indicateurs, pour les tests et la mise en forme. */
  kpi: Record<'tcoNominal' | 'lcc' | 'tcoDirect' | 'lccDirect' | 'riskNominal' | 'carbonNominal', { row: number; col: number }>;
  /** Cellules saisies (à surligner). */
  inputs: { row: number; col: number }[];
}

export const colLetter = (i: number): string => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function buildReproducibleSheet(project: Project, offer: SupplierOffer): ReproducibleSheet {
  const N = finite(project.horizonYears) && project.horizonYears >= 1 ? Math.round(project.horizonYears) : 5;
  const A = { ...DEFAULT_ASSUMPTIONS, ...(project.modelAssumptions ?? {}) };
  const FIRST = 3;                                  // colonne D = année 0
  const LAST = FIRST + N;
  const grid: Cell[][] = [];
  const inputs: { row: number; col: number }[] = [];
  const put = (r: number, c: number, v: Cell, input = false) => { (grid[r] ??= [])[c] = v; if (input) inputs.push({ row: r, col: c }); };
  const num = (r: number, c: number): number => { const x = grid[r]?.[c]; return isFormula(x as Cell) ? (x as Formula).v : typeof x === 'number' ? x : 0; };
  const F = (f: string, v: number): Formula => ({ f, v });

  put(0, 0, `Calcul reproductible — ${offer.supplierName} (${offer.offerReference})`);
  put(1, 0, 'Cellules saisies = hypothèses et données modifiables ; les flux et totaux sont des formules. Conventions : docs/METHODOLOGIE-TCO.md (actualisation en fin d\'année, t = 0 : investissement initial).');
  put(3, 0, 'HYPOTHÈSES');
  const params: [string, number][] = [
    ["Taux d'actualisation", project.discountRate], ['Inflation générale', project.inflationRate], ["Inflation de l'énergie", project.energyInflationRate],
    ['Prix du carbone (€/tCO2e)', project.carbonPricePerTonne], ['Croissance annuelle du prix du carbone', A.carbonPriceGrowthRate],
    ['Vieillissement de la maintenance (par an)', A.maintenanceWearRate], ['Vieillissement des pannes (par an)', A.failureAgingRate],
    ["Pannes : vieillissement après l'année", A.failureAgingStartYear], ["Horizon d'analyse (années)", N],
  ];
  params.forEach(([label, v], i) => { put(4 + i, 0, label); put(4 + i, 1, v, true); });
  // Références absolues : B5 taux, B6 inflation, B7 énergie, B8 carbone, B9 croissance carbone, B10 usure, B11 vieillissement, B12 début, B13 horizon
  const R = { disc: '$B$5', infl: '$B$6', ein: '$B$7', cp: '$B$8', g: '$B$9', wear: '$B$10', aging: '$B$11', start: '$B$12', n: '$B$13' };

  const HEAD = 14;                                  // ligne d'en-tête (0-indexée) : années
  put(HEAD, 0, 'Poste'); put(HEAD, 1, 'Catégorie / probabilité'); put(HEAD, 2, 'Montant saisi');
  for (let t = 0; t <= N; t++) put(HEAD, FIRST + t, t);
  const T = (c: number) => `${colLetter(c)}$${HEAD + 1}`;      // cellule « année » de la colonne c

  let row = HEAD + 1;
  const section = (title: string) => { put(row, 0, title); row++; };
  const sumRow = (label: string, from: number, to: number): number => {
    put(row, 0, label);
    for (let t = 0; t <= N; t++) {
      let v = 0; for (let r = from; r <= to; r++) v += num(r, FIRST + t);
      put(row, FIRST + t, to < from ? 0 : F(`SUM(${colLetter(FIRST + t)}${from + 1}:${colLetter(FIRST + t)}${to + 1})`, v));
    }
    return row++;
  };

  // ── Postes directs ──
  section('COÛTS DIRECTS');
  const directFrom = row;
  const items: readonly CostBreakdownItem[] = offer.costItems ?? [];
  const qty = finite(offer.quantity) && offer.quantity > 0 ? offer.quantity : finite(project.plannedVolume) && project.plannedVolume > 0 ? project.plannedVolume : 1;
  const unitPrice = offer.apparentUnitPrice?.value ?? (offer.apparentTotal ? offer.apparentTotal / qty : 0);
  const hasAcquisition = items.some((i) => i.category === 'acquisition' && finite(i.amount?.value));
  const ignored: string[] = [];

  const yearsFor = (it: CostBreakdownItem, defaultYears: number[]): number[] => {
    const occ = (it.yearOccurrences ?? []).filter((y) => Number.isInteger(y) && y >= 0 && y <= N);
    return occ.length > 0 ? occ : defaultYears;
  };
  const all = Array.from({ length: N }, (_, k) => k + 1);

  const itemRow = (label: string, cat: string, amount: number, formulaFor: (t: string, r: number) => string, valueFor: (t: number) => number, years: number[]) => {
    put(row, 0, label); put(row, 1, cat); put(row, 2, amount, true);
    for (let t = 0; t <= N; t++) put(row, FIRST + t, years.includes(t) ? F(formulaFor(T(FIRST + t), row + 1), valueFor(t)) : 0);
    row++;
  };
  const pw = (base: number, e: number) => Math.pow(base, e);

  for (const it of items) {
    const v = it.amount?.value;
    if (!finite(v)) continue;
    const rec = !!it.isRecurringYearly;
    const C = (r: number) => `$C${r}`;
    const m1 = (t: number) => Math.max(0, t - 1);
    switch (it.category) {
      case 'acquisition': case 'logistique_douanes': case 'installation_mise_en_service':
        itemRow(it.label, it.category, v, (t, r) => `${C(r)}*(1+${R.infl})^MAX(0,${t}-1)`, (t) => v * pw(1 + project.inflationRate, m1(t)), rec ? all : yearsFor(it, [0])); break;
      case 'energie_consommables':
        itemRow(it.label, it.category, v, (t, r) => `${C(r)}*(1+${R.ein})^MAX(0,${t}-1)`, (t) => v * pw(1 + project.energyInflationRate, m1(t)), rec ? yearsFor(it, all) : yearsFor(it, [1])); break;
      case 'maintenance_reparations':
        itemRow(it.label, it.category, v, (t, r) => `${C(r)}*(1+${R.infl})^MAX(0,${t}-1)*(1+MAX(0,${t}-1)*${R.wear})`, (t) => v * pw(1 + project.inflationRate, m1(t)) * (1 + m1(t) * A.maintenanceWearRate), rec ? yearsFor(it, all) : yearsFor(it, [1])); break;
      case 'remplacement_pannes':
        itemRow(it.label, it.category, v, (t, r) => `${C(r)}*(1+${R.infl})^MAX(0,${t}-1)*(1+MAX(0,${t}-${R.start})*${R.aging})`, (t) => v * pw(1 + project.inflationRate, m1(t)) * (1 + Math.max(0, t - A.failureAgingStartYear) * A.failureAgingRate), rec ? yearsFor(it, all) : yearsFor(it, [1])); break;
      case 'couts_administratifs_conformite':
        itemRow(it.label, it.category, v, (t, r) => `${C(r)}*(1+${R.infl})^MAX(0,${t}-1)`, (t) => v * pw(1 + project.inflationRate, m1(t)), rec ? yearsFor(it, all) : yearsFor(it, [0])); break;
      case 'fin_de_vie_recyclage':
        itemRow(it.label, it.category, v, (_t, r) => `${C(r)}`, () => v, [N]); break;
      case 'valeur_residuelle':
        itemRow(`${it.label} (crédit)`, it.category, v, (_t, r) => `-ABS(${C(r)})`, () => -Math.abs(v), [N]); break;
      default: ignored.push(it.label);
    }
  }
  if (!hasAcquisition && finite(unitPrice) && unitPrice * qty > 0) {
    itemRow('Prix du devis (prix unitaire × quantité)', 'acquisition (devis)', unitPrice * qty, (_t, r) => `$C${r}`, () => unitPrice * qty, [0]);
  }
  const directTo = row - 1;
  const directRow = sumRow('Sous-total direct', directFrom, directTo);
  if (ignored.length) { put(row, 0, `Postes ignorés (déjà modélisés via risques / carbone) : ${ignored.join(', ')}`); row++; }
  row++;

  // ── Risques ──
  section('RISQUES (probabilité sur l\'horizon × impact, répartie uniformément sur les années 1..N)');
  const riskFrom = row;
  for (const r of offer.riskItems ?? []) {
    const p = r.probability?.value, imp = r.financialImpact?.value;
    if (!finite(p) || !finite(imp)) continue;
    put(row, 0, r.label); put(row, 1, p, true); put(row, 2, imp, true);
    for (let t = 0; t <= N; t++) put(row, FIRST + t, t >= 1 ? F(`MIN(MAX($B${row + 1},0),1)*$C${row + 1}/${R.n}`, (Math.min(Math.max(p, 0), 1) * imp) / N) : 0);
    row++;
  }
  const riskRow = sumRow('Sous-total risques', riskFrom, row - 1);
  row++;

  // ── Carbone ──
  section('CARBONE (tonnes par année × prix du carbone × (1 + croissance)^t)');
  const carbFrom = row;
  for (const c of offer.carbonItems ?? []) {
    const perUnit = c.emissionsPerUnitTonneCO2e?.value;
    const perUnitAnnual = /\/\s*an\b/i.test(c.emissionsPerUnitTonneCO2e?.unit ?? '');
    const abs = c.emissionsTCO2e?.value;
    const derived = finite(abs) ? abs : finite(perUnit) ? perUnit * qty * (perUnitAnnual ? N : 1) : undefined;
    const total = finite(c.totalLifecycleEmissions) && c.totalLifecycleEmissions > 0 ? c.totalLifecycleEmissions : derived ?? 0;
    const phase = c.lifecyclePhase ?? 'fabrication';
    put(row, 0, c.label ?? c.scope); put(row, 1, phase); put(row, 2, total, true);
    for (let t = 0; t <= N; t++) {
      const tc = T(FIRST + t);
      const tonnes = phase === 'utilisation_annuelle' ? (t >= 1 ? `$C${row + 1}/${R.n}` : null) : phase === 'fin_de_vie' ? (t === N ? `$C${row + 1}` : null) : (t === 0 ? `$C${row + 1}` : null);
      const tv = phase === 'utilisation_annuelle' ? (t >= 1 ? total / N : 0) : phase === 'fin_de_vie' ? (t === N ? total : 0) : (t === 0 ? total : 0);
      put(row, FIRST + t, tonnes ? F(`${tonnes}*${R.cp}*(1+${R.g})^${tc}`, tv * project.carbonPricePerTonne * pw(1 + A.carbonPriceGrowthRate, t)) : 0);
    }
    row++;
  }
  const carbonRow = sumRow('Sous-total carbone', carbFrom, row - 1);
  row++;

  // ── Totaux ──
  section('TOTAUX');
  const totalRow = row; put(row, 0, 'COÛT COMPLET (nominal) = direct + risques + carbone');
  for (let t = 0; t <= N; t++) { const c = colLetter(FIRST + t); put(row, FIRST + t, F(`${c}${directRow + 1}+${c}${riskRow + 1}+${c}${carbonRow + 1}`, num(directRow, FIRST + t) + num(riskRow, FIRST + t) + num(carbonRow, FIRST + t))); }
  row++;
  const factorRow = row; put(row, 0, "Facteur d'actualisation 1/(1+r)^t");
  for (let t = 0; t <= N; t++) put(row, FIRST + t, F(`1/(1+${R.disc})^${T(FIRST + t)}`, 1 / pw(1 + project.discountRate, t)));
  row++;
  const discRow = row; put(row, 0, 'Coût complet actualisé');
  for (let t = 0; t <= N; t++) { const c = colLetter(FIRST + t); put(row, FIRST + t, F(`${c}${totalRow + 1}*${c}${factorRow + 1}`, num(totalRow, FIRST + t) * num(factorRow, FIRST + t))); }
  row++;
  put(row, 0, 'Cumul actualisé');
  for (let t = 0; t <= N; t++) { const c = colLetter(FIRST + t); put(row, FIRST + t, t === 0 ? F(`${c}${discRow + 1}`, num(discRow, FIRST)) : F(`${colLetter(FIRST + t - 1)}${row + 1}+${c}${discRow + 1}`, num(row, FIRST + t - 1) + num(discRow, FIRST + t))); }
  row += 2;

  const rng = (r: number) => `${colLetter(FIRST)}${r + 1}:${colLetter(LAST)}${r + 1}`;
  section('INDICATEURS');
  const sumOf = (r: number) => { let x = 0; for (let t = 0; t <= N; t++) x += num(r, FIRST + t); return x; };
  const k = (label: string, formula: string, value: number) => { put(row, 0, label); put(row, 1, F(formula, value)); return { row: row++, col: 1 }; };
  const kpi = {
    tcoNominal: k('TCO complet nominal', `SUM(${rng(totalRow)})`, sumOf(totalRow)),
    lcc: k('Coût complet actualisé (LCC) — critère de décision', `SUM(${rng(discRow)})`, sumOf(discRow)),
    tcoDirect: k('TCO direct nominal (hors risques et carbone)', `SUM(${rng(directRow)})`, sumOf(directRow)),
    lccDirect: k('Coût direct actualisé', `SUMPRODUCT(${rng(directRow)},${rng(factorRow)})`, Array.from({ length: N + 1 }, (_, t) => num(directRow, FIRST + t) * num(factorRow, FIRST + t)).reduce((a, b) => a + b, 0)),
    riskNominal: k('Risques (nominal)', `SUM(${rng(riskRow)})`, sumOf(riskRow)),
    carbonNominal: k('Carbone monétisé (nominal)', `SUM(${rng(carbonRow)})`, sumOf(carbonRow)),
  };
  // Grille DENSE (aucune ligne ni cellule manquante) : exigée par les tableurs et par les convertisseurs.
  let width = 0;
  for (let r = 0; r < grid.length; r++) width = Math.max(width, grid[r]?.length ?? 0);   // (grid est creux : pas de .map/spread)
  const dense: Cell[][] = Array.from({ length: grid.length }, (_, r) => Array.from({ length: width }, (_, c) => grid[r]?.[c] ?? null));
  return { grid: dense, kpi, inputs };
}
