/**
 * TrueTCO — Simulation probabiliste du risque (Phase 3)
 * ---------------------------------------------------------------------------
 * Répond à la question que le classement déterministe ne peut pas trancher :
 * « AND QUOI la décision tient-elle ? ». Le classement compare des valeurs
 * centrales ; ici, chaque hypothèse incertaine est tirée selon une loi DÉCLARÉE,
 * et la décision est recalculée par le moteur complet à chaque tirage.
 *
 * CE QUE CE MODULE EST
 *   - une propagation de l'incertitude DÉCLARÉE par l'utilisateur, par échantillonnage ;
 *   - un outil de comparaison : la grandeur d'intérêt est l'ÉCART de VAN entre deux
 *     offres (challenger − gagnant), parce que c'est cette différence qui décide ;
 *   - reproductible : même graine + mêmes entrées ⇒ mêmes résultats, au bit près.
 *
 * CE QUE CE MODULE N'EST PAS — et ne doit jamais laisser croire
 *   1. Pas un intervalle de confiance statistique. Les quantiles produits
 *      décrivent la dispersion SIMULÉE sous les hypothèses écrites dans le
 *      rapport. Aucune inférence n'est faite sur une population, aucun échantillon
 *      de marché n'est utilisé, aucune loi n'est ajustée sur des données réelles.
 *      Le vocabulaire employé est donc « quantile P10/P50/P90 de la distribution
 *      simulée », jamais « intervalle de confiance à 80 % ».
 *   2. Pas une prédiction. Aucun tirage ne crée d'information : si l'utilisateur
 *      déclare que tout est certain, la simulation le dit au lieu de fabriquer
 *      de la variabilité.
 *   3. Pas une analyse de risque complète. Les risques d'événements (panne,
 *      litige, rupture) sont traités par le moteur principal (`riskItems`) ; ce
 *      module propage l'incertitude des PARAMÈTRES économiques.
 *
 * CHOIX MÉTHODOLOGIQUES, TOUS EXPOSÉS DANS LE RAPPORT
 *   - Tirage aléatoire reproductible : générateur mulberry32 initialisé par une
 *     graine dérivée de la chaîne fournie. Aucun recours à Math.random() : un
 *     résultat qui change à chaque exécution n'est pas auditable.
 *   - Lois supportées : fixe, uniforme, triangulaire, normale (tronquée aux bornes
 *     si elles sont fournies), log-normale, PERT. Chaque loi est paramétrée dans
 *     l'unité du paramètre, jamais dans un rescalage caché.
 *   - Corrélations : copule gaussienne avec décomposition de Cholesky. Une matrice
 *     non définie positive est REFUSÉE (message explicite) au lieu d'être corrigée
 *     en silence : « énergie 0,9, carbone 0,9 et énergie/carbone −0,9 » est une
 *     hypothèse incohérente, et un résultat obtenu malgré tout serait faux.
 *   - PERT : échantillonnée par son approximation bêta standard
 *     (a = 1 + 4·(mode−min)/(max−min), b = 1 + 4·(max−mode)/(max−min)), ce qui est
 *     écrit dans le rapport. Ce n'est pas la loi bêta-pert exacte : c'est dit.
 *   - Aucune troncature silencieuse : une normale tronquée est signalée dans le
 *     rapport, avec ses bornes.
 */

import { Project, SupplierOffer } from '../types/domain';
import { BuildOptions, TCOEngine, TCO_ENGINE_VERSION } from './tcoEngine';

export const RISK_METHODOLOGY_VERSION = '2026.1-monte-carlo';

/** Paramètres économiques qui peuvent être tirés. Liste fermée et explicite. */
export const SIMULATION_PARAMETERS = [
  'discountRate',
  'energyInflationRate',
  'inflationRate',
  'carbonPricePerTonne',
  'failureRateMultiplier',
  'horizonYears',
] as const;

export type SimulationParameter = (typeof SIMULATION_PARAMETERS)[number];

export const PARAMETER_LABELS: Record<SimulationParameter, { label: string; unit: string; note: string }> = {
  discountRate: {
    label: 'Taux d’actualisation',
    unit: 'fraction (0,05 = 5 %)',
    note: 'Représente le coût du capital de l’organisation. Il conditionne le poids des coûts futurs.',
  },
  energyInflationRate: {
    label: 'Inflation de l’énergie',
    unit: 'fraction (0,04 = 4 %)',
    note: 'S’applique aux postes d’énergie et de consommables indexés sur l’énergie.',
  },
  inflationRate: {
    label: 'Inflation générale',
    unit: 'fraction (0,02 = 2 %)',
    note: 'S’applique aux autres postes récurrents.',
  },
  carbonPricePerTonne: {
    label: 'Prix du carbone',
    unit: '€ par tonne de CO₂e',
    note: 'Valorisation interne de la tonne évitée. Une valeur réglementaire doit être sourcée et datée.',
  },
  failureRateMultiplier: {
    label: 'Multiplicateur du taux de panne',
    unit: 'facteur (1 = hypothèse centrale)',
    note: 'Décale la fréquence des défaillances attendues sur la durée de vie.',
  },
  horizonYears: {
    label: 'Horizon d’analyse',
    unit: 'années (entier)',
    note: 'Durée de détention retenue. La comparer aux durées de vie évite un biais d’usage.',
  },
};

export type DistributionKind = 'fixed' | 'uniform' | 'triangular' | 'normal' | 'lognormal' | 'pert';

export interface VariableSpec {
  parameter: SimulationParameter;
  distribution: DistributionKind;
  /** Bornes (uniforme, triangulaire, PERT) ou bornes de troncature (normale, log-normale). */
  min?: number | null;
  max?: number | null;
  /** Mode (triangulaire, PERT). */
  mode?: number | null;
  /** Moyenne et écart-type (normale, log-normale) dans l'unité du paramètre. */
  mean?: number | null;
  stdDev?: number | null;
  /** Origine de la spécification, pour la traçabilité du rapport. */
  source?: string | null;
}

export interface CorrelationSpec {
  between: [SimulationParameter, SimulationParameter];
  /** Coefficient de corrélation de rang visé, dans ]−1 ; 1[. */
  rho: number;
}

export interface SimulationInput {
  variables: VariableSpec[];
  correlations?: CorrelationSpec[];
  /** Nombre de tirages. Borné : 200 minimum, 20 000 maximum. */
  iterations?: number;
  /** Graine : identique ⇒ résultat identique. Obligatoire. */
  seed: string | number;
  /** Offre de référence (celle qui gagne au scénario central). */
  winnerOfferId: string;
  /** Offre challenger comparée. */
  challengerOfferId: string;
}

export interface DistributionSummary {
  parameter: SimulationParameter;
  label: string;
  unit: string;
  distribution: DistributionKind;
  /** Paramètres de la loi tels qu'utilisés, dans l'unité du paramètre. */
  parameters: Record<string, number | null>;
  /** Valeur au scénario central, pour comparaison. */
  centralValue: number;
  /** Moyenne effectivement tirée, et écart-type tiré (contrôle de cohérence). */
  sampledMean: number;
  sampledStdDev: number;
  sampledMin: number;
  sampledMax: number;
  source: string | null;
  note: string;
}

export interface Quantiles {
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  mean: number;
  stdDev: number;
}

export interface OfferDistribution {
  offerId: string;
  offerReference: string;
  supplierName: string;
  /** VAN du coût complet (positif = coût), quantiles simulés. */
  npv: Quantiles;
  /** Probabilité simulée que cette offre soit la moins coûteuse des deux comparées. */
  probabilityCheapest: number;
}

export interface RiskSimulationResult {
  engineVersion: string;
  methodologyVersion: string;
  seedUsed: string;
  iterations: number;
  converged: boolean;
  /** Erreur standard de la moyenne de l'écart : contrôle du bruit de simulation. */
  standardError: number;
  correlationMatrix: { parameters: SimulationParameter[]; matrix: number[][]; note: string };
  distributions: DistributionSummary[];
  winner: OfferDistribution;
  challenger: OfferDistribution;
  /** Écart de VAN : challenger − gagnant, au scénario central et simulé. */
  delta: Quantiles & { centralValue: number; signConvention: string };
  /** Probabilité simulée que le challenger devienne moins coûteux que le gagnant. */
  probabilityDecisionReverses: number;
  /** Fréquence observée des tirages où l'écart change de signe, par dixième de P10–P90. */
  histogram: { binStart: number; binEnd: number; count: number; share: number }[];
  /** Explications lisibles, générées à partir des chiffres — jamais l'inverse. */
  reading: string[];
  warnings: string[];
  assumptionsUsed: Record<string, number>;
  computedAt: string;
}

export class SimulationInputError extends Error {
  constructor(
    message: string,
    public readonly code: string
  ) {
    super(message);
    this.name = 'SimulationInputError';
  }
}

// -----------------------------------------------------------------------------
// Générateur reproductible
// -----------------------------------------------------------------------------
/** Hachage xmur3 : transforme une graine textuelle en graine numérique stable. */
function seedFromString(text: string): number {
  let h = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index += 1) {
    h = Math.imul(h ^ text.charCodeAt(index), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/** Générateur mulberry32 : petit, rapide, reproductible, sans dépendance. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Loi normale centrée réduite (Box-Muller), consommation déterministe. */
function makeStandardNormal(random: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = random() * 2 - 1;
      v = random() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const factor = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * factor;
    return u * factor;
  };
}

/** Fonction de répartition de la loi normale centrée réduite (approximation d'Abramowitz-Stegun). */
function standardNormalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pdf = Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * poly;
  return z >= 0 ? cdf : 1 - cdf;
}

// -----------------------------------------------------------------------------
// Tirage des lois
// -----------------------------------------------------------------------------
function sampleTriangular(u: number, min: number, mode: number, max: number): number {
  if (max <= min) return min;
  const c = (mode - min) / (max - min);
  if (u < c) return min + Math.sqrt(u * (max - min) * (mode - min));
  return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
}

/** Échantillonnage gamma (Marsaglia-Tsang) pour la loi bêta du PERT. */
function sampleGamma(shape: number, standardNormal: () => number): number {
  if (shape < 1) {
    // Relation d'échelle : Gamma(a) = Gamma(a+1) · U^(1/a)
    const u = standardNormalCdf(standardNormal());
    return sampleGamma(shape + 1, standardNormal) * Math.pow(Math.max(u, 1e-12), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let x = 0;
    let v = 0;
    do {
      x = standardNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(standardNormalCdf(standardNormal()), 1e-12);
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v;
    }
  }
  // Repli documenté : si la boucle ne converge pas (probabilité négligeable avec
  // un générateur correct), on rend la moyenne de la loi plutôt qu'une valeur
  // aberrante — et le rapport signale que ce repli existe.
  return d;
}

function samplePert(min: number, mode: number, max: number, standardNormal: () => number): number {
  if (max <= min) return min;
  const a = 1 + (4 * (mode - min)) / (max - min);
  const b = 1 + (4 * (max - mode)) / (max - min);
  const x = sampleGamma(a, standardNormal);
  const y = sampleGamma(b, standardNormal);
  const beta = x / (x + y);
  return min + beta * (max - min);
}

/**
 * Tire une valeur selon la loi déclarée.
 * `z` est une valeur normale centrée réduite (déjà corrélée si nécessaire).
 */
function sampleVariable(
  spec: VariableSpec,
  z: number,
  standardNormal: () => number
): { value: number; note: string } {
  const uniform = Math.min(1 - 1e-12, Math.max(1e-12, standardNormalCdf(z)));
  const min = spec.min ?? null;
  const max = spec.max ?? null;
  const mode = spec.mode ?? null;
  const mean = spec.mean ?? null;
  const stdDev = spec.stdDev ?? null;

  // L'horizon se compte en ANNÉES ENTIÈRES : l'arrondi est fait ici, à la source,
  // pour que le rapport décrive exactement la valeur qui a servi au calcul. Un
  // rapport qui afficherait « 5,43 années » alors que le moteur a calculé sur 5
  // serait un écart silencieux entre ce qui est montré et ce qui est fait.
  const finish = (value: number, note: string): { value: number; note: string } =>
    spec.parameter === 'horizonYears'
      ? { value: Math.max(1, Math.round(value)), note: `${note} Arrondie à l’année entière : ${Math.max(1, Math.round(value))}.` }
      : { value, note };

  switch (spec.distribution) {
    case 'fixed': {
      const value = mean ?? mode ?? min ?? 0;
      return finish(value, 'Paramètre fixé : aucune variabilité simulée.');
    }
    case 'uniform': {
      if (min === null || max === null) {
        throw new SimulationInputError(
          `Loi uniforme pour « ${spec.parameter} » : les bornes minimum ET maximum sont obligatoires.`,
          'MISSING_BOUNDS'
        );
      }
      if (max < min) {
        throw new SimulationInputError(
          `Loi uniforme pour « ${spec.parameter} » : le maximum (${max}) est inférieur au minimum (${min}).`,
          'INVALID_BOUNDS'
        );
      }
      return finish(min + uniform * (max - min), `Uniforme entre ${min} et ${max}.`);
    }
    case 'triangular': {
      if (min === null || max === null || mode === null) {
        throw new SimulationInputError(
          `Loi triangulaire pour « ${spec.parameter} » : minimum, mode et maximum sont obligatoires.`,
          'MISSING_BOUNDS'
        );
      }
      if (!(min <= mode && mode <= max)) {
        throw new SimulationInputError(
          `Loi triangulaire pour « ${spec.parameter} » : le mode (${mode}) doit être compris entre ${min} et ${max}.`,
          'INVALID_BOUNDS'
        );
      }
      return finish(
        sampleTriangular(uniform, min, mode, max),
        `Triangulaire (min ${min}, mode ${mode}, max ${max}).`
      );
    }
    case 'normal': {
      if (mean === null || stdDev === null) {
        throw new SimulationInputError(
          `Loi normale pour « ${spec.parameter} » : la moyenne et l’écart-type sont obligatoires.`,
          'MISSING_PARAMETERS'
        );
      }
      if (stdDev < 0) {
        throw new SimulationInputError(
          `Loi normale pour « ${spec.parameter} » : l’écart-type ne peut pas être négatif (${stdDev}).`,
          'INVALID_PARAMETERS'
        );
      }
      let value = mean + stdDev * z;
      let note = `Normale (moyenne ${mean}, écart-type ${stdDev}).`;
      if (min !== null || max !== null) {
        const lower = min ?? Number.NEGATIVE_INFINITY;
        const upper = max ?? Number.POSITIVE_INFINITY;
        const clamped = Math.min(Math.max(value, lower), upper);
        if (clamped !== value) {
          note += ` Tronquée aux bornes [${lower === -Infinity ? '−∞' : lower} ; ${upper === Infinity ? '+∞' : upper}] : ${value.toFixed(6)} ramené à ${clamped.toFixed(6)}.`;
          value = clamped;
        } else {
          note += ` Bornes de troncature [${lower === -Infinity ? '−∞' : lower} ; ${upper === Infinity ? '+∞' : upper}].`;
        }
      }
      return finish(value, note);
    }
    case 'lognormal': {
      if (mean === null || stdDev === null) {
        throw new SimulationInputError(
          `Loi log-normale pour « ${spec.parameter} » : la moyenne et l’écart-type (dans l’unité du paramètre) sont obligatoires.`,
          'MISSING_PARAMETERS'
        );
      }
      if (mean <= 0) {
        throw new SimulationInputError(
          `Loi log-normale pour « ${spec.parameter} » : la moyenne doit être strictement positive (${mean}). ` +
            'Une log-normale ne peut pas décrire une valeur négative : choisissez une loi normale si le paramètre peut changer de signe.',
          'INVALID_PARAMETERS'
        );
      }
      const varianceRatio = (stdDev * stdDev) / (mean * mean);
      const sigma = Math.sqrt(Math.log(1 + varianceRatio));
      // sigma = 0 (écart-type nul) : la log-normale dégénère, on le dit.
      if (sigma === 0) {
        return finish(mean, 'Log-normale dégénérée (écart-type nul) : valeur constante égale à la moyenne.');
      }
      const mu = Math.log(mean) - (sigma * sigma) / 2;
      let value = Math.exp(mu + sigma * z);
      let note = `Log-normale (moyenne ${mean}, écart-type ${stdDev} → mu ${mu.toFixed(6)}, sigma ${sigma.toFixed(6)}).`;
      if (min !== null || max !== null) {
        const lower = min ?? Number.NEGATIVE_INFINITY;
        const upper = max ?? Number.POSITIVE_INFINITY;
        const clamped = Math.min(Math.max(value, lower), upper);
        if (clamped !== value) {
          note += ` Tronquée aux bornes [${lower} ; ${upper}].`;
          value = clamped;
        }
      }
      return finish(value, note);
    }
    case 'pert': {
      if (min === null || max === null || mode === null) {
        throw new SimulationInputError(
          `Loi PERT pour « ${spec.parameter} » : minimum, mode et maximum sont obligatoires.`,
          'MISSING_BOUNDS'
        );
      }
      if (!(min <= mode && mode <= max)) {
        throw new SimulationInputError(
          `Loi PERT pour « ${spec.parameter} » : le mode (${mode}) doit être compris entre ${min} et ${max}.`,
          'INVALID_BOUNDS'
        );
      }
      return finish(
        samplePert(min, mode, max, standardNormal),
        `PERT (min ${min}, mode ${mode}, max ${max}), échantillonnée par son approximation bêta standard.`
      );
    }
    default:
      throw new SimulationInputError(
        `Loi inconnue « ${String(spec.distribution)} » pour « ${spec.parameter} ». Lois acceptées : fixed, uniform, triangular, normal, lognormal, pert.`,
        'UNKNOWN_DISTRIBUTION'
      );
  }
}

// -----------------------------------------------------------------------------
// Corrélations
// -----------------------------------------------------------------------------
/**
 * Construit la matrice de corrélation demandée et sa décomposition de Cholesky.
 * Une matrice non définie positive est refusée : le produit ne « répare » pas une
 * hypothèse incohérente en silence, car le résultat serait présenté comme valide.
 */
function cholesky(matrix: number[][]): number[][] {
  const size = matrix.length;
  const lower: number[][] = Array.from({ length: size }, () => new Array(size).fill(0));
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= lower[i][k] * lower[j][k];
      if (i === j) {
        if (sum <= 0) {
          throw new SimulationInputError(
            `Matrice de corrélation incohérente : la décomposition de Cholesky échoue sur la ${i + 1}ᵉ variable ` +
              `(valeur ${sum.toFixed(6)} ≤ 0). Des corrélations déclarées se contredisent — par exemple « énergie » et ` +
              '« carbone » fortement liés tous les deux au même troisième paramètre avec des signes opposés. ' +
              'Corrigez les coefficients : le produit ne modifie jamais une hypothèse à votre place.',
            'CORRELATION_MATRIX_NOT_POSITIVE_DEFINITE'
          );
        }
        lower[i][j] = Math.sqrt(sum);
      } else {
        lower[i][j] = sum / lower[j][j];
      }
    }
  }
  return lower;
}

function buildCorrelationMatrix(variables: VariableSpec[], correlations: CorrelationSpec[]): number[][] {
  const names = variables.map((variable) => variable.parameter);
  const size = names.length;
  const matrix: number[][] = Array.from({ length: size }, (_, i) =>
    Array.from({ length: size }, (_, j) => (i === j ? 1 : 0))
  );
  for (const correlation of correlations) {
    const [first, second] = correlation.between;
    const i = names.indexOf(first);
    const j = names.indexOf(second);
    if (i === -1 || j === -1) {
      throw new SimulationInputError(
        `Corrélation déclarée entre « ${first} » et « ${second} » alors qu’une des deux variables n’est pas simulée. ` +
          'Une corrélation ne peut concerner que des paramètres effectivement tirés.',
        'CORRELATION_UNKNOWN_PARAMETER'
      );
    }
    if (i === j) {
      throw new SimulationInputError(
        `Corrélation déclarée d’un paramètre avec lui-même (« ${first} ») : le coefficient vaudrait 1 par définition.`,
        'CORRELATION_SELF'
      );
    }
    if (!(correlation.rho > -1 && correlation.rho < 1)) {
      throw new SimulationInputError(
        `Coefficient de corrélation invalide pour « ${first} » / « ${second} » : ${correlation.rho}. ` +
          'La valeur doit être strictement comprise entre −1 et 1.',
        'CORRELATION_OUT_OF_RANGE'
      );
    }
    matrix[i][j] = correlation.rho;
    matrix[j][i] = correlation.rho;
  }
  return matrix;
}

// -----------------------------------------------------------------------------
// Statistiques descriptives
// -----------------------------------------------------------------------------
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function summarize(values: number[]): Quantiles {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  // Tous les tirages identiques ⇒ dispersion exactement nulle.
  //
  // Sans ce test, le calcul laissait un résidu de virgule flottante (2,7e-16 pour
  // des valeurs pourtant rigoureusement égales), et le rapport ne signalait pas
  // qu'aucune variabilité n'avait été déclarée : l'utilisateur pouvait lire des
  // quantiles P10/P50/P90 identiques sans savoir que la simulation n'avait rien
  // exploré. L'égalité est testée sur les valeurs elles-mêmes, pas sur un seuil.
  const allIdentical = sorted.length > 0 && sorted[0] === sorted[sorted.length - 1];
  return {
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean,
    stdDev: allIdentical ? 0 : Math.sqrt(variance),
  };
}

// -----------------------------------------------------------------------------
// Simulation
// -----------------------------------------------------------------------------
export interface SimulationContext {
  project: Project;
  offersById: Map<string, SupplierOffer>;
  /** Valeurs centrales des paramètres utilisées par le dossier, pour comparaison. */
  centralParameters: Record<SimulationParameter, number>;
}

const MIN_ITERATIONS = 200;
const MAX_ITERATIONS = 20_000;
const DEFAULT_ITERATIONS = 2_000;

/**
 * Lance la simulation et renvoie un rapport complet et lisible.
 * Fonction PURE : elle ne modifie ni le projet ni les offres.
 */
export function simulateDecision(
  context: SimulationContext,
  input: SimulationInput
): RiskSimulationResult {
  if (!input.seed && input.seed !== 0) {
    throw new SimulationInputError(
      'Une graine est obligatoire : sans elle, les résultats changeraient à chaque exécution et ne seraient pas auditables.',
      'SEED_REQUIRED'
    );
  }
  if (!Array.isArray(input.variables) || input.variables.length === 0) {
    throw new SimulationInputError(
      'Aucune variable à simuler : déclarez au moins un paramètre incertain, ou renoncez à la simulation ' +
        '(elle n’invente pas de variabilité à votre place).',
      'NO_VARIABLES'
    );
  }
  const winners = context.offersById.get(input.winnerOfferId);
  const challengers = context.offersById.get(input.challengerOfferId);
  if (!winners || !challengers) {
    throw new SimulationInputError(
      'Les deux offres comparées doivent appartenir au dossier : offre gagnante ou challenger introuvable.',
      'OFFERS_NOT_FOUND'
    );
  }
  if (input.winnerOfferId === input.challengerOfferId) {
    throw new SimulationInputError(
      'Les deux offres comparées sont identiques : il n’y a aucun écart à analyser.',
      'SAME_OFFERS'
    );
  }

  const iterations = Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.round(input.iterations ?? DEFAULT_ITERATIONS)));
  if (input.iterations !== undefined && (input.iterations < MIN_ITERATIONS || input.iterations > MAX_ITERATIONS)) {
    // Pas de refus, mais l'ajustement est DIT dans le rapport (warnings).
  }

  const variables = [...input.variables];
  const correlationMatrix = buildCorrelationMatrix(variables, input.correlations ?? []);
  const lower = cholesky(correlationMatrix);

  const random = createRandom(seedFromString(String(input.seed)));
  const standardNormal = makeStandardNormal(random);

  const deltaValues: number[] = [];
  const winnerValues: number[] = [];
  const challengerValues: number[] = [];
  const parameterSamples: Record<string, number[]> = {};
  for (const variable of variables) parameterSamples[variable.parameter] = [];

  const warnings: string[] = [];
  const notes = new Map<SimulationParameter, string>();
  let reversalCount = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    // Tirages normaux indépendants, puis corrélés par Cholesky (copule gaussienne).
    const independent = variables.map(() => standardNormal());
    const correlated = new Array(variables.length).fill(0);
    for (let i = 0; i < variables.length; i += 1) {
      let sum = 0;
      for (let j = 0; j <= i; j += 1) sum += lower[i][j] * independent[j];
      correlated[i] = sum;
    }

    const overrides: BuildOptions = {};
    for (let index = 0; index < variables.length; index += 1) {
      const variable = variables[index];
      const { value, note } = sampleVariable(variable, correlated[index], standardNormal);
      notes.set(variable.parameter, note);
      parameterSamples[variable.parameter].push(value);
      switch (variable.parameter) {
        case 'discountRate':
          overrides.discountRate = value;
          break;
        case 'energyInflationRate':
          overrides.energyInflationRate = value;
          break;
        case 'inflationRate':
          overrides.inflationRate = value;
          break;
        case 'carbonPricePerTonne':
          overrides.carbonPricePerTonne = value;
          break;
        case 'failureRateMultiplier':
          overrides.failureRateMultiplier = value;
          break;
        case 'horizonYears':
          overrides.horizonYears = Math.max(1, Math.round(value));
          break;
        default:
          break;
      }
    }

    const winnerResult = TCOEngine.calculateOfferTCO(context.project, winners, overrides);
    const challengerResult = TCOEngine.calculateOfferTCO(context.project, challengers, overrides);
    const winnerNpv = winnerResult.lifecycleCostLCC;
    const challengerNpv = challengerResult.lifecycleCostLCC;
    const delta = challengerNpv - winnerNpv;

    winnerValues.push(winnerNpv);
    challengerValues.push(challengerNpv);
    deltaValues.push(delta);
    if (delta < 0) reversalCount += 1;
  }

  // Contrôle du bruit de simulation : sans lui, un utilisateur pourrait lire un
  // P10/P90 comme une propriété du dossier alors qu'il mesure en partie le hasard
  // du tirage. L'erreur standard de la moyenne de l'écart est donc publiée.
  const deltaSummary = summarize(deltaValues);
  const standardError = deltaSummary.stdDev / Math.sqrt(iterations);

  const distributions: DistributionSummary[] = variables.map((variable) => {
    const samples = parameterSamples[variable.parameter];
    const summary = summarize(samples);
    const meta = PARAMETER_LABELS[variable.parameter];
    return {
      parameter: variable.parameter,
      label: meta.label,
      unit: meta.unit,
      distribution: variable.distribution,
      parameters: {
        min: variable.min ?? null,
        max: variable.max ?? null,
        mode: variable.mode ?? null,
        mean: variable.mean ?? null,
        stdDev: variable.stdDev ?? null,
      },
      centralValue: context.centralParameters[variable.parameter],
      sampledMean: summary.mean,
      sampledStdDev: summary.stdDev,
      sampledMin: summary.min,
      sampledMax: summary.max,
      source: variable.source ?? null,
      note: notes.get(variable.parameter) ?? meta.note,
    };
  });

  // Détection d'une variable sans variabilité RÉELLE. Le seuil est RELATIF à
  // l'échelle du paramètre : une dispersion de 1e-12 sur un taux d'actualisation
  // n'est pas une incertitude, c'est du bruit de calcul.
  const constantVariables = distributions.filter((distribution) => {
    const scale = Math.max(1e-12, Math.abs(distribution.centralValue));
    return distribution.sampledStdDev <= scale * 1e-9;
  });
  if (constantVariables.length === distributions.length) {
    warnings.push(
      'Aucune variabilité n’a été déclarée : tous les tirages donnent exactement le même résultat. ' +
        'Les quantiles P10/P50/P90 sont donc égaux — ce n’est pas une absence de risque, c’est une absence d’hypothèses incertaines.'
    );
  } else if (constantVariables.length > 0) {
    warnings.push(
      `Paramètre(s) sans variabilité déclarée : ${constantVariables.map((entry) => entry.label).join(', ')}. ` +
        'Leur incertitude n’est pas représentée dans la dispersion affichée.'
    );
  }
  if (input.iterations !== undefined && iterations !== input.iterations) {
    warnings.push(
      `Nombre de tirages ajusté de ${input.iterations} à ${iterations} (bornes acceptées : ${MIN_ITERATIONS} à ${MAX_ITERATIONS}).`
    );
  }
  const excludedSources = distributions.filter((distribution) => !distribution.source);
  if (excludedSources.length > 0) {
    warnings.push(
      `Aucune source déclarée pour : ${excludedSources.map((entry) => entry.label).join(', ')}. ` +
        'Une dispersion non sourcée reste une hypothèse de travail, pas une donnée établie.'
    );
  }

  const lowerBound = deltaSummary.p10;
  const upperBound = deltaSummary.p90;
  const binCount = 10;
  const span = upperBound - lowerBound;
  const histogram =
    span <= 0
      ? [{ binStart: lowerBound, binEnd: upperBound, count: deltaValues.length, share: 1 }]
      : Array.from({ length: binCount }, (_, index) => {
          const binStart = lowerBound + (span * index) / binCount;
          const binEnd = binStart + span / binCount;
          const count = deltaValues.filter((value) =>
            index === binCount - 1 ? value >= binStart && value <= binEnd : value >= binStart && value < binEnd
          ).length;
          return { binStart, binEnd, count, share: count / deltaValues.length };
        });

  // Seuil de décision du produit : le classement tient un écart inférieur à 0,5 % de
  // la VAN du gagnant pour non significatif. La probabilité « moins chère » et la
  // probabilité « significativement moins chère » sont donc publiées séparément :
  // confondre les deux ferait passer un écart négligeable pour une inversion.
  const significanceThreshold = Math.max(1, Math.abs(percentile([...winnerValues].sort((a, b) => a - b), 0.5)) * 0.005);
  const significantReversalCount = deltaValues.filter((value) => value < -significanceThreshold).length;

  const reversalProbability = reversalCount / iterations;
  const significantReversalProbability = significantReversalCount / iterations;

  const reading: string[] = [];
  reading.push(
    `Sur ${iterations.toLocaleString('fr-FR')} tirages, l'écart de VAN entre « ${challengers.supplierName} » et ` +
      `« ${winners.supplierName} » (challenger − gagnant, VAN du coût complet) a pour médiane ` +
      `${formatEuro(deltaSummary.p50)} — positif, donc le challenger reste plus cher dans la moitié des cas.`
  );
  reading.push(
    `Écart aux bornes de la distribution simulée : ${formatEuro(deltaSummary.p10)} (P10) à ${formatEuro(deltaSummary.p90)} (P90). ` +
      'Ces quantiles décrivent la dispersion SIMULÉE sous les hypothèses listées ci-dessus : ce ne sont pas des ' +
      'bornes d’un intervalle de confiance statistique, faute d’échantillon réel et de loi ajustée sur des données.'
  );
  reading.push(
    `Probabilité simulée que le challenger devienne strictement moins coûteux : ${(reversalProbability * 100).toFixed(1)} %. ` +
      `En retenant le seuil de significativité du produit (${formatEuro(significanceThreshold)}, soit 0,5 % de la VAN du gagnant), ` +
      `cette probabilité tombe à ${(significantReversalProbability * 100).toFixed(1)} %.`
  );
  reading.push(
    `Bruit de simulation : erreur standard de la moyenne de l'écart = ${formatEuro(standardError)} ` +
      `(${((standardError / Math.max(1, Math.abs(deltaSummary.p50))) * 100).toFixed(3)} % de la médiane de l'écart). ` +
      'Un écart inférieur à cette valeur est indiscernable du hasard du tirage.'
  );
  reading.push(`Dispersion la plus large, rapportée à sa valeur centrale : ${dominantDriver(distributions, variables)}`);

  const converged = standardError <= Math.max(1, Math.abs(deltaSummary.p50) * 0.02);

  return {
    engineVersion: TCO_ENGINE_VERSION,
    methodologyVersion: RISK_METHODOLOGY_VERSION,
    seedUsed: String(input.seed),
    iterations,
    converged,
    standardError,
    correlationMatrix: {
      parameters: variables.map((variable) => variable.parameter),
      matrix: correlationMatrix,
      note:
        (input.correlations ?? []).length === 0
          ? 'Aucune corrélation déclarée : les paramètres sont tirés indépendamment. Si deux paramètres dépendent d’une même cause (par exemple l’énergie et le prix du carbone), ne pas la déclarer revient à supposer leur indépendance — c’est un choix, et il est écrit ici.'
          : 'Copule gaussienne : chaque paramètre est tiré via une loi normale corrélée (décomposition de Cholesky), puis transformé par sa propre loi marginale.',
    },
    distributions,
    winner: {
      offerId: winners.id,
      offerReference: winners.offerReference,
      supplierName: winners.supplierName,
      npv: summarize(winnerValues),
      probabilityCheapest: deltaValues.filter((value) => value >= 0).length / iterations,
    },
    challenger: {
      offerId: challengers.id,
      offerReference: challengers.offerReference,
      supplierName: challengers.supplierName,
      npv: summarize(challengerValues),
      probabilityCheapest: deltaValues.filter((value) => value < 0).length / iterations,
    },
    delta: {
      ...deltaSummary,
      centralValue:
        TCOEngine.calculateOfferTCO(context.project, challengers).lifecycleCostLCC -
        TCOEngine.calculateOfferTCO(context.project, winners).lifecycleCostLCC,
      signConvention:
        'delta = VAN(challenger) − VAN(gagnant) : un delta NÉGATIF signifie que le challenger devient MOINS coûteux, donc que la décision s’inverse.',
    },
    probabilityDecisionReverses: reversalProbability,
    histogram,
    reading,
    warnings,
    assumptionsUsed: { ...context.centralParameters },
    computedAt: new Date().toISOString(),
  };
}

/**
 * Variable à la dispersion relative la plus large.
 * Mesure simple et DITE telle quelle : dispersion déclarée rapportée à la valeur
 * centrale du paramètre. Ce n'est pas une analyse de sensibilité causale — celle-ci
 * est produite par le moteur principal (`calculateSensitivity`) et par l'analyse
 * d'inversion de décision, qui recalculent réellement le classement.
 */
function dominantDriver(distributions: DistributionSummary[], variables: VariableSpec[]): string {
  if (distributions.length === 0) return 'aucune variable déclarée.';
  const spread = distributions
    .map((distribution) => {
      const variable = variables.find((candidate) => candidate.parameter === distribution.parameter);
      const relativeSpread =
        Math.abs(distribution.centralValue) > 0
          ? Math.abs(distribution.sampledStdDev / distribution.centralValue)
          : distribution.sampledStdDev > 0
            ? Number.POSITIVE_INFINITY
            : 0;
      return { label: distribution.label, relativeSpread, distribution, variable };
    })
    .sort((a, b) => b.relativeSpread - a.relativeSpread);
  const top = spread[0];
  return (
    `${top.label} (dispersion relative ${Number.isFinite(top.relativeSpread) ? `${(top.relativeSpread * 100).toFixed(1)} %` : 'non bornée'}), ` +
    `loi ${top.distribution.distribution}${top.variable?.source ? `, source « ${top.variable.source} »` : ', sans source déclarée'}. ` +
    'Il s’agit d’un classement des dispersions déclarées, pas d’une analyse de sensibilité causale.'
  );
}

function formatEuro(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR')} €`;
}
