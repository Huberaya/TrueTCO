import * as XLSX from 'xlsx';
import { Project, SupplierOffer, AuditLogEntry } from '../types/domain';
import { DecisionRunResult } from './serverData';

export class ExcelExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExcelExportValidationError';
  }
}

export class ExcelExportService {
  /**
   * Produit un classeur à partir des calculs serveur de l'exécution fournie.
   * Le fichier n'est ni signé, ni certifié, ni validé par un auditeur externe.
   * Les résultats incomplets, périmés ou incompatibles sont refusés : l'export
   * ne doit jamais reclasser les lignes restantes ni transformer un rang en choix.
   */
  public static exportFinancialWorkbook(
    project: Project,
    offers: SupplierOffer[],
    decisionRun: DecisionRunResult,
    auditLogs: AuditLogEntry[]
  ): void {
    const workbook = this.buildFinancialWorkbook(project, offers, decisionRun, auditLogs);
    const cleanProjectRef = project.reference.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `TrueTCO_Modele_Financier_${cleanProjectRef}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }

  private static resolveRankedCalculations(
    project: Project,
    offers: SupplierOffer[],
    decisionRun: DecisionRunResult
  ): { offer: SupplierOffer; calc: DecisionRunResult['calculationsByOfferId'][string] }[] {
    if (decisionRun.projectId !== project.id) {
      throw new ExcelExportValidationError('Export bloqué : le calcul serveur ne correspond pas au dossier sélectionné.');
    }
    if (decisionRun.freshness?.dataChangedSinceRun || decisionRun.freshness?.engineChangedSinceRun) {
      throw new ExcelExportValidationError('Export bloqué : le calcul serveur est périmé. Relancez le calcul avant l’export.');
    }
    if (decisionRun.blockingIssues?.length) {
      throw new ExcelExportValidationError('Export bloqué : le calcul serveur contient des erreurs bloquantes.');
    }
    if (!Array.isArray(decisionRun.warnings)) {
      throw new ExcelExportValidationError('Export bloqué : les avertissements et qualifications renvoyés par le serveur sont absents.');
    }
    if (
      !decisionRun.dataCompleteness ||
      !Number.isInteger(decisionRun.dataCompleteness.totalCostItems) ||
      decisionRun.dataCompleteness.totalCostItems < 0 ||
      !decisionRun.dataCompleteness.byQualityStatus ||
      typeof decisionRun.dataCompleteness.byQualityStatus !== 'object'
    ) {
      throw new ExcelExportValidationError('Export bloqué : la complétude des données renvoyée par le serveur est absente ou invalide.');
    }
    if (
      decisionRun.dataCompleteness.totalCostItems > 0 &&
      !decisionRun.warnings.some((warning) => /Convention métier non confirmée/i.test(warning))
    ) {
      throw new ExcelExportValidationError(
        'Export bloqué : cette exécution ne qualifie pas la convention de fréquence non confirmée. Relancez le calcul serveur avant export.'
      );
    }
    if (!Array.isArray(decisionRun.ranking) || decisionRun.ranking.length === 0) {
      throw new ExcelExportValidationError('Export bloqué : aucun classement serveur exploitable n’est fourni.');
    }
    if (!decisionRun.calculationsByOfferId || typeof decisionRun.calculationsByOfferId !== 'object') {
      throw new ExcelExportValidationError('Export bloqué : les résultats détaillés du serveur sont absents.');
    }

    const offersById = new Map<string, SupplierOffer>();
    for (const offer of offers) {
      if (offersById.has(offer.id)) {
        throw new ExcelExportValidationError('Export bloqué : plusieurs offres locales portent le même identifiant.');
      }
      offersById.set(offer.id, offer);
    }

    const rankedIds = new Set<string>();
    const calculated: { offer: SupplierOffer; calc: DecisionRunResult['calculationsByOfferId'][string] }[] = [];
    for (const [index, entry] of decisionRun.ranking.entries()) {
      if (!entry?.offerId || rankedIds.has(entry.offerId)) {
        throw new ExcelExportValidationError(`Export bloqué : identifiant d’offre absent ou dupliqué au rang ${index + 1}.`);
      }
      rankedIds.add(entry.offerId);

      const offer = offersById.get(entry.offerId);
      const calc = decisionRun.calculationsByOfferId[entry.offerId];
      if (!offer || offer.projectId !== project.id || !calc || calc.offerId !== entry.offerId) {
        throw new ExcelExportValidationError(
          `Export bloqué : les détails de l’offre classée « ${entry.offerReference || entry.offerId} » sont absents ou incompatibles.`
        );
      }
      if (entry.supplierName !== offer.supplierName || entry.offerReference !== offer.offerReference || calc.supplierName !== offer.supplierName) {
        throw new ExcelExportValidationError(
          `Export bloqué : l’identité de l’offre « ${entry.offerReference || entry.offerId} » diffère entre le classement, le détail et le dossier actuel.`
        );
      }
      if (!Array.isArray(calc.cashFlowsByYear)) {
        throw new ExcelExportValidationError(
          `Export bloqué : les flux serveur de l’offre « ${entry.offerReference || entry.offerId} » sont absents.`
        );
      }
      const requiredNumericFields = [
        'apparentDirectCost',
        'adminComplianceTotal',
        'economicTCONominal',
        'lifecycleCostLCC',
        'monetizedCarbonTotal',
        'riskExpositionTotal',
        'totalComprehensiveTCO',
        'dataQualityScore',
        'totalLifecycleCO2eTonnes',
      ] as const;
      if (requiredNumericFields.some((field) => !Number.isFinite(calc[field]))) {
        throw new ExcelExportValidationError(
          `Export bloqué : un agrégat financier ou carbone de l’offre « ${entry.offerReference || entry.offerId} » est absent ou invalide.`
        );
      }
      calculated.push({ offer, calc });
    }

    if (!decisionRun.recommendation || !['ferme', 'conditionnel', 'indetermine'].includes(decisionRun.recommendation.status)) {
      throw new ExcelExportValidationError('Export bloqué : le statut de recommandation serveur est absent ou inconnu.');
    }
    if (decisionRun.recommendation.status !== 'indetermine') {
      const proposedId = decisionRun.recommendation.offerId;
      if (!proposedId || !rankedIds.has(proposedId)) {
        throw new ExcelExportValidationError('Export bloqué : l’option proposée par le serveur ne correspond à aucune offre détaillée du classement.');
      }
    }

    return calculated;
  }

  /** Construit le classeur en mémoire afin que son contenu puisse être vérifié sans télécharger de fichier. */
  public static buildFinancialWorkbook(
    project: Project,
    offers: SupplierOffer[],
    decisionRun: DecisionRunResult,
    auditLogs: AuditLogEntry[]
  ): XLSX.WorkBook {
    const calculated = this.resolveRankedCalculations(project, offers, decisionRun);
    const workbook = XLSX.utils.book_new();

    // ==========================================
    // TAB 1: SYNTHÈSE & DÉCISION FINANCIÈRE
    // ==========================================
    const tab1Data: any[][] = [
      ['TRUETCO - RAPPORT FINANCIER D\'ARBITRAGE ÉCONOMIQUE & COÛT COMPLET (LCC)'],
      [`Export non signé/non certifié · calcul serveur ${decisionRun.runId} · moteur ${decisionRun.engineVersion} · méthodologie ${decisionRun.methodologyVersion}`],
      [''],
      ['1. PARAMÈTRES GÉNÉRAUX DE LA CONSULTATION'],
      ['Nom du Projet', project.name],
      ['Référence Consultation', project.reference],
      ['Catégorie d\'Achat', project.category],
      ['Entité Juridique / Organisation', project.companyName || project.organizationId],
      ['Budget plafond (CAPEX max)', project.budgetCap, project.currency],
      ['Volume Contractuel', project.plannedVolume, project.unitName],
      ['Horizon d\'Analyse Retenu', project.horizonYears, 'ans'],
      ['Taux d\'Actualisation Financière (WACC)', (project.discountRate * 100).toFixed(2), '%'],
      ['Inflation Énergétique Annuelle Projetée', (project.energyInflationRate * 100).toFixed(2), '%'],
      [`Prix carbone retenu (source à vérifier)`, project.carbonPricePerTonne, `${project.currency} / tCO2e`],
      ['Exécution serveur', decisionRun.runId],
      ['Date d\'exécution du calcul', new Date(decisionRun.createdAt).toLocaleString('fr-FR')],
      ['Révision des données', decisionRun.inputVersion],
      ['Empreinte SHA-256 des entrées', decisionRun.inputFingerprint],
      ['Fraîcheur à l’export', decisionRun.freshness?.explanation ?? 'Non fournie dans cette exécution'],
      ['Statut de recommandation du moteur', decisionRun.recommendation.status],
      ['Motif de recommandation renvoyé par l’API', decisionRun.recommendation.reason],
      ['Identifiant de l’option proposée par l’API', decisionRun.recommendation.status === 'indetermine' ? 'Aucune recommandation ferme' : decisionRun.recommendation.offerId ?? 'Non fournie'],
      ['Avertissements et qualifications renvoyés par le serveur'],
      ...(decisionRun.warnings.length > 0
        ? decisionRun.warnings.map((warning) => ['AVERTISSEMENT', warning])
        : [['Aucun avertissement renvoyé par le serveur.']]),
      [''],
      ['2. COMPARATIF SYNTHÉTIQUE DES OFFRES CANDIDATES'],
      [
        'Rang fourni par l’API',
        'Fournisseur',
        'Référence Offre',
        'Marqueur responsable (saisi)',
        `Prix facial (référence, ${project.currency})`,
        `Administration / conformité (${project.currency})`,
        `Fiscalité / taxes (${project.currency})`,
        `TCO économique nominal (serveur, ${project.currency})`,
        `LCC actualisé (serveur, ${project.currency})`,
        `Monétisation carbone (serveur, ${project.currency})`,
        `Exposition aux risques (serveur, ${project.currency})`,
        `TCO complet nominal (serveur, ${project.currency})`,
        'Qualité des données (%)',
      ],
    ];

    calculated.forEach(({ offer, calc }, index) => {
      tab1Data.push([
        index + 1,
        offer.supplierName,
        offer.offerReference,
        offer.isResponsibleCandidate ? 'Oui (marqueur saisi)' : 'Non',
        calc.apparentDirectCost,
        calc.adminComplianceTotal,
        typeof calc.taxesTotal === 'number' ? calc.taxesTotal : 'Non disponible dans cette exécution',
        calc.economicTCONominal,
        calc.lifecycleCostLCC,
        calc.monetizedCarbonTotal,
        calc.riskExpositionTotal,
        calc.totalComprehensiveTCO,
        calc.dataQualityScore,
      ]);
    });

    const ws1 = XLSX.utils.aoa_to_sheet(tab1Data);
    XLSX.utils.book_append_sheet(workbook, ws1, 'Synthèse Décision');

    // ==========================================
    // TAB 2 : ÉCHÉANCIER CASH-FLOWS ACTUALISÉS (LCC)
    // ==========================================
    const tab2Data: any[][] = [
      ['ÉCHÉANCIER PLURIANNUEL DES CASH-FLOWS & ACTUALISATION AU COÛT DU CAPITAL (WACC)'],
      [`Taux WACC appliqué : ${(project.discountRate * 100).toFixed(2)}% | Horizon : ${project.horizonYears} ans`],
      [''],
    ];

    calculated.forEach(({ offer, calc }) => {
      tab2Data.push([`>>> OFFRE : ${offer.supplierName} (${offer.offerReference})`]);
      tab2Data.push([
        'Période',
        `Flux nominal complet (${project.currency})`,
        'Facteur d\'actualisation (serveur)',
        `Flux actualisé complet (${project.currency})`,
        'Cumul actualisé (€)',
        'Émissions de la période (tCO2e)',
      ]);

      // Inclut l'année 0 et les années suivantes telles que renvoyées par le moteur.
      calc.cashFlowsByYear.forEach((flow) => {
        tab2Data.push([
          `Année ${flow.year}`,
          flow.nominalCost,
          flow.discountFactor,
          flow.discountedCost,
          flow.cumulativeDiscountedCost,
          flow.carbonEmissionsTonnes,
        ]);
      });

      tab2Data.push([
        'TOTAL LCC ACTUALISÉ',
        '',
        '',
        '',
        calc.lifecycleCostLCC,
        '',
      ]);
      tab2Data.push(['']);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(tab2Data);
    XLSX.utils.book_append_sheet(workbook, ws2, 'CashFlows LCC (WACC)');

    // ==========================================
    // TAB 3 : DÉCOMPOSITION DÉTAILLÉE DU TCO (CBS)
    // ==========================================
    const tab3Data: any[][] = [
      ['TRACES DES POSTES DE COÛT DU RÉSULTAT SERVEUR'],
      ['Ces traces reprennent les lignes de coût renvoyées par le moteur ; elles ne constituent pas une ventilation exhaustive des risques et du carbone. Les agrégats serveur figurent dans la synthèse et les données d’émissions disponibles dans l’onglet Carbone.'],
      [''],
      [
        'Fournisseur',
        'Référence offre',
        'Poste',
        'Catégorie déclarée',
        'Catégorie interprétée par le moteur',
        `Montant nominal (${project.currency})`,
        `Montant actualisé (${project.currency})`,
        'Années d’occurrence',
        'Occurrences par an',
        'Indexation',
        'Source déclarée',
        'Type de source déclaré',
        'Niveau déclaré (%)',
        'Crédit',
      ],
    ];

    calculated.forEach(({ offer, calc }) => {
      const lines = calc.costLineTrace ?? [];
      if (lines.length === 0) {
        tab3Data.push([offer.supplierName, offer.offerReference, 'Aucune trace détaillée dans cette exécution']);
        return;
      }
      lines.forEach((line) => {
        tab3Data.push([
          offer.supplierName,
          offer.offerReference,
          line.label,
          line.declaredCategory,
          line.category,
          line.amountNominal,
          line.amountDiscounted,
          line.occurrences.map((year) => `Année ${year}`).join(', '),
          line.occurrencesPerYear ?? '',
          line.indexation,
          line.sourceName,
          line.sourceType,
          line.confidenceLevel,
          line.isCredit ? 'Oui' : 'Non',
        ]);
      });
    });

    const ws3 = XLSX.utils.aoa_to_sheet(tab3Data);
    XLSX.utils.book_append_sheet(workbook, ws3, 'Décomposition TCO (CBS)');

    // ==========================================
    // TAB 4 : BILAN CARBONE & VALEUR TUTÉLAIRE
    // ==========================================
    const tab4Data: any[][] = [
      ['ÉVALUATION DE L\'EMPREINTE CARBONE ACV & EXTERNALITÉS MONÉTISÉES (SECTION 11)'],
      [`Prix du carbone retenu au dossier : ${project.carbonPricePerTonne} ${project.currency}/tCO2e · source à vérifier`],
      [''],
      [
        'Offre',
        'Périmètre Scope',
        'Phase du Cycle de Vie',
        'Émissions Unitaires (tCO2e/u)',
        'Émissions Totales (tCO2e)',
        'Montant monétisé par poste (non exposé)',
        'Source Facteur d\'Émission',
      ],
    ];

    calculated.forEach(({ offer, calc }) => {
      offer.carbonItems.forEach((c) => {
        tab4Data.push([
          offer.supplierName,
          c.scope,
          c.lifecyclePhase,
          c.emissionsPerUnitTonneCO2e?.value ?? 'Non renseigné',
          c.totalLifecycleEmissions,
          'Non ventilé par poste dans le résultat serveur',
          c.emissionFactorSource || 'SOURCE À VÉRIFIER',
        ]);
      });

      tab4Data.push([
        `TOTAL ${offer.supplierName}`,
        'Total serveur (périmètre enregistré)',
        'Cycle de vie selon les données reçues',
        '',
        calc.totalLifecycleCO2eTonnes,
        calc.monetizedCarbonTotal,
        'Bilan consolidé',
      ]);
      tab4Data.push(['']);
    });

    const ws4 = XLSX.utils.aoa_to_sheet(tab4Data);
    XLSX.utils.book_append_sheet(workbook, ws4, 'Carbone & Externalités');

    // ==========================================
    // TAB 5 : ENTRÉES DU JOURNAL D'AUDIT SERVEUR
    // ==========================================
    const tab5Data: any[][] = [
      ['ENTRÉES DU JOURNAL D\'AUDIT DU SERVEUR'],
      ['Export de consultation ; ne constitue ni une certification ni une attestation d\'audit externe.'],
      [`Calcul de référence : ${decisionRun.runId} · empreinte : ${decisionRun.inputFingerprint}`],
      [''],
      [
        'ID Audit',
        'Horodatage serveur',
        'Auteur de la Modification',
        'Rôle / Profil Système',
        'Élément Révisé',
        'Champ Modifié',
        'Ancienne Valeur',
        'Nouvelle Valeur',
        'Justification enregistrée',
      ],
    ];

    // Le chargement de l'application peut contenir le journal de toute l'organisation :
    // l'export de ce dossier ne doit inclure que les entrées explicitement liées à lui.
    const projectAuditLogs = auditLogs.filter((log) => log.projectId === project.id);
    if (projectAuditLogs.length === 0) {
      tab5Data.push(['Aucune entrée de journal associée à ce dossier n’a été fournie.']);
    }
    projectAuditLogs.forEach((log) => {
      tab5Data.push([
        log.id,
        new Date(log.timestamp).toLocaleString('fr-FR'),
        log.userName,
        log.userRole,
        log.entityName,
        log.fieldChanged,
        log.oldValue,
        log.newValue,
        log.justification,
      ]);
    });

    const ws5 = XLSX.utils.aoa_to_sheet(tab5Data);
    XLSX.utils.book_append_sheet(workbook, ws5, 'Journal serveur');

    // Auto-size columns for readability across all sheets
    [ws1, ws2, ws3, ws4, ws5].forEach((sheet) => {
      sheet['!cols'] = [
        { wch: 25 },
        { wch: 30 },
        { wch: 25 },
        { wch: 25 },
        { wch: 25 },
        { wch: 25 },
        { wch: 25 },
        { wch: 25 },
        { wch: 35 },
      ];
    });

    return workbook;
  }
}
