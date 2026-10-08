/**
 * TrueTCO — Inversion de décision : « Quand la décision change-t-elle ? »
 * ---------------------------------------------------------------------------
 * C'est la question à laquelle aucun tableur ne répond proprement, et la
 * signature du produit. Pour une paire d'offres (celle qui gagne, celle qui
 * perd), ce module cherche la valeur d'un paramètre à partir de laquelle le
 * classement s'inverse — puis dit clairement ce qu'il a trouvé, et surtout ce
 * qu'il n'a PAS trouvé.
 *
 * Conventions et honnêteté du calcul :
 *  - Métrique comparée : la VAN du coût complet (LCC), périmètre strictement
 *    identique au TCO global (économique + risque + carbone). Comparer une VAN à
 *    un montant nominal serait une erreur de méthode.
 *  - Les plages explorées sont DÉCLARÉES et bornées à des valeurs crédibles. Un
 *    seuil trouvé hors de ces bornes n'est pas annoncé comme un résultat.
 *  - La recherche procède par balayage puis dichotomie dans l'intervalle où le
 *    signe change. Elle ne suppose pas la monotonie : elle rapporte tous les
 *    intervalles d'inversion détectés.
 *  - Aucun seuil n'est extrapolé. Si aucune inversion n'existe dans la plage,
 *    le résultat est `isReachable: false` avec la marge restante : c'est une
 *    information utile (« même à 20 % d'inflation énergie, la décision tient »).
 */

import { Project, SupplierOffer } from '../types/domain';
import { BuildOptions, TCOEngine } from './tcoEngine';

export type ReversalParameter =
  | 'taux_actualisation'
  | 'inflation_energie'
  | 'inflation_generale'
  | 'prix_carbone'
  | 'horizon'
  | 'taux_panne';

/** Valeur courante d'un paramètre pour un dossier donné. */
export interface ParameterSpec {
  parameter: ReversalParameter;
  label: string;
  unit: string;
  currentValue: number;
  /** Bornes crédibles explorées. Elles sont affichées à l'utilisateur. */
  min: number;
  max: number;
  /** Pas d'exploration. Un horizon se parcourt en années entières. */
  step: number;
  /** Clé de surcharge dans `BuildOptions`. */
  overrideKey: keyof BuildOptions;
}

export interface ReversalInterval {
  /** Valeur du paramètre où la décision est encore favorable. */
  from: number;
  /** Valeur du paramètre à partir de laquelle la décision s'inverse. */
  to: number;
  /** Seuil retenu (borne la plus proche du changement de signe). */
  threshold: number;
  /** Sens de lecture : « à partir de » (croissant) ou « en dessous de ». */
  direction: 'au_dessus' | 'en_dessous';
  /** Écart relatif entre le seuil et la valeur courante. */
  relativeDistance: number;
  /** Vraie lorsque la valeur courante est du côté favorable. */
  currentSide: 'favorable' | 'defavorable';
}

export interface ReversalResult {
  parameter: ReversalParameter;
  label: string;
  unit: string;
  currentValue: number;
  exploredRange: { min: number; max: number; step: number };
  /** Vrai si au moins un seuil d'inversion a été trouvé dans la plage explorée. */
  isReachable: boolean;
  /** Seuil le plus proche de la valeur courante (celui qui compte). */
  nearestThreshold: number | null;
  /** Tous les intervalles d'inversion détectés, du plus proche au plus lointain. */
  intervals: ReversalInterval[];
  /**
   * Marge disponible avant inversion, en points du paramètre et en % relatif.
   * `null` lorsque la valeur courante est déjà du côté défavorable.
   */
  marginToThreshold: { absolute: number; relative: number } | null;
  /** Explication lisible, y compris quand rien n'a été trouvé. */
  statement: string;
  /**
   * Écart de VAN (offre perdante − offre gagnante) aux bornes de la plage
   * explorée : montre de quel côté penche la décision aux extrêmes testés.
   */
  deltaAtBounds: { min: number; max: number; deltaAtMin: number; deltaAtMax: number };
}

export interface ReversalAnalysis {
  /** Offre qui gagne à la valeur courante du paramètre. */
  winnerOfferId: string;
  winnerSupplierName: string;
  /** Offre challenger comparée. */
  challengerOfferId: string;
  challengerSupplierName: string;
  /** Écart de VAN (challenger − gagnant) au scénario central, en €. */
  baseDelta: number;
  /** Convention de signe, exposée pour éviter toute lecture inversée. */
  signConvention: string;
  parameters: ReversalResult[];
  method: string;
}

interface SpecDefinition {
  parameter: ReversalParameter;
  label: string;
  unit: string;
  evaluate: (project: Project) => number;
  min: number;
  max: number;
  step: number;
  overrideKey: keyof BuildOptions;
}

/**
 * Plages explorées, exprimées en unités du paramètre. Elles sont volontairement
 * larges mais bornées à des valeurs défendables devant un comité d'achat.
 */
const SPECS: SpecDefinition[] = [
  {
    parameter: 'taux_actualisation',
    label: "Taux d'actualisation (WACC)",
    unit: '%',
    evaluate: (project) => project.discountRate,
    min: 0,
    max: 0.3,
    step: 0.0025,
    overrideKey: 'discountRate',
  },
  {
    parameter: 'inflation_energie',
    label: 'Inflation de l’énergie',
    unit: '%/an',
    evaluate: (project) => project.energyInflationRate,
    min: 0,
    max: 0.2,
    step: 0.002,
    overrideKey: 'energyInflationRate',
  },
  {
    parameter: 'inflation_generale',
    label: 'Inflation générale',
    unit: '%/an',
    evaluate: (project) => project.inflationRate,
    min: 0,
    max: 0.1,
    step: 0.001,
    overrideKey: 'inflationRate',
  },
  {
    parameter: 'prix_carbone',
    label: 'Prix du carbone',
    unit: '€/tCO2e',
    evaluate: (project) => project.carbonPricePerTonne,
    min: 0,
    max: 500,
    step: 5,
    overrideKey: 'carbonPricePerTonne',
  },
  {
    parameter: 'horizon',
    label: "Durée d'analyse",
    unit: 'ans',
    evaluate: (project) => project.horizonYears,
    min: 1,
    max: 20,
    step: 1,
    overrideKey: 'horizonYears',
  },
];

/**
 * Écart de VAN (challenger − gagnant) pour une surcharge donnée.
 * Positif ⇒ l'offre gagnante reste moins chère ; négatif ⇒ la décision s'inverse.
 */
function deltaAt(
  project: Project,
  winner: SupplierOffer,
  challenger: SupplierOffer,
  override: BuildOptions
): number {
  const winnerResult = TCOEngine.calculateOfferTCO(project, winner, override);
  const challengerResult = TCOEngine.calculateOfferTCO(project, challenger, override);
  return challengerResult.lifecycleCostLCC - winnerResult.lifecycleCostLCC;
}

/**
 * Construit la grille d'exploration. Une grille sur un horizon est en années
 * entières : interpoler une durée n'aurait aucun sens métier.
 */
function buildGrid(spec: SpecDefinition, current: number): number[] {
  const values: number[] = [];
  for (let value = spec.min; value <= spec.max + 1e-9; value += spec.step) {
    values.push(Number(value.toFixed(6)));
  }
  if (!values.some((v) => Math.abs(v - current) < 1e-9)) {
    values.push(current);
    values.sort((a, b) => a - b);
  }
  return values;
}

export function analyseDecisionReversal(
  project: Project,
  winner: SupplierOffer,
  challenger: SupplierOffer,
  options: { parameters?: ReversalParameter[] } = {}
): ReversalAnalysis {
  const baseDelta = deltaAt(project, winner, challenger, {});
  const requested = options.parameters;

  const specs = SPECS.filter((spec) => !requested || requested.includes(spec.parameter));

  const parameters: ReversalResult[] = specs.map((spec) => {
    const currentValue = spec.evaluate(project);
    const grid = buildGrid(spec, currentValue);

    // Balayage : on évalue la grille et on repère les changements de signe.
    const samples = grid.map((value) => ({
      value,
      delta: deltaAt(project, winner, challenger, { [spec.overrideKey]: value } as BuildOptions),
    }));

    const intervals: ReversalInterval[] = [];
    for (let i = 0; i < samples.length - 1; i += 1) {
      const a = samples[i];
      const b = samples[i + 1];
      if (a.delta === 0) continue;
      const signChanged = (a.delta > 0 && b.delta <= 0) || (a.delta < 0 && b.delta >= 0);
      if (!signChanged) continue;

      // Dichotomie dans l'intervalle pour resserrer le seuil.
      let low = a.value;
      let high = b.value;
      const lowIsFavourable = a.delta > 0;
      for (let iteration = 0; iteration < 60 && Math.abs(high - low) > spec.step / 1000; iteration += 1) {
        const middle = (low + high) / 2;
        const middleDelta = deltaAt(project, winner, challenger, { [spec.overrideKey]: middle } as BuildOptions);
        const middleFavourable = middleDelta > 0;
        if (middleFavourable === lowIsFavourable) low = middle;
        else high = middle;
      }
      const threshold = Number(((low + high) / 2).toFixed(6));
      // « Au-dessus » : la décision tient jusqu'à ce seuil puis s'inverse.
      const direction: ReversalInterval['direction'] = lowIsFavourable ? 'au_dessus' : 'en_dessous';
      const from = lowIsFavourable ? a.value : b.value;
      const to = lowIsFavourable ? b.value : a.value;
      const relativeDistance =
        currentValue !== 0 ? Math.abs(threshold - currentValue) / Math.abs(currentValue) : Number.POSITIVE_INFINITY;

      intervals.push({
        from,
        to,
        threshold,
        direction,
        relativeDistance,
        // « favorable » = la valeur courante laisse la décision actuelle intacte.
        // Se déduit de l'écart de VAN observé au scénario central (baseDelta).
        currentSide:
          currentValue >= Math.min(from, to) && currentValue <= Math.max(from, to) && baseDelta <= 0
            ? 'defavorable'
            : 'favorable',
      });
    }

    intervals.sort((a, b) => a.relativeDistance - b.relativeDistance);
    const nearest = intervals[0] ?? null;

    const deltaAtMin = samples[0].delta;
    const deltaAtMax = samples[samples.length - 1].delta;

    const formatValue = (value: number) => {
      if (spec.unit === '%') return `${(value * 100).toFixed(2)} %`;
      if (spec.unit === '%/an') return `${(value * 100).toFixed(2)} %/an`;
      if (spec.unit === 'ans') return `${Math.round(value)} ans`;
      return `${value.toLocaleString('fr-FR')} ${spec.unit}`;
    };

    const allDeltasZero = samples.every((sample) => sample.delta === 0);

    let statement: string;
    if (allDeltasZero) {
      statement =
        "Les deux offres présentent exactement la même VAN de coût complet sur toute la plage explorée : " +
        'aucun seuil ne peut être mis en évidence par ce paramètre. La décision doit se prendre sur des critères non financiers ' +
        '(qualité de service, carbone, risque).';
    } else if (nearest) {
      const margin = Math.abs(nearest.threshold - currentValue);
      const marginLabel =
        spec.unit === '%' || spec.unit === '%/an'
          ? `${(margin * 100).toFixed(2)} point(s)`
          : spec.unit === 'ans'
            ? `${Math.round(margin)} an(s)`
            : `${margin.toLocaleString('fr-FR')} ${spec.unit}`;
      statement =
        `La décision s'inverse ${nearest.direction === 'au_dessus' ? 'à partir de' : 'en dessous de'} ` +
        `${formatValue(nearest.threshold)} (valeur du scénario : ${formatValue(currentValue)}). ` +
        `Marge disponible : ${marginLabel}.`;
    } else if (deltaAtMin > 0 && deltaAtMax > 0) {
      statement =
        `Aucune inversion dans la plage explorée (${formatValue(spec.min)} à ${formatValue(spec.max)}) : ` +
        `la décision tient sur toute la plage testée.`;
    } else if (deltaAtMin < 0 && deltaAtMax < 0) {
      statement =
        `La décision est déjà défavorable sur toute la plage explorée ` +
        `(${formatValue(spec.min)} à ${formatValue(spec.max)}).`;
    } else {
      statement =
        `Le paramètre n'est pas monotone sur la plage explorée : aucun seuil unique ne peut être annoncé. ` +
        `Analysez les scénarios correspondants avant de conclure.`;
    }

    return {
      parameter: spec.parameter,
      label: spec.label,
      unit: spec.unit,
      currentValue,
      exploredRange: { min: spec.min, max: spec.max, step: spec.step },
      isReachable: nearest !== null,
      nearestThreshold: nearest ? nearest.threshold : null,
      intervals,
      marginToThreshold: nearest ? { absolute: Math.abs(nearest.threshold - currentValue), relative: nearest.relativeDistance } : null,
      statement,
      deltaAtBounds: { min: spec.min, max: spec.max, deltaAtMin, deltaAtMax },
    };
  });

  return {
    winnerOfferId: winner.id,
    winnerSupplierName: winner.supplierName,
    challengerOfferId: challenger.id,
    challengerSupplierName: challenger.supplierName,
    baseDelta,
    signConvention:
      'Écart de VAN = VAN(offre challenger) − VAN(offre gagnante). Un écart positif signifie que la décision actuelle ' +
      'reste la moins coûteuse ; un écart négatif signifie que la décision s’inverse.',
    parameters,
    method:
      'Balayage de la plage déclarée puis dichotomie sur l’intervalle de changement de signe, sur la VAN du coût complet ' +
      '(économique + risque + carbone). Aucune extrapolation hors des bornes explorées.',
  };
}
