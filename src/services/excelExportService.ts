import { Project, SupplierOffer, Supplier, AuditLogEntry, ExternalityReferenceBenchmark } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';

export class ExcelExportService {
  /**
   * Downloads a local, indicative XLSX export; it is not audited evidence or a decision record.
   */
  public static async exportFinancialWorkbook(
    project: Project,
    offers: SupplierOffer[],
    suppliers: Supplier[],
    auditLogs: AuditLogEntry[],
    benchmarks: ExternalityReferenceBenchmark[]
  ): Promise<void> {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();

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
      ['TRUETCO — EXPORT INDICATIF TCO / LCC (NON VÉRIFIÉ)'],
      ['Simulation financière indicative — non certifiée'],
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
        'Score déclaré — non vérifié',
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

    const ws1 = workbook.addWorksheet('Synthèse Décision');
    ws1.addRows(tab1Data);

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

    const ws2 = workbook.addWorksheet('CashFlows LCC (WACC)');
    ws2.addRows(tab2Data);

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

    const ws3 = workbook.addWorksheet('Décomposition TCO (CBS)');
    ws3.addRows(tab3Data);

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
          c.emissionFactorSource || 'Source non renseignée',
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

    const ws4 = workbook.addWorksheet('Carbone & Externalités');
    ws4.addRows(tab4Data);

    // ==========================================
    // TAB 5 : ÉVÉNEMENTS D'AUDIT (NON CERTIFIÉS)
    // ==========================================
    const tab5Data: any[][] = [
      ['ÉVÉNEMENTS D\'APPLICATION — EXPORT NON CERTIFIÉ'],
      ['Export informatif : intégrité, identité, horodatage et conservation non garantis.'],
      [''],
      [
        'ID Audit',
        'Horodatage (non certifié)',
        'Auteur de la Modification',
        'Rôle / Profil Système',
        'Élément Révisé',
        'Champ Modifié',
        'Ancienne Valeur',
        'Nouvelle Valeur',
        'Justification saisie (non vérifiée)',
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

    const ws5 = workbook.addWorksheet('Événements d\'audit');
    ws5.addRows(tab5Data);

    // Fixed widths keep exports readable without presenting them as audited evidence.
    [ws1, ws2, ws3, ws4, ws5].forEach((sheet) => {
      for (let index = 1; index <= 9; index += 1) {
        sheet.getColumn(index).width = index === 9 ? 35 : index === 2 ? 30 : 25;
      }
    });

    // Write and trigger download
    const cleanProjectRef = project.reference.replace(/[^a-zA-Z0-9-_]/g, '_');
    const fileName = `TrueTCO_Modele_Financier_${cleanProjectRef}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }
}
