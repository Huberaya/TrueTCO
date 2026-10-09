import React, { useState } from 'react';
import {
  Project,
  SupplierOffer,
  TCOCalculationResult,
  AuditLogEntry,
} from '../types/domain';
import { DecisionRunResult } from '../services/serverData';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';
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
import { CalculationTraceRow, WhyThisAmountModal } from './WhyThisAmountModal';
import { NavView } from './Sidebar';
import { ExcelExportService } from '../services/excelExportService';

interface ComparatorViewProps {
  project: Project;
  offers: SupplierOffer[];
  decisionRun: DecisionRunResult | null;
  auditLogs?: AuditLogEntry[];
  onOpenImportModal: () => void;
  onNavigate?: (view: NavView) => void;
}

export const ComparatorView: React.FC<ComparatorViewProps> = ({
  project,
  offers,
  decisionRun,
  auditLogs = [],
  onOpenImportModal,
  onNavigate,
}) => {
  const [exportError, setExportError] = useState<string | null>(null);
  const [modalData, setModalData] = useState<{
    isOpen: boolean;
    title: string;
    categoryLabel: string;
    rows: CalculationTraceRow[];
    methodology: Record<string, string>;
  }>({
    isOpen: false,
    title: '',
    categoryLabel: '',
    rows: [],
    methodology: {},
  });

  // Les résultats sont ordonnés par le classement déjà produit par l'API ;
  // cette page ne recalcule ni ne retrie les offres.
  const results: (TCOCalculationResult & { offer: SupplierOffer })[] = decisionRun
    ? decisionRun.ranking.flatMap(({ offerId }) => {
        const offer = offers.find((item) => item.id === offerId);
        const calculation = decisionRun.calculationsByOfferId[offerId];
        return offer && calculation ? [{ ...calculation, offer }] : [];
      })
    : [];
  const rankedLeader = decisionRun?.ranking[0]
    ? results.find((result) => result.offerId === decisionRun.ranking[0].offerId)
    : undefined;
  const recommendation = decisionRun?.recommendation;

  type NumericResultField =
    | 'apparentDirectCost'
    | 'installationTotal'
    | 'energyConsumablesTotal'
    | 'maintenanceRepairsTotal'
    | 'replacementDefectsTotal'
    | 'adminComplianceTotal'
    | 'taxesTotal'
    | 'salvageValueTotal'
    | 'economicTCONominal'
    | 'riskExpositionTotal'
    | 'monetizedCarbonTotal'
    | 'lifecycleCostLCC';

  const handleExplain = (
    title: string,
    categoryLabel: string,
    resultField: NumericResultField,
    traceCategories?: string[],
    useApparentPriceSource = false
  ) => {
    const rows = results.map((result) => ({
      supplierName: result.supplierName,
      offerReference: result.offer.offerReference,
      amount: typeof result[resultField] === 'number' && Number.isFinite(result[resultField])
        ? result[resultField]
        : null,
      source:
        useApparentPriceSource && result.offer.apparentUnitPrice
          ? {
              value: result.offer.apparentUnitPrice.value,
              unit: result.offer.apparentUnitPrice.unit,
              sourceType: result.offer.apparentUnitPrice.sourceType,
              sourceName: result.offer.apparentUnitPrice.sourceName,
              sourceUrl: result.offer.apparentUnitPrice.sourceUrl,
              confidenceLevel: result.offer.apparentUnitPrice.confidenceLevel,
              lastUpdated: result.offer.apparentUnitPrice.lastUpdated,
            }
          : undefined,
      lines: (result.costLineTrace ?? []).filter(
        (line) => !traceCategories || traceCategories.includes(line.category)
      ),
    }));
    setModalData({
      isOpen: true,
      title,
      categoryLabel,
      rows,
      methodology: results[0]?.methodology ?? {},
    });
  };

  const handleExportExcel = () => {
    if (!decisionRun) {
      setExportError('Export bloqué : aucun résultat serveur n’est fourni.');
      return;
    }
    try {
      ExcelExportService.exportFinancialWorkbook(project, offers, decisionRun, auditLogs);
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Le classeur n’a pas pu être exporté.');
    }
  };

  if (offers.length > 0 && !decisionRun) {
    return <ServerCalculationEmptyState title="Aucun comparatif calculé côté serveur" />;
  }

  if (offers.length === 0) {
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
  if (!decisionRun) return <ServerCalculationEmptyState title="Aucun comparatif calculé côté serveur" />;
  if (!rankedLeader) {
    return <ServerCalculationEmptyState title="Le dernier calcul ne contient pas les offres affichées" />;
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
            onClick={handleExportExcel}
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

      {exportError && <div className="rounded-lg border border-rose-700 bg-rose-950/40 p-3 text-xs text-rose-200" role="alert">{exportError}</div>}

      {/* Synthèse fidèle au classement et au statut renvoyés par l'API */}
      {recommendation && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-400">
              <span>Résultat de l'exécution serveur</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-300">{project.plannedVolume} {project.unitName} · {project.horizonYears} ans</span>
            </div>
            <div className="text-sm text-slate-200">
              {recommendation.status === 'indetermine' ? (
                <>Rang 1 du classement VAN : <strong className="text-white">{rankedLeader.supplierName}</strong>. Aucune recommandation ferme n'est émise.</>
              ) : (
                <>Proposition du moteur ({recommendation.status === 'conditionnel' ? 'conditionnelle' : 'à approuver'}) : <strong className="text-white">{recommendation.supplierName ?? rankedLeader.supplierName}</strong>.</>
              )}
            </div>
            <p className="max-w-3xl text-xs text-slate-400">{recommendation.reason}</p>
            {recommendation.economicAdvantage && (
              <p className="text-xs text-slate-300">Écart de VAN face à la deuxième offre, tel que renvoyé par le serveur : <span className="font-mono">{recommendation.economicAdvantage.vsSecondBestNpv.toLocaleString('fr-FR')} €</span>.</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right"><div className="text-[11px] text-slate-400">Taux d'actualisation du dossier</div><div className="font-mono text-xs font-semibold text-white">{(project.discountRate * 100).toFixed(1)}%</div></div>
            <div className="border-l border-slate-800 pl-3 text-right"><div className="text-[11px] text-slate-400">Prix carbone saisi</div><div className="font-mono text-xs font-semibold text-white">{project.carbonPricePerTonne} €/t</div></div>
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
                        handleExplain('Prix facial du devis', 'Acquisition directe', 'apparentDirectCost', undefined, true)
                      }
                      className="text-slate-500 hover:text-slate-300 ml-2"
                      title="Pourquoi ce montant ?"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="py-2.5 px-4 border-l border-slate-800/80 font-mono tabular-nums">
                    <div className="font-semibold text-white">{res.apparentDirectCost.toLocaleString('fr-FR')} €</div>
                    <div className="text-[11px] text-slate-400">
                      {typeof res.offer.apparentUnitPrice?.value === 'number'
                        ? `${res.offer.apparentUnitPrice.value.toLocaleString('fr-FR')} € / unité`
                        : 'Prix unitaire non renseigné'}
                    </div>
                  </td>
                ))}
              </tr>

              {/* Row 2: Installation and Commissioning */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-slate-700">Installation & Mise en service</span>
                    <button
                      onClick={() =>
                        handleExplain('Installation, raccordement & mise en service', 'CAPEX Complémentaire', 'installationTotal', ['installation_mise_en_service'])
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
                        handleExplain('Consommation énergétique cumulée', 'OPEX Énergie', 'energyConsumablesTotal', ['energie_consommables'])
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
                        handleExplain('Entretien préventif et pièces d\'usure', 'OPEX Maintenance', 'maintenanceRepairsTotal', ['maintenance_reparations'])
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
                        handleExplain('Pannes curatives et défaillances hors garantie', 'Risque Opérationnel Pièces', 'replacementDefectsTotal', ['remplacement_pannes'])
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
                      Administration & conformité
                    </span>
                    <button
                      onClick={() =>
                        handleExplain('Coûts administratifs et conformité', 'Administration', 'adminComplianceTotal', ['couts_administratifs_conformite'])
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

              {/* Taxes sont exposées séparément par le résultat serveur. */}
              <tr className="hover:bg-slate-900/40 transition-colors">
                <td className="py-2.5 px-4 text-slate-300">
                  <div className="flex items-center justify-between">
                    <span className="pl-3 border-l-2 border-rose-500">Fiscalité & taxes</span>
                    <button
                      onClick={() => handleExplain('Taxes et fiscalité', 'Poste fiscal du résultat serveur', 'taxesTotal', ['fiscalite_taxes'])}
                      className="text-slate-500 hover:text-slate-300"
                      title="Détail des taxes exposées dans le résultat serveur"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                {results.map((res) => (
                  <td key={res.offerId} className="border-l border-slate-800/80 px-4 py-2.5 font-mono tabular-nums text-slate-200">
                    {typeof res.taxesTotal === 'number' && Number.isFinite(res.taxesTotal)
                      ? `${res.taxesTotal.toLocaleString('fr-FR')} €`
                      : 'Non exposé par cette exécution'}
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
                        handleExplain('Valeur résiduelle nette de cession', 'Actif de Récupération', 'salvageValueTotal', ['valeur_residuelle'])
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
                        handleExplain('TCO Économique Nominal (hors risques & carbone)', 'Moteur TCO Modulaire', 'economicTCONominal')
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
                        handleExplain('Exposition aux risques de non-conformité', 'Gestion des Risques B2B', 'riskExpositionTotal', [])
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
                        handleExplain('Externalité carbone monétisée', 'Comptabilité Extra-Financière', 'monetizedCarbonTotal', [])
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
                  const isLowestTCO = res.offerId === rankedLeader.offerId;
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
                          {recommendation?.status === 'indetermine'
                            ? 'Rang 1 VAN — sans recommandation ferme'
                            : recommendation?.status === 'conditionnel'
                              ? 'Rang 1 VAN — résultat conditionnel'
                              : 'Rang 1 VAN — proposition à approuver'}
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
                        handleExplain('Lifecycle Costing (LCC) Actualisé', 'Actualisation Financière WACC', 'lifecycleCostLCC')
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
          Ventilation graphique de composantes du TCO calculé
        </h3>
        <p className="text-[11px] text-slate-500">Parts rapportées au TCO nominal serveur ; ces segments ne sont pas exhaustifs. Une ligne fiscale absente d'une ancienne exécution reste affichée comme indisponible dans le tableau.</p>
        <div className="space-y-3">
          {results.map((res) => {
            const total = res.totalComprehensiveTCO;
            const share = (value: number) => total > 0 ? Math.max(0, (value / total) * 100) : 0;
            const acqPct = share(res.apparentDirectCost);
            const nrjPct = share(res.energyConsumablesTotal);
            const maintPct = share(res.maintenanceRepairsTotal + res.replacementDefectsTotal);
            const adminPct = share(res.adminComplianceTotal);
            const taxPct = typeof res.taxesTotal === 'number' && Number.isFinite(res.taxesTotal)
              ? share(res.taxesTotal)
              : null;
            const carbPct = share(res.monetizedCarbonTotal);
            const riskPct = share(res.riskExpositionTotal);

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
                    style={{ width: `${adminPct}%` }}
                    className="bg-rose-500 hover:opacity-90 transition-opacity"
                    title={`Administration : ${res.adminComplianceTotal.toLocaleString()} € (${adminPct.toFixed(1)}%)`}
                  />
                  {taxPct !== null && (
                    <div
                      style={{ width: `${taxPct}%` }}
                      className="bg-orange-500 hover:opacity-90 transition-opacity"
                      title={`Fiscalité : ${res.taxesTotal.toLocaleString()} € (${taxPct.toFixed(1)}%)`}
                    />
                  )}
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
            <span className="w-2.5 h-2.5 rounded-sm bg-rose-500" /> Administration
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-orange-500" /> Fiscalité
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
        runId={decisionRun.runId}
        engineVersion={decisionRun.engineVersion}
        methodologyVersion={decisionRun.methodologyVersion}
        rows={modalData.rows}
        methodology={modalData.methodology}
      />
    </div>
  );
};
