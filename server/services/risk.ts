/**
 * TrueTCO — Service des simulations probabilistes du risque (Phase 3)
 * ---------------------------------------------------------------------------
 * Chaîne : validation des hypothèses → chargement du dossier (contexte RLS) →
 * simulation par la bibliothèque pure `src/engine/riskSimulation.ts` → écriture
 * de la preuve de calcul → entrée d'audit.
 *
 * Ce que ce service refuse de faire :
 *   - simuler sans graine : un résultat non reproductible n'est pas auditable ;
 *   - inventer une dispersion : si l'utilisateur n'a déclaré aucune incertitude,
 *     le rapport le dit au lieu de fabriquer de la variabilité ;
 *   - « réparer » une matrice de corrélations incohérente : elle est rejetée avec
 *     l'explication du conflit ;
 *   - comparer autre chose que deux offres du dossier (aucune fuite possible vers
 *     une autre organisation : le chargement passe par le contexte RLS).
 */

import { HttpError } from '../http';
import { Db, Executor } from '../db/types';
import { AuthContext } from '../auth/types';
import { recordAudit } from '../audit';
import {
  CorrelationSpec,
  SIMULATION_PARAMETERS,
  SimulationContext,
  SimulationInput,
  SimulationInputError,
  SimulationParameter,
  VariableSpec,
  simulateDecision,
} from '../../src/engine/riskSimulation';
import { TCO_ENGINE_VERSION } from '../../src/engine/tcoEngine';
import { mapOffer, mapProject } from '../../src/engine/mapping';
import { loadProjectInputs, fingerprintInputs, RequestMeta } from './decision';

export interface RiskSimulationRequest {
  winnerOfferId: string;
  challengerOfferId: string;
  seed?: string | number | null;
  iterations?: number | null;
  variables: unknown;
  correlations?: unknown;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badInput(message: string, code: string, details?: Record<string, unknown>): never {
  throw new HttpError(400, code, message, details);
}

/** Valide la liste des variables simulées transmise par l'appelant. */
export function parseVariables(raw: unknown): VariableSpec[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    badInput(
      'Aucune variable à simuler : déclarez au moins un paramètre incertain. Le produit ne crée pas d’incertitude à votre place.',
      'NO_VARIABLES'
    );
  }
  if (raw.length > SIMULATION_PARAMETERS.length) {
    badInput(
      `Trop de variables déclarées (${raw.length}). Paramètres simulables : ${SIMULATION_PARAMETERS.join(', ')}.`,
      'TOO_MANY_VARIABLES'
    );
  }

  const seen = new Set<string>();
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      badInput(`variables[${index}] doit être un objet décrivant le paramètre, sa loi et ses paramètres.`, 'INVALID_VARIABLE');
    }
    const candidate = entry as Record<string, unknown>;
    const parameter = String(candidate.parameter ?? '');
    if (!(SIMULATION_PARAMETERS as readonly string[]).includes(parameter)) {
      badInput(
        `Paramètre inconnu « ${parameter} » (variables[${index}]). Paramètres simulables : ${SIMULATION_PARAMETERS.join(', ')}.`,
        'UNKNOWN_PARAMETER'
      );
    }
    if (seen.has(parameter)) {
      badInput(
        `Le paramètre « ${parameter} » est déclaré deux fois : une variable ne peut porter qu’une loi.`,
        'DUPLICATE_PARAMETER'
      );
    }
    seen.add(parameter);

    const distribution = String(candidate.distribution ?? '');
    const numberOrNull = (value: unknown, field: string): number | null => {
      if (value === undefined || value === null || value === '') return null;
      const parsed = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(parsed)) {
        badInput(`variables[${index}].${field} n’est pas un nombre exploitable (« ${String(value)} »).`, 'INVALID_NUMBER');
      }
      return parsed;
    };

    return {
      parameter: parameter as SimulationParameter,
      distribution: distribution as VariableSpec['distribution'],
      min: numberOrNull(candidate.min, 'min'),
      max: numberOrNull(candidate.max, 'max'),
      mode: numberOrNull(candidate.mode, 'mode'),
      mean: numberOrNull(candidate.mean, 'mean'),
      stdDev: numberOrNull(candidate.stdDev, 'stdDev'),
      source:
        candidate.source === undefined || candidate.source === null ? null : String(candidate.source).slice(0, 300),
    };
  });
}

/** Valide les corrélations déclarées. */
export function parseCorrelations(raw: unknown): CorrelationSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    badInput('correlations doit être une liste de paires `{ between: [paramètreA, paramètreB], rho }`.', 'INVALID_CORRELATIONS');
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      badInput(`correlations[${index}] doit être un objet.`, 'INVALID_CORRELATION');
    }
    const candidate = entry as Record<string, unknown>;
    const between = candidate.between;
    if (!Array.isArray(between) || between.length !== 2) {
      badInput(
        `correlations[${index}].between doit contenir exactement deux paramètres simulés, par exemple ["energyInflationRate", "carbonPricePerTonne"].`,
        'INVALID_CORRELATION_PAIR'
      );
    }
    const [first, second] = between.map((value) => String(value));
    for (const parameter of [first, second]) {
      if (!(SIMULATION_PARAMETERS as readonly string[]).includes(parameter)) {
        badInput(
          `Paramètre inconnu « ${parameter} » dans correlations[${index}]. Paramètres simulables : ${SIMULATION_PARAMETERS.join(', ')}.`,
          'UNKNOWN_PARAMETER'
        );
      }
    }
    const rho = typeof candidate.rho === 'number' ? candidate.rho : Number(candidate.rho);
    if (!Number.isFinite(rho)) {
      badInput(`correlations[${index}].rho n’est pas un nombre exploitable.`, 'INVALID_NUMBER');
    }
    return { between: [first as SimulationParameter, second as SimulationParameter], rho };
  });
}

export interface RiskSimulationRunResult {
  simulationId: string;
  projectId: string;
  inputFingerprint: string;
  result: ReturnType<typeof simulateDecision>;
}

/**
 * Exécute une simulation et enregistre sa preuve de calcul.
 * `replayOf` n'est pas utilisé ici : voir `replayRiskSimulation`.
 */
export async function runRiskSimulation(
  db: Db,
  ctx: AuthContext,
  projectId: string,
  request: RiskSimulationRequest,
  meta: RequestMeta
): Promise<RiskSimulationRunResult> {
  if (!UUID_PATTERN.test(request.winnerOfferId ?? '') || !UUID_PATTERN.test(request.challengerOfferId ?? '')) {
    badInput(
      'Les identifiants des deux offres comparées sont obligatoires (offre gagnante au scénario central, et challenger).',
      'OFFER_IDS_REQUIRED'
    );
  }
  if (!request.seed && request.seed !== 0) {
    badInput(
      'Une graine est obligatoire : sans elle, deux exécutions donneraient des chiffres différents et le résultat ne serait pas auditable. ' +
        'Utilisez une valeur stable et documentée (par exemple la référence du dossier et la date de la réunion).',
      'SEED_REQUIRED'
    );
  }

  const variables = parseVariables(request.variables);
  const correlations = parseCorrelations(request.correlations);
  const iterations =
    request.iterations === undefined || request.iterations === null ? undefined : Math.round(Number(request.iterations));
  if (iterations !== undefined && !Number.isFinite(iterations)) {
    badInput('iterations n’est pas un nombre exploitable.', 'INVALID_NUMBER');
  }

  const simulationInput: SimulationInput = {
    variables,
    correlations,
    iterations,
    seed: String(request.seed),
    winnerOfferId: request.winnerOfferId,
    challengerOfferId: request.challengerOfferId,
  };

  return db.asOrganization(ctx.organization.id, async (tx) => {
    const { project: projectRow, offers } = await loadProjectInputs(tx, projectId);
    const mappingContext = {
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
      userName: ctx.user.fullName,
      now: new Date().toISOString(),
    };
    const project = mapProject(projectRow, mappingContext);
    const offersById = new Map(
      offers.map((entry) => {
        const mapped = mapOffer(
          { offer: entry.row, costItems: entry.costItems, carbonItems: entry.carbonItems, riskItems: entry.riskItems },
          mappingContext
        );
        return [entry.row.id, mapped.offer] as const;
      })
    );

    if (!offersById.has(request.winnerOfferId) || !offersById.has(request.challengerOfferId)) {
      throw new HttpError(
        404,
        'OFFER_NOT_IN_PROJECT',
        'Les deux offres comparées doivent appartenir à ce dossier et à votre organisation.'
      );
    }

    const context: SimulationContext = {
      project,
      offersById,
      centralParameters: {
        discountRate: projectRow.discount_rate !== null ? Number(projectRow.discount_rate) : project.discountRate,
        energyInflationRate:
          projectRow.energy_inflation_rate !== null ? Number(projectRow.energy_inflation_rate) : project.energyInflationRate,
        inflationRate: projectRow.general_inflation_rate !== null ? Number(projectRow.general_inflation_rate) : project.inflationRate,
        carbonPricePerTonne:
          projectRow.carbon_price_per_tonne !== null ? Number(projectRow.carbon_price_per_tonne) : project.carbonPricePerTonne,
        failureRateMultiplier: 1,
        horizonYears: projectRow.horizon_years,
      },
    };

    let result: ReturnType<typeof simulateDecision>;
    try {
      result = simulateDecision(context, simulationInput);
    } catch (error) {
      if (error instanceof SimulationInputError) {
        // Les refus de la bibliothèque (loi mal paramétrée, matrice incohérente…)
        // remontent tels quels : ce sont des erreurs d'HYPOTHÈSE, pas des pannes.
        throw new HttpError(400, error.code, error.message);
      }
      throw error;
    }

    const inputFingerprint = fingerprintInputs(projectRow, offers, TCO_ENGINE_VERSION);
    const [inserted] = await tx.query<{ id: string }>(
      `INSERT INTO risk_simulations (
          organization_id, project_id, winner_offer_id, challenger_offer_id,
          engine_version, methodology_version, seed, iterations,
          variable_specs, correlations, central_parameters, results, input_fingerprint,
          computed_at, created_by, is_demo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, CURRENT_TIMESTAMP, $14, $15)
       RETURNING id`,
      [
        ctx.organization.id,
        projectId,
        request.winnerOfferId,
        request.challengerOfferId,
        result.engineVersion,
        result.methodologyVersion,
        result.seedUsed,
        result.iterations,
        JSON.stringify(variables),
        JSON.stringify(correlations),
        JSON.stringify(context.centralParameters),
        JSON.stringify(result),
        inputFingerprint,
        ctx.user.id,
        false,
      ]
    );

    await recordAudit(tx, { id: ctx.user.id, name: ctx.user.fullName, role: ctx.user.role }, ctx.organization.id, {
      action: 'risk.simulation_run',
      entityType: 'risk_simulation',
      entityId: inserted.id,
      projectId,
      newValue: JSON.stringify({
        winnerOfferId: request.winnerOfferId,
        challengerOfferId: request.challengerOfferId,
        seed: result.seedUsed,
        iterations: result.iterations,
        methodologyVersion: result.methodologyVersion,
        medianDelta: Math.round(result.delta.p50),
        probabilityDecisionReverses: Number(result.probabilityDecisionReverses.toFixed(4)),
        declaredVariables: variables.map((variable) => `${variable.parameter}:${variable.distribution}`),
        variablesWithoutSource: result.distributions
          .filter((distribution) => !distribution.source)
          .map((distribution) => distribution.parameter),
      }),
      ...meta,
    });

    return { simulationId: inserted.id, projectId, inputFingerprint, result };
  });
}

/** Liste des simulations d'un dossier (les plus récentes d'abord). */
export async function listRiskSimulations(
  db: Db,
  ctx: AuthContext,
  projectId: string,
  page: { limit: number; offset: number }
) {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const items = await tx.query(
      `SELECT rs.id, rs.project_id, rs.winner_offer_id, rs.challenger_offer_id, rs.engine_version,
              rs.methodology_version, rs.seed, rs.iterations, rs.variable_specs, rs.correlations,
              rs.input_fingerprint, rs.computed_at,
              (rs.results -> 'delta' ->> 'p50') AS median_delta,
              (rs.results ->> 'probabilityDecisionReverses') AS probability_reverses,
              wo.offer_reference AS winner_reference, wo.supplier_name AS winner_supplier,
              co.offer_reference AS challenger_reference, co.supplier_name AS challenger_supplier
         FROM risk_simulations rs
         LEFT JOIN supplier_offers wo ON wo.id = rs.winner_offer_id
         LEFT JOIN supplier_offers co ON co.id = rs.challenger_offer_id
        WHERE rs.project_id = $1
        ORDER BY rs.computed_at DESC
        LIMIT $2 OFFSET $3`,
      [projectId, page.limit, page.offset]
    );
    const [count] = await tx.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM risk_simulations WHERE project_id = $1`,
      [projectId]
    );
    return { items, total: Number(count?.total ?? 0) };
  });
}

/** Détail d'une simulation, avec contrôle de fraîcheur des données du dossier. */
export async function getRiskSimulation(db: Db, ctx: AuthContext, simulationId: string) {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    if (!UUID_PATTERN.test(simulationId)) {
      badInput('Identifiant de simulation invalide.', 'INVALID_SIMULATION_ID');
    }
    const rows = await tx.query<{
      id: string;
      project_id: string;
      winner_offer_id: string;
      challenger_offer_id: string;
      seed: string;
      iterations: number;
      variable_specs: unknown;
      correlations: unknown;
      central_parameters: unknown;
      results: unknown;
      input_fingerprint: string;
      engine_version: string;
      methodology_version: string;
      computed_at: string;
    }>(`SELECT * FROM risk_simulations WHERE id = $1`, [simulationId]);
    if (rows.length === 0) {
      throw new HttpError(404, 'SIMULATION_NOT_FOUND', "Cette simulation est introuvable dans votre organisation.");
    }
    const record = rows[0];
    const { project, offers } = await loadProjectInputs(tx, record.project_id);
    const currentFingerprint = fingerprintInputs(project, offers, TCO_ENGINE_VERSION);
    return {
      ...record,
      freshness: {
        dataChangedSinceSimulation: currentFingerprint !== record.input_fingerprint,
        storedFingerprint: record.input_fingerprint,
        currentFingerprint,
        explanation:
          currentFingerprint === record.input_fingerprint
            ? 'Les données du dossier sont identiques à celles utilisées pour cette simulation.'
            : 'Le dossier a changé depuis cette simulation (montant, source, poste ou hypothèse) : le résultat ne décrit plus l’état actuel. Relancez la simulation avant de vous en servir.',
      },
    };
  });
}

/**
 * Rejeu d'une simulation enregistrée : on reprend la graine, les lois et les
 * corrélations STOCKÉES, on recalcule, et on compare. Un écart signale soit une
 * évolution du dossier, soit une évolution du moteur — dans les deux cas, cela doit
 * se voir au lieu d'être supposé.
 */
export async function replayRiskSimulation(db: Db, ctx: AuthContext, simulationId: string) {
  const stored = await getRiskSimulation(db, ctx, simulationId);
  const request: RiskSimulationRequest = {
    winnerOfferId: stored.winner_offer_id,
    challengerOfferId: stored.challenger_offer_id,
    seed: stored.seed,
    iterations: stored.iterations,
    variables: stored.variable_specs,
    correlations: stored.correlations,
  };

  const replayed = await runRiskSimulation(db, ctx, stored.project_id, request, {
    ipAddress: null,
    userAgent: null,
    correlationId: null,
  });

  const previous = stored.results as { delta?: { p10?: number; p50?: number; p90?: number } };
  const differences: string[] = [];
  if (previous?.delta) {
    for (const key of ['p10', 'p50', 'p90'] as const) {
      const before = previous.delta[key];
      const after = replayed.result.delta[key];
      if (typeof before === 'number' && Math.abs(before - after) > 1e-6) {
        differences.push(`Quantile ${key.toUpperCase()} de l’écart : ${before} → ${after}.`);
      }
    }
  }

  return {
    originalSimulationId: simulationId,
    replaySimulationId: replayed.simulationId,
    identical: differences.length === 0,
    differences,
    dataChangedSinceSimulation: replayed.inputFingerprint !== stored.input_fingerprint,
    explanation:
      differences.length === 0
        ? 'Le rejeu, à partir de la graine et des lois enregistrées, reproduit exactement les mêmes quantiles.'
        : 'Le rejeu ne reproduit pas les mêmes quantiles : soit les données du dossier ont changé, soit le moteur a changé de version. Les deux cas sont distingués ci-dessus.',
    engineVersionStored: stored.engine_version,
    engineVersionReplayed: TCO_ENGINE_VERSION,
    result: replayed.result,
  };
}

/** Compte les simulations d'un dossier (résumé pour l'écran de décision). */
export async function countRiskSimulations(tx: Executor, projectId: string): Promise<number> {
  const [row] = await tx.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM risk_simulations WHERE project_id = $1`,
    [projectId]
  );
  return Number(row?.total ?? 0);
}
