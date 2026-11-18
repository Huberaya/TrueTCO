import { CsrdExecutiveReport, Project, SupplierOffer } from '../types/domain';

/**
 * No source-backed ESRS/Taxonomy dataset is connected. Deliberately return an
 * unavailable report rather than inventing aligned spend, emissions, or assurance.
 */
export class CsrdTaxonomyService {
  public static generateReport(
    _projects: Project[],
    _offers: SupplierOffer[],
    fiscalYear = new Date().getUTCFullYear(),
    organizationName = ''
  ): CsrdExecutiveReport {
    return {
      fiscalYear,
      organizationId: '',
      organizationName,
      reportingDate: new Date().toISOString(),
      totalProcurementCapex: 0,
      totalProcurementOpex: 0,
      taxonomyEligibleCapexPercent: 0,
      taxonomyAlignedCapexPercent: 0,
      taxonomyEligibleOpexPercent: 0,
      taxonomyAlignedOpexPercent: 0,
      totalAvoidedGhgTCO2e: 0,
      internalCarbonPriceEur: 0,
      carbonPriceTrajectoryYear: fiscalYear,
      financialSavingsFromCarbonTax: 0,
      scope1AvoidedTCO2e: 0,
      scope2AvoidedTCO2e: 0,
      scope3UpstreamAvoidedTCO2e: 0,
      activities: [],
      auditorVerificationStatus: 'donnees_insuffisantes',
      independentAuditorName: '',
    };
  }
}
