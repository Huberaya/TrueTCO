import { CsrdExecutiveReport, Project, SupplierOffer, TaxonomyActivityAlignment } from '../types/domain';

/**
 * ===========================================================================
 * REPORTING CSRD / TAXONOMIE VERTE — CE QUE CE MODULE FAIT ET NE FAIT PAS
 * ===========================================================================
 * ⚠️ CE QUE FAISAIT LA VERSION PRÉCÉDENTE (inacceptable) :
 *   `generateReport(projects, offers, …)` ignorait purement et simplement ses
 *   paramètres et renvoyait un rapport ENTIÈREMENT CODÉ EN DUR : 4 activités
 *   (6.5 / 3.6 / 7.1 / 8.2) avec des CAPEX/OPEX figés, un statut
 *   `auditorVerificationStatus: 'certifie_sans_reserve'` et un auditeur nommé
 *   « PwC Audit & Sustainability / OTI Agréé Cofrac ».
 *   Autrement dit : un document présenté comme une déclaration de durabilité
 *   CERTIFIÉE PAR PWC, contenant des chiffres ne provenant d'aucune donnée de
 *   l'entreprise et attribués à un tiers qui n'avait rien examiné.
 *
 * ⚠️ CE QUE CE MODULE FAIT DÉSORMAIS :
 *   - il agrège UNIQUEMENT les données réellement présentes dans les projets et
 *     les offres (postes de coût et postes carbone) ;
 *   - il ne qualifie JAMAIS l'alignement à la taxonomie : l'éligibilité, les
 *     critères d'examen technique, le principe DNSH et les garanties minimales
 *     exigent une analyse juridique et technique que le produit ne réalise pas.
 *     Ces champs valent donc `false` avec une explication ;
 *   - il indique explicitement que le rapport n'a fait l'objet d'aucune revue
 *     par un tiers (`auditorVerificationStatus: 'non_verifie'`,
 *     `independentAuditorName: ''`) ;
 *   - il remonte les données manquantes dans `dataWarnings`.
 *
 * ⚠️ CE QUI RESTE À CONSTRUIRE pour un usage réglementaire réel :
 *   mapping codifié des activités (annexes du règlement 2020/852) avec
 *   justification par activité, collecte des indicateurs DNSH et garanties
 *   minimales, périmètre de consolidation groupe (KPI au niveau de l'entité
 *   cotée), piste d'audit documentaire et export au format ESEF/XBRL.
 */

interface AggregatedActivity {
  key: string;
  label: string;
  category: TaxonomyActivityAlignment['category'];
  capex: number;
  opex: number;
  carbonTonnes: number;
  projectReferences: string[];
  offerReferences: string[];
}

export class CsrdTaxonomyService {
  /**
   * Construit un rapport de préparation à partir des données réellement saisies.
   * Aucun montant n'est inventé : une section sans données est renvoyée à zéro
   * et signalée dans `dataWarnings`.
   */
  public static generateReport(
    projects: Project[],
    offers: SupplierOffer[],
    fiscalYear = new Date().getFullYear(),
    organizationName = ''
  ): CsrdExecutiveReport {
    const warnings: string[] = [];
    const buckets = new Map<string, AggregatedActivity>();

    const bucketFor = (project: Project): AggregatedActivity => {
      const key = project.category || 'non_classe';
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          label: project.category || 'Achats non classés',
          category: 'equipements',
          capex: 0,
          opex: 0,
          carbonTonnes: 0,
          projectReferences: [],
          offerReferences: [],
        });
      }
      const bucket = buckets.get(key)!;
      if (!bucket.projectReferences.includes(project.reference)) {
        bucket.projectReferences.push(project.reference);
      }
      return bucket;
    };

    let unallocatedOffers = 0;
    let offersWithoutCarbonData = 0;
    let offersWithoutCostItems = 0;

    for (const offer of offers) {
      const project = projects.find((p) => p.id === offer.projectId);
      if (!project) {
        unallocatedOffers += 1;
        continue;
      }
      const bucket = bucketFor(project);
      bucket.offerReferences.push(offer.offerReference);

      const items = offer.costItems ?? [];
      if (items.length === 0) offersWithoutCostItems += 1;

      for (const item of items) {
        const amount = Math.abs(Number(item.amount?.value) || 0) * (Number(offer.quantity) || 1);
        const category = String(item.category ?? '');
        // CAPEX : acquisition, logistique, installation, déploiement.
        if (['acquisition', 'logistique_douanes', 'installation_mise_en_service', 'deploiement'].includes(category)) {
          bucket.capex += amount;
        } else {
          // OPEX : tout le reste est présenté comme charge de la période.
          bucket.opex += amount;
        }
      }

      const carbonItems = offer.carbonItems ?? [];
      if (carbonItems.length === 0) {
        offersWithoutCarbonData += 1;
      }
      for (const carbon of carbonItems) {
        const tonnes = Number(
          (carbon as any).totalLifecycleEmissions ??
            (Number((carbon as any).emissionsPerUnitTonneCO2e?.value) || 0) * (Number(offer.quantity) || 1)
        );
        if (Number.isFinite(tonnes)) bucket.carbonTonnes += tonnes;
      }
    }

    if (offers.length === 0) {
      warnings.push(
        "Aucune offre enregistrée : le rapport ne contient aucun indicateur. Les KPI de durabilité ne peuvent pas être calculés à partir d'un jeu de données vide."
      );
    }
    if (unallocatedOffers > 0) {
      warnings.push(
        `${unallocatedOffers} offre(s) ne sont rattachées à aucun projet : elles sont exclues des agrégats (rattacher l'offre à un projet pour l'intégrer).`
      );
    }
    if (offersWithoutCostItems > 0) {
      warnings.push(
        `${offersWithoutCostItems} offre(s) n'ont aucun poste de coût renseigné : leurs montants ne sont pas comptabilisés.`
      );
    }
    if (offersWithoutCarbonData > 0) {
      warnings.push(
        `${offersWithoutCarbonData} offre(s) n'ont aucune donnée carbone (ACV / facteur d'émission) : les émissions correspondantes sont sous-estimées.`
      );
    }

    const activities: TaxonomyActivityAlignment[] = Array.from(buckets.values()).map((bucket) => ({
      // Le code d'activité de la taxonomie NE PEUT PAS être déduit
      // automatiquement d'une catégorie d'achat interne : il doit être choisi
      // par l'utilisateur et justifié activité par activité.
      activityCode: '',
      activityName: bucket.label,
      category: bucket.category,
      capexAmount: Math.round(bucket.capex),
      opexAmount: Math.round(bucket.opex),
      // Éligibilité, alignement, critères techniques, DNSH et garanties
      // minimales : NON ÉVALUÉS par TrueTCO.
      isEligible: false,
      isAligned: false,
      technicalScreeningMet: false,
      dnshCriteriaMet: false,
      minimumSafeguardsMet: false,
      // Les émissions agrégées sont celles déclarées par les offres : ce ne sont
      // pas des « évitements », qui supposent un scénario de comparaison.
      ghgAvoidedTonnes: 0,
    }));

    const totalProcurementCapex = activities.reduce((acc, a) => acc + a.capexAmount, 0);
    const totalProcurementOpex = activities.reduce((acc, a) => acc + a.opexAmount, 0);
    const totalEmissions = Array.from(buckets.values()).reduce((acc, b) => acc + b.carbonTonnes, 0);

    if (activities.length === 0) {
      warnings.push(
        "Aucune activité n'a pu être construite : les rubriques de Taxonomie verte et les indicateurs ESRS E1 restent vides."
      );
    }

    return {
      fiscalYear,
      organizationId: '',
      organizationName,
      reportingDate: new Date().toISOString(),
      totalProcurementCapex,
      totalProcurementOpex,
      // Les ratios d'éligibilité et d'alignement ne peuvent pas être calculés
      // sans classification préalable des activités : ils sont renvoyés à 0 et
      // accompagnés d'un avertissement, plutôt qu'estimés arbitrairement.
      taxonomyEligibleCapexPercent: 0,
      taxonomyAlignedCapexPercent: 0,
      taxonomyEligibleOpexPercent: 0,
      taxonomyAlignedOpexPercent: 0,
      totalAvoidedGhgTCO2e: 0,
      internalCarbonPriceEur: 0,
      carbonPriceTrajectoryYear: fiscalYear + 5,
      financialSavingsFromCarbonTax: 0,
      scope1AvoidedTCO2e: 0,
      scope2AvoidedTCO2e: 0,
      scope3UpstreamAvoidedTCO2e: 0,
      activities,
      auditorVerificationStatus: 'non_verifie',
      independentAuditorName: '',
      dataWarnings: [
        ...warnings,
        "Éligibilité et alignement à la taxonomie : NON ÉVALUÉS. Ces qualifications exigent l'analyse des critères d'examen technique, du principe DNSH et des garanties minimales, activité par activité, sous la responsabilité de l'entreprise et de ses auditeurs.",
        "Émissions agrégées déclarées par les offres : " +
          `${totalEmissions.toFixed(1)} tCO2e. Aucun « évitement » n'est calculé faute de scénario de comparaison documenté.`,
        "Ce rapport est un BROUILLON interne : il n'a fait l'objet d'aucune revue par un organisme tiers indépendant.",
      ],
      computationBasis: {
        capex: 'Somme des postes acquisition / logistique / installation / déploiement des offres rattachées à un projet.',
        opex: 'Somme des autres postes de coût (exploitation, maintenance, énergie, fin de vie).',
        carbon: "Somme des émissions déclarées dans les postes carbone des offres (aucun évitement calculé).",
        alignment: 'Non évalué — qualification réglementaire hors périmètre de calcul de TrueTCO.',
      },
    };
  }
}
