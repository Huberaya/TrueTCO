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
  | 'source_externe'    // 🔵 Source externe certifiée (ADEME, Quinet, WEC, etc.)
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
    | 'indisponibilite_operationnelle'
    | 'fiscalite_taxes'
    | 'deploiement'
    | 'valeur_residuelle'; // Valeur négative (récupération d'actif)
  label: string;
  amount: AuditedValue<number>;
  isRecurringYearly: boolean;
  yearlyInflationType?: 'general' | 'energy' | 'maintenance' | 'none';
  yearOccurrences?: number[]; // [1, 2, 3, 4, 5]
  /**
   * Alias toléré de `yearOccurrences`, émis historiquement par les imports ERP
   * et le parser IA. Le moteur honore les deux champs (aucune perte silencieuse).
   */
  annualOccurrenceYears?: number[];
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
  /** Coût nominal complet de l'année (économique + risque + carbone) — v2 */
  nominalCost: number;
  discountFactor: number;
  /** Coût actualisé complet (économique + risque + carbone) — v2 */
  discountedCost: number;
  cumulativeDiscountedCost: number;
  carbonEmissionsTonnes: number;
  carbonCostNominal: number;
  // --- Ventilation v2 (traçabilité auditable) -----------------------------
  economicNominalCost?: number;
  economicDiscountedCost?: number;
  capexNominalCost?: number;
  opexNominalCost?: number;
  riskNominalCost?: number;
  riskDiscountedCost?: number;
  carbonDiscountedCost?: number;
  salvageNominalCost?: number;
  endOfLifeNominalCost?: number;
}

export interface CostLineTrace {
  id: string;
  label: string;
  declaredCategory: string;
  category: string;
  amountNominal: number;
  amountDiscounted: number;
  occurrences: number[];
  indexation: string;
  sourceName: string;
  sourceType: DataSourceType | string;
  confidenceLevel: number;
  isCredit: boolean;
}

export interface CalculationWarning {
  code: string;
  severity: 'critique' | 'avertissement' | 'information';
  message: string;
  amount?: number;
  itemId?: string;
}

export interface DataConfidenceBreakdown {
  weightedScore: number;
  method: string;
  bySourceType: Record<string, { amount: number; share: number }>;
  missingAmount: number;
  missingShare: number;
}

export interface UncertaintyRange {
  minTCO: number;
  maxTCO: number;
  /** @deprecated v1 : champ trompeur, conservé en optionnel pour compatibilité */
  confidenceIntervalPercent?: number;
  method?: 'envelope_par_type_de_source';
  isStatisticalConfidenceInterval?: boolean;
  dispersionPercent?: number;
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
  /** Montant des postes dont la catégorie n'a pas été reconnue (comptés prudemment) */
  unallocatedCostTotal?: number;

  quantity?: number;

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
  /**
   * Valeur Actuelle Nette du coût complet : économique + risque + carbone.
   * v2 : périmètre strictement identique à `totalComprehensiveTCO` (nominal).
   */
  lifecycleCostLCC: number;
  /** Valeur Actuelle Nette du périmètre économique seul (hors risque et carbone) */
  economicLCC?: number;

  // Data Quality and Uncertainty
  dataQualityScore: number; // 0 - 100%, pondéré par la matérialité
  uncertaintyRange: UncertaintyRange;
  dataConfidenceBreakdown?: DataConfidenceBreakdown;

  // Environmental Impact
  totalLifecycleCO2eTonnes: number;

  // --- Traçabilité & auditabilité (v2) ------------------------------------
  costLineTrace?: CostLineTrace[];
  warnings?: CalculationWarning[];
  isComplete?: boolean;
  engineVersion?: string;
  methodology?: Record<string, string>;
}

export interface BreakEvenAnalysis {
  hasBreakEven: boolean;
  breakEvenMonth: number | null; // e.g. 28 months
  initialPriceDeltaPercent: number; // Écart de prix facial (information)
  monthlyOperatingSavings: number; // e.g. 1,420 € / month saved during usage (nominal)
  breakEvenDescription: string;
  crossoverYear: number | null;
  /** Écart réel de dépense Année 0 (CAPEX), base du calcul du point mort — v2 */
  initialOutlayDelta?: number;
  initialOutlayDeltaPercent?: number;
  /** Méthode utilisée : `discounted_cumulative_crossover` (référence) ou repli legacy */
  method?: 'discounted_cumulative_crossover' | 'linear_undiscounted_legacy';
  finalDiscountedDelta?: number;
}

export interface SensitivityDriver {
  parameterName: string;
  category: 'energie' | 'duree_de_vie' | 'taux_panne' | 'prix_carbone' | 'taux_actualisation' | 'cout_maintenance';
  baseValue: number;
  unit: string;
  lowValueImpactOnDeltaTCO: number; // Impact in € on difference vs baseline
  highValueImpactOnDeltaTCO: number;
  lowValue?: number;
  highValue?: number;
  /** Indicateur commun sur lequel tous les drivers sont mesurés (comparabilité) */
  metric?: 'delta_comprehensive_npv';
  spreadOnDeltaTCO?: number;
  sensitivityRank: 'critique' | 'fort' | 'moyen' | 'faible';
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
  isRelativeToProjectBase?: boolean;
  resultsByOfferId: Record<string, {
    nominalTCO: number;
    discountedLCC: number;
    deltaVsCheapestNominal: number;
    deltaVsCheapestNpv?: number;
    isBestChoice: boolean;
    isBestChoiceByNpv?: boolean;
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
}

export interface ExternalityReferenceBenchmark {
  /**
   * `true` lorsque la valeur est une HYPOTHÈSE DE DÉMONSTRATION et non une
   * donnée institutionnelle vérifiée. L'interface doit alors l'afficher
   * explicitement et interdire sa présentation comme référence officielle.
   */
  isDemoHypothesis?: boolean;
  /** Avertissement affiché à l'utilisateur (millésime, périmètre, limites). */
  verificationNote?: string;
  id: string;
  name: string;
  category: 'carbone' | 'wacc' | 'energie_kwh' | 'recyclage' | 'energie' | 'dechets' | 'pollution_locale';
  value: number;
  unit: string;
  source: string;
  sourceUrl?: string;
  documentRef: string;
  lastUpdated: string;
  countryScope: string;
  methodology: string;
  valueRange?: [number, number];
  confidenceLevel: number; // 0-100%
}

/**
 * =============================================================================
 * CHANTIER 7 : CONNECTEURS ERP & e-PROCUREMENT
 * =============================================================================
 */
export type ErpSystemCode = 'sap_ariba' | 'coupa' | 'ivalua' | 'jaggaer' | 'generic_rest';

export interface ErpConnector {
  id: string;
  name: string;
  code: ErpSystemCode;
  version: string;
  status: 'connected' | 'syncing' | 'idle' | 'error' | 'disabled';
  endpointUrl: string;
  authType: 'oauth2_client_credentials' | 'api_key_bearer' | 'basic_cxml';
  clientId?: string;
  apiKeyMasked?: string;
  organizationId: string;
  lastSyncTimestamp: string;
  syncFrequency: 'realtime_webhook' | 'hourly' | 'daily' | 'manual';
  autoPushWinnerAward: boolean;
  costCenterMapping: Record<string, string>;
  inboundOffersCount: number;
  outboundAwardsCount: number;
  description: string;
  protocol: 'REST / JSON' | 'cXML 1.2' | 'SOAP / XML' | 'Webhook HMAC';
}

export interface ErpSyncLog {
  id: string;
  connectorId: string;
  connectorName: string;
  direction: 'inbound' | 'outbound';
  timestamp: string;
  status: 'success' | 'failed' | 'warning';
  action: string;
  entityReference: string;
  payloadPreview: string;
  httpCode: number;
  durationMs: number;
  details: string;
}

/**
 * =============================================================================
 * CHANTIER 8 : PARSER IA / OCR MULTIMODAL DE DEVIS & FICHES FDES / EPD
 * =============================================================================
 */
export type DocumentCategory = 'devis_fournisseur' | 'fiche_fdes_epd';

export interface DocumentParseResult {
  id: string;
  filename: string;
  docCategory: DocumentCategory;
  parsedAt: string;
  confidenceScore: number; // 0-100%
  /**
   * 'unavailable' : aucun moteur d'extraction disponible → aucune donnée n'a
   * été produite et une saisie humaine est requise. L'interface ne doit pas
   * proposer d'injecter ce résultat dans le projet.
   */
  extractionStatus?: 'extracted' | 'unavailable';
  extractionMessage?: string;
  requiresHumanInput?: boolean;
  extractedSupplier: {
    name: string;
    siren?: string;
    country?: string;
    contact?: string;
  };
  offerReference: string;
  currency: string;
  quantity: number;
  unitName: string;
  apparentUnitPrice: number;
  apparentTotal: number;
  deliveryLeadTimeWeeks: number;
  warrantyMonths: number;
  expectedLifespanYears: number;
  technicalSuitabilityScore: number;
  costItems: Array<{
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
      | 'valeur_residuelle';
    label: string;
    amount: number;
    sourceType: DataSourceType;
    confidenceLevel: number;
    notes?: string;
  }>;
  carbonItems: Array<{
    scope: 'Scope 1' | 'Scope 2' | 'Scope 3 - Amont' | 'Scope 3 - Fin de vie';
    label: string;
    emissionsTCO2e: number; // total for the batch
    emissionsPerUnit: number;
    factorSource: string;
    confidenceLevel: number;
  }>;
  riskItems: Array<{
    category: 'reglementaire' | 'retrait_rappel' | 'interruption_service' | 'reputationnel';
    description: string;
    financialImpact: number;
    probability: number; // 0-1
    riskLevel?: 'faible' | 'moyen' | 'eleve' | 'critique';
  }>;
  isResponsibleCandidate: boolean;
  summaryAnalysis: string;
  keyDifferentiators: string[];
}

/**
 * =============================================================================
 * CHANTIER 9 : SIGNATURE ÉLECTRONIQUE CERTIFIÉE (eIDAS & SCELLÉ NUMÉRIQUE)
 * =============================================================================
 */
export type SignatureRole = 'acheteur' | 'rse' | 'finance' | 'direction';

export interface DigitalSignatureRecord {
  id: string;
  role: SignatureRole;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
  signedAt: string;
  status: 'signe' | 'en_attente' | 'refuse';
  sha256Hash: string;
  certificateSerial: string;
  certificateAuthority: string; // e.g. 'CertEurope / ANSSI eIDAS QES'
  signatureDataUrl?: string; // handwritten canvas PNG
  ipAddress: string;
  auditTrailRef: string;
  comment?: string;
}

export interface AdjudicationCertificate {
  certificateId: string;
  projectId: string;
  projectReference: string;
  winningOfferId: string;
  winningSupplierName: string;
  awardedTotalAmount: number;
  awardedTcoAmount: number;
  awardedCarbonAvoidedTonnes: number;
  generatedAt: string;
  sealedHash: string;
  signatures: DigitalSignatureRecord[];
  isFullyExecuted: boolean;
  /** Statut juridique réel du document. 'non_qualifiee' tant qu'aucun
   *  prestataire de confiance eIDAS n'est intégré. */
  legalStatus?: 'non_qualifiee' | 'qualifiee';
  /** Avertissement légal affiché et imprimé avec le document. */
  legalDisclaimer?: string;
  /** Marqueur interne : 'false' = aucun contenu fabriqué (identités, séries, IP). */
  containsFabricatedIdentity?: boolean;
  /** Carbone du scénario retenu (tCO2e) — jamais un « évitement » sans base de comparaison. */
  awardedCarbonTonnes?: number;
}

/**
 * =============================================================================
 * CHANTIER 10 : REPORTING CSRD (ESRS E1) & TAXONOMIE VERTE EUROPÉENNE
 * =============================================================================
 */
export interface TaxonomyActivityAlignment {
  activityCode: string; // e.g. '6.5', '3.6', '7.1'
  activityName: string;
  category: 'mobilite' | 'equipements' | 'batiment' | 'it_circulaire';
  capexAmount: number;
  opexAmount: number;
  isEligible: boolean;
  isAligned: boolean; // Satisfies TSC + DNSH + MSS
  technicalScreeningMet: boolean; // Critères d'examen technique
  dnshCriteriaMet: boolean; // Do No Significant Harm
  minimumSafeguardsMet: boolean; // Droits de l'homme et droit social
  ghgAvoidedTonnes: number;
}

export interface CsrdExecutiveReport {
  fiscalYear: number;
  organizationId: string;
  organizationName: string;
  reportingDate: string;
  totalProcurementCapex: number;
  totalProcurementOpex: number;
  
  // Taxonomie ratios
  taxonomyEligibleCapexPercent: number; // e.g. 84.5%
  taxonomyAlignedCapexPercent: number;   // e.g. 72.8%
  taxonomyEligibleOpexPercent: number;  // e.g. 68.0%
  taxonomyAlignedOpexPercent: number;    // e.g. 59.4%

  // Indicateurs ESRS E1 Climat
  totalAvoidedGhgTCO2e: number;
  internalCarbonPriceEur: number;
  carbonPriceTrajectoryYear: number;
  financialSavingsFromCarbonTax: number;
  scope1AvoidedTCO2e: number;
  scope2AvoidedTCO2e: number;
  scope3UpstreamAvoidedTCO2e: number;

  activities: TaxonomyActivityAlignment[];
  auditorVerificationStatus:
    | 'non_verifie'
    | 'certifie_sans_reserve'
    | 'revue_en_cours'
    | 'conforme_csrd';
  /**
   * Nom de l'organisme ayant réellement revu le rapport. VIDE tant qu'aucun
   * auditeur n'a été mandaté : TrueTCO ne peut pas attribuer une revue à un
   * tiers qui ne l'a pas réalisée.
   */
  independentAuditorName: string;
  /** Avertissements de complétude (données manquantes, périmètres non évalués). */
  dataWarnings?: string[];
  /** Base de calcul effectivement utilisée pour chaque agrégat. */
  computationBasis?: Record<string, string>;
}
