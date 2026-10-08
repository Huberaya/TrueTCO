import { DocumentParseResult, DocumentCategory, SupplierOffer } from '../types/domain';

export interface SampleDocumentItem {
  id: string;
  title: string;
  subtitle: string;
  category: DocumentCategory;
  fileFormat: string;
  supplierName: string;
  estimatedPages: number;
  snippet: string;
  contentRaw: string;
}

export const SAMPLE_DOCUMENTS: SampleDocumentItem[] = [
  {
    id: 'sample-devis-renault-elec',
    title: 'Devis Fournisseur — Flotte 50 Utilitaires Électriques Master E-Tech',
    subtitle: 'Bordereau de prix constructeur avec bornes IRVE, maintenance et batterie garantie',
    category: 'devis_fournisseur',
    fileFormat: 'PDF',
    supplierName: 'Renault Trucks France SAS',
    estimatedPages: 4,
    snippet: 'Proposition commerciale RFQ-2026-MOB-004 · 50 Master E-Tech City 52 kWh · Prix facial : 3 850 000 € HT · Infrastructure de charge 25 bornes doubles · Contrat d’entretien full service 5 ans · Déclaration ACV Carbone Scope 3',
    contentRaw: `RENAULT TRUCKS FRANCE SAS
Direction des Ventes Entreprises & Flottes Publiques
99 Route de Lyon, 69800 Saint-Priest | SIREN 954 506 077

DEVIS ET OFFRE COMMERCIALE N° DEV-2026-RT-0849
Date d'émission : 14 Mars 2026 | Validité : 60 jours
Client : Acme Logistics Europe SAS
Objet : Renouvellement de 50 Véhicules Utilitaires Légers Électriques (Projet AO-2026-MOB-004)

1. ACQUISITION DIRECTE DU PARC ROULANT
- Désignation : 50 x Renault Master E-Tech Fourgon Grand Volume (3.5T, Pack Batterie 52 kWh)
- Prix unitaire catalogue remisé : 77 000,00 € HT
- Montant Total Matériel Roulant : 3 850 000,00 € HT
- Garantie constructeur : 60 mois ou 160 000 km
- Délai de mise à disposition : 8 semaines après signature

2. INFRASTRUCTURE DE RECHARGE ET INSTALLATION
- 25 x Bornes de recharge intelligentes doubles 22 kW AC (Marque Schneider Electric EVlink)
- Travaux de génie civil, tirage de câbles TGBT et mise en service sur 3 dépôts logistiques
- Montant Forfaitaire Installation & Raccordement : 85 000,00 € HT
- Subvention Advenir Entreprises déjà déduite dans le devis

3. CONTRAT DE SERVICE ET MAINTENANCE PRÉVENTIVE / CURATIVE
- Contrat d'entretien complet "Excellence EV" incluant révisions annuelles, pièces d'usure, assistance 24/7 et véhicule relais
- Montant annuel récurrent : 42 000,00 € HT / an (soit 210 000,00 € HT sur 5 ans)

4. CONSOMMATION ÉNERGÉTIQUE ET FLUIDES ESTIMÉE
- Consommation moyenne homologuée : 24,5 kWh / 100 km
- Kilométrage prévisionnel : 25 000 km / an / véhicule (soit 1 250 000 km / an de flotte)
- Consommation globale annuelle estimée : 306 250 kWh / an
- Coût annuel estimé électricité réseau : 46 000,00 € HT / an

5. DONNÉES ENVIRONNEMENTALES ET EMPREINTE CARBONE ACV
- Bilan Carbone Berceau-à-la-tombe selon protocole GHG et méthodologie ADEME
- Émissions de fabrication (Scope 3 Amont, batterie incluse) : 12,8 tCO2e par véhicule (Total : 640 tCO2e)
- Émissions en phase d'usage (Scope 2 électricité réseau mix français 55g/kWh) : 16,8 tCO2e / an (Total 5 ans : 84 tCO2e)
- Recyclabilité batterie certifiée en filière close européenne : 95%`,
  },
  {
    id: 'sample-devis-dell-recond',
    title: 'Devis Fournisseur — Parc 200 Postes Portables Reconditionnés Grade A+',
    subtitle: 'Offre informatique circulaire avec extension de garantie et traçabilité DEEE',
    category: 'devis_fournisseur',
    fileFormat: 'PDF',
    supplierName: 'CircularPC Technologies',
    estimatedPages: 3,
    snippet: 'Proposition B2B circulaire · 200 Ordinateurs Dell Latitude 5420 i7 16Go reconditionnés en France · Prix unitaire : 790 € HT · Évitement carbone certifié ADEME : 352 kgCO2e/poste · Garantie échange J+1 sur 48 mois',
    contentRaw: `CIRCULARPC TECHNOLOGIES SAS
Ateliers de Reconditionnement & Économie Circulaire
Parc d'Activités des Bretonnières, 44000 Nantes | SIRET 881 204 192 00018
Certifications : ISO 14001, Label Numérique Responsable, EcoVadis Gold

PROPOSITION COMMERCIALE CIRCULAIRE N° OFF-CPC-2026-0312
Date : 12 Mars 2026 | Projet d'achat : AO-2026-IT-012 (200 Postes Ingénierie)

1. POSTES DE TRAVAIL RECONDITIONNÉS PREMIUM (GRADE A+)
- Désignation : 200 x Dell Latitude 5420 (Intel Core i7 11th Gen, 16 Go RAM, SSD 512 Go NVMe, Batterie neuve certifiée 100% santé)
- Prix unitaire remisé : 790,00 € HT
- Montant Total Matériel : 158 000,00 € HT (vs 320 000 € HT équivalent neuf de série)
- Délai de livraison : 2 semaines (disponibilité immédiate en stock)

2. PACK LOGISTIQUE ET MASTERISATION LOGICIELLE
- Pré-configuration en atelier, gravure master d'entreprise Acme, étiquetage code-barres asset management
- Forfait unitaire : 35,00 € HT / poste (Total : 7 000,00 € HT)

3. GARANTIE ÉTENDUE 48 MOIS ET PIÈCES DÉTACHÉES
- Garantie 4 ans avec remplacement sous 24h ouvrées (J+1 sur site)
- Stock tampon de 5 machines pré-positionnées chez le client
- Coût annuel support & maintenance : 9 500,00 € HT / an (soit 38 000,00 € HT sur 4 ans)

4. VALEUR RÉSIDUELLE ET REPRISE EN FIN DE VIE (BUY-BACK)
- Engagement contractuel de rachat résiduel à 48 mois : 90,00 € HT / machine restituée
- Valeur de rachat garantie en fin de vie : -18 000,00 € HT au terme de l'exercice

5. RAPPORT D'ÉVITEMENT CARBONE ET CONFORMITÉ CSRD
- Facteur d'émission fabrication reconditionné : 48 kgCO2e / machine (vs 400 kgCO2e pour du neuf équivalent)
- Évitement carbone net audité : 352 kgCO2e par unité (soit 70,4 tonnes de CO2e évitées sur l'ensemble du projet)
- Certificat de traçabilité DEEE conforme Code de l'Environnement R543`,
  },
  {
    id: 'sample-fdes-grundfos-pump',
    title: 'Fiche FDES / EPD — Pompe Centrifuge Grundfos IE5 Moteur Synchrone',
    subtitle: 'Fiche de Déclaration Environnementale et Sanitaire normalisée ISO 14025 / EN 15804',
    category: 'fiche_fdes_epd',
    fileFormat: 'FDES XML',
    supplierName: 'Grundfos Pompes SAS',
    estimatedPages: 6,
    snippet: 'Fiche FDES INIES n° 2026-GRUND-IE5 · Station d’épuration Veolia · Moteur à réluctance synchrone IE5 · Rendement hydraulique 96,2% · Bilan ACV Modules A1-A3, B1-B7, C1-C4 · Recyclabilité métaux 98,5%',
    contentRaw: `DÉCLARATION ENVIRONNEMENTALE DE PRODUIT (EPD / FDES)
Conforme aux normes ISO 14025 et EN 15804+A2 | Vérification tierce partie : Bureau Veritas
Numéro d'enregistrement base INIES : FDES-2026-GRUND-IE5-091

IDENTIFICATION DU PRODUIT :
- Produit : Pompe centrifuge multicellulaire verticale Grundfos CR-IE5 95-3
- Fabricant : Grundfos Pompes SAS | Bjerringbro / Longeville-lès-Saint-Avold
- Unité fonctionnelle : Pompage en continu de 1 m3/h à 8 bars pendant une durée de vie de 10 ans

INDICATEURS DU CYCLE DE VIE (ACV BERCEAU À LA TOMBE) :
1. Étape de production (Modules A1-A3) :
- Émissions de fabrication et extraction matières premières : 60,0 tCO2e (Fonte nodulaire, inox 316, cuivre haute pureté)
- Consommation d'énergie primaire totale : 840 GJ

2. Étape d'utilisation (Modules B1-B7) :
- Rendement moteur : Classe IE5 (Ultra-Premium Efficiency, gain de 40% sur les pertes rotoriques)
- Consommation électrique annuelle en service continu : 72 000 kWh / an
- Émissions de gaz à effet de serre en phase d'usage : 190 tCO2e / an (mix réseau électrique européen moyen)
- Consommation d'eau en exploitation : 0 m3 (circuit fermé)

3. Étape de fin de vie et valorisation (Modules C1-C4 & D) :
- Démontabilité des composants : 100% sans outillage spécifique
- Taux de recyclabilité métaux : 98,5%
- Crédit environnemental valorisation acier et cuivre (Module D) : -18,2 tCO2e évités

CONDITIONS DE MAINTENANCE ET DURABILITÉ :
- Intervalle de révision préconisé : 25 000 heures de fonctionnement
- MTBF (Mean Time Between Failures) : 60 000 heures`,
  },
  {
    id: 'sample-epd-saint-gobain-four',
    title: 'Fiche EPD — Fives Stein & Saint-Gobain Électrification Fours Verriers',
    subtitle: 'Déclaration environnementale d’équipement industriel bas-carbone avec récupération de chaleur',
    category: 'fiche_fdes_epd',
    fileFormat: 'EPD PDF',
    supplierName: 'Fives Stein / Saint-Gobain Eco-Solutions',
    estimatedPages: 8,
    snippet: 'Étude d’ingénierie et ACV Fours Industriels Hybrides · Remplacement du gaz naturel par oxy-combustion et induction électrique · Récupération de chaleur fatale de 4,2 MWth · Réduction de 60% des émissions directes Scope 1',
    contentRaw: `ENVIRONMENTAL PRODUCT DECLARATION (EPD)
Programme Operator: The International EPD® System | S-P-08422
Standard: ISO 14025, ISO 14040/44 and PCR 2021:02 Industrial Equipment

SYSTÈME INDUSTRIEL AUDITÉ :
- Four de fusion verrier haute température à régénération thermique hybride (Électrique 70% / Oxy-gaz 30%)
- Maître d'œuvre : Fives Stein SAS | Client industriel : Saint-Gobain Vitrage

SYNTHÈSE DU BILAN DES ÉMISSIONS DE GAZ À EFFET DE SERRE (12 ANS D'EXPLOITATION) :
1. Investissement initial & Fabrication (CapEx & Scope 3 Amont) :
- Masse de matériaux réfractaires et structures acier : 450 tonnes
- Empreinte carbone de construction et montage : 820 tCO2e

2. Performance énergétique et émissions en exploitation (OpEx & Scope 1 & 2) :
- Consommation nette d'énergie après récupération : 14 000 MWh / an (soit -50% vs four traditionnel au gaz)
- Émissions directes Scope 1 résiduelles : 480 tCO2e / an (vs 1 200 tCO2e / an en configuration conventionnelle)
- Émissions indirectes Scope 2 (électricité renouvelable PPA) : 110 tCO2e / an
- Émissions annuelles évitées certifiées : 610 tCO2e / an (Total évité sur 12 ans : 7 320 tCO2e)

3. Risques industriels et résilience réglementaire :
- Conformité anticipée aux quotas ETS Phase 4 de l'Union Européenne
- Exposition monétaire évitée aux pénalités taxe carbone : estimée à 732 000 € sur l'horizon`,
  },
];

const newId = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}`;

/** Référence d'offre déterministe et traçable, dérivée du nom de fichier. */
const referenceFromFilename = (filename: string): string => {
  const base = (filename || 'document')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 40);
  return `${base || 'DOCUMENT'}-IMPORT-${new Date().toISOString().slice(0, 10)}`;
};

export class AiParserService {
  /**
   * Parse document either via server API (Gemini 3.8 Flash) or smart fallback
   */
  public static async parseDocument(params: {
    filename: string;
    content: string;
    category: DocumentCategory;
  }): Promise<DocumentParseResult> {
    try {
      const res = await fetch('/api/ai/parse-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: params.filename,
          category: params.category,
          text: params.content,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.result) {
          return data.result;
        }
      }

      // Réponse non exploitable : message d'erreur du serveur remonté tel quel.
      const errorBody = await res.json().catch(() => ({} as any));
      return this.buildUnavailableResult(
        params.filename,
        params.category,
        errorBody?.error ??
          `Service d'extraction indisponible (HTTP ${res.status}). Saisie manuelle requise : aucune donnée n'a été extraite.`
      );
    } catch (err: any) {
      return this.buildUnavailableResult(
        params.filename,
        params.category,
        "Service d'extraction injoignable. Aucune donnée n'a été extraite : saisir l'offre manuellement ou reconfigurer le service. " +
          '(Aucune estimation automatique n’est produite, afin de ne jamais introduire de montant inventé dans une décision d’achat.)'
      );
    }
  }

  /**
   * Deterministic and smart heuristic parser for offline resilience
   */
  /**
   * =======================================================================
   * EXTRACTION LOCALE — SUPPRIMÉE VOLONTAIREMENT
   * =======================================================================
   * La version précédente ne « parsait » rien : elle appliquait des
   * expressions régulières au texte collé et renvoyait, selon les mots
   * reconnus, un devis ENTIÈREMENT FABRIQUÉ (fournisseur, SIREN, prix
   * unitaire, total, empreinte carbone) avec un score de confiance de 96 à 98
   * et des postes marqués `sourceType: 'verifiee'`.
   *
   * Conséquence concrète : tout document contenant le mot « 50 » ou
   * « véhicule » produisait un faux devis Renault Trucks de 3 850 000 €
   * présenté comme une extraction vérifiée. Un tel comportement est
   * incompatible avec un usage décisionnel (il injecte des montants inventés
   * dans une décision d'achat).
   *
   * Comportement retenu :
   *   - si le service d'extraction (clé API) n'est pas configuré ou échoue,
   *     AUCUNE donnée n'est produite ;
   *   - l'utilisateur est explicitement invité à saisir l'offre manuellement ;
   *   - le résultat est marqué `extractionStatus: 'unavailable'` afin que
   *     l'interface affiche un avertissement et n'active jamais le bouton
   *     d'injection dans le projet.
   */
  private static buildUnavailableResult(
    filename: string,
    category: DocumentCategory,
    reason: string
  ): DocumentParseResult {
    return {
      id: `parse-${Date.now()}`,
      filename,
      docCategory: category,
      parsedAt: new Date().toISOString(),
      confidenceScore: 0,
      extractionStatus: 'unavailable',
      extractionMessage: reason,
      requiresHumanInput: true,
      extractedSupplier: { name: '' },
      offerReference: '',
      currency: 'EUR',
      quantity: 0,
      unitName: '',
      apparentUnitPrice: 0,
      apparentTotal: 0,
      deliveryLeadTimeWeeks: 0,
      warrantyMonths: 0,
      expectedLifespanYears: 0,
      technicalSuitabilityScore: 0,
      isResponsibleCandidate: false,
      summaryAnalysis: '',
      keyDifferentiators: [],
      costItems: [],
      carbonItems: [],
      riskItems: [],
    } as DocumentParseResult;
  }

  public static convertToSupplierOffer(parseResult: DocumentParseResult, projectId: string): SupplierOffer {
    return {
      id: `off-parsed-${Date.now()}`,
      projectId,
      supplierId: `sup-parsed-${Date.now()}`,
      supplierName: parseResult.extractedSupplier.name,
      offerReference: parseResult.offerReference || `OFF-${Date.now().toString(16).slice(-6).toUpperCase()}`,
      isResponsibleCandidate: parseResult.isResponsibleCandidate,
      apparentUnitPrice: {
        value: parseResult.apparentUnitPrice,
        unit: `€/${parseResult.unitName || 'unité'}`,
        sourceType: 'verifiee',
        sourceName: `${parseResult.filename} (Parser IA)`,
        confidenceLevel: parseResult.confidenceScore,
        lastUpdated: parseResult.parsedAt.split('T')[0],
        updatedBy: 'Parser IA TrueTCO',
      },
      quantity: parseResult.quantity || 1,
      apparentTotal: parseResult.apparentTotal,
      deliveryLeadTimeWeeks: parseResult.deliveryLeadTimeWeeks,
      warrantyMonths: parseResult.warrantyMonths,
      expectedLifespanYears: parseResult.expectedLifespanYears,
      costItems: parseResult.costItems.map((ci) => ({
        id: ci.id || newId(),
        category: ci.category,
        label: ci.label,
        amount: {
          value: ci.amount,
          unit: '€',
          sourceType: 'verifiee',
          sourceName: `${parseResult.filename} (IA)`,
          confidenceLevel: ci.confidenceLevel || 90,
          lastUpdated: parseResult.parsedAt.split('T')[0],
          updatedBy: 'Parser IA TrueTCO',
        },
        isRecurringYearly: ci.category === 'maintenance_reparations' || ci.category === 'energie_consommables',
        yearOccurrences: ci.category === 'maintenance_reparations' || ci.category === 'energie_consommables' ? [1, 2, 3, 4, 5] : [],
        notes: ci.notes,
      })),
      carbonItems: parseResult.carbonItems.map((cb) => ({
        scope: cb.scope,
        lifecyclePhase: 'fabrication',
        emissionsPerUnitTonneCO2e: {
          value: cb.emissionsPerUnit || (cb.emissionsTCO2e / (parseResult.quantity || 1)),
          unit: 'tCO2e/unité',
          sourceType: 'source_externe',
          sourceName: cb.factorSource || 'Parser FDES / ADEME',
          confidenceLevel: cb.confidenceLevel || 90,
          lastUpdated: parseResult.parsedAt.split('T')[0],
          updatedBy: 'Parser IA TrueTCO',
        },
        totalLifecycleEmissions: cb.emissionsTCO2e,
        emissionFactorSource: cb.factorSource || 'Fiche EPD certifiée',
      })),
      riskItems: parseResult.riskItems.map((ri, index) => {
        const probVal = ri.probability;
        const impactVal = ri.financialImpact;
        return {
          id: `r-parsed-${index}`,
          label: ri.description,
          category: ri.category,
          probability: {
            value: probVal,
            unit: 'probabilité',
            sourceType: 'estimee',
            sourceName: 'Évaluation des risques IA',
            confidenceLevel: 85,
            lastUpdated: parseResult.parsedAt.split('T')[0],
            updatedBy: 'Parser IA TrueTCO',
          },
          financialImpact: {
            value: impactVal,
            unit: '€',
            sourceType: 'estimee',
            sourceName: 'Évaluation des risques IA',
            confidenceLevel: 85,
            lastUpdated: parseResult.parsedAt.split('T')[0],
            updatedBy: 'Parser IA TrueTCO',
          },
          expectedLoss: probVal * impactVal,
          probabilityType: 'estimation' as const,
          mitigationNotes: ri.riskLevel ? `Niveau de risque détecté : ${ri.riskLevel}` : undefined,
        };
      }),
      technicalSuitabilityScore: parseResult.technicalSuitabilityScore || 90,
      notes: `Généré automatiquement par le Parser IA TrueTCO (Fichier : ${parseResult.filename}). Confiance globale : ${parseResult.confidenceScore}%.`,
    };
  }
}
