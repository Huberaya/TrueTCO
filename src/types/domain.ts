/**
 * TrueTCO - Data Domain & Types
 * Modèle de données pour le Moteur d'Arbitrage Économique & Coût Complet ESG
 */

export type UserRole = 
  | 'admin'
  | 'directeur_achats'
  | 'acheteur'
  | 'finance_controleur'
  | 'rse_esg'
  | 'direction_generale';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  organizationId: string;
  avatarUrl?: string;
}

export interface Organization {
  id: string;
  name: string;
  currency: string;
  defaultDiscountRate: number; // e.g. 0.05 (5%)
  defaultCarbonPrice: number; // € per tCO2e
  currentPlan: 'starter' | 'business' | 'enterprise';
}

export type ProjectStatus = 
  | 'brouillon'
  | 'collecte_offres'
  | 'analyse'
  | 'validation_finance'
  | 'validation_achats'
  | 'decision'
  | 'adjudique'
  | 'termine'
  | 'archive';

export type ProcurementCategory = 
  | 'flotte_automobile'
  | 'informatique_it'
  | 'equipements_industriels'
  | 'packaging'
  | 'energie_batiment';

export type HorizonYears = 1 | 2 | 3 | 4 | 5 | 7 | 10;

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  companyName?: string; // e.g. Acme Corp France
  reference: string;
  category: ProcurementCategory;
  budgetCap: number;
  currency: string;
  startDate?: string; // Date de début
  analysisDurationMonths?: number; // Durée d'analyse
  horizonYears: HorizonYears;
  plannedVolume: number; // e.g. 50 units
  unitName: string; // 'véhicules', 'postes de travail', 'machines', etc.
  purchaseFrequency: 'unique' | 'annuel' | 'pluriannuel';
  objective: string;
  ownerId: string;
  ownerName: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  discountRate: number; // Taux d'actualisation WACC (e.g. 0.045)
  carbonScenario: 'bas' | 'central' | 'haut';
  carbonPricePerTonne: number; // €/tCO2e (ex: 120€/t)
  inflationRate: number; // e.g. 0.02
  energyInflationRate: number; // e.g. 0.04
  /** Hypothèses de modélisation propres au projet (surchargent les valeurs par défaut du modèle). */
  modelAssumptions?: {
    maintenanceWearRate?: number;
    failureAgingStartYear?: number;
    failureAgingRate?: number;
    carbonPriceGrowthRate?: number;
  };
}

export interface Supplier {
  id: string;
  organizationId: string;
  name: string;
  country: string;
  sector: string;
  contactName?: string;
  contactEmail: string;
  contactPhone?: string;
  certifications: string[]; // ISO 14001, EcoVadis Gold, B Corp, etc.
  defaultIncoterm: string; // EXW, FOB, DDP, CIF, CIP
  currency: string;
  paymentTerms: string; // 30j fin de mois, 60j
  moq: number; // Minimum Order Quantity
  leadTimeDays: number; // Délai moyen de livraison en jours
  historicalDefectRate: number; // e.g. 0.015 (1.5%)
  warrantyMonths: number;
  performanceScore: number; // 0-100 (Historique de performance)
  esgScore: number; // 0-100
  environmentalDataAvailable: string[]; // Données environnementales disponibles
  dataQualityScore: number; // 0-100 (Système de score de qualité des données)
}

export type DataSourceType = 
  | 'verifiee'          // 🟢 Donnée vérifiée (contrat, devis ferme, facture)
  | 'estimee'           // 🟡 Donnée estimée (modèle d'ingénierie)
  | 'utilisateur'       // 🟠 Fournie par acheteur/utilisateur
  | 'source_externe'    // 🔵 Source externe déclarée (ex. base publique) — non contrôlée par TrueTCO
  | 'donnee_sectorielle'// 🟣 Donnée de benchmark sectoriel
  | 'historique'        // 🏛️ Historique interne d'exploitation
  | 'estimation'        // 📊 Estimation probabiliste
  | 'manquante';        // 🔴 Donnée manquante / valeur par défaut

export interface AuditedValue<T = number> {
  value: T;
  unit: string;
  sourceType: DataSourceType;
  sourceName: string;
  sourceUrl?: string;
  confidenceLevel: number; // 0-100 %
  lastUpdated: string;
  updatedBy: string;
  notes?: string;
}

export interface CostBreakdownItem {
  id: string;
  category: 
    | 'acquisition'
    | 'logistique_douanes'
    | 'installation_mise_en_service'
    | 'energie_consommables'
    | 'maintenance_reparations'
    | 'remplacement_pannes'
    | 'couts_administratifs_conformite'
    | 'risques_operationnels'
    | 'externalite_carbone'
    | 'fin_de_vie_recyclage'
    | 'valeur_residuelle'; // Valeur négative (récupération d'actif)
  label: string;
  amount: AuditedValue<number>;
  isRecurringYearly: boolean;
  yearlyInflationType?: 'general' | 'energy' | 'maintenance' | 'none';
  yearOccurrences?: number[]; // [1, 2, 3, 4, 5]
}

export interface RiskExpositionItem {
  id: string;
  label: string;
  category: 'reglementaire' | 'retrait_rappel' | 'interruption_service' | 'reputationnel';
  probability: AuditedValue<number>; // 0 to 1 (e.g. 0.08)
  financialImpact: AuditedValue<number>; // in currency (e.g. 45000 €)
  expectedLoss: number; // Probability * Impact
  probabilityType: 'historique' | 'hypothese_utilisateur' | 'donnee_sectorielle' | 'estimation';
  mitigationNotes?: string;
}

export interface CarbonFootprintItem {
  id?: string;
  category?: string;
  label?: string;
  emissionsTCO2e?: AuditedValue<number>;
  scope: 'Scope 1' | 'Scope 2' | 'Scope 3 - Amont' | 'Scope 3 - Fin de vie';
  lifecyclePhase?: 'fabrication' | 'transport' | 'utilisation_annuelle' | 'fin_de_vie';
  emissionsPerUnitTonneCO2e?: AuditedValue<number>; // in tCO2e per unit
  totalLifecycleEmissions: number; // tonnes CO2e
  emissionFactorSource?: string;
}

export interface SupplierOffer {
  id: string;
  projectId: string;
  supplierId: string;
  supplierName: string;
  offerReference: string;
  isResponsibleCandidate: boolean; // Flag if this is the eco-responsible/reconditioned/circular proposal
  
  // Apparent Purchase Terms (Ce qu'on voit sur le devis standard)
  apparentUnitPrice: AuditedValue<number>;
  quantity: number;
  apparentTotal: number;
  deliveryLeadTimeWeeks: number;
  warrantyMonths: number;
  expectedLifespanYears: number;

  // Granular Cost Breakdown for TCO
  costItems: CostBreakdownItem[];

  // Carbon externalities
  carbonItems: CarbonFootprintItem[];

  // Risks and compliance exposures
  riskItems: RiskExpositionItem[];

  // Qualitative notes
  technicalSuitabilityScore: number; // 0 - 100
  notes?: string;
}

export interface YearCashFlow {
  year: number;
  /** Coût complet de l'année (direct + risque + carbone), nominal. */
  nominalCost: number;
  discountFactor: number;
  /** Coût complet de l'année, actualisé. */
  discountedCost: number;
  cumulativeDiscountedCost: number;
  carbonEmissionsTonnes: number;
  /** Part carbone du coût de l'année (incluse dans nominalCost). */
  carbonCostNominal: number;
  /** Détail par composante (nominal). La valeur résiduelle est négative (crédit). */
  components?: Record<'acquisition' | 'logistics' | 'installation' | 'energy' | 'maintenance' | 'replacement' | 'admin' | 'endOfLife' | 'salvage' | 'risk' | 'carbon', number>;
}

export interface TCOCalculationResult {
  offerId: string;
  supplierName: string;
  isResponsibleCandidate: boolean;

  // Apparent Initial Price (Devis direct)
  apparentDirectCost: number;

  // Standard TCO (Nominal sum over the analysis horizon)
  acquisitionTotal: number;
  logisticsTotal: number;
  installationTotal: number;
  energyConsumablesTotal: number;
  maintenanceRepairsTotal: number;
  replacementDefectsTotal: number;
  adminComplianceTotal: number;
  salvageValueTotal: number; // Positive credit / reduction of TCO
  endOfLifeRecyclingTotal: number;

  economicTCONominal: number; // Standard economic TCO before risks and externalities

  // Risk and Externalities integration
  riskExpositionTotal: number;
  monetizedCarbonTotal: number;
  
  // Total Comprehensive Cost (Full TCO)
  totalComprehensiveTCO: number;

  // Unit Metrics
  unitTCO: number;

  // Lifecycle Costing (LCC) - Discounted Cash Flows
  discountRateUsed: number;
  cashFlowsByYear: YearCashFlow[];
  /** Coût complet ACTUALISÉ : direct + risques + carbone (mêmes composantes que totalComprehensiveTCO). */
  lifecycleCostLCC: number;
  /** Actualisé, hors risques et hors carbone. */
  lifecycleCostDirect: number;
  /** Actualisé, risques inclus, carbone exclu. */
  lifecycleCostLCCExCarbon: number;
  /** Anomalies de données et conventions appliquées (aucune correction silencieuse). */
  warnings: { code: string; message: string; itemId?: string }[];
  /** Valeurs non arrondies, pour les exports et les tests. */
  exact: { economicTCONominal: number; totalComprehensiveTCO: number; lifecycleCostLCC: number; lifecycleCostDirect: number; lifecycleCostLCCExCarbon: number; monetizedCarbonTotal: number; riskExpositionTotal: number };

  // Data Quality and Uncertainty
  dataQualityScore: number; // 0 - 100%
  /**
   * Fourchette du TCO complet nominal sur les scénarios pessimiste / central / optimiste.
   * Ce n'est PAS un intervalle de confiance statistique (voir la simulation de robustesse).
   */
  uncertaintyRange: {
    minTCO: number;
    maxTCO: number;
    basis: 'scenarios';
  };

  // Environmental Impact
  totalLifecycleCO2eTonnes: number;
}

export interface BreakEvenAnalysis {
  hasBreakEven: boolean;
  breakEvenMonth: number | null; // e.g. 28 months
  initialPriceDeltaPercent: number; // e.g. +14.2% initial acquisition cost
  monthlyOperatingSavings: number; // économie mensuelle moyenne hors investissement initial (nominal)
  breakEvenDescription: string;
  crossoverYear: number | null;
  /** Mois de croisement sur les flux cumulés NOMINAUX (breakEvenMonth est sur les flux ACTUALISÉS). */
  breakEvenMonthNominal?: number | null;
  /** Écart cumulé actualisé en fin d'horizon : positif = l'offre candidate est moins chère. */
  finalAdvantageDiscounted?: number;
  finalAdvantageNominal?: number;
  /** true si l'avantage s'inverse après le premier croisement. */
  crossesBackAfterBreakEven?: boolean;
  /** Écart cumulé (candidate − référence) par année : négatif = candidate moins chère. */
  cumulativeDifference?: { year: number; nominal: number; discounted: number }[];
}

export interface SensitivityDriver {
  parameterName: string;
  category: 'energie' | 'duree_de_vie' | 'taux_panne' | 'prix_carbone' | 'taux_actualisation' | 'cout_maintenance' | 'cout_energie' | 'prix_achat' | 'inflation' | 'valeur_residuelle' | 'exposition_risques';
  baseValue: number;
  unit: string;
  /** Valeurs testées (mêmes unités que baseValue). */
  lowValue?: number;
  highValue?: number;
  /** Variation de l'ÉCART de coût complet actualisé (candidate − référence) par rapport au cas central, en €. */
  lowValueImpactOnDeltaTCO: number;
  highValueImpactOnDeltaTCO: number;
  /** 'critique' = la décision change de camp dans la plage testée. */
  sensitivityRank: 'critique' | 'fort' | 'moyen' | 'faible';
  flipsDecision?: boolean;
  /** Valeur du paramètre pour laquelle les deux offres coûtent autant (null = aucun basculement dans la plage étendue). */
  switchingValue?: number | null;
  explanation: string;
}

export interface ScenarioResult {
  scenarioName: 'Pessimiste' | 'Central' | 'Optimiste';
  parameters: {
    inflationRate: number;
    energyInflationRate: number;
    carbonPricePerTonne: number;
    failureRateMultiplier: number;
    discountRate: number;
  };
  /** 'project' : valeurs du projet ; 'model_default' : hypothèse par défaut du modèle, non sourcée. */
  parametersSource: 'project' | 'model_default';
  /** Offre au meilleur coût complet ACTUALISÉ (critère de décision). */
  bestOfferId: string;
  resultsByOfferId: Record<string, {
    nominalTCO: number;
    discountedLCC: number;
    deltaVsCheapestNominal: number;
    deltaVsBestLCC: number;
    /** Meilleure offre selon le coût complet actualisé. */
    isBestChoice: boolean;
  }>;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  projectId?: string;
  offerId?: string;
  entityName: string; // e.g. 'Coût énergie annuel'
  fieldChanged: string;
  oldValue: string;
  newValue: string;
  unit?: string;
  justification: string;
  /** 'server' : constat enregistré par le serveur. 'client_declared' : justification saisie par l'utilisateur (identité et date restent celles du serveur). */
  origin?: 'server' | 'client_declared';
}

export interface ExternalityReferenceBenchmark {
  id: string;
  name: string;
  category: 'carbone' | 'wacc' | 'energie_kwh' | 'recyclage' | 'energie' | 'dechets' | 'pollution_locale';
  value: number;
  unit: string;
  source: string;
  sourceUrl?: string;
  documentRef?: string;
  lastUpdated: string;
  countryScope: string;
  methodology: string;
  valueRange?: [number, number];
  confidenceLevel: number; // 0-100%
}
