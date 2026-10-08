/**
 * TrueTCO — Moteur de calcul TCO / LCC / Carbone / Risques
 * ---------------------------------------------------------------------------
 * VERSION 2.0.0 — Correctifs de fiabilité financière (voir METHODOLOGY pour le
 * détail des conventions retenues et des défauts corrigés en v1).
 *
 * Principes non négociables de cette version :
 *  1. AUCUN poste de coût déclaré n'est ignoré silencieusement. Tout poste dont
 *     la catégorie n'est pas reconnue est compté prudemment comme un coût et
 *     remonte dans `warnings[]` + `unallocatedCostTotal`.
 *  2. Les occurrences (`isRecurringYearly`, `yearOccurrences`,
 *     `annualOccurrenceYears`) sont honorées. Une ligne récurrente n'est jamais
 *     réduite à une seule année.
 *  3. Le LCC est la Valeur Actuelle Nette d'un périmètre STRICTEMENT identique
 *     au TCO global : économique + risque + carbone. Aucun agrégat hybride.
 *  4. Aucune statistique inventée : `uncertaintyRange` documente explicitement
 *     sa méthode et n'est pas présentée comme un intervalle de confiance
 *     statistique.
 *  5. Le moteur est PURE : il ne mute jamais ses entrées.
 *  6. Toute hypothèse est exposée (`methodology`) pour être auditable.
 */

import {
  Project,
  SupplierOffer,
  TCOCalculationResult,
  YearCashFlow,
  BreakEvenAnalysis,
  SensitivityDriver,
  ScenarioResult,
  CostBreakdownItem,
  DataSourceType,
  CostLineTrace,
  CalculationWarning,
  DataConfidenceBreakdown,
} from '../types/domain';

export type { CostLineTrace, CalculationWarning, DataConfidenceBreakdown };

export const TCO_ENGINE_VERSION = '2.0.0';

/** Marqueur utilisé par les tests pour garantir l'export de la méthodologie. */
export const METHODOLOGY_EXPORT_MARKER = 'truetco-methodology';

/**
 * Conventions méthodologiques publiques du moteur (auditables par un DAF/CAC).
 */
export const TCO_METHODOLOGY = {
  version: TCO_ENGINE_VERSION,
  reference: 'ISO 15686-5 (LCC) / GHG Protocol / normes de choix d\'investissement',
  conventions: {
    year0: 'Les postes d\'investissement (acquisition, logistique/douanes, installation, administration), le carbone de fabrication/transport et la valeur résiduelle sont positionnés en Année 0 lorsque non récurrents.',
    opex: 'Les postes d\'exploitation non récurrents sans occurrences explicites sont positionnés en Année 1.',
    discounting:
      'Actualisation en fin de période : facteur_t = 1 / (1 + WACC)^t. Rien n\'est actualisé en Année 0.',
    indexation:
      'yearlyInflationType pilote l\'indexation : "energy" → inflation énergétique, "general"/"maintenance" → inflation générale (+ usure pour maintenance), "none" → aucune indexation.',
    maintenanceWear: 'Facteur d\'usure maintenance : +3 %/an cumulatif.',
    replacementAging: 'Facteur de vieillissement remplacement : +8 %/an à partir de l\'Année 4.',
    residualValue:
      'La valeur résiduelle est un produit (crédit) positionné en dernière année d\'horizon et signé en négatif dans les flux. La valeur saisie est lue en valeur absolue.',
    endOfLife: 'Le coût de fin de vie / recyclage est positionné en dernière année d\'horizon.',
    carbonTiming:
      'Carbone : "fabrication" et "transport" en Année 0, "utilisation_annuelle" réparti linéairement sur les années 1..horizon, "fin_de_vie" en dernière année. Le prix du carbone est appliqué à plat (pas de trajectoire implicite) sauf override explicite.',
    risk: 'Risque : Probabilité × Impact (espérance mathématique), réparti linéairement sur les années 1..horizon faute d\'échéancier fourni.',
    lccDefinition:
      'lifecycleCostLCC = NPV du coût complet (économique + risque + carbone). economicLCC = NPV du périmètre économique seul. Les deux sont exposés séparément.',
  },
  warnings: [
    'Les postes de coût dont la catégorie est inconnue sont comptés prudemment comme des coûts et signalés.',
    'Aucun intervalle de confiance statistique n\'est calculé : uncertaintyRange est une enveloppe déterministe dérivée du niveau de confiance déclaré par source.',
  ],
} as const;

/** Catégories canoniques reconnues par le moteur. */
export const RECOGNIZED_COST_CATEGORIES = [
  'acquisition',
  'logistique_douanes',
  'installation_mise_en_service',
  'energie_consommables',
  'maintenance_reparations',
  'remplacement_pannes',
  'couts_administratifs_conformite',
  'fin_de_vie_recyclage',
  'valeur_residuelle',
  'indisponibilite_operationnelle',
  'fiscalite_taxes',
  'deploiement',
  'risques_operationnels',
  'externalite_carbone',
] as const;

export type CostCategory = (typeof RECOGNIZED_COST_CATEGORIES)[number];

/**
 * Alias tolérés : libellés déjà émis par des versions antérieures du produit,
 * par les imports ERP ou par le parser IA. Aucun de ces alias ne doit être
 * silencieusement perdu.
 */
const CATEGORY_ALIASES: Record<string, CostCategory> = {
  acquisition: 'acquisition',
  achat: 'acquisition',
  capex: 'acquisition',
  logistique_douanes: 'logistique_douanes',
  logistique: 'logistique_douanes',
  transport: 'logistique_douanes',
  douanes: 'logistique_douanes',
  installation_mise_en_service: 'installation_mise_en_service',
  installation: 'installation_mise_en_service',
  mise_en_service: 'installation_mise_en_service',
  energie_consommables: 'energie_consommables',
  energie: 'energie_consommables',
  consommables: 'energie_consommables',
  fluides: 'energie_consommables',
  maintenance_reparations: 'maintenance_reparations',
  maintenance: 'maintenance_reparations',
  reparation: 'maintenance_reparations',
  reparations: 'maintenance_reparations',
  services: 'maintenance_reparations',
  remplacement_pannes: 'remplacement_pannes',
  remplacement: 'remplacement_pannes',
  pannes: 'remplacement_pannes',
  couts_administratifs_conformite: 'couts_administratifs_conformite',
  conformite: 'couts_administratifs_conformite',
  administratif: 'couts_administratifs_conformite',
  taxes: 'fiscalite_taxes',
  fiscalite: 'fiscalite_taxes',
  fiscalite_taxes: 'fiscalite_taxes',
  redevances: 'fiscalite_taxes',
  depenses_fiscales: 'fiscalite_taxes',
  deploiement: 'deploiement',
  indisponibilite: 'indisponibilite_operationnelle',
  indisponibilite_operationnelle: 'indisponibilite_operationnelle',
  arret_production: 'indisponibilite_operationnelle',
  risques_operationnels: 'risques_operationnels',
  externalite_carbone: 'externalite_carbone',
  carbone: 'externalite_carbone',
  fin_de_vie_recyclage: 'fin_de_vie_recyclage',
  fin_de_vie: 'fin_de_vie_recyclage',
  recyclage: 'fin_de_vie_recyclage',
  demantelement: 'fin_de_vie_recyclage',
  valeur_residuelle: 'valeur_residuelle',
  valeur_de_revente: 'valeur_residuelle',
};

/** Catégories positionnées en Année 0 lorsqu'elles ne sont pas récurrentes. */
const YEAR0_CATEGORIES: CostCategory[] = [
  'acquisition',
  'logistique_douanes',
  'installation_mise_en_service',
  'couts_administratifs_conformite',
  'deploiement',
  'externalite_carbone',
];

/** Dispersion d'incertitude par type de source (méthode déterministe documentée). */
const SOURCE_DISPERSION: Record<DataSourceType, number> = {
  verifiee: 0.05,
  historique: 0.1,
  source_externe: 0.1,
  donnee_sectorielle: 0.2,
  calculee: 0.2,
  estimee: 0.25,
  estimation: 0.3,
  utilisateur: 0.35,
  manquante: 0.5,
} as unknown as Record<DataSourceType, number>;

interface BuildOptions {
  discountRate?: number;
  carbonPricePerTonne?: number;
  inflationRate?: number;
  energyInflationRate?: number;
  failureRateMultiplier?: number;
  horizonYears?: number;
}

export class TCOEngine {
  private static normalizeCategory(raw: string | undefined): CostCategory | null {
    if (!raw) return null;
    const key = String(raw).trim().toLowerCase();
    return CATEGORY_ALIASES[key] ?? null;
  }

  private static occurrencesOf(item: any): number[] | null {
    const explicit = item?.yearOccurrences ?? item?.annualOccurrenceYears;
    if (Array.isArray(explicit) && explicit.length > 0) {
      return explicit
        .map((y: any) => Number(y))
        .filter((y: number) => Number.isFinite(y) && y >= 0)
        .map((y: number) => Math.round(y));
    }
    return null;
  }

  /**
   * Calcule le TCO complet (nominal) et le LCC (NPV) d'une offre.
   * Fonction pure : ne mute jamais `project` ni `offer`.
   */
  /**
   * Classement d'un écart de sensibilité (€) : RELATIF à l'échelle économique
   * du dossier comparé. Un seuil absolu (ancienne version : 25 000 €) classait
   * « critique » tout driver d'un contrat de 100 M€ et « faible » tout driver
   * d'un contrat de 80 k€. Ici, 5 % de l'assiette comparée = critique.
   */
  private static rankSensitivity(spread: number, scale: number): SensitivityDriver['sensitivityRank'] {
    const base = Math.max(Math.abs(scale), 1_000);
    const ratio = Math.abs(spread) / base;
    if (ratio >= 0.05) return 'critique';
    if (ratio >= 0.015) return 'fort';
    if (ratio >= 0.005) return 'moyen';
    return 'faible';
  }

  public static calculateOfferTCO(
    project: Project,
    offer?: SupplierOffer | null,
    overrideParameters?: BuildOptions
  ): TCOCalculationResult {
    const horizon = Math.max(1, Math.round(overrideParameters?.horizonYears ?? project?.horizonYears ?? 5));
    const discountRate = overrideParameters?.discountRate ?? project?.discountRate ?? 0.05;
    const carbonPrice = overrideParameters?.carbonPricePerTonne ?? project?.carbonPricePerTonne ?? 120;
    const inflation = overrideParameters?.inflationRate ?? project?.inflationRate ?? 0.02;
    const energyInflation = overrideParameters?.energyInflationRate ?? project?.energyInflationRate ?? 0.04;
    const failureMultiplier = overrideParameters?.failureRateMultiplier ?? 1.0;

    const emptyResult = (): TCOCalculationResult => ({
      offerId: '',
      supplierName: 'Aucune offre',
      isResponsibleCandidate: false,
      apparentDirectCost: 0,
      quantity: 0,
      acquisitionTotal: 0,
      logisticsTotal: 0,
      installationTotal: 0,
      energyConsumablesTotal: 0,
      maintenanceRepairsTotal: 0,
      replacementDefectsTotal: 0,
      adminComplianceTotal: 0,
      salvageValueTotal: 0,
      endOfLifeRecyclingTotal: 0,
      unallocatedCostTotal: 0,
      economicTCONominal: 0,
      riskExpositionTotal: 0,
      monetizedCarbonTotal: 0,
      totalComprehensiveTCO: 0,
      unitTCO: 0,
      discountRateUsed: discountRate,
      cashFlowsByYear: [],
      lifecycleCostLCC: 0,
      economicLCC: 0,
      dataQualityScore: 0,
      dataConfidenceBreakdown: {
        weightedScore: 0,
        method: 'Aucune donnée à évaluer.',
        bySourceType: {},
        missingAmount: 0,
        missingShare: 0,
      },
      uncertaintyRange: {
        minTCO: 0,
        maxTCO: 0,
        method: 'envelope_par_type_de_source',
        isStatisticalConfidenceInterval: false,
        dispersionPercent: 0,
      },
      totalLifecycleCO2eTonnes: 0,
      costLineTrace: [],
      warnings: [
        {
          code: 'NO_OFFER',
          severity: 'critique',
          message: 'Aucune offre fournie au moteur : aucun résultat financier ne peut être produit.',
        },
      ],
      isComplete: false,
      engineVersion: TCO_ENGINE_VERSION,
      methodology: TCO_METHODOLOGY.conventions,
    });

    if (!offer) return emptyResult();

    const quantity = Number(offer.quantity) > 0 ? Number(offer.quantity) : Number(project?.plannedVolume) || 1;
    const unitPrice =
      offer.apparentUnitPrice?.value ??
      (offer.apparentTotal ? offer.apparentTotal / (quantity || 1) : 0);
    const apparentDirectCost = unitPrice * quantity;

    const warnings: CalculationWarning[] = [];
    const costLineTrace: CostLineTrace[] = [];

    // --- Vecteurs annuels (index 0 = Année 0) --------------------------------
    const annualEnergy = new Array<number>(horizon + 1).fill(0);
    const annualMaintenance = new Array<number>(horizon + 1).fill(0);
    const annualReplacement = new Array<number>(horizon + 1).fill(0);
    const annualAdmin = new Array<number>(horizon + 1).fill(0);
    const annualOther = new Array<number>(horizon + 1).fill(0);
    const annualIndispo = new Array<number>(horizon + 1).fill(0);
    const annualTaxes = new Array<number>(horizon + 1).fill(0);
    const annualDeployment = new Array<number>(horizon + 1).fill(0);
    const annualCarbonExternality = new Array<number>(horizon + 1).fill(0);
    const annualAcquisition = new Array<number>(horizon + 1).fill(0);
    const annualLogistics = new Array<number>(horizon + 1).fill(0);
    const annualInstallation = new Array<number>(horizon + 1).fill(0);

    let acquisitionTotal = 0;
    let logisticsTotal = 0;
    let installationTotal = 0;
    let salvageValueTotal = 0;
    let endOfLifeRecyclingTotal = 0;
    let unallocatedCostTotal = 0;
    let unallocatedItemCount = 0;
    let fallbackAcquisitionAtYear0 = 0;

    const discount = (year: number) => 1 / Math.pow(1 + discountRate, year);

    const pushTrace = (
      item: CostBreakdownItem,
      amountNominal: number,
      occurrences: number[],
      indexation: string,
      isCredit: boolean,
      category: CostCategory | 'NON_RECONNUE'
    ) => {
      // Les crédits (valeur résiduelle) sont tracés en valeur absolue et
      // signalés par `isCredit` : le signe ne peut donc pas être interprété de
      // travers dans un export ou une réconciliation comptable.
      const signedAmount = isCredit ? Math.abs(amountNominal) : amountNominal;
      const amountDiscounted = occurrences.reduce((acc, y) => acc + signedAmount * discount(y), 0);
      costLineTrace.push({
        id: item.id,
        label: item.label,
        declaredCategory: String(item.category),
        category,
        amountNominal: Math.round(signedAmount),
        amountDiscounted: Math.round(amountDiscounted),
        occurrences: [...occurrences],
        indexation,
        sourceName: item.amount?.sourceName ?? 'Non renseigné',
        sourceType: item.amount?.sourceType ?? ('manquante' as DataSourceType),
        confidenceLevel: typeof item.amount?.confidenceLevel === 'number' ? item.amount.confidenceLevel : 0,
        isCredit,
      });
    };

    // --- Boucle analytique sur les postes de coût ---------------------------
    for (const item of offer.costItems || []) {
      const rawAmount = Number(item.amount?.value);
      if (!Number.isFinite(rawAmount)) {
        warnings.push({
          code: 'INVALID_AMOUNT',
          severity: 'critique',
          message: `Poste "${item.label}" ignoré : montant absent ou non numérique.`,
          itemId: item.id,
        });
        continue;
      }

      const category = this.normalizeCategory(item.category);
      const explicitOccurrences = this.occurrencesOf(item);
      const isRecurring = item.isRecurringYearly === true;

      // Détermination des années d'occurrence (règle explicite et documentée).
      let occurrences: number[];
      if (explicitOccurrences) {
        occurrences = explicitOccurrences.filter((y) => y <= horizon);
        if (explicitOccurrences.some((y) => y > horizon)) {
          warnings.push({
            code: 'OCCURRENCE_OUT_OF_HORIZON',
            severity: 'avertissement',
            message: `Poste "${item.label}" : certaines occurrences dépassent l'horizon de ${horizon} ans et ont été exclues (impact non nul sur le coût complet si l'horizon est étendu).`,
            itemId: item.id,
          });
        }
      } else if (category === 'valeur_residuelle') {
        occurrences = [horizon];
      } else if (category === 'fin_de_vie_recyclage') {
        occurrences = [horizon];
      } else if (isRecurring) {
        occurrences = Array.from({ length: horizon }, (_, i) => i + 1);
      } else if (category && YEAR0_CATEGORIES.includes(category)) {
        occurrences = [0];
      } else {
        occurrences = [1];
      }

      // La valeur résiduelle et le coût de fin de vie sont traités comme des
      // montants NOMINAUX contractuels : ils ne sont jamais indexés.
      const indexationType =
        category === 'valeur_residuelle' || category === 'fin_de_vie_recyclage'
          ? 'none'
          : item.yearlyInflationType ?? (category === 'energie_consommables' ? 'energy' : 'general');

      // Indexation + facteurs d'usure/vieillissement appliqués poste par poste.
      const indexedAmounts = occurrences.map((y) => {
        let base = rawAmount;
        if (y > 0) {
          if (indexationType === 'energy') base *= Math.pow(1 + energyInflation, y - 1);
          else if (indexationType === 'maintenance') base *= Math.pow(1 + inflation, y - 1);
          else if (indexationType === 'general') base *= Math.pow(1 + inflation, y - 1);
          // 'none' → aucune indexation
        }
        if (category === 'maintenance_reparations' && y > 1) base *= 1 + (y - 1) * 0.03;
        if (category === 'remplacement_pannes') {
          base *= failureMultiplier;
          if (y > 3) base *= 1 + (y - 3) * 0.08;
        }
        return base;
      });

      const nominal = indexedAmounts.reduce((a, b) => a + b, 0);
      const isCredit = category === 'valeur_residuelle';

      if (category === null) {
        // Politique prudente : un poste non classé reste un coût, jamais ignoré.
        unallocatedItemCount += 1;
        unallocatedCostTotal += nominal;
        occurrences.forEach((y, i) => {
          annualOther[y] += indexedAmounts[i];
        });
        warnings.push({
          code: 'UNRECOGNIZED_COST_CATEGORY',
          severity: 'critique',
          message: `Catégorie de coût non reconnue « ${item.category} » sur le poste « ${item.label} ». Le montant est compté prudemment comme un coût (aucune perte silencieuse).`,
          amount: Math.round(nominal),
          itemId: item.id,
        });
        pushTrace(item, nominal, occurrences, indexationType, false, 'NON_RECONNUE');
        continue;
      }

      occurrences.forEach((y, i) => {
        const v = indexedAmounts[i];
        switch (category) {
          case 'acquisition':
            acquisitionTotal += v;
            // Les occurrences sont écrites dans le vecteur Année 0 et suivantes
            // via annualAcquisition pour éviter tout double comptage.
            annualAcquisition[y] += v;
            break;
          case 'logistique_douanes':
            logisticsTotal += v;
            annualLogistics[y] += v;
            break;
          case 'installation_mise_en_service':
            installationTotal += v;
            annualInstallation[y] += v;
            break;
          case 'energie_consommables':
            annualEnergy[y] += v;
            break;
          case 'maintenance_reparations':
            annualMaintenance[y] += v;
            break;
          case 'remplacement_pannes':
            annualReplacement[y] += v;
            break;
          case 'couts_administratifs_conformite':
            annualAdmin[y] += v;
            break;
          case 'deploiement':
            annualDeployment[y] += v;
            break;
          case 'fiscalite_taxes':
            annualTaxes[y] += v;
            break;
          case 'indisponibilite_operationnelle':
            annualIndispo[y] += v;
            break;
          case 'risques_operationnels':
            annualOther[y] += v;
            break;
          case 'externalite_carbone':
            annualCarbonExternality[y] += v;
            break;
          case 'valeur_residuelle':
            // Valeur résiduelle = produit attendu, lue en valeur absolue.
            salvageValueTotal += Math.abs(v);
            break;
          case 'fin_de_vie_recyclage':
            endOfLifeRecyclingTotal += v;
            break;
        }
      });

      pushTrace(item, nominal, occurrences, indexationType, isCredit, category);
    }

    // Si aucun poste d'acquisition n'est ventilé, repli documenté sur le prix facial.
    if (acquisitionTotal === 0 && apparentDirectCost > 0) {
      acquisitionTotal = apparentDirectCost;
      fallbackAcquisitionAtYear0 = apparentDirectCost;
      annualAcquisition[0] += apparentDirectCost;
      warnings.push({
        code: 'ACQUISITION_FROM_APPARENT_PRICE',
        severity: 'information',
        message:
          "Aucun poste de coût de catégorie « acquisition » : le prix facial de l'offre (prix unitaire × quantité) a été utilisé comme coût d'acquisition.",
        amount: Math.round(apparentDirectCost),
      });
    }

    // --- Risque : Probabilité × Impact --------------------------------------
    let riskExpositionTotal = 0;
    let unquantifiedRiskCount = 0;
    for (const risk of offer.riskItems || []) {
      const p = Number(risk.probability?.value);
      const impact = Number(risk.financialImpact?.value);
      if (!Number.isFinite(p) || !Number.isFinite(impact)) {
        unquantifiedRiskCount += 1;
        continue;
      }
      const clampedP = Math.min(Math.max(p, 0), 1);
      if (p !== clampedP) {
        warnings.push({
          code: 'RISK_PROBABILITY_CLAMPED',
          severity: 'avertissement',
          message: `Probabilité hors bornes [0;1] sur le risque « ${risk.label} » : valeur ${p} ramenée à ${clampedP}.`,
        });
      }
      if (risk.probabilityType === 'hypothese_utilisateur' || risk.probabilityType === 'estimation') {
        warnings.push({
          code: 'RISK_IS_ASSUMPTION',
          severity: 'information',
          message: `Le risque « ${risk.label} » repose sur une ${risk.probabilityType === 'estimation' ? 'estimation' : 'hypothèse utilisateur'} non étayée par un historique : à valider formellement avant décision.`,
        });
      }
      riskExpositionTotal += clampedP * impact;
    }
    if (unquantifiedRiskCount > 0) {
      warnings.push({
        code: 'RISK_NOT_QUANTIFIED',
        severity: 'avertissement',
        message: `${unquantifiedRiskCount} risque(s) non quantifié(s) (probabilité ou impact manquant) : exposition réelle supérieure à celle affichée.`,
      });
    }

    // --- Carbone -------------------------------------------------------------
    let totalLifecycleCO2eTonnes = 0;
    const carbonByYear = new Array<number>(horizon + 1).fill(0);
    const annualCarbonTonnes = new Array<number>(horizon + 1).fill(0);
    const carbonItems = offer.carbonItems || [];

    for (const c of carbonItems) {
      const perUnit = Number(c.emissionsPerUnitTonneCO2e?.value);
      const totalDeclared = Number((c as any).totalLifecycleEmissions);
      let tonnes = Number.isFinite(totalDeclared) && totalDeclared !== 0 ? totalDeclared : NaN;

      if (!Number.isFinite(tonnes)) {
        if (Number.isFinite(perUnit)) {
          tonnes = perUnit * quantity;
          warnings.push({
            code: 'CARBON_COMPUTED_FROM_FACTOR',
            severity: 'information',
            message: `Émissions totales recalculées depuis le facteur unitaire pour le poste carbone « ${c.label ?? c.scope} » (${perUnit} tCO2e/unité × ${quantity}).`,
          });
        } else {
          warnings.push({
            code: 'CARBON_NOT_QUANTIFIED',
            severity: 'avertissement',
            message: `Poste carbone « ${c.label ?? c.scope} » non quantifié : ni total ni facteur unitaire exploitable.`,
          });
          continue;
        }
      }
      totalLifecycleCO2eTonnes += tonnes;

      const phase = c.lifecyclePhase ?? 'fabrication';
      if (phase === 'utilisation_annuelle') {
        const perYear = tonnes / horizon;
        for (let y = 1; y <= horizon; y++) annualCarbonTonnes[y] += perYear;
      } else if (phase === 'fin_de_vie') {
        annualCarbonTonnes[horizon] += tonnes;
      } else {
        // fabrication | transport → Année 0
        annualCarbonTonnes[0] += tonnes;
      }

      // Toute émission est monétisée à l'année où elle survient (traçable).
    }

    for (let y = 0; y <= horizon; y++) {
      carbonByYear[y] = annualCarbonTonnes[y] * carbonPrice;
    }
    const monetizedCarbonTotal = totalLifecycleCO2eTonnes * carbonPrice;

    // Double comptage carbone : si l'utilisateur a aussi saisi une ligne
    // d'externalité carbone explicite, on l'avertit sans la supprimer.
    const explicitCarbonLines = annualCarbonExternality.reduce((a, b) => a + b, 0);
    if (explicitCarbonLines > 0 && monetizedCarbonTotal > 0) {
      warnings.push({
        code: 'POTENTIAL_CARBON_DOUBLE_COUNT',
        severity: 'critique',
        message:
          "Un poste de coût « externalite_carbone » existe en plus des postes carbone quantifiés : risque de double comptage de la même émission. Vérifier que les deux périmètres ne se recouvrent pas.",
        amount: Math.round(explicitCarbonLines),
      });
    }

    // --- Agrégats nominaux sur l'horizon ------------------------------------
    const sumArr = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const energyConsumablesTotal = sumArr(annualEnergy);
    const maintenanceRepairsTotal = sumArr(annualMaintenance);
    const replacementDefectsTotal = sumArr(annualReplacement);
    const totalAdminCompliance = sumArr(annualAdmin);
    const indispoTotal = sumArr(annualIndispo);
    const taxesTotal = sumArr(annualTaxes);
    const deploymentTotal = sumArr(annualDeployment);
    const otherTotal = sumArr(annualOther);
    const explicitCarbonExternalityTotal = sumArr(annualCarbonExternality);

    /**
     * Somme des vecteurs annuels pour l'année y. Un seul chemin d'agrégation
     * alimente à la fois les totaux et les flux : l'invariant
     * Σ_y flux_économiques == economicTCONominal est donc garanti par
     * construction (et vérifié par les tests).
     */
    const economicAtYear = (y: number) =>
      annualAcquisition[y] +
      annualLogistics[y] +
      annualInstallation[y] +
      annualEnergy[y] +
      annualMaintenance[y] +
      annualReplacement[y] +
      annualAdmin[y] +
      annualDeployment[y] +
      annualTaxes[y] +
      annualIndispo[y] +
      annualOther[y] +
      annualCarbonExternality[y];

    // --- TCO économique nominal ---------------------------------------------
    const economicTCONominal =
      acquisitionTotal +
      logisticsTotal +
      installationTotal +
      energyConsumablesTotal +
      maintenanceRepairsTotal +
      replacementDefectsTotal +
      totalAdminCompliance +
      deploymentTotal +
      taxesTotal +
      indispoTotal +
      otherTotal +
      explicitCarbonExternalityTotal +
      endOfLifeRecyclingTotal -
      salvageValueTotal;

    // Les lignes « externalite_carbone » sont déjà agrégées dans otherTotal via
    // annualCarbonExternality : elles sont incluses UNE SEULE FOIS dans
    // economicTCONominal et ne sont donc pas ré-ajoutées ici.
    const totalComprehensiveTCO = economicTCONominal + riskExpositionTotal + monetizedCarbonTotal;

    // --- Flux de trésorerie + actualisation ---------------------------------
    const cashFlowsByYear: YearCashFlow[] = [];
    let cumulativeEconomic = 0;
    let cumulativeComprehensive = 0;
    const annualRiskShare = horizon > 0 ? riskExpositionTotal / horizon : 0;

    for (let y = 0; y <= horizon; y++) {
      const economicNominal =
        economicAtYear(y) + (y === horizon ? endOfLifeRecyclingTotal - salvageValueTotal : 0);

      const riskNominal = y === 0 ? 0 : annualRiskShare;
      const carbonNominal = carbonByYear[y];
      const nominalComprehensive = economicNominal + riskNominal + carbonNominal;

      const factor = discount(y);
      const economicDiscounted = economicNominal * factor;
      const riskDiscounted = riskNominal * factor;
      const carbonDiscounted = carbonNominal * factor;

      cumulativeEconomic += economicDiscounted;
      cumulativeComprehensive += economicDiscounted + riskDiscounted + carbonDiscounted;

      cashFlowsByYear.push({
        year: y,
        nominalCost: nominalComprehensive,
        discountFactor: Number(factor.toFixed(6)),
        discountedCost: economicDiscounted + riskDiscounted + carbonDiscounted,
        cumulativeDiscountedCost: cumulativeComprehensive,
        carbonEmissionsTonnes: annualCarbonTonnes[y] || 0,
        carbonCostNominal: carbonNominal,
        economicNominalCost: economicNominal,
        economicDiscountedCost: economicDiscounted,
        capexNominalCost: y === 0 ? economicAtYear(0) : 0,
        opexNominalCost:
          y === 0
            ? 0
            : economicAtYear(y) - (y === horizon ? endOfLifeRecyclingTotal - salvageValueTotal : 0) + (y === horizon ? 0 : 0),
        riskNominalCost: riskNominal,
        riskDiscountedCost: riskDiscounted,
        carbonDiscountedCost: carbonDiscounted,
        salvageNominalCost: y === horizon ? -salvageValueTotal : 0,
        endOfLifeNominalCost: y === horizon ? endOfLifeRecyclingTotal : 0,
      });
    }

    const economicLCC = cumulativeEconomic;
    const lifecycleCostLCC = cumulativeComprehensive;

    // --- Score de confiance pondéré par la matérialité ----------------------
    const confidenceInputs: { amount: number; level: number; sourceType: DataSourceType | string }[] = [];
    for (const item of offer.costItems || []) {
      const amount = Math.abs(Number(item.amount?.value) || 0);
      const level = typeof item.amount?.confidenceLevel === 'number' ? item.amount.confidenceLevel : 0;
      confidenceInputs.push({ amount, level, sourceType: item.amount?.sourceType ?? 'manquante' });
    }
    if (offer.apparentUnitPrice) {
      confidenceInputs.push({
        amount: Math.abs(apparentDirectCost),
        level: typeof offer.apparentUnitPrice.confidenceLevel === 'number' ? offer.apparentUnitPrice.confidenceLevel : 0,
        sourceType: offer.apparentUnitPrice.sourceType ?? 'manquante',
      });
    }
    for (const c of carbonItems) {
      const amount = Math.abs(Number(c.emissionsPerUnitTonneCO2e?.value) || 0) * carbonPrice;
      const level = typeof c.emissionsPerUnitTonneCO2e?.confidenceLevel === 'number' ? c.emissionsPerUnitTonneCO2e.confidenceLevel : 0;
      confidenceInputs.push({ amount, level, sourceType: c.emissionsPerUnitTonneCO2e?.sourceType ?? 'manquante' });
    }
    for (const r of offer.riskItems || []) {
      const amount = Math.abs((Number(r.probability?.value) || 0) * (Number(r.financialImpact?.value) || 0));
      confidenceInputs.push({
        amount,
        level: typeof r.financialImpact?.confidenceLevel === 'number' ? r.financialImpact.confidenceLevel : 0,
        sourceType: r.financialImpact?.sourceType ?? 'manquante',
      });
    }

    const totalWeight = confidenceInputs.reduce((a, c) => a + Math.abs(c.amount), 0);
    const bySourceType: Record<string, { amount: number; share: number }> = {};
    let missingAmount = 0;
    let weightedScore = 0;

    for (const c of confidenceInputs) {
      const key = String(c.sourceType);
      bySourceType[key] = bySourceType[key] ?? { amount: 0, share: 0 };
      bySourceType[key].amount += c.amount;
      if (key === 'manquante') missingAmount += c.amount;
      if (totalWeight > 0) weightedScore += (c.amount / totalWeight) * Math.max(0, Math.min(100, c.level));
    }
    for (const key of Object.keys(bySourceType)) {
      bySourceType[key].share = totalWeight > 0 ? bySourceType[key].amount / totalWeight : 0;
      bySourceType[key].amount = Math.round(bySourceType[key].amount);
    }

    const dataQualityScore = totalWeight > 0 ? Math.round(weightedScore) : 0;
    const missingShare = totalWeight > 0 ? missingAmount / totalWeight : 0;

    if (totalWeight === 0) {
      warnings.push({
        code: 'NO_QUALIFIED_DATA',
        severity: 'critique',
        message: "Aucune donnée financière qualifiée : le score de confiance ne peut pas être calculé (et non 75/100 par défaut).",
      });
    }

    // --- Enveloppe d'incertitude (déterministe, non statistique) ------------
    let weightedDispersion = 0;
    for (const c of confidenceInputs) {
      const sourceType = String(c.sourceType) as DataSourceType;
      const dispersion = SOURCE_DISPERSION[sourceType] ?? 0.35;
      if (totalWeight > 0) weightedDispersion += (c.amount / totalWeight) * dispersion;
    }
    // Le carbone et le risque suivent la même enveloppe lorsqu'ils pèsent.
    const dispersionPercent = Math.max(0.03, Math.min(0.6, weightedDispersion || 0.35));

    const uncertaintyRange = {
      minTCO: Math.round(totalComprehensiveTCO * (1 - dispersionPercent)),
      maxTCO: Math.round(totalComprehensiveTCO * (1 + dispersionPercent)),
      method: 'envelope_par_type_de_source' as const,
      isStatisticalConfidenceInterval: false,
      dispersionPercent: Number(dispersionPercent.toFixed(4)),
    };

    if (unallocatedItemCount > 0) {
      warnings.push({
        code: 'TCO_INCOMPLETE_MAPPING',
        severity: 'critique',
        message: `${unallocatedItemCount} poste(s) de coût non reconnu(s) pour un total de ${Math.round(unallocatedCostTotal)} € : comptés comme coûts, mais la nomenclature doit être corrigée.`,
        amount: Math.round(unallocatedCostTotal),
      });
    }

    return {
      offerId: offer.id,
      supplierName: offer.supplierName,
      isResponsibleCandidate: offer.isResponsibleCandidate,
      apparentDirectCost: Math.round(apparentDirectCost),
      quantity,
      acquisitionTotal: Math.round(acquisitionTotal),
      logisticsTotal: Math.round(logisticsTotal),
      installationTotal: Math.round(installationTotal),
      energyConsumablesTotal: Math.round(energyConsumablesTotal),
      maintenanceRepairsTotal: Math.round(maintenanceRepairsTotal),
      replacementDefectsTotal: Math.round(replacementDefectsTotal),
      adminComplianceTotal: Math.round(totalAdminCompliance),
      salvageValueTotal: Math.round(salvageValueTotal),
      endOfLifeRecyclingTotal: Math.round(endOfLifeRecyclingTotal),
      unallocatedCostTotal: Math.round(unallocatedCostTotal),
      economicTCONominal: Math.round(economicTCONominal),
      riskExpositionTotal: Math.round(riskExpositionTotal),
      monetizedCarbonTotal: Math.round(monetizedCarbonTotal),
      totalComprehensiveTCO: Math.round(totalComprehensiveTCO),
      unitTCO: quantity > 0 ? Math.round(totalComprehensiveTCO / quantity) : Math.round(totalComprehensiveTCO),
      discountRateUsed: discountRate,
      cashFlowsByYear,
      lifecycleCostLCC: Math.round(lifecycleCostLCC),
      economicLCC: Math.round(economicLCC),
      dataQualityScore,
      dataConfidenceBreakdown: {
        weightedScore: dataQualityScore,
        method:
          'Moyenne des niveaux de confiance déclarés, pondérée par le poids financier absolu de chaque poste (matérialité). Une donnée « manquante » compte pour 0/100, jamais pour une valeur par défaut.',
        bySourceType,
        missingAmount: Math.round(missingAmount),
        missingShare: Number(missingShare.toFixed(4)),
      },
      uncertaintyRange,
      totalLifecycleCO2eTonnes: Number(totalLifecycleCO2eTonnes.toFixed(3)),
      costLineTrace,
      warnings,
      isComplete: unallocatedItemCount === 0 && totalWeight > 0,
      engineVersion: TCO_ENGINE_VERSION,
      methodology: TCO_METHODOLOGY.conventions,
    };
  }

  /**
   * Point mort économique (crossover) entre une offre conventionnelle et une
   * offre candidate.
   *
   * Méthode de référence (`discounted_cumulative_crossover`) :
   *   On compare les cumuls ACTUALISÉS des coûts complets des deux offres.
   *   `épargne(y) = coût_conv(y) − coût_resp(y)` (actualisée). Le point mort est
   *   le premier mois où l'épargne cumulée devient positive, obtenu par
   *   interpolation linéaire intra-annuelle. Le point de départ est la dépense
   *   Année 0 RÉELLE (CAPEX : acquisition, logistique/douanes, installation,
   *   administration, déploiement, fiscalité, externalités initiales).
   *
   * Correctifs v2 :
   *  - v1 utilisait le seul prix facial (prix unitaire × quantité), ignorant
   *    l'installation et la logistique : le point mort annoncé pouvait être
   *    atteint en réalité bien après l'horizon.
   *  - v1 n'actualisait pas : le résultat était totalement insensible au WACC.
   */
  public static calculateBreakEven(
    convResult: TCOCalculationResult,
    respResult: TCOCalculationResult,
    horizonYears: number
  ): BreakEvenAnalysis {
    const totalMonths = Math.max(1, Math.round(horizonYears)) * 12;
    const discountRate = respResult?.discountRateUsed ?? convResult?.discountRateUsed ?? 0;

    const apparentDelta = respResult.apparentDirectCost - convResult.apparentDirectCost;
    const apparentDeltaPercent =
      convResult.apparentDirectCost > 0
        ? Number(((apparentDelta / convResult.apparentDirectCost) * 100).toFixed(1))
        : 0;

    const capexOf = (r: TCOCalculationResult) =>
      Number(r.cashFlowsByYear?.[0]?.capexNominalCost ?? r.cashFlowsByYear?.[0]?.economicNominalCost ?? r.cashFlowsByYear?.[0]?.nominalCost ?? 0) || 0;

    const initialOutlayDelta = capexOf(respResult) - capexOf(convResult);
    const initialOutlayDeltaPercent =
      capexOf(convResult) > 0 ? Number(((initialOutlayDelta / capexOf(convResult)) * 100).toFixed(1)) : 0;

    // Économies d'exploitation nominales (indicateur d'information).
    const convOperating =
      convResult.energyConsumablesTotal +
      convResult.maintenanceRepairsTotal +
      convResult.replacementDefectsTotal +
      convResult.riskExpositionTotal +
      convResult.monetizedCarbonTotal;
    const respOperating =
      respResult.energyConsumablesTotal +
      respResult.maintenanceRepairsTotal +
      respResult.replacementDefectsTotal +
      respResult.riskExpositionTotal +
      respResult.monetizedCarbonTotal;
    const monthlyOperatingSavings = totalMonths > 0 ? (convOperating - respOperating) / totalMonths : 0;

    const hasDetailedFlows =
      Array.isArray(convResult.cashFlowsByYear) &&
      Array.isArray(respResult.cashFlowsByYear) &&
      convResult.cashFlowsByYear.length > 0 &&
      respResult.cashFlowsByYear.length > 0 &&
      typeof (convResult.cashFlowsByYear[0] as YearCashFlow).economicNominalCost === 'number' &&
      typeof (respResult.cashFlowsByYear[0] as YearCashFlow).economicNominalCost === 'number';

    if (!hasDetailedFlows) {
      // Repli documenté : méthode linéaire non actualisée (résultats v1 uniquement).
      if (initialOutlayDelta <= 0) {
        return {
          hasBreakEven: true,
          breakEvenMonth: 0,
          crossoverYear: 0,
          initialPriceDeltaPercent: apparentDeltaPercent,
          initialOutlayDelta: Math.round(initialOutlayDelta),
          initialOutlayDeltaPercent,
          monthlyOperatingSavings: Math.round(monthlyOperatingSavings),
          method: 'linear_undiscounted_legacy',
          breakEvenDescription:
            "L'offre responsable est immédiatement plus économique (surcoût à l'achat nul ou négatif).",
        };
      }
      if (monthlyOperatingSavings <= 0) {
        return {
          hasBreakEven: false,
          breakEvenMonth: null,
          crossoverYear: null,
          initialPriceDeltaPercent: apparentDeltaPercent,
          initialOutlayDelta: Math.round(initialOutlayDelta),
          initialOutlayDeltaPercent,
          monthlyOperatingSavings: Math.round(monthlyOperatingSavings),
          method: 'linear_undiscounted_legacy',
          breakEvenDescription:
            "Pas de point mort sur l'horizon : l'offre responsable présente un surcoût initial sans économies d'exploitation suffisantes.",
        };
      }
      const legacyMonth = Math.ceil(initialOutlayDelta / monthlyOperatingSavings);
      return {
        hasBreakEven: legacyMonth <= totalMonths,
        breakEvenMonth: legacyMonth,
        crossoverYear: Number((legacyMonth / 12).toFixed(1)),
        initialPriceDeltaPercent: apparentDeltaPercent,
        initialOutlayDelta: Math.round(initialOutlayDelta),
        initialOutlayDeltaPercent,
        monthlyOperatingSavings: Math.round(monthlyOperatingSavings),
        method: 'linear_undiscounted_legacy',
        breakEvenDescription:
          legacyMonth <= totalMonths
            ? `Point mort théorique (méthode linéaire non actualisée) : ${legacyMonth} mois.`
            : `Le point mort théorique (${legacyMonth} mois) dépasse l'horizon d'analyse de ${horizonYears} ans.`,
      };
    }

    // --- Méthode de référence : épargne cumulée actualisée -------------------
    const annualTotalOf = (r: TCOCalculationResult, y: number) => {
      const flow = r.cashFlowsByYear[y];
      if (!flow) return 0;
      return (
        (flow.economicDiscountedCost ?? 0) +
        (flow.riskDiscountedCost ?? 0) +
        (flow.carbonDiscountedCost ?? 0)
      );
    };

    const horizon = Math.min(convResult.cashFlowsByYear.length, respResult.cashFlowsByYear.length) - 1;

    // Épargne cumulée à l'Année 0 = écart de dépense initiale (positif = le
    // responsable engage moins de trésorerie au départ).
    let cumulativeSavings = annualTotalOf(convResult, 0) - annualTotalOf(respResult, 0);
    const savingsAtYear0 = cumulativeSavings;

    let crossMonth: number | null = savingsAtYear0 >= 0 ? 0 : null;

    for (let y = 1; y <= horizon && crossMonth === null; y++) {
      const annualSavings = annualTotalOf(convResult, y) - annualTotalOf(respResult, y);
      const after = cumulativeSavings + annualSavings;
      if (cumulativeSavings < 0 && after >= 0 && annualSavings !== 0) {
        const fraction = Math.min(Math.max(-cumulativeSavings / annualSavings, 0), 1);
        crossMonth = Math.round((y - 1) * 12 + fraction * 12);
        if (crossMonth < 1) crossMonth = 1;
      }
      cumulativeSavings = after;
    }

    const finalSavings = cumulativeSavings;
    const hasBreakEven = crossMonth !== null;
    const crossoverYear = hasBreakEven && crossMonth! > 0 ? Number((crossMonth! / 12).toFixed(1)) : hasBreakEven ? 0 : null;

    let description: string;
    if (hasBreakEven && crossMonth === 0) {
      description = `L'offre responsable engage une dépense initiale inférieure de ${Math.round(-initialOutlayDelta).toLocaleString('fr-FR')} € : elle est déjà la moins coûteuse en valeur actualisée dès l'Année 0 (WACC ${(discountRate * 100).toFixed(2)} %).`;
    } else if (hasBreakEven) {
      description = `L'offre responsable nécessite +${initialOutlayDeltaPercent} % de dépense initiale (Année 0), mais devient la moins coûteuse en valeur actualisée au mois ${crossMonth} (${crossoverYear} an(s)), au taux d'actualisation de ${(discountRate * 100).toFixed(2)} %.`;
    } else {
      description = `Pas de point mort sur l'horizon de ${horizonYears} ans : en valeur actualisée, l'offre responsable reste plus coûteuse de ${Math.round(Math.abs(finalSavings)).toLocaleString('fr-FR')} € à l'échéance (WACC ${(discountRate * 100).toFixed(2)} %).`;
    }

    return {
      hasBreakEven,
      breakEvenMonth: crossMonth,
      crossoverYear,
      initialPriceDeltaPercent: apparentDeltaPercent,
      initialOutlayDelta: Math.round(initialOutlayDelta),
      initialOutlayDeltaPercent,
      monthlyOperatingSavings: Math.round(monthlyOperatingSavings),
      method: 'discounted_cumulative_crossover',
      finalDiscountedDelta: Math.round(finalSavings),
      breakEvenDescription: description,
    };
  }

  /**
   * Analyse de sensibilité (Tornado).
   * Correctif v2 : tous les drivers sont mesurés sur le MÊME indicateur
   * (Δ de valeur actuelle nette complète), ce qui rend les barres comparables.
   * En v1, le driver WACC utilisait un Δ de LCC comparé à un Δ de TCO nominal.
   */
  public static calculateSensitivity(
    project: Project,
    convOffer: SupplierOffer,
    respOffer: SupplierOffer
  ): SensitivityDriver[] {
    const baseConv = this.calculateOfferTCO(project, convOffer);
    const baseResp = this.calculateOfferTCO(project, respOffer);
    const baseDelta = baseResp.lifecycleCostLCC - baseConv.lifecycleCostLCC;

    const deltaWith = (overrides: BuildOptions) => {
      const c = this.calculateOfferTCO(project, convOffer, overrides);
      const r = this.calculateOfferTCO(project, respOffer, overrides);
      return r.lifecycleCostLCC - c.lifecycleCostLCC;
    };

    const drivers: SensitivityDriver[] = [];
    const metric = 'delta_comprehensive_npv' as const;
    // Échelle de comparaison : VAN complète du dossier (les deux offres).
    const scale = Math.max(
      Math.abs(baseConv.lifecycleCostLCC),
      Math.abs(baseResp.lifecycleCostLCC),
      Math.abs(baseDelta)
    );

    const push = (
      parameterName: string,
      category: SensitivityDriver['category'],
      baseValue: number,
      unit: string,
      lowRaw: unknown,
      highRaw: unknown,
      lowValue: number,
      highValue: number,
      explanation: string,
      rankFromSpread: boolean
    ) => {
      const lowDelta = deltaWith({ [category === 'prix_carbone' ? 'carbonPricePerTonne' : category === 'energie' ? 'energyInflationRate' : category === 'taux_panne' ? 'failureRateMultiplier' : 'discountRate']: lowRaw } as BuildOptions);
      const highDelta = deltaWith({ [category === 'prix_carbone' ? 'carbonPricePerTonne' : category === 'energie' ? 'energyInflationRate' : category === 'taux_panne' ? 'failureRateMultiplier' : 'discountRate']: highRaw } as BuildOptions);
      const spread = Math.abs(highDelta - lowDelta);
      drivers.push({
        parameterName,
        category,
        baseValue,
        unit,
        lowValue,
        highValue,
        lowValueImpactOnDeltaTCO: Math.round(lowDelta - baseDelta),
        highValueImpactOnDeltaTCO: Math.round(highDelta - baseDelta),
        metric,
        spreadOnDeltaTCO: Math.round(spread),
        sensitivityRank: this.rankSensitivity(spread, scale),
        explanation,
      });
    };

    push(
      "Inflation & coût de l'énergie",
      'energie',
      project.energyInflationRate * 100,
      '%/an',
      project.energyInflationRate * 0.5,
      project.energyInflationRate * 2.0,
      project.energyInflationRate * 0.5 * 100,
      project.energyInflationRate * 2.0 * 100,
      "Une hausse des tarifs énergétiques amplifie l'avantage économique des équipements à haute efficacité énergétique. Convention de stress-test : −50 % / +100 % de l'hypothèse du projet (à paramétrer selon la politique de risque du client).",
      true
    );

    push(
      'Valeur tutélaire du carbone',
      'prix_carbone',
      project.carbonPricePerTonne,
      '€/tCO2e',
      project.carbonPricePerTonne * 0.5,
      project.carbonPricePerTonne * 2.0,
      project.carbonPricePerTonne * 0.5,
      project.carbonPricePerTonne * 2.0,
      "Test de −50 % / +100 % du prix du carbone retenu dans le projet. La valeur de référence et sa source doivent être vérifiées dans le référentiel d'externalités.",
      true
    );

    push(
      'Fréquence de panne & coûts curatifs',
      'taux_panne',
      1.0,
      'x multiplicateur',
      0.5,
      1.8,
      0.5,
      1.8,
      "Mesure la fragilité opérationnelle et l'exposition aux pannes hors garantie contractuelle. Convention de stress-test : 0,5x à 1,8x la sinistralité retenue (à paramétrer).",
      true
    );

    push(
      "Taux d'actualisation (WACC)",
      'taux_actualisation',
      project.discountRate * 100,
      '%',
      0.02,
      0.08,
      2,
      8,
      "Un WACC élevé pénalise les investissements à CAPEX fort même lorsque les économies futures sont significatives. Convention de stress-test : 2 %–8 % ; la valeur centrale reste celle du projet.",
      true
    );

    // Sensibilité à la durée d'analyse : variable décisionnelle majeure, absente en v1.
    {
      const shortHorizon = this.calculateOfferTCO(project, respOffer, { horizonYears: Math.max(1, Math.round(project.horizonYears * 0.6)) });
      const longHorizon = this.calculateOfferTCO(project, respOffer, { horizonYears: Math.round(project.horizonYears * 1.4) });
      const shortConv = this.calculateOfferTCO(project, convOffer, { horizonYears: Math.max(1, Math.round(project.horizonYears * 0.6)) });
      const longConv = this.calculateOfferTCO(project, convOffer, { horizonYears: Math.round(project.horizonYears * 1.4) });
      const lowDelta = shortHorizon.lifecycleCostLCC - shortConv.lifecycleCostLCC;
      const highDelta = longHorizon.lifecycleCostLCC - longConv.lifecycleCostLCC;
      const spread = Math.abs(highDelta - lowDelta);
      drivers.push({
        parameterName: "Durée d'analyse (horizon)",
        category: 'duree_de_vie',
        baseValue: project.horizonYears,
        unit: 'ans',
        lowValue: Math.max(1, Math.round(project.horizonYears * 0.6)),
        highValue: Math.round(project.horizonYears * 1.4),
        lowValueImpactOnDeltaTCO: Math.round(lowDelta - baseDelta),
        highValueImpactOnDeltaTCO: Math.round(highDelta - baseDelta),
        metric,
        spreadOnDeltaTCO: Math.round(spread),
        sensitivityRank: this.rankSensitivity(spread, scale),
        explanation:
          "L'horizon est une variable décisionnelle à part entière : un arbitrage peut s'inverser selon la durée de détention retenue.",
      });
    }

    return drivers.sort(
      (a, b) => Math.abs(b.spreadOnDeltaTCO ?? 0) - Math.abs(a.spreadOnDeltaTCO ?? 0)
    );
  }

  /**
   * Scénarios macro-économiques.
   * Correctif v2 : les scénarios sont RELATIFS aux hypothèses du projet
   * (multiplicateurs), et non des valeurs absolues codées en dur. En v1, un
   * projet à 300 €/tCO2e voyait son scénario « pessimiste » à 200 €/t, donc
   * inférieur au scénario central.
   */
  public static calculateScenarios(
    project: Project,
    offers: SupplierOffer[],
    customScenarios?: {
      scenarioName: string;
      inflationMultiplier: number;
      energyInflationMultiplier: number;
      carbonPriceMultiplier: number;
      failureRateMultiplier: number;
      discountRateDelta: number;
    }[]
  ): ScenarioResult[] {
    const definitions =
      customScenarios ??
      [
        {
          scenarioName: 'Pessimiste',
          inflationMultiplier: 1.5,
          energyInflationMultiplier: 2.0,
          carbonPriceMultiplier: 1.75,
          failureRateMultiplier: 1.4,
          discountRateDelta: 0.02,
        },
        {
          scenarioName: 'Central',
          inflationMultiplier: 1.0,
          energyInflationMultiplier: 1.0,
          carbonPriceMultiplier: 1.0,
          failureRateMultiplier: 1.0,
          discountRateDelta: 0.0,
        },
        {
          scenarioName: 'Optimiste',
          inflationMultiplier: 0.75,
          energyInflationMultiplier: 0.5,
          carbonPriceMultiplier: 0.5,
          failureRateMultiplier: 0.8,
          discountRateDelta: -0.01,
        },
      ];

    return definitions.map((sc) => {
      const parameters = {
        inflationRate: project.inflationRate * sc.inflationMultiplier,
        energyInflationRate: project.energyInflationRate * sc.energyInflationMultiplier,
        carbonPricePerTonne: project.carbonPricePerTonne * sc.carbonPriceMultiplier,
        failureRateMultiplier: sc.failureRateMultiplier,
        discountRate: Math.max(0, project.discountRate + sc.discountRateDelta),
      };

      const resultsByOfferId: ScenarioResult['resultsByOfferId'] = {};
      let lowestNominal = Infinity;
      let lowestComprehensive = Infinity;
      let bestOfferId = '';
      let bestOfferIdByNpv = '';

      for (const offer of offers) {
        const res = this.calculateOfferTCO(project, offer, parameters);
        if (res.totalComprehensiveTCO < lowestNominal) {
          lowestNominal = res.totalComprehensiveTCO;
          bestOfferId = offer.id;
        }
        if (res.lifecycleCostLCC < lowestComprehensive) {
          lowestComprehensive = res.lifecycleCostLCC;
          bestOfferIdByNpv = offer.id;
        }
        resultsByOfferId[offer.id] = {
          nominalTCO: res.totalComprehensiveTCO,
          discountedLCC: res.lifecycleCostLCC,
          deltaVsCheapestNominal: 0,
          deltaVsCheapestNpv: 0,
          isBestChoice: false,
          isBestChoiceByNpv: false,
        };
      }

      for (const offer of offers) {
        const item = resultsByOfferId[offer.id];
        item.deltaVsCheapestNominal = item.nominalTCO - lowestNominal;
        item.deltaVsCheapestNpv = item.discountedLCC - lowestComprehensive;
        item.isBestChoice = offer.id === bestOfferId;
        item.isBestChoiceByNpv = offer.id === bestOfferIdByNpv;
      }

      return {
        // Les scénarios personnalisés peuvent porter un libellé libre.
        scenarioName: sc.scenarioName as ScenarioResult['scenarioName'],
        parameters,
        isRelativeToProjectBase: true,
        resultsByOfferId,
      };
    });
  }
}
