import React, { useState } from 'react';
import {
  Project,
  SupplierOffer,
  TCOCalculationResult,
  CostBreakdownItem,
  Supplier,
  AuditLogEntry,
  ExternalityReferenceBenchmark,
} from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import {
  HelpCircle,
  TrendingDown,
  TrendingUp,
  Plus,
  Sliders,
  ShieldCheck,
  CheckCircle,
  FileSpreadsheet,
  Award,
  Layers,
  Network,
  Sparkles,
} from 'lucide-react';
import { WhyThisAmountModal } from './WhyThisAmountModal';
import { NavView } from './Sidebar';
import { ExcelExportService } from '../services/excelExportService';

interface ComparatorViewProps {
  project: Project;
  offers: SupplierOffer[];
  suppliers?: Supplier[];
  auditLogs?: AuditLogEntry[];
  benchmarks?: ExternalityReferenceBenchmark[];
  onOpenImportModal: () => void;
  onUpdateProject: (updated: Project) => void;
  onNavigate?: (view: NavView) => void;
}

export const ComparatorView: React.FC<ComparatorViewProps> = ({
  project,
  offers,
  suppliers = [],
  auditLogs = [],
  benchmarks = [],
  onOpenImportModal,
  onUpdateProject,
  onNavigate,
}) => {
  // Modal state for explainability
  const [modalData, setModalData] = useState<{
    isOpen: boolean;
    title: string;
    categoryLabel: string;
    auditedValue?: any;
    calculatedFormula?: string;
    calculationExplanation?: string;
    relatedAssumptions?: { label: string; value: string }[];
  }>({
    isOpen: false,
    title: '',
    categoryLabel: '',
  });

  // Calculate results for all offers
  const results: (TCOCalculationResult & { offer: SupplierOffer })[] = offers.map((offer) => {
    const res = TCOEngine.calculateOfferTCO(project, offer);
    return { ...res, offer };
  });

  // Sort by comprehensive TCO ascending
  const sortedByTCO = [...results].sort(
    (a, b) => a.totalComprehensiveTCO - b.totalComprehensiveTCO
  );
  const cheapestTCO = sortedByTCO[0];

  // Also find cheapest initial acquisition
  const sortedByInitial = [...results].sort(
    (a, b) => a.apparentDirectCost - b.apparentDirectCost
  );
  const cheapestInitial = sortedByInitial[0];

  const handleExplain = (
    title: string,
    categoryLabel: string,
    auditedValue?: any,
    formula?: string,
    explanation?: string,
    assumptions?: { label: string; value: string }[]
  ) => {
    setModalData({
      isOpen: true,
      title,
      categoryLabel,
      auditedValue,
      calculatedFormula: formula,
      calculationExplanation: explanation,
      relatedAssumptions: assumptions,
    });
  };

  if (offers.length === 0 || !cheapestTCO || !cheapestInitial) {
    return (
      <div className="p-12 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 mx-auto">
          <Layers className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">Aucune offre déposée pour cette consultation</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Importez ou saisissez les offres de vos fournisseurs pour lancer la normalisation TCO, la valorisation carbone et l'arbitrage économique.
          </p>
        </div>
        <button
          onClick={onOpenImportModal}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold inline-flex items-center gap-2 transition-colors shadow-lg shadow-emerald-950/40"
        >
          <Plus className="w-4 h-4" />
          <span>Importer une Première Offre</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1">
            Moteur d'Aide à la Décision Achats
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Comparateur & Décomposition TCO / LCC
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Transformation objective de la comparaison faciale (prix unitaire devis) en coût total de possession sur {project.horizonYears} ans intégrant énergie, maintenance, risques opérationnels et externalités carbone.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => ExcelExportService.exportFinancialWorkbook(project, offers, suppliers, auditLogs, benchmarks)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Exporter le modèle financier complet en classeur Excel multi-onglets (.xlsx)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            Exporter Excel (.xlsx)
          </button>

          {onNavigate && (
            <>
              <button
                onClick={() => onNavigate('erp_connectors')}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-400 hover:text-sky-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                title="Synchroniser les offres depuis votre ERP (SAP Ariba, Coupa, Ivalua)"
              >
                <Network className="w-3.5 h-3.5" />
                Sync ERP
              </button>
              <button
                onClick={() => onNavigate('ai_parser')}
                className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-purple-400 hover:text-purple-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                title="Numériser un devis PDF ou fiche FDES par IA"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Parser IA
              </button>
              <button
                onClick={() => onNavigate('multicriteria')}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-400 hover:text-emerald-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                title="Accéder à la matrice de pondération multicritères 360°"
              >
                <Award className="w-3.5 h-3.5" />
                Arbitrage Multicritères 360°
              </button>
            </>
          )}

          <button
            onClick={onOpenImportModal}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Importer une offre
          </button>
        </div>
      </div>

      {/* Strategic Takeaway Banner */}
      {cheapestInitial && cheapestTCO && (
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-slate-400 flex items-center gap-2">
              <span>Constat Financier Clé</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">Périmètre : {project.plannedVolume} {project.unitName} sur {project.horizonYears} ans</span>
            </div>
            <div className="text-sm text-slate-200">
              L'offre faciale la moins chère est{' '}
              <strong className="text-white">{cheapestInitial.supplierName}</strong> ({cheapestInitial.apparentDirectCost.toLocaleString('fr-FR')} €).{' '}
              {cheapestInitial.offerId !== cheapestTCO.offerId ? (
                <>
                  Cependant, sur l'horizon de {project.horizonYears} ans,{' '}
                  <strong className="text-emerald-400">{cheapestTCO.supplierName}</strong> présente le coût total réel le plus avantageux ({cheapestTCO.totalComprehensiveTCO.toLocaleString('fr-FR')} €), soit{' '}
                  <span className="text-emerald-400 font-semibold font-mono">
                    {(cheapestInitial.totalComprehensiveTCO - cheapestTCO.totalComprehensiveTCO).toLocaleString('fr-FR')} € d'économies nettes
                  </span>.
                </>
              ) : (
                <>
                  Elle s'avère également la plus avantageuse sur le coût global TCO ({cheapestTCO.totalComprehensiveTCO.toLocaleString('fr-FR')} €).
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[11px] text-slate-400">Taux d'actualisation WACC</div>
              <div className="font-mono text-xs font-semibold text-white">{(project.discountRate * 100).toFixed(1)}%</div>
            </div>
            <div className="text-right pl-3 border-l border-slate-800">
              <div className="text-[11px] text-slate-400">Prix Carbone Tutélaire</div>
              <div className="font-mono text-xs font-semibold text-white">{project.carbonPricePerTonne} €/t</div>
            </div>
          </div>
        </div>
      )}

      {/* Main Comparison Table */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <th className="py-3 px-4 font-semibold text-white min-w-[220px]">
                  Postes de Coûts & Indicateurs
                </th>
                {results.map((res) => (
                  <th key={res.offerId} className="py-3 px-4 min-w-[200px] border-l border-slate-800/80">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-white text-sm truncate">{res.supplierName}</span>
                      {res.isResponsibleCandidate && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-1.5 py-0.5 rounded font-medium">
                          Option ESG
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                      Réf: {res.offer.offerReference}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800/60">
              {/* Row 1: Apparent Purchase Price */}
              <tr className="bg-slate-900/30 hover:bg-slate-900/50 transition-colors">
                <td className="py-2.5 px-4 font-semibold text-slate-200">
                  <div className="flex items-center justify-between">
                    <span>1. Prix Facial Devis (Acquisition CAPEX)</span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Prix facial du devis',
                          'Acquisition directe',
                          {
                            value: 'Prix unitaire × Volume prévu',
                            unit: '',
                            sourceType: 'verifiee',
                            sourceName: 'Devis négocié du fournisseur',
                            confidenceLevel: 98,
                            lastUpdated: '2026-03-10',
                            updatedBy: 'Acheteur Lead',
                          },
                          'Prix_Facial = Prix_Unitaire_Devis × Quantité',
                          'Montant brut figurant sur le devis standard avant intégration des coûts d\'exploitation, de maintenance et d\'externalités.'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300 ml-2"
                      title="Pourquoi ce montant ?"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => {
                  const isLowest = res.apparentDirectCost === cheapestInitial.apparentDirectCost;
                  return (
                    <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums">
                      <div className="font-semibold text-white">
                        {res.apparentDirectCost.toLocaleString('fr-FR')} €
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {(res.offer?.apparentUnitPrice?.value ?? (res.offer?.apparentTotal ? res.offer.apparentTotal / (res.offer.quantity || 1) : 0)).toLocaleString('fr-FR')} € / unité
                        {isLowest && (
                          <span className="text-emerald-400 ml-1.5 font-sans font-medium text-[10px]">
                            (Moins cher facial)
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>

              {/* Row 2: Installation and Commissioning */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-slate-700">Installation & Mise en service</span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Installation, raccordement & mise en service',
                          'CAPEX Complémentaire',
                          {
                            value: 'Bornes IRVE / Raccordement réseau / Masterisation',
                            unit: '',
                            sourceType: 'verifiee',
                            sourceName: 'Devis installateur qualifié',
                            confidenceLevel: 95,
                            lastUpdated: '2026-03-10',
                            updatedBy: 'Acheteur Lead',
                          },
                          'Coût_Installation = Matériel_Infrastructure + Raccordement - Aides_Subventions',
                          'Prestations indispensables pour rendre le matériel opérationnel sur site.'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-slate-300">
                    {res.installationTotal > 0 ? `${res.installationTotal.toLocaleString('fr-FR')} €` : '0 € (Inclus)'}
                  </td>
                ))}
              </tr>

              {/* Row 3: Energy / Consumables */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-emerald-500">
                      Énergie & Carburant ({project.horizonYears} ans)
                    </span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Consommation énergétique cumulée',
                          'OPEX Énergie',
                          {
                            value: 'Flux actualisé avec inflation annuelle',
                            unit: '€',
                            sourceType: 'estimee',
                            sourceName: 'Consommation télémétrique & contrat d\'énergie',
                            confidenceLevel: 88,
                            lastUpdated: '2026-03-12',
                            updatedBy: 'Contrôleur DAF',
                          },
                          'Total_Énergie = Σ(t=1..H) [ Conso_Annuelle × (1 + Inflation_Énergie)^(t-1) ]',
                          `Prend en compte ${project.energyInflationRate * 100}% d'inflation annuelle prévisionnelle sur les tarifs énergétiques.`,
                          [
                            { label: 'Inflation énergie retenue', value: `${project.energyInflationRate * 100}% / an` },
                            { label: 'Horizon temporel', value: `${project.horizonYears} ans` },
                          ]
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-slate-200">
                    {res.energyConsumablesTotal.toLocaleString('fr-FR')} €
                  </td>
                ))}
              </tr>

              {/* Row 4: Maintenance & Repairs */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-indigo-500">
                      Maintenance préventive & pneumatiques
                    </span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Entretien préventif et pièces d\'usure',
                          'OPEX Maintenance',
                          {
                            value: 'Forfait contractuel pièces & main d\'œuvre',
                            unit: '€',
                            sourceType: 'verifiee',
                            sourceName: 'Barème constructeur certifié',
                            confidenceLevel: 92,
                            lastUpdated: '2026-03-10',
                            updatedBy: 'Acheteur Lead',
                          },
                          'Maint_Total = Σ(t=1..H) [ Forfait_Annuel × (1 + Inflation)^(t-1) × Facteur_Usure(t) ]',
                          'Intègre les révisions obligatoires, consommables d\'usure et coefficient de vieillissement matériel.'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-slate-200">
                    {res.maintenanceRepairsTotal.toLocaleString('fr-FR')} €
                  </td>
                ))}
              </tr>

              {/* Row 5: Curative Failures & Defect costs */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-amber-500">
                      Pannes curatives & aléas post-garantie
                    </span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Pannes curatives et défaillances hors garantie',
                          'Risque Opérationnel Pièces',
                          {
                            value: 'Historique de pannes × coût moyen incident',
                            unit: '€',
                            sourceType: 'estimee',
                            sourceName: 'Historique flotte interne & retours constructeur',
                            confidenceLevel: 80,
                            lastUpdated: '2026-03-12',
                            updatedBy: 'Contrôleur DAF',
                          },
                          'Curatif = Σ [ Taux_Panne_Historique × Coût_Moyen_Intervention ]',
                          'Prend en compte la durée de la garantie contractuelle (2 ans vs 5 ans).'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-slate-200">
                    {res.replacementDefectsTotal.toLocaleString('fr-FR')} €
                    <span className="block text-[10px] text-slate-400 font-sans">
                      Garantie: {res.offer.warrantyMonths} mois
                    </span>
                  </td>
                ))}
              </tr>

              {/* Row 6: Administrative & Compliance / Taxes */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-rose-500">
                      Taxes sur émissions & conformité réglementaire
                    </span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Fiscalité écologique & Malus annuel',
                          'Conformité Fiscale',
                          {
                            value: 'Barème officiel Loi de Finances',
                            unit: '€',
                            sourceType: 'source_externe',
                            sourceName: 'Code Général des Impôts 2026',
                            confidenceLevel: 98,
                            lastUpdated: '2026-03-01',
                            updatedBy: 'Contrôleur DAF',
                          },
                          'Fiscalité = Taxe_Annuelle_CO2 + Malus_Masse',
                          'Exonération totale pour les véhicules 100% électriques.'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-slate-200">
                    {res.adminComplianceTotal.toLocaleString('fr-FR')} €
                  </td>
                ))}
              </tr>

              {/* Row 7: Salvage Value (Credit) */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-emerald-400 text-emerald-400">
                      Valeur résiduelle / Revente à {project.horizonYears} ans (Déduction)
                    </span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Valeur résiduelle nette de cession',
                          'Actif de Récupération',
                          {
                            value: 'Estimation côte marché secondaire ou engagement rachat',
                            unit: '€',
                            sourceType: 'estimee',
                            sourceName: 'Observatoire du Véhicule Professionnel & constructeur',
                            confidenceLevel: 80,
                            lastUpdated: '2026-03-15',
                            updatedBy: 'Contrôleur DAF',
                          },
                          'TCO_Économique = Coûts_Bruts - Valeur_Résiduelle_Cession',
                          'La valeur résiduelle vient réduire le coût global de l\'investissement en fin d\'horizon.'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-emerald-400">
                    - {res.salvageValueTotal.toLocaleString('fr-FR')} €
                  </td>
                ))}
              </tr>

              {/* SUB-TOTAL: Economic TCO */}
              <tr className="bg-slate-900/70 border-t-2 border-slate-700 font-semibold">
                <td className="py-3 px-4 text-white">
                  <div className="flex items-center justify-between">
                    <span>Sous-total TCO Économique Standard</span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'TCO Économique Nominal (hors risques & carbone)',
                          'Moteur TCO Modulaire',
                          {
                            value: 'Somme arithmétique des flux CAPEX et OPEX',
                            unit: '€',
                            sourceType: 'verifiee',
                            sourceName: 'Moteur de calcul certifié TrueTCO',
                            confidenceLevel: 94,
                            lastUpdated: '2026-03-20',
                            updatedBy: 'Moteur TCO',
                          },
                          'TCO_eco = Acquisition + Logistique + Installation + Énergie + Maintenance + Pannes + Taxes + Fin_de_vie - Valeur_résiduelle',
                          'Coût total économique conventionnel avant monétisation des externalités et risques de non-conformité.'
                        )
                      }
                      className="text-slate-400 hover:text-white"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-3 px-4 border-l border-slate-800/80 font-mono tabular-nums text-white text-sm">
                    {res.economicTCONominal.toLocaleString('fr-FR')} €
                  </td>
                ))}
              </tr>

              {/* Row 8: Operational & Regulatory Risks */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-rose-500">
                      Exposition aux risques réglementaires & ZFE (P × I)
                    </span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Exposition aux risques de non-conformité',
                          'Gestion des Risques B2B',
                          {
                            value: 'Probabilité × Impact financier moyen',
                            unit: '€',
                            sourceType: 'estimee',
                            sourceName: 'Matrice des risques juridiques et opérationnels',
                            confidenceLevel: 80,
                            lastUpdated: '2026-03-05',
                            updatedBy: 'Contrôleur DAF',
                          },
                          'Exposition_Financière = Σ [ Probabilité_i × Impact_Financier_i ]',
                          'Valorise l\'exposition financière aux restrictions de circulation ZFE, pénalités de retard ou risques batterie.'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-rose-300">
                    + {res.riskExpositionTotal.toLocaleString('fr-FR')} €
                  </td>
                ))}
              </tr>

              {/* Row 9: Carbon Externalities */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-sky-400">
                      Coût Carbone Monétisé ({project.carbonPricePerTonne} €/t)
                    </span>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Externalité carbone monétisée',
                          'Comptabilité Extra-Financière',
                          {
                            value: `${project.carbonPricePerTonne} € par tonne CO2e`,
                            unit: '€/tCO2e',
                            sourceType: 'source_externe',
                            sourceName: 'Valeur tutélaire Quinet & ADEME Base Carbone',
                            confidenceLevel: 95,
                            lastUpdated: '2026-01-10',
                            updatedBy: 'Resp. RSE',
                          },
                          'Coût_Carbone = Émissions_Totales_(tCO2e) × Prix_Tutélaire_(€/t)',
                          `Monétise le coût social et réglementaire du carbone selon la trajectoire Quinet (${project.carbonPricePerTonne} €/t).`
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums text-sky-300">
                    + {res.monetizedCarbonTotal.toLocaleString('fr-FR')} €
                    <span className="block text-[10px] text-slate-400 font-sans">
                      {res.totalLifecycleCO2eTonnes} tCO2e émises
                    </span>
                  </td>
                ))}
              </tr>

              {/* TOTAL: Full Comprehensive TCO */}
              <tr className="bg-slate-900 border-t-2 border-emerald-500/80 font-bold">
                <td className="py-3.5 px-4 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm">COÛT TOTAL RÉEL (TCO GLOBAL)</span>
                      <span className="block text-[11px] font-normal text-slate-400">
                        Économique + Risques + Externalité Carbone
                      </span>
                    </div>
                  </div>
                </td>
                {results.map((res) => {
                  const isLowestTCO = res.offerId === cheapestTCO.offerId;
                  return (
                    <td
                      key={res.offerId}
                      className={`py-3.5 px-4 border-l border-slate-800/80 font-mono tabular-nums ${
                        isLowestTCO ? 'bg-emerald-950/40 text-emerald-400' : 'text-white'
                      }`}
                    >
                      <div className="text-base font-extrabold">
                        {res.totalComprehensiveTCO.toLocaleString('fr-FR')} €
                      </div>
                      <div className="text-xs font-normal text-slate-400">
                        {res.unitTCO.toLocaleString('fr-FR')} € / unité
                      </div>
                      {isLowestTCO && (
                        <div className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-950/80 border border-emerald-700/60 px-2 py-0.5 rounded">
                          <CheckCircle className="w-3 h-3" />
                          Recommandation Économique
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>

              {/* Row 10: Lifecycle Costing (LCC Discounted - Actualisé) */}
              <tr className="bg-slate-900/30 hover:bg-slate-900/50 transition-colors">
                <td className="py-3 px-4 text-slate-200">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-xs">LCC Actualisé (Net Present Value - WACC {(project.discountRate * 100).toFixed(1)}%)</span>
                      <span className="block text-[11px] text-slate-400">
                        Flux de trésorerie déflatés dans le temps
                      </span>
                    </div>
                    <button
                      onClick={() =>
                        handleExplain(
                          'Lifecycle Costing (LCC) Actualisé',
                          'Actualisation Financière WACC',
                          {
                            value: `WACC = ${(project.discountRate * 100).toFixed(1)}%`,
                            unit: '%',
                            sourceType: 'source_externe',
                            sourceName: 'Norme ISO 15686-5 & consensus Trésorerie',
                            confidenceLevel: 95,
                            lastUpdated: '2026-02-01',
                            updatedBy: 'Contrôleur DAF',
                          },
                          'LCC = CAPEX_0 + Σ(t=1..H) [ CashFlow_t / (1 + r)^t ]',
                          'Calcule la valeur actuelle nette de l\'ensemble des sorties de fonds réelles au fil des années.'
                        )
                      }
                      className="text-slate-500 hover:text-slate-300"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-3 px-4 border-l border-slate-800/80 font-mono tabular-nums text-slate-100 font-semibold">
                    {res.lifecycleCostLCC.toLocaleString('fr-FR')} €
                  </td>
                ))}
              </tr>

              {/* Row 11: Data Quality and Uncertainty Interval */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs">Indice de Qualité des Données & Fourchette</span>
                      <span className="block text-[11px] text-slate-400">
                        Gestion de l'incertitude (anti-fausse précision)
                      </span>
                    </div>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 rounded-full"
                          style={{ width: `${res.dataQualityScore}%` }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-emerald-400 font-medium">
                        {res.dataQualityScore}%
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      {res.uncertaintyRange.minTCO.toLocaleString('fr-FR')} € – {res.uncertaintyRange.maxTCO.toLocaleString('fr-FR')} €
                    </div>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Visual Composition Stacked Bars */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
          Décomposition Graphique du TCO Réel
        </h3>
        <div className="space-y-3">
          {results.map((res) => {
            const total = res.totalComprehensiveTCO;
            const acqPct = (res.apparentDirectCost / total) * 100;
            const nrjPct = (res.energyConsumablesTotal / total) * 100;
            const maintPct = ((res.maintenanceRepairsTotal + res.replacementDefectsTotal) / total) * 100;
            const taxPct = (res.adminComplianceTotal / total) * 100;
            const carbPct = (res.monetizedCarbonTotal / total) * 100;
            const riskPct = (res.riskExpositionTotal / total) * 100;

            return (
              <div key={res.offerId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">{res.supplierName}</span>
                  <span className="font-mono text-slate-300 font-semibold tabular-nums">
                    {res.totalComprehensiveTCO.toLocaleString('fr-FR')} €
                  </span>
                </div>
                <div className="h-4 bg-slate-950 rounded overflow-hidden flex border border-slate-800">
                  <div
                    style={{ width: `${acqPct}%` }}
                    className="bg-slate-500 hover:opacity-90 transition-opacity"
                    title={`Acquisition: ${res.apparentDirectCost.toLocaleString()} € (${acqPct.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${nrjPct}%` }}
                    className="bg-emerald-500 hover:opacity-90 transition-opacity"
                    title={`Énergie: ${res.energyConsumablesTotal.toLocaleString()} € (${nrjPct.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${maintPct}%` }}
                    className="bg-indigo-500 hover:opacity-90 transition-opacity"
                    title={`Maintenance: ${(res.maintenanceRepairsTotal + res.replacementDefectsTotal).toLocaleString()} € (${maintPct.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${taxPct}%` }}
                    className="bg-rose-500 hover:opacity-90 transition-opacity"
                    title={`Taxes: ${res.adminComplianceTotal.toLocaleString()} € (${taxPct.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${riskPct}%` }}
                    className="bg-amber-500 hover:opacity-90 transition-opacity"
                    title={`Risques: ${res.riskExpositionTotal.toLocaleString()} € (${riskPct.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${carbPct}%` }}
                    className="bg-sky-500 hover:opacity-90 transition-opacity"
                    title={`Carbone: ${res.monetizedCarbonTotal.toLocaleString()} € (${carbPct.toFixed(1)}%)`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 pt-2 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-slate-500" /> Acquisition
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Énergie
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500" /> Maintenance & Pièces
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Taxes & Réglementation
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Risques Opérationnels
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" /> Externalité Carbone
          </span>
        </div>
      </div>

      {/* WhyThisAmount Modal Container */}
      <WhyThisAmountModal
        isOpen={modalData.isOpen}
        onClose={() => setModalData((prev) => ({ ...prev, isOpen: false }))}
        title={modalData.title}
        categoryLabel={modalData.categoryLabel}
        auditedValue={modalData.auditedValue}
        calculatedFormula={modalData.calculatedFormula}
        calculationExplanation={modalData.calculationExplanation}
        relatedAssumptions={modalData.relatedAssumptions}
      />
    </div>
  );
};
