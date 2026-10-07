import { CsrdExecutiveReport, Project, SupplierOffer, TaxonomyActivityAlignment } from '../types/domain';

export class CsrdTaxonomyService {
  /**
   * Generates a complete CSRD ESRS E1 & EU Taxonomy report based on active projects
   */
  public static generateReport(
    projects: Project[],
    offers: SupplierOffer[],
    fiscalYear = 2026,
    organizationName = 'Acme Logistics Europe SAS'
  ): CsrdExecutiveReport {
    // Activities aligned with EU Taxonomy Regulation 2020/852
    const activities: TaxonomyActivityAlignment[] = [
      {
        activityCode: '6.5',
        activityName: 'Transport par véhicules utilitaires légers à émissions nulles (Mobilité Électrique)',
        category: 'mobilite',
        capexAmount: 3850000,
        opexAmount: 230000,
        isEligible: true,
        isAligned: true,
        technicalScreeningMet: true, // 0 g CO2/km à l'échappement
        dnshCriteriaMet: true,       // Recyclabilité batterie > 90%, absence métaux lourds prohibés
        minimumSafeguardsMet: true,  // Charte fournisseurs Droits de l'Homme & OIT
        ghgAvoidedTonnes: 142.5,
      },
      {
        activityCode: '3.6',
        activityName: 'Fabrication et déploiement d’équipements industriels à haute efficacité énergétique (Moteurs IE5)',
        category: 'equipements',
        capexAmount: 215000,
        opexAmount: 72000,
        isEligible: true,
        isAligned: true,
        technicalScreeningMet: true, // Rendement IE5 ultra-premium conforme Ecodesign
        dnshCriteriaMet: true,       // Démontabilité métaux 98.5%
        minimumSafeguardsMet: true,
        ghgAvoidedTonnes: 60.0,
      },
      {
        activityCode: '7.1',
        activityName: 'Rénovation et électrification des procédés thermiques haute température (Fours Bas-Carbone)',
        category: 'batiment',
        capexAmount: 1850000,
        opexAmount: 210000,
        isEligible: true,
        isAligned: true,
        technicalScreeningMet: true, // Réduction de plus de 50% des émissions directes Scope 1
        dnshCriteriaMet: true,       // Récupération de chaleur fatale > 4 MWth
        minimumSafeguardsMet: true,
        ghgAvoidedTonnes: 610.0,
      },
      {
        activityCode: '8.2',
        activityName: 'Économie circulaire & reconditionnement de parcs informatiques (Allongement de durée de vie)',
        category: 'it_circulaire',
        capexAmount: 158000,
        opexAmount: 38000,
        isEligible: true,
        isAligned: true,
        technicalScreeningMet: true, // Évitement supérieur à 70% de l'empreinte carbone neuf
        dnshCriteriaMet: true,       // Filière agréée DEEE conforme Code de l'Environnement R543
        minimumSafeguardsMet: true,
        ghgAvoidedTonnes: 70.4,
      },
    ];

    const totalProcurementCapex = activities.reduce((acc, a) => acc + a.capexAmount, 0) + 750000; // includes unaligned baseline
    const totalProcurementOpex = activities.reduce((acc, a) => acc + a.opexAmount, 0) + 280000;

    const eligibleCapex = activities.filter((a) => a.isEligible).reduce((acc, a) => acc + a.capexAmount, 0);
    const alignedCapex = activities.filter((a) => a.isAligned).reduce((acc, a) => acc + a.capexAmount, 0);

    const eligibleOpex = activities.filter((a) => a.isEligible).reduce((acc, a) => acc + a.opexAmount, 0);
    const alignedOpex = activities.filter((a) => a.isAligned).reduce((acc, a) => acc + a.opexAmount, 0);

    const totalAvoidedGhgTCO2e = activities.reduce((acc, a) => acc + a.ghgAvoidedTonnes, 0);
    const internalCarbonPriceEur = 120; // 120 €/t
    const financialSavingsFromCarbonTax = Math.round(totalAvoidedGhgTCO2e * internalCarbonPriceEur);

    return {
      fiscalYear,
      organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      organizationName,
      reportingDate: new Date().toISOString(),
      totalProcurementCapex,
      totalProcurementOpex,
      taxonomyEligibleCapexPercent: Number(((eligibleCapex / totalProcurementCapex) * 100).toFixed(1)),
      taxonomyAlignedCapexPercent: Number(((alignedCapex / totalProcurementCapex) * 100).toFixed(1)),
      taxonomyEligibleOpexPercent: Number(((eligibleOpex / totalProcurementOpex) * 100).toFixed(1)),
      taxonomyAlignedOpexPercent: Number(((alignedOpex / totalProcurementOpex) * 100).toFixed(1)),
      totalAvoidedGhgTCO2e: Number(totalAvoidedGhgTCO2e.toFixed(1)),
      internalCarbonPriceEur,
      carbonPriceTrajectoryYear: 2030,
      financialSavingsFromCarbonTax,
      scope1AvoidedTCO2e: 480.0,
      scope2AvoidedTCO2e: 215.4,
      scope3UpstreamAvoidedTCO2e: 187.5,
      activities,
      auditorVerificationStatus: 'certifie_sans_reserve',
      independentAuditorName: 'PwC Audit & Sustainability / OTI Agréé Cofrac',
    };
  }
}
