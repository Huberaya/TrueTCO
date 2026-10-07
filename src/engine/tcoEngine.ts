/**
 * TrueTCO - Moteur de Calcul TCO, LCC, Carbone & Risques
 * Architecture financière indépendante et certifiée
 */

import {
  Project,
  SupplierOffer,
  TCOCalculationResult,
  YearCashFlow,
  BreakEvenAnalysis,
  SensitivityDriver,
  ScenarioResult,
} from '../types/domain';

export class TCOEngine {
  /**
   * Calcule le TCO complet et le LCC actualisé pour une offre donnée
   */
  public static calculateOfferTCO(
    project: Project,
    offer?: SupplierOffer | null,
    overrideParameters?: {
      discountRate?: number;
      carbonPricePerTonne?: number;
      inflationRate?: number;
      energyInflationRate?: number;
      failureRateMultiplier?: number;
    }
  ): TCOCalculationResult {
    const horizon = project?.horizonYears || 5;
    const discountRate = overrideParameters?.discountRate ?? project?.discountRate ?? 0.05;

    if (!offer) {
      return {
        offerId: '',
        supplierName: 'Aucune offre',
        isResponsibleCandidate: false,
        apparentDirectCost: 0,
        acquisitionTotal: 0,
        logisticsTotal: 0,
        installationTotal: 0,
        energyConsumablesTotal: 0,
        maintenanceRepairsTotal: 0,
        replacementDefectsTotal: 0,
        adminComplianceTotal: 0,
        salvageValueTotal: 0,
        endOfLifeRecyclingTotal: 0,
        economicTCONominal: 0,
        riskExpositionTotal: 0,
        monetizedCarbonTotal: 0,
        totalComprehensiveTCO: 0,
        unitTCO: 0,
        discountRateUsed: discountRate,
        cashFlowsByYear: [],
        lifecycleCostLCC: 0,
        dataQualityScore: 0,
        uncertaintyRange: {
          minTCO: 0,
          maxTCO: 0,
          confidenceIntervalPercent: 90,
        },
        totalLifecycleCO2eTonnes: 0,
      };
    }

    const carbonPrice = overrideParameters?.carbonPricePerTonne ?? project?.carbonPricePerTonne ?? 120;
    const inflation = overrideParameters?.inflationRate ?? project?.inflationRate ?? 0.02;
    const energyInflation = overrideParameters?.energyInflationRate ?? project?.energyInflationRate ?? 0.04;
    const failureMultiplier = overrideParameters?.failureRateMultiplier ?? 1.0;

    const unitPrice = offer?.apparentUnitPrice?.value ?? (offer?.apparentTotal ? offer.apparentTotal / (offer.quantity || 1) : 0);
    const quantity = offer?.quantity || project?.plannedVolume || 1;
    let apparentDirectCost = unitPrice * quantity;
    let acquisitionTotal = 0;
    let logisticsTotal = 0;
    let installationTotal = 0;
    let adminComplianceTotal = 0;
    let salvageValueTotal = 0;
    let endOfLifeRecyclingTotal = 0;

    // Tableaux pour stocker les flux annuels
    const annualEnergy: number[] = new Array(horizon + 1).fill(0);
    const annualMaintenance: number[] = new Array(horizon + 1).fill(0);
    const annualReplacement: number[] = new Array(horizon + 1).fill(0);
    const annualAdmin: number[] = new Array(horizon + 1).fill(0);
    const annualCarbonNominal: number[] = new Array(horizon + 1).fill(0);
    const annualCarbonTonnes: number[] = new Array(horizon + 1).fill(0);

    // Initial Outlay (Année 0)
    let year0Total = 0;

    // Analyse des postes de coûts
    for (const item of offer.costItems) {
      const baseAmount = item.amount.value;

      switch (item.category) {
        case 'acquisition':
          acquisitionTotal += baseAmount;
          year0Total += baseAmount;
          break;

        case 'logistique_douanes':
          logisticsTotal += baseAmount;
          year0Total += baseAmount;
          break;

        case 'installation_mise_en_service':
          installationTotal += baseAmount;
          year0Total += baseAmount;
          break;

        case 'energie_consommables':
          if (item.isRecurringYearly) {
            for (let y = 1; y <= horizon; y++) {
              const inflatedCost = baseAmount * Math.pow(1 + energyInflation, y - 1);
              annualEnergy[y] += inflatedCost;
            }
          } else {
            annualEnergy[1] += baseAmount;
          }
          break;

        case 'maintenance_reparations':
          if (item.isRecurringYearly) {
            for (let y = 1; y <= horizon; y++) {
              // Léger facteur d'usure avec les années
              const wearFactor = 1 + (y - 1) * 0.03;
              const inflatedCost = baseAmount * Math.pow(1 + inflation, y - 1) * wearFactor;
              annualMaintenance[y] += inflatedCost;
            }
          } else {
            annualMaintenance[1] += baseAmount;
          }
          break;

        case 'remplacement_pannes':
          {
            const adjustedCost = baseAmount * failureMultiplier;
            if (item.isRecurringYearly) {
              for (let y = 1; y <= horizon; y++) {
                const agingRisk = 1 + (y > 3 ? (y - 3) * 0.08 : 0);
                const inflatedCost = adjustedCost * Math.pow(1 + inflation, y - 1) * agingRisk;
                annualReplacement[y] += inflatedCost;
              }
            } else {
              annualReplacement[1] += adjustedCost;
            }
          }
          break;

        case 'couts_administratifs_conformite':
          if (item.isRecurringYearly) {
            for (let y = 1; y <= horizon; y++) {
              annualAdmin[y] += baseAmount * Math.pow(1 + inflation, y - 1);
            }
          } else {
            adminComplianceTotal += baseAmount;
            year0Total += baseAmount;
          }
          break;

        case 'valeur_residuelle':
          // Valeur résiduelle perçue à la fin de l'horizon
          salvageValueTotal += Math.abs(baseAmount);
          break;

        case 'fin_de_vie_recyclage':
          endOfLifeRecyclingTotal += baseAmount;
          break;

        default:
          break;
      }
    }

    // Si acquisitionTotal est vide, utiliser apparentDirectCost
    if (acquisitionTotal === 0 && apparentDirectCost > 0) {
      acquisitionTotal = apparentDirectCost;
      year0Total += apparentDirectCost;
    }

    // Totaux nominaux d'exploitation
    const energyConsumablesTotal = annualEnergy.reduce((a, b) => a + b, 0);
    const maintenanceRepairsTotal = annualMaintenance.reduce((a, b) => a + b, 0);
    const replacementDefectsTotal = annualReplacement.reduce((a, b) => a + b, 0);
    const adminRecurringTotal = annualAdmin.reduce((a, b) => a + b, 0);
    const totalAdminCompliance = adminComplianceTotal + adminRecurringTotal;

    // TCO Économique standard (hors carbone et risques)
    const economicTCONominal = 
      acquisitionTotal +
      logisticsTotal +
      installationTotal +
      energyConsumablesTotal +
      maintenanceRepairsTotal +
      replacementDefectsTotal +
      totalAdminCompliance +
      endOfLifeRecyclingTotal -
      salvageValueTotal;

    // Calcul de l'exposition aux risques : Probabilité × Impact
    let riskExpositionTotal = 0;
    for (const risk of offer.riskItems) {
      const p = Math.min(Math.max(risk.probability.value, 0), 1);
      const impact = risk.financialImpact.value;
      const expectedLoss = p * impact;
      riskExpositionTotal += expectedLoss;
    }

    // Calcul des émissions et de l'externalité carbone
    let totalLifecycleCO2eTonnes = 0;
    for (const c of offer.carbonItems) {
      const perUnit = c.emissionsPerUnitTonneCO2e?.value ?? (c.emissionsTCO2e?.value ? c.emissionsTCO2e.value / (offer.quantity || 1) : 0);
      const total = c.totalLifecycleEmissions || perUnit * offer.quantity;
      c.totalLifecycleEmissions = total;
      totalLifecycleCO2eTonnes += total;

      if (c.lifecyclePhase === 'utilisation_annuelle') {
        const annualTonne = total / horizon;
        for (let y = 1; y <= horizon; y++) {
          annualCarbonTonnes[y] += annualTonne;
          // Prix du carbone actualisé ou indexé
          annualCarbonNominal[y] += annualTonne * carbonPrice;
        }
      }
    }
    const monetizedCarbonTotal = totalLifecycleCO2eTonnes * carbonPrice;

    // TCO Global Complet (Economic + Risks + Carbon)
    const totalComprehensiveTCO = economicTCONominal + riskExpositionTotal + monetizedCarbonTotal;
    const unitTCO = offer.quantity > 0 ? totalComprehensiveTCO / offer.quantity : totalComprehensiveTCO;

    // Construction des flux d'actualisation LCC (Net Present Value)
    const cashFlowsByYear: YearCashFlow[] = [];
    let cumulativeDiscountedCost = year0Total;

    // Année 0 (Investissement initial CAPEX)
    cashFlowsByYear.push({
      year: 0,
      nominalCost: year0Total,
      discountFactor: 1.0,
      discountedCost: year0Total,
      cumulativeDiscountedCost: year0Total,
      carbonEmissionsTonnes: 0,
      carbonCostNominal: 0,
    });

    for (let y = 1; y <= horizon; y++) {
      let nominalYear = annualEnergy[y] + annualMaintenance[y] + annualReplacement[y] + annualAdmin[y];
      
      // En dernière année : déduction de la valeur résiduelle + coût de fin de vie
      if (y === horizon) {
        nominalYear += endOfLifeRecyclingTotal - salvageValueTotal;
      }

      // Ajout de la part annuelle de risque opérationnel
      const annualRiskShare = riskExpositionTotal / horizon;
      nominalYear += annualRiskShare;

      // Facteur d'actualisation WACC : 1 / (1 + r)^t
      const discountFactor = 1 / Math.pow(1 + discountRate, y);
      const discountedYear = nominalYear * discountFactor;
      cumulativeDiscountedCost += discountedYear;

      cashFlowsByYear.push({
        year: y,
        nominalCost: nominalYear,
        discountFactor: Number(discountFactor.toFixed(4)),
        discountedCost: discountedYear,
        cumulativeDiscountedCost: cumulativeDiscountedCost,
        carbonEmissionsTonnes: annualCarbonTonnes[y] || 0,
        carbonCostNominal: annualCarbonNominal[y] || 0,
      });
    }

    const lifecycleCostLCC = cumulativeDiscountedCost;

    // Calcul du Score de Qualité des Données
    let totalConfidenceWeight = 0;
    let confidenceSum = 0;

    const auditables = [
      offer?.apparentUnitPrice,
      ...(offer?.costItems || []).map((ci) => ci.amount),
      ...(offer?.carbonItems || []).map((ci) => ci.emissionsPerUnitTonneCO2e),
      ...(offer?.riskItems || []).map((ri) => ri.financialImpact),
      ...(offer?.riskItems || []).map((ri) => ri.probability),
    ];

    for (const aud of auditables) {
      if (aud) {
        const conf = aud.confidenceLevel ?? 70;
        confidenceSum += conf;
        totalConfidenceWeight++;
      }
    }

    const dataQualityScore = totalConfidenceWeight > 0 
      ? Math.round(confidenceSum / totalConfidenceWeight) 
      : 75;

    // Calcul de l'intervalle d'incertitude
    // Plus le score de qualité est bas, plus l'intervalle s'élargit
    const uncertaintyMarginPercent = Math.max(0.04, (100 - dataQualityScore) * 0.0035);
    const minTCO = Math.round(totalComprehensiveTCO * (1 - uncertaintyMarginPercent));
    const maxTCO = Math.round(totalComprehensiveTCO * (1 + uncertaintyMarginPercent));

    return {
      offerId: offer.id,
      supplierName: offer.supplierName,
      isResponsibleCandidate: offer.isResponsibleCandidate,
      apparentDirectCost: Math.round(apparentDirectCost),
      acquisitionTotal: Math.round(acquisitionTotal),
      logisticsTotal: Math.round(logisticsTotal),
      installationTotal: Math.round(installationTotal),
      energyConsumablesTotal: Math.round(energyConsumablesTotal),
      maintenanceRepairsTotal: Math.round(maintenanceRepairsTotal),
      replacementDefectsTotal: Math.round(replacementDefectsTotal),
      adminComplianceTotal: Math.round(totalAdminCompliance),
      salvageValueTotal: Math.round(salvageValueTotal),
      endOfLifeRecyclingTotal: Math.round(endOfLifeRecyclingTotal),
      economicTCONominal: Math.round(economicTCONominal),
      riskExpositionTotal: Math.round(riskExpositionTotal),
      monetizedCarbonTotal: Math.round(monetizedCarbonTotal),
      totalComprehensiveTCO: Math.round(totalComprehensiveTCO),
      unitTCO: Math.round(unitTCO),
      discountRateUsed: discountRate,
      cashFlowsByYear,
      lifecycleCostLCC: Math.round(lifecycleCostLCC),
      dataQualityScore,
      uncertaintyRange: {
        minTCO,
        maxTCO,
        confidenceIntervalPercent: 90,
      },
      totalLifecycleCO2eTonnes: Number(totalLifecycleCO2eTonnes.toFixed(1)),
    };
  }

  /**
   * Point mort économique (Break-Even Crossover)
   * Compare une offre conventionnelle de référence avec une offre candidate responsable
   */
  public static calculateBreakEven(
    convResult: TCOCalculationResult,
    respResult: TCOCalculationResult,
    horizonYears: number
  ): BreakEvenAnalysis {
    const initialPriceDelta = respResult.apparentDirectCost - convResult.apparentDirectCost;
    const initialPriceDeltaPercent = convResult.apparentDirectCost > 0
      ? Number(((initialPriceDelta / convResult.apparentDirectCost) * 100).toFixed(1))
      : 0;

    // Coûts opérationnels totaux sur la période (Énergie + Maint + Pannes + Risques + Carbone)
    const convOperatingTotal = 
      convResult.energyConsumablesTotal +
      convResult.maintenanceRepairsTotal +
      convResult.replacementDefectsTotal +
      convResult.riskExpositionTotal +
      convResult.monetizedCarbonTotal;

    const respOperatingTotal = 
      respResult.energyConsumablesTotal +
      respResult.maintenanceRepairsTotal +
      respResult.replacementDefectsTotal +
      respResult.riskExpositionTotal +
      respResult.monetizedCarbonTotal;

    const totalOperatingSavings = convOperatingTotal - respOperatingTotal;
    const totalMonths = horizonYears * 12;
    const monthlyOperatingSavings = totalMonths > 0 ? totalOperatingSavings / totalMonths : 0;

    // Si l'offre responsable est déjà moins chère à l'achat :
    if (initialPriceDelta <= 0) {
      return {
        hasBreakEven: true,
        breakEvenMonth: 0,
        crossoverYear: 0,
        initialPriceDeltaPercent,
        monthlyOperatingSavings: Math.round(monthlyOperatingSavings),
        breakEvenDescription: "L'offre responsable est immédiatement plus économique (surcoût d'acquisition nul ou négatif).",
      };
    }

    // Si l'offre responsable ne génère pas d'économies opérationnelles :
    if (monthlyOperatingSavings <= 0) {
      return {
        hasBreakEven: false,
        breakEvenMonth: null,
        crossoverYear: null,
        initialPriceDeltaPercent,
        monthlyOperatingSavings: Math.round(monthlyOperatingSavings),
        breakEvenDescription: "Pas de point mort sur l'horizon : l'offre responsable présente un surcoût initial sans générer d'économies d'exploitation suffisantes.",
      };
    }

    // Calcul du mois de croisement
    const breakEvenMonth = Math.ceil(initialPriceDelta / monthlyOperatingSavings);
    const crossoverYear = Number((breakEvenMonth / 12).toFixed(1));

    const isWithinHorizon = breakEvenMonth <= totalMonths;

    return {
      hasBreakEven: isWithinHorizon,
      breakEvenMonth: breakEvenMonth,
      crossoverYear: crossoverYear,
      initialPriceDeltaPercent,
      monthlyOperatingSavings: Math.round(monthlyOperatingSavings),
      breakEvenDescription: isWithinHorizon
        ? `L'offre responsable coûte ${initialPriceDeltaPercent > 0 ? '+' : ''}${initialPriceDeltaPercent}% à l'achat mais devient économiquement rentable après ${breakEvenMonth} mois (${crossoverYear} ans).`
        : `Le point mort théorique (${breakEvenMonth} mois) dépasse l'horizon d'analyse de ${horizonYears} ans (${totalMonths} mois).`,
    };
  }

  /**
   * Analyse de sensibilité (Tornado Drivers)
   */
  public static calculateSensitivity(
    project: Project,
    convOffer: SupplierOffer,
    respOffer: SupplierOffer
  ): SensitivityDriver[] {
    const baseConv = this.calculateOfferTCO(project, convOffer);
    const baseResp = this.calculateOfferTCO(project, respOffer);
    const baseDelta = baseResp.totalComprehensiveTCO - baseConv.totalComprehensiveTCO;

    const drivers: SensitivityDriver[] = [];

    // 1. Sensibilité Énergie (±30%)
    {
      const lowEnergyResp = this.calculateOfferTCO(project, respOffer, { energyInflationRate: project.energyInflationRate * 0.5 });
      const lowEnergyConv = this.calculateOfferTCO(project, convOffer, { energyInflationRate: project.energyInflationRate * 0.5 });
      const lowDelta = lowEnergyResp.totalComprehensiveTCO - lowEnergyConv.totalComprehensiveTCO;

      const highEnergyResp = this.calculateOfferTCO(project, respOffer, { energyInflationRate: project.energyInflationRate * 2.0 });
      const highEnergyConv = this.calculateOfferTCO(project, convOffer, { energyInflationRate: project.energyInflationRate * 2.0 });
      const highDelta = highEnergyResp.totalComprehensiveTCO - highEnergyConv.totalComprehensiveTCO;

      const spread = Math.abs(highDelta - lowDelta);
      drivers.push({
        parameterName: "Inflation & Coût de l'énergie",
        category: 'energie',
        baseValue: project.energyInflationRate * 100,
        unit: '%/an',
        lowValueImpactOnDeltaTCO: Math.round(lowDelta - baseDelta),
        highValueImpactOnDeltaTCO: Math.round(highDelta - baseDelta),
        sensitivityRank: spread > 25000 ? 'critique' : spread > 10000 ? 'fort' : 'moyen',
        explanation: 'Une hausse des tarifs énergétiques amplifie considérablement l\'avantage économique des équipements à haute efficacité énergétique.',
      });
    }

    // 2. Sensibilité Prix de la tonne de Carbone (50€ vs 250€)
    {
      const lowCarbResp = this.calculateOfferTCO(project, respOffer, { carbonPricePerTonne: 50 });
      const lowCarbConv = this.calculateOfferTCO(project, convOffer, { carbonPricePerTonne: 50 });
      const lowDelta = lowCarbResp.totalComprehensiveTCO - lowCarbConv.totalComprehensiveTCO;

      const highCarbResp = this.calculateOfferTCO(project, respOffer, { carbonPricePerTonne: 250 });
      const highCarbConv = this.calculateOfferTCO(project, convOffer, { carbonPricePerTonne: 250 });
      const highDelta = highCarbResp.totalComprehensiveTCO - highCarbConv.totalComprehensiveTCO;

      const spread = Math.abs(highDelta - lowDelta);
      drivers.push({
        parameterName: 'Valeur tutélaire du carbone',
        category: 'prix_carbone',
        baseValue: project.carbonPricePerTonne,
        unit: '€/tCO2e',
        lowValueImpactOnDeltaTCO: Math.round(lowDelta - baseDelta),
        highValueImpactOnDeltaTCO: Math.round(highDelta - baseDelta),
        sensitivityRank: spread > 25000 ? 'critique' : spread > 10000 ? 'fort' : 'moyen',
        explanation: 'Intègre les anticipations de la trajectoire Quinet et du marché des quotas européens EU ETS.',
      });
    }

    // 3. Sensibilité Taux de panne / Défaillance (±50%)
    {
      const lowFailResp = this.calculateOfferTCO(project, respOffer, { failureRateMultiplier: 0.5 });
      const lowFailConv = this.calculateOfferTCO(project, convOffer, { failureRateMultiplier: 0.5 });
      const lowDelta = lowFailResp.totalComprehensiveTCO - lowFailConv.totalComprehensiveTCO;

      const highFailResp = this.calculateOfferTCO(project, respOffer, { failureRateMultiplier: 1.8 });
      const highFailConv = this.calculateOfferTCO(project, convOffer, { failureRateMultiplier: 1.8 });
      const highDelta = highFailResp.totalComprehensiveTCO - highFailConv.totalComprehensiveTCO;

      const spread = Math.abs(highDelta - lowDelta);
      drivers.push({
        parameterName: 'Fréquence de panne & Coûts curatifs',
        category: 'taux_panne',
        baseValue: 1.0,
        unit: 'x mult',
        lowValueImpactOnDeltaTCO: Math.round(lowDelta - baseDelta),
        highValueImpactOnDeltaTCO: Math.round(highDelta - baseDelta),
        sensitivityRank: spread > 20000 ? 'fort' : spread > 8000 ? 'moyen' : 'faible',
        explanation: 'Mesure la fragilité opérationnelle et l\'exposition aux pannes hors garantie contractuelle.',
      });
    }

    // 4. Sensibilité Taux d'actualisation WACC (2% vs 8%)
    {
      const lowWaccResp = this.calculateOfferTCO(project, respOffer, { discountRate: 0.02 });
      const lowWaccConv = this.calculateOfferTCO(project, convOffer, { discountRate: 0.02 });
      const lowDelta = lowWaccResp.lifecycleCostLCC - lowWaccConv.lifecycleCostLCC;

      const highWaccResp = this.calculateOfferTCO(project, respOffer, { discountRate: 0.08 });
      const highWaccConv = this.calculateOfferTCO(project, convOffer, { discountRate: 0.08 });
      const highDelta = highWaccResp.lifecycleCostLCC - highWaccConv.lifecycleCostLCC;

      const spread = Math.abs(highDelta - lowDelta);
      drivers.push({
        parameterName: "Taux d'actualisation WACC",
        category: 'taux_actualisation',
        baseValue: project.discountRate * 100,
        unit: '%',
        lowValueImpactOnDeltaTCO: Math.round(lowDelta - baseDelta),
        highValueImpactOnDeltaTCO: Math.round(highDelta - baseDelta),
        sensitivityRank: spread > 15000 ? 'fort' : spread > 5000 ? 'moyen' : 'faible',
        explanation: 'Un WACC élevé défavorise les investissements à CAPEX fort même si les flux d\'économies futurs sont significatifs.',
      });
    }

    // Trier par impact absolu décroissant (Tornado standard)
    return drivers.sort((a, b) => {
      const spreadA = Math.abs(a.highValueImpactOnDeltaTCO - a.lowValueImpactOnDeltaTCO);
      const spreadB = Math.abs(b.highValueImpactOnDeltaTCO - b.lowValueImpactOnDeltaTCO);
      return spreadB - spreadA;
    });
  }

  /**
   * Simulation de Scénarios Macro-Économiques (Pessimiste, Central, Optimiste)
   */
  public static calculateScenarios(
    project: Project,
    offers: SupplierOffer[]
  ): ScenarioResult[] {
    const scenariosDef = [
      {
        scenarioName: 'Pessimiste' as const,
        parameters: {
          inflationRate: 0.045, // Forte inflation
          energyInflationRate: 0.08, // Choc énergétique
          carbonPricePerTonne: 200, // Durcissement réglementaire strict
          failureRateMultiplier: 1.4, // Taux de défaillance accru
          discountRate: 0.065,
        },
      },
      {
        scenarioName: 'Central' as const,
        parameters: {
          inflationRate: project.inflationRate,
          energyInflationRate: project.energyInflationRate,
          carbonPricePerTonne: project.carbonPricePerTonne,
          failureRateMultiplier: 1.0,
          discountRate: project.discountRate,
        },
      },
      {
        scenarioName: 'Optimiste' as const,
        parameters: {
          inflationRate: 0.015,
          energyInflationRate: 0.02,
          carbonPricePerTonne: 80,
          failureRateMultiplier: 0.8,
          discountRate: 0.035,
        },
      },
    ];

    return scenariosDef.map((sc) => {
      const resultsByOfferId: ScenarioResult['resultsByOfferId'] = {};

      let lowestNominal = Infinity;
      let bestOfferId = '';

      for (const offer of offers) {
        const res = this.calculateOfferTCO(project, offer, sc.parameters);
        if (res.totalComprehensiveTCO < lowestNominal) {
          lowestNominal = res.totalComprehensiveTCO;
          bestOfferId = offer.id;
        }

        resultsByOfferId[offer.id] = {
          nominalTCO: res.totalComprehensiveTCO,
          discountedLCC: res.lifecycleCostLCC,
          deltaVsCheapestNominal: 0,
          isBestChoice: false,
        };
      }

      for (const offer of offers) {
        const item = resultsByOfferId[offer.id];
        item.deltaVsCheapestNominal = item.nominalTCO - lowestNominal;
        item.isBestChoice = offer.id === bestOfferId;
      }

      return {
        scenarioName: sc.scenarioName,
        parameters: sc.parameters,
        resultsByOfferId,
      };
    });
  }
}
