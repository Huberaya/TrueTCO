/**
 * TrueTCO — Service de décision (exécution du moteur côté serveur)
 * ---------------------------------------------------------------------------
 * C'est ici que le produit répond aux quatre questions du cahier des charges :
 *   1. Combien cela coûte      → TCO nominal et LCC (VAN) par offre
 *   2. Pourquoi                → `costLineTrace` par poste + sources + confiance
 *   3. Quelle option est préférable → classement multi-critères (coût, carbone,
 *      risque, qualité de donnée) et avantage économique chiffré
 *   4. Dans quelles hypothèses la décision change → analyse d'inversion
 *      (`analyseDecisionReversal`) + sensibilité + point mort
 *
 * Principes :
 *  - Le moteur est PUR : ce service ne fait que lui fournir des entrées mappées,
 *    puis enregistrer ce qu'il a produit. Aucun résultat n'est retouché.
 *  - Chaque exécution est enregistrée avec ses versions (moteur, méthodologie,
 *    révision des données), une empreinte des entrées et un SNAPSHOT complet des
 *    entrées : un dossier ancien reste rejouable des années plus tard.
 *  - Aucun chiffre n'est calculé par le navigateur pour la décision : le serveur
 *    est la référence, y compris pour l'export et l'audit.
 */

import crypto from 'crypto';
import { Db, Executor } from '../db/types';
import { HttpError, notFound } from '../http';
import { actorFromContext, recordAudit } from '../audit';
import { AuthContext } from '../auth/types';
import { TCO_ENGINE_VERSION, TCO_METHODOLOGY, TCOEngine } from '../../src/engine/tcoEngine';
import { analyseDecisionReversal, ReversalAnalysis } from '../../src/engine/decisionReversal';
import { TCOCalculationResult, BreakEvenAnalysis, SensitivityDriver, SupplierOffer } from '../../src/types/domain';
import { CarbonRow, CostItemRow, MappingContext, OfferRow, ProjectRowInput, RiskRow, mapOffer, mapProject } from '../engine/mapping';

export const METHODOLOGY_VERSION = process.env.TRUETCO_METHODOLOGY_VERSION ?? '2026.1';

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface OfferDecision {
  offerId: string;
  supplierName: string;
  offerReference: string;
  isResponsibleCandidate: boolean;
  /** TCO nominal complet sur l'horizon (€) — économique + risque + carbone. */
  totalComprehensiveTCO: number;
  /** VAN du même périmètre (€) : c'est la métrique de comparaison. */
  lifecycleCostLCC: number;
  economicLCC: number | null;
  unitTCO: number;
  carbonTonnes: number;
  carbonCost: number;
  riskExposure: number;
  dataQualityScore: number;
  costLineCount: number;
  warnings: TCOCalculationResult['warnings'];
}

export interface DecisionRunSummary {
  runId: string;
  projectId: string;
  engineVersion: string;
  methodologyVersion: string;
  inputVersion: number;
  inputFingerprint: string;
  createdAt: string;
  createdBy: string;
  ranking: OfferDecision[];
  recommendation: {
    offerId: string | null;
    supplierName: string | null;
    status: 'ferme' | 'conditionnel' | 'indetermine';
    reason: string;
    economicAdvantage: {
      /** Gain de VAN par rapport à la deuxième meilleure option (€). */
      vsSecondBestNpv: number;
      /** Gain de VAN par rapport à l'option la plus chère (€). */
      vsWorstNpv: number;
      /** Gain ou perte face à l'option « apparemment la moins chère ». */
      vsCheapestApparentNpv: number;
      apparentCheapestOfferId: string | null;
    } | null;
  };
  breakEven: BreakEvenAnalysis | null;
  sensitivity: SensitivityDriver[];
  decisionReversal: ReversalAnalysis | null;
  warnings: string[];
  blockingIssues: { offerId: string; offerReference: string; costItemId: string; label: string; reason: string }[];
  dataCompleteness: {
    totalCostItems: number;
    byQualityStatus: Record<string, number>;
    missingAmountTotal: number;
    unsourcedAmountTotal: number;
    demoItemCount: number;
  };
}

interface LoadedOffer {
  row: OfferRow;
  costItems: CostItemRow[];
  carbonItems: CarbonRow[];
  riskItems: RiskRow[];
}

/** Chargement de toutes les données nécessaires, dans le contexte RLS de l'organisation. */
export async function loadProjectInputs(
  tx: Executor,
  projectId: string
): Promise<{ project: ProjectRowInput; offers: LoadedOffer[] }> {
  const projects = await tx.query<ProjectRowInput>('SELECT * FROM projects WHERE id = $1', [projectId]);
  if (projects.length === 0) {
    throw notFound("Ce dossier est introuvable dans votre organisation.");
  }

  const offers = await tx.query<OfferRow>(
    `SELECT id, project_id, supplier_id, supplier_name, offer_reference, apparent_total, quantity, currency,
            delivery_lead_time_weeks, warranty_months, expected_lifespan_years,
            technical_suitability_score, is_responsible_candidate, is_demo
       FROM supplier_offers WHERE project_id = $1 ORDER BY created_at`,
    [projectId]
  );

  const loaded: LoadedOffer[] = [];
  for (const offer of offers) {
    const costItems = await tx.query<CostItemRow>(
      `SELECT id, category, label, amount, currency, unit, quantity, unit_price, quality_status, source_name,
              source_type, confidence_level, is_recurring_yearly, yearly_inflation_type, year_occurrences,
              calculation_formula, explanation_notes, is_demo
         FROM cost_items WHERE offer_id = $1 ORDER BY category, label`,
      [offer.id]
    );
    const carbonItems = await tx.query<CarbonRow>(
      `SELECT id, scope, lifecycle_phase, total_lifecycle_emissions, emission_factor_source, factor_verified,
              quality_status, confidence_level, is_demo
         FROM carbon_items WHERE offer_id = $1 ORDER BY scope, lifecycle_phase`,
      [offer.id]
    );
    const riskItems = await tx.query<RiskRow>(
      `SELECT id, description, category, probability, financial_impact, probability_type, mitigation_notes,
              confidence_level, is_demo
         FROM risk_items WHERE offer_id = $1 ORDER BY probability DESC`,
      [offer.id]
    );
    loaded.push({ row: offer, costItems, carbonItems, riskItems });
  }

  return { project: projects[0], offers: loaded };
}

/**
 * Empreinte déterministe des entrées réellement utilisées. Deux exécutions sur
 * des données identiques produisent la même empreinte ; toute modification d'un
 * montant, d'une source, d'une hypothèse ou d'un facteur la change.
 */
export function fingerprintInputs(project: ProjectRowInput, offers: LoadedOffer[], engineVersion: string): string {
  const canonical = JSON.stringify({
    engineVersion,
    project: {
      id: project.id,
      horizon: project.horizon_years,
      discountRate: String(project.discount_rate),
      energyInflation: String(project.energy_inflation_rate),
      generalInflation: String(project.general_inflation_rate),
      carbonPrice: String(project.carbon_price_per_tonne),
      currency: project.currency,
    },
    offers: offers.map((offer) => ({
      id: offer.row.id,
      reference: offer.row.offer_reference,
      supplier: offer.row.supplier_name,
      apparentTotal: String(offer.row.apparent_total),
      lifespan: offer.row.expected_lifespan_years,
      responsible: offer.row.is_responsible_candidate,
      costItems: offer.costItems.map((item) => ({
        id: item.id,
        category: item.category,
        amount: String(item.amount),
        quality: item.quality_status,
        source: item.source_name,
        recurring: item.is_recurring_yearly,
        inflation: item.yearly_inflation_type,
        occurrences: item.year_occurrences,
      })),
      carbonItems: offer.carbonItems.map((item) => ({
        id: item.id,
        scope: item.scope,
        tonnes: String(item.total_lifecycle_emissions),
        factorSource: item.emission_factor_source,
        factorVerified: item.factor_verified,
      })),
      riskItems: offer.riskItems.map((item) => ({
        id: item.id,
        probability: String(item.probability),
        impact: String(item.financial_impact),
        type: item.probability_type,
      })),
    })),
  });
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export interface RunContext {
  ctx: AuthContext;
  meta: RequestMeta;
  /** Exécution déclenchée automatiquement (import, recalcul) plutôt que par un utilisateur. */
  trigger?: 'manuel' | 'import' | 'recalcul';
}

/**
 * Exécute la décision pour un dossier : calcule toutes les offres, classe,
 * recommande, analyse le point mort, la sensibilité et l'inversion de décision,
 * puis persiste l'exécution dans la même transaction.
 */
export async function runDecision(
  db: Db,
  projectId: string,
  { ctx, meta, trigger = 'manuel' }: RunContext
): Promise<DecisionRunSummary> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const { project: projectRow, offers: loadedOffers } = await loadProjectInputs(tx, projectId);
    if (loadedOffers.length === 0) {
      throw new HttpError(
        409,
        'NO_OFFER_TO_COMPARE',
        "Aucune offre n'est enregistrée sur ce dossier : il n'y a rien à comparer. Importez ou saisissez au moins une offre fournisseur."
      );
    }

    const mappingCtx: MappingContext = {
      organizationId: ctx.organization.id,
      userId: ctx.user.id,
      userName: ctx.user.fullName,
      now: new Date().toISOString(),
    };

    const project = mapProject(projectRow, mappingCtx);
    const mapped = loadedOffers.map((loaded) => ({ loaded, ...mapOffer({ ...loaded }, mappingCtx) }));

    const blockingIssues = mapped.flatMap((entry) =>
      entry.blocking.map((issue) => ({
        offerId: entry.loaded.row.id,
        offerReference: entry.loaded.row.offer_reference,
        ...issue,
      }))
    );

    // Données reconnues invalides : refuser de produire un chiffre plutôt que
    // d'en produire un faux (règle « aucune donnée inventée »).
    if (blockingIssues.length > 0) {
      throw new HttpError(
        409,
        'DECISION_BLOCKED_INVALID_DATA',
        `Le calcul est bloqué : ${blockingIssues.length} poste(s) de coût sont marqués en erreur. Corrigez-les avant de relancer l'analyse ` +
          '(un montant calculé sur des données reconnues invalides serait trompeur).',
        { blockingIssues }
      );
    }

    const results: { offer: SupplierOffer; result: TCOCalculationResult; warnings: TCOCalculationResult['warnings'] }[] = mapped.map(
      (entry) => ({
        offer: entry.offer,
        result: TCOEngine.calculateOfferTCO(project, entry.offer),
        warnings: entry.warnings,
      })
    );

    // Classement : la métrique de comparaison est la VAN du coût complet.
    // Les données manquantes sont signalées, pas compensées par un montant deviné.
    const ranking: OfferDecision[] = [...results]
      .sort((a, b) => a.result.lifecycleCostLCC - b.result.lifecycleCostLCC)
      .map(({ offer, result, warnings }) => ({
        offerId: offer.id,
        supplierName: offer.supplierName,
        offerReference: offer.offerReference,
        isResponsibleCandidate: offer.isResponsibleCandidate,
        totalComprehensiveTCO: result.totalComprehensiveTCO,
        lifecycleCostLCC: result.lifecycleCostLCC,
        economicLCC: result.economicLCC ?? null,
        unitTCO: result.unitTCO,
        carbonTonnes: result.totalLifecycleCO2eTonnes,
        carbonCost: result.monetizedCarbonTotal,
        riskExposure: result.riskExpositionTotal,
        dataQualityScore: result.dataQualityScore,
        costLineCount: result.costLineTrace?.length ?? 0,
        warnings: [...(result.warnings ?? []), ...(warnings ?? [])],
      }));

    const best = ranking[0];
    const second = ranking[1] ?? null;
    const worst = ranking[ranking.length - 1];

    const apparentCheapest = [...results].sort(
      (a, b) => a.offer.apparentTotal - b.offer.apparentTotal
    )[0];

    const rankingTolerance = Math.max(1, best.lifecycleCostLCC * 0.005); // 0,5 % = écart non significatif
    const hasTie = second !== null && Math.abs(second.lifecycleCostLCC - best.lifecycleCostLCC) <= rankingTolerance;

    const completenessCounts = mapped.reduce<Record<string, number>>((acc, entry) => {
      for (const [status, count] of Object.entries(entry.stats.byQuality)) {
        acc[status] = (acc[status] ?? 0) + count;
      }
      return acc;
    }, {});

    const runWarnings: string[] = [];
    if (completenessCounts.missing) {
      runWarnings.push(
        `${completenessCounts.missing} poste(s) de coût sont marqués « manquant » : ils sont EXCLUS du total. Le coût réel est donc supérieur à celui affiché.`
      );
    }
    if (completenessCounts.unsourced) {
      runWarnings.push(
        `${completenessCounts.unsourced} poste(s) de coût n'ont aucune source documentaire : ils sont conservés mais avec une confiance nulle.`
      );
    }
    if (completenessCounts.demo) {
      runWarnings.push(
        `${completenessCounts.demo} poste(s) proviennent d'un jeu de démonstration : ils ne correspondent à aucune offre fournisseur réelle.`
      );
    }
    if (hasTie) {
      runWarnings.push(
        `Les deux premières offres sont à moins de 0,5 % en VAN (${Math.round(best.lifecycleCostLCC - second!.lifecycleCostLCC)} € d'écart) : ` +
          'le classement n’est pas robuste, la décision doit être arbitrée sur des critères non financiers.'
      );
    }

    const recommendationStatus: 'ferme' | 'conditionnel' | 'indetermine' =
      hasTie || completenessCounts.missing
        ? 'indetermine'
        : completenessCounts.unsourced || completenessCounts.estimated || completenessCounts.demo || best.dataQualityScore < 60
          ? 'conditionnel'
          : 'ferme';

    const recommendationReason =
      recommendationStatus === 'ferme'
        ? `« ${best.supplierName} » présente la VAN de coût complet la plus faible, avec un écart significatif et une qualité de données suffisante.`
        : recommendationStatus === 'conditionnel'
          ? `« ${best.supplierName} » présente la VAN la plus faible, mais une partie des données n'est pas sourcée (qualité de données ${best.dataQualityScore}/100) : la recommandation est conditionnée à la validation de ces postes.`
          : `Aucune recommandation ferme : les deux meilleures offres sont à moins de 0,5 % d'écart ou des postes de coût essentiels sont manquants.`;

    // Point mort : comparaison de l'offre recommandée à la meilleure alternative.
    const breakEven =
      second !== null
        ? TCOEngine.calculateBreakEven(
            results.find((entry) => entry.offer.id === second.offerId)!.result,
            results.find((entry) => entry.offer.id === best.offerId)!.result,
            project.horizonYears
          )
        : null;

    const sensitivity =
      second !== null
        ? TCOEngine.calculateSensitivity(
            project,
            results.find((entry) => entry.offer.id === second.offerId)!.offer,
            results.find((entry) => entry.offer.id === best.offerId)!.offer
          )
        : [];

    const decisionReversal =
      second !== null
        ? analyseDecisionReversal(
            project,
            results.find((entry) => entry.offer.id === best.offerId)!.offer,
            results.find((entry) => entry.offer.id === second.offerId)!.offer
          )
        : null;

    // Révision des données : compteur monotone par dossier (1re exécution = 1).
    const [revision] = await tx.query<{ next: string }>(
      `SELECT COALESCE(MAX(input_version), 0) + 1 AS next FROM decision_runs WHERE project_id = $1`,
      [projectId]
    );
    const inputVersion = Number(revision?.next ?? 1);

    const inputFingerprint = fingerprintInputs(projectRow, loadedOffers, TCO_ENGINE_VERSION);

    const assumptions = {
      discountRate: project.discountRate,
      energyInflationRate: project.energyInflationRate,
      generalInflationRate: project.inflationRate,
      carbonPricePerTonne: project.carbonPricePerTonne,
      horizonYears: project.horizonYears,
      unitName: project.unitName,
      plannedVolume: project.plannedVolume,
      countryCode: projectRow.country_code,
      currency: projectRow.currency,
      source:
        "Hypothèses portées par le dossier. Elles sont modifiables par les rôles finance/ESG ; leur valeur au moment du calcul est enregistrée ici.",
    };

    const recommendations = {
      offerId: best.offerId,
      supplierName: best.supplierName,
      status: recommendationStatus,
      reason: recommendationReason,
      economicAdvantage: second
        ? {
            vsSecondBestNpv: second.lifecycleCostLCC - best.lifecycleCostLCC,
            vsWorstNpv: worst.lifecycleCostLCC - best.lifecycleCostLCC,
            vsCheapestApparentNpv: apparentCheapest.result.lifecycleCostLCC - best.lifecycleCostLCC,
            apparentCheapestOfferId: apparentCheapest.offer.id,
          }
        : null,
    };

    const resultsPayload = {
      ranking,
      recommendation: recommendations,
      breakEven,
      sensitivity,
      decisionReversal,
      warnings: runWarnings,
      completeness: {
        byQualityStatus: completenessCounts,
        missingAmountTotal: mapped.reduce((sum, entry) => sum + entry.stats.missingAmount, 0),
        unsourcedAmountTotal: mapped.reduce((sum, entry) => sum + entry.stats.unsourcedAmount, 0),
        demoItemCount: mapped.reduce((sum, entry) => sum + entry.stats.demoCount, 0),
      },
      methodology: TCO_METHODOLOGY,
      // Traçabilité par poste : « Pourquoi ce montant » au niveau du dossier.
      lineTraces: results.map(({ offer, result }) => ({
        offerId: offer.id,
        supplierName: offer.supplierName,
        lines: result.costLineTrace ?? [],
      })),
    };

    // Snapshot des entrées : permet de rejouer ce calcul à l'identique plus tard,
    // même si les offres ont changé depuis.
    const inputsSnapshot = {
      project: projectRow,
      offers: loadedOffers,
      mappingContext: mappingCtx,
    };

    const [run] = await tx.query<{ id: string; created_at: string }>(
      `INSERT INTO decision_runs (
          organization_id, project_id, run_by, engine_version, methodology_version, input_version,
          assumptions, factor_versions, results, recommended_offer_id, is_demo,
          input_fingerprint, inputs_snapshot
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, created_at`,
      [
        ctx.organization.id,
        projectId,
        ctx.user.id,
        TCO_ENGINE_VERSION,
        METHODOLOGY_VERSION,
        inputVersion,
        JSON.stringify(assumptions),
        JSON.stringify(
          loadedOffers.flatMap((offer) =>
            offer.carbonItems
              .filter((item) => item.emission_factor_source)
              .map((item) => ({
                offerId: offer.row.id,
                carbonItemId: item.id,
                factorSource: item.emission_factor_source,
                factorVerified: item.factor_verified,
                value: item.total_lifecycle_emissions,
              }))
          )
        ),
        JSON.stringify(resultsPayload),
        best.offerId,
        loadedOffers.some((offer) => offer.row.is_demo),
        inputFingerprint,
        JSON.stringify(inputsSnapshot),
      ]
    );

    // Résultats consolidés sur l'offre : c'est une COPIE du calcul serveur, jamais
    // une saisie. Elle alimente la comparaison sans recalculer à chaque affichage.
    for (const { offer, result } of results) {
      await tx.query(
        `UPDATE supplier_offers
            SET computed_tco_nominal = $2, computed_lcc = $3, computed_carbon_tonnes = $4,
                computed_confidence = $5, engine_version = $6, computed_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
        [
          offer.id,
          Math.round(result.totalComprehensiveTCO * 100) / 100,
          Math.round(result.lifecycleCostLCC * 100) / 100,
          Math.round(result.totalLifecycleCO2eTonnes * 1000) / 1000,
          Math.round(result.dataQualityScore),
          TCO_ENGINE_VERSION,
        ]
      );
    }

    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'decision.run',
      entityType: 'decision_run',
      entityId: run.id,
      projectId,
      newValue: JSON.stringify({
        inputVersion,
        engineVersion: TCO_ENGINE_VERSION,
        methodologyVersion: METHODOLOGY_VERSION,
        inputFingerprint,
        offersCompared: ranking.length,
        recommendedOfferId: best.offerId,
        recommendationStatus,
        trigger,
      }),
      ...meta,
    });

    return {
      runId: run.id,
      projectId,
      engineVersion: TCO_ENGINE_VERSION,
      methodologyVersion: METHODOLOGY_VERSION,
      inputVersion,
      inputFingerprint,
      createdAt: run.created_at,
      createdBy: ctx.user.fullName,
      ranking,
      recommendation: { ...recommendations, status: recommendationStatus, reason: recommendationReason },
      breakEven,
      sensitivity,
      decisionReversal,
      warnings: runWarnings,
      blockingIssues: [],
      dataCompleteness: {
        totalCostItems: mapped.reduce((sum, entry) => sum + entry.loaded.costItems.length, 0),
        byQualityStatus: completenessCounts,
        missingAmountTotal: mapped.reduce((sum, entry) => sum + entry.stats.missingAmount, 0),
        unsourcedAmountTotal: mapped.reduce((sum, entry) => sum + entry.stats.unsourcedAmount, 0),
        demoItemCount: mapped.reduce((sum, entry) => sum + entry.stats.demoCount, 0),
      },
    };
  });
}

/** Liste des exécutions d'un dossier (sans le détail, pour l'historique). */
export async function listDecisionRuns(db: Db, ctx: AuthContext, projectId: string, page: { limit: number; offset: number }) {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const items = await tx.query<any>(
      `SELECT id, engine_version, methodology_version, input_version, input_fingerprint,
              recommended_offer_id, created_at, run_by,
              (results->'recommendation'->>'status') AS recommendation_status,
              (results->'recommendation'->>'supplierName') AS recommended_supplier
         FROM decision_runs
        WHERE project_id = $1
        ORDER BY input_version DESC
        LIMIT $2 OFFSET $3`,
      [projectId, page.limit, page.offset]
    );
    const [count] = await tx.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM decision_runs WHERE project_id = $1`,
      [projectId]
    );
    return { items, total: Number(count?.total ?? 0) };
  });
}

export interface RunFreshness {
  runId: string;
  contentHash: string;
  storedFingerprint: string;
  currentFingerprint: string | null;
  /** Vrai lorsque les données du dossier ont changé depuis l'exécution enregistrée. */
  dataChangedSinceRun: boolean;
  /** Vrai lorsque le moteur a changé de version depuis l'exécution. */
  engineChangedSinceRun: boolean;
  engineVersionStored: string;
  engineVersionCurrent: string;
  explanation: string;
}

/**
 * Compare l'empreinte des données ENREGISTRÉES avec celle des données ACTUELLES
 * du dossier. C'est une information indispensable en audit : une décision rendue
 * sur d'autres données que celles affichées aujourd'hui doit être signalée.
 */
export async function checkRunFreshness(db: Db, ctx: AuthContext, runId: string): Promise<RunFreshness> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const rows = await tx.query<{ id: string; project_id: string; input_fingerprint: string; engine_version: string }>(
      `SELECT id, project_id, input_fingerprint, engine_version FROM decision_runs WHERE id = $1`,
      [runId]
    );
    if (rows.length === 0) throw notFound('Exécution de décision introuvable.');
    const run = rows[0];

    const { project, offers } = await loadProjectInputs(tx, run.project_id);
    const currentFingerprint = fingerprintInputs(project, offers, TCO_ENGINE_VERSION);

    const dataChangedSinceRun = currentFingerprint !== run.input_fingerprint;
    const engineChangedSinceRun = run.engine_version !== TCO_ENGINE_VERSION;

    const parts: string[] = [];
    if (dataChangedSinceRun) {
      parts.push(
        'Les données du dossier ont changé depuis cette exécution (montant, source, statut de qualité ou hypothèse) : ' +
          'le rejeu utilise le snapshot enregistré, donc la décision reste reproductible, mais elle ne correspond plus à l’état actuel du dossier.'
      );
    }
    if (engineChangedSinceRun) {
      parts.push(
        `Le moteur de calcul a changé de version (${run.engine_version} lors de l’exécution, ${TCO_ENGINE_VERSION} aujourd’hui) : ` +
          'un recalcul peut produire un résultat différent, c’est attendu et doit être documenté.'
      );
    }
    if (parts.length === 0) {
      parts.push('Les données et la version du moteur sont identiques à celles de cette exécution.');
    }

    return {
      runId,
      contentHash: run.input_fingerprint,
      storedFingerprint: run.input_fingerprint,
      currentFingerprint,
      dataChangedSinceRun,
      engineChangedSinceRun,
      engineVersionStored: run.engine_version,
      engineVersionCurrent: TCO_ENGINE_VERSION,
      explanation: parts.join(' '),
    };
  });
}

export interface ReplayResult {
  runId: string;
  storedFingerprint: string;
  replayedFingerprint: string;
  engineVersionStored: string;
  engineVersionReplayed: string;
  identical: boolean;
  differences: string[];
  replayedRecommendationOfferId: string | null;
  storedRecommendationOfferId: string | null;
}

/**
 * Rejoue une exécution passée à partir du snapshot d'entrées enregistré, puis
 * compare le résultat recalculé au résultat stocké. C'est la preuve de
 * reproductibilité exigée pour un dossier auditable : si le moteur ou la
 * méthodologie a changé depuis, l'écart est signalé explicitement au lieu d'être
 * masqué.
 */
export async function replayDecisionRun(db: Db, ctx: AuthContext, runId: string): Promise<ReplayResult> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const rows = await tx.query<{ inputs_snapshot: any; results: any; input_fingerprint: string; engine_version: string; methodology_version: string }>(
      `SELECT inputs_snapshot, results, input_fingerprint, engine_version, methodology_version
         FROM decision_runs WHERE id = $1`,
      [runId]
    );
    if (rows.length === 0) throw notFound('Exécution de décision introuvable.');
    const stored = rows[0];

    if (!stored.inputs_snapshot) {
      throw new HttpError(
        409,
        'REPLAY_SNAPSHOT_MISSING',
        "Cette exécution ne contient pas de snapshot d'entrées (elle est antérieure à l'ajout de cette fonctionnalité) : " +
          'elle ne peut pas être rejouée à l’identique.'
      );
    }

    const snapshot = stored.inputs_snapshot as { project: ProjectRowInput; offers: LoadedOffer[]; mappingContext: MappingContext };
    const project = mapProject(snapshot.project, snapshot.mappingContext);
    const offers = snapshot.offers.map((loaded) => mapOffer({ ...loaded }, snapshot.mappingContext).offer);

    const replayedRanking = offers
      .map((offer) => ({ offer, result: TCOEngine.calculateOfferTCO(project, offer) }))
      .sort((a, b) => a.result.lifecycleCostLCC - b.result.lifecycleCostLCC)
      .map(({ offer, result }) => ({
        offerId: offer.id,
        lifecycleCostLCC: Math.round(result.lifecycleCostLCC * 100) / 100,
        totalComprehensiveTCO: Math.round(result.totalComprehensiveTCO * 100) / 100,
      }));

    const replayedFingerprint = fingerprintInputs(snapshot.project, snapshot.offers, TCO_ENGINE_VERSION);
    const storedRanking = (stored.results?.ranking ?? []) as { offerId: string; lifecycleCostLCC: number; totalComprehensiveTCO: number }[];

    const differences: string[] = [];
    if (replayedFingerprint !== stored.input_fingerprint) {
      differences.push(
        'Empreinte des entrées différente : le snapshot a été modifié ou la version du moteur a changé entre-temps.'
      );
    }
    if (stored.engine_version !== TCO_ENGINE_VERSION) {
      differences.push(
        `Version du moteur différente : ${stored.engine_version} au moment du calcul, ${TCO_ENGINE_VERSION} aujourd'hui. ` +
          'Le rejeu utilise la version actuelle ; un écart de résultat est donc attendu et doit être documenté.'
      );
    }
    if (storedRanking.length !== replayedRanking.length) {
      differences.push(`Nombre d'offres différent : ${storedRanking.length} enregistrées, ${replayedRanking.length} rejouées.`);
    }
    for (const [index, replayed] of replayedRanking.entries()) {
      const original = storedRanking[index];
      if (!original) continue;
      if (original.offerId !== replayed.offerId) {
        differences.push(
          `Classement différent à la position ${index + 1} : ${original.offerId} enregistré, ${replayed.offerId} recalculé.`
        );
      }
      if (Math.abs(original.lifecycleCostLCC - replayed.lifecycleCostLCC) > 0.01) {
        differences.push(
          `VAN différente pour l'offre ${replayed.offerId} : ${original.lifecycleCostLCC} enregistrée, ${replayed.lifecycleCostLCC} recalculée.`
        );
      }
      if (Math.abs(original.totalComprehensiveTCO - replayed.totalComprehensiveTCO) > 0.01) {
        differences.push(
          `TCO nominal différent pour l'offre ${replayed.offerId} : ${original.totalComprehensiveTCO} enregistré, ${replayed.totalComprehensiveTCO} recalculé.`
        );
      }
    }

    return {
      runId,
      storedFingerprint: stored.input_fingerprint,
      replayedFingerprint,
      engineVersionStored: stored.engine_version,
      engineVersionReplayed: TCO_ENGINE_VERSION,
      identical: differences.length === 0,
      differences,
      replayedRecommendationOfferId: replayedRanking[0]?.offerId ?? null,
      storedRecommendationOfferId: stored.results?.recommendation?.offerId ?? null,
    };
  });
}
