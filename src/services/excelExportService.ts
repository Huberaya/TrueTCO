import * as XLSX from 'xlsx';
import { Project, SupplierOffer, Supplier, AuditLogEntry, ExternalityReferenceBenchmark } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';

export class ExcelExportService {
  /**
   * Generates and downloads a multi-tab financial workbook (XLSX)
   * designed for Financial Controllers (DAF) and Statutory Auditors (CAC).
   */
  public static exportFinancialWorkbook(
    project: Project,
    offers: SupplierOffer[],
    suppliers: Supplier[],
    auditLogs: AuditLogEntry[],
    benchmarks: ExternalityReferenceBenchmark[]
  ): void {
    const workbook = XLSX.utils.book_new();

    // 1. Calculate detailed TCO for all offers in this project
    const calculated = offers.map((offer) => {
      const calc = TCOEngine.calculateOfferTCO(project, offer);
      const supplier = suppliers.find((s) => s.id === offer.supplierId);
      return { offer, calc, supplier };
    });

    const baseline = calculated.find((c) => !c.offer.isResponsibleCandidate) || calculated[0];

    // ==========================================
    // TAB 1: SYNTHÈSE & DÉCISION FINANCIÈRE
    // ==========================================
    const tab1Data: any[][] = [
      ['TRUETCO - RAPPORT FINANCIER D\'ARBITRAGE ÉCONOMIQUE & COÛT COMPLET (LCC)'],
      ['Document officiel certifié pour Comité d\'Investissement & Contrôle de Gestion'],
      [''],
      ['1. PARAMÈTRES GÉNÉRAUX DE LA CONSULTATION'],
      ['Nom du Projet', project.name],
      ['Référence Consultation', project.reference],
      ['Catégorie d\'Achat', project.category],
      ['Entité Juridique / Organisation', project.companyName || project.organizationId],
      ['Budget Plafond (CAPEX Max)', project.budgetCap, '€'],
      ['Volume Contractuel', project.plannedVolume, project.unitName],
      ['Horizon d\'Analyse Retenu', project.horizonYears, 'ans'],
      ['Taux d\'Actualisation Financière (WACC)', (project.discountRate * 100).toFixed(2), '%'],
      ['Inflation Énergétique Annuelle Projetée', (project.energyInflationRate * 100).toFixed(2), '%'],
      ['Valeur Tutélaire du Carbone (Quinet)', project.carbonPricePerTonne, '€ / tCO2e'],
      ['Date d\'Extraction du Modèle', new Date().toLocaleString('fr-FR')],
      [''],
      ['2. COMPARATIF SYNTHÉTIQUE DES OFFRES CANDIDATES'],
      [
        'Fournisseur',
        'Référence Offre',
        'Statut Proposition',
        'Prix Facial Devis (Achat Brut)',
        'TCO Économique Nominal',
        'LCC Actualisé (NPV @ WACC)',
        'Monétisation Carbone Quinet',
        'Exposition Risques & Pannes',
        'TCO GLOBAL COMPLET',
        'Qualité Données (%)',
        'Écart vs Offre Conventionnelle',
      ],
    ];

    calculated.forEach(({ offer, calc }) => {
      const deltaVsBaseline = baseline
        ? calc.totalComprehensiveTCO - baseline.calc.totalComprehensiveTCO
        : 0;

      tab1Data.push([
        offer.supplierName,
        offer.offerReference,
        offer.isResponsibleCandidate ? 'Solution Éco-responsable' : 'Proposition Standard',
        offer.apparentTotal,
        calc.economicTCONominal,
        calc.lifecycleCostLCC,
        calc.monetizedCarbonTotal,
        calc.riskExpositionTotal,
        calc.totalComprehensiveTCO,
        calc.dataQualityScore,
        deltaVsBaseline,
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
        'Nature du Flux',
        'Cash-Flow Nominal Sortant (€)',
        'Facteur d\'Actualisation (1/(1+r)^t)',
        'Cash-Flow Actualisé (NPV €)',
      ]);

      // Year 0 (CAPEX)
      const capexDiscountFactor = 1.0;
      tab2Data.push([
        'Année 0',
        'Acquisition Initiale (CAPEX + Déploiement)',
        offer.apparentTotal,
        capexDiscountFactor,
        offer.apparentTotal * capexDiscountFactor,
      ]);

      // Subsequent years from cashFlowsByYear
      calc.cashFlowsByYear.forEach((flow) => {
        tab2Data.push([
          `Année ${flow.year}`,
          `Exploitation récurrente & maintenance`,
          flow.nominalCost,
          flow.discountFactor,
          flow.discountedCost,
        ]);
      });

      tab2Data.push([
        'TOTAL LCC ACTUALISÉ',
        'Somme actualisée nette des déboursements',
        '',
        '',
        calc.lifecycleCostLCC,
      ]);
      tab2Data.push(['']);
    });

    const ws2 = XLSX.utils.aoa_to_sheet(tab2Data);
    XLSX.utils.book_append_sheet(workbook, ws2, 'CashFlows LCC (WACC)');

    // ==========================================
    // TAB 3 : DÉCOMPOSITION DÉTAILLÉE DU TCO (CBS)
    // ==========================================
    const tab3Data: any[][] = [
      ['DÉCOMPOSITION ANALYTIQUE DU COÛT TOTAL DE POSSESSION (COST BREAKDOWN STRUCTURE)'],
      ['Ventilation exhaustive des coûts tangibles sur la durée de détention'],
      [''],
      [
        'Offre',
        'Poste de Coût Analytique',
        'Catégorie',
        'Montant (€)',
        'Unité',
        'Récurrence',
        'Source Donnée',
        'Niveau Confiance (%)',
      ],
    ];

    calculated.forEach(({ offer }) => {
      offer.costItems.forEach((item) => {
        tab3Data.push([
          offer.supplierName,
          item.label,
          item.category,
          item.amount.value,
          item.amount.unit,
          item.isRecurringYearly ? 'Annuel récurrent' : 'Unique (Ponctuel)',
          item.amount.sourceName,
          item.amount.confidenceLevel,
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
      [`Valeur tutélaire de l'action climat : ${project.carbonPricePerTonne} €/tCO2e (Commission Quinet)`],
      [''],
      [
        'Offre',
        'Périmètre Scope',
        'Phase du Cycle de Vie',
        'Émissions Unitaires (tCO2e/u)',
        'Émissions Totales (tCO2e)',
        'Coût Externalité Monétisé (€)',
        'Source Facteur d\'Émission',
      ],
    ];

    calculated.forEach(({ offer, calc }) => {
      offer.carbonItems.forEach((c) => {
        const monetized = c.totalLifecycleEmissions * project.carbonPricePerTonne;
        tab4Data.push([
          offer.supplierName,
          c.scope,
          c.lifecyclePhase,
          c.emissionsPerUnitTonneCO2e?.value ?? (c.emissionsTCO2e?.value ? c.emissionsTCO2e.value / (offer.quantity || 1) : 0),
          c.totalLifecycleEmissions,
          monetized,
          c.emissionFactorSource || 'Base Carbone ADEME',
        ]);
      });

      tab4Data.push([
        `TOTAL ${offer.supplierName}`,
        'Scopes 1-2-3 cumulés',
        'Cycle de vie complet',
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
    // TAB 5 : REGISTRE D'AUDIT IMMUABLE (CAC)
    // ==========================================
    const tab5Data: any[][] = [
      ['JOURNAL D\'AUDIT LÉGAL & TRAÇABILITÉ DES HYPOTHÈSES (SECTION 26)'],
      ['Piste d\'audit fiable certifiée pour Commissaires aux Comptes & Contrôle Interne'],
      [''],
      [
        'ID Audit',
        'Horodatage Certifié',
        'Auteur de la Modification',
        'Rôle / Profil Système',
        'Élément Révisé',
        'Champ Modifié',
        'Ancienne Valeur',
        'Nouvelle Valeur',
        'Justification Formelle Auditée',
      ],
    ];

    auditLogs.forEach((log) => {
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
    XLSX.utils.book_append_sheet(workbook, ws5, 'Journal d\'Audit CAC');

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

    // Write and trigger download
    const cleanProjectRef = project.reference.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `TrueTCO_Modele_Financier_${cleanProjectRef}_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  }
}
