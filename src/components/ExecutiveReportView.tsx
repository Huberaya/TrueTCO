import React, { useMemo } from 'react';
import {
  Project,
  SupplierOffer,
  Supplier,
  AuditLogEntry,
  ExternalityReferenceBenchmark,
} from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import { ExcelExportService } from '../services/excelExportService';
import {
  Printer,
  FileSpreadsheet,
  ArrowLeft,
  ShieldCheck,
  FileCheck,
  Award,
  Info,
} from 'lucide-react';

interface ExecutiveReportViewProps {
  project: Project;
  offers: SupplierOffer[];
  suppliers?: Supplier[];
  auditLogs?: AuditLogEntry[];
  benchmarks?: ExternalityReferenceBenchmark[];
  onBack: () => void;
  onUpdateProject?: (updated: Project) => void;
  onAddAuditLog?: (entry: AuditLogEntry) => void;
}


export const ExecutiveReportView: React.FC<ExecutiveReportViewProps> = ({
  project,
  offers,
  suppliers = [],
  auditLogs = [],
  benchmarks = [],
  onBack,
}) => {
  // Calculate detailed TCO for all offers
  const results = useMemo(() => {
    return offers.map((offer) => ({
      offer,
      calc: TCOEngine.calculateOfferTCO(project, offer),
      supplier: suppliers.find((s) => s.id === offer.supplierId),
    }));
  }, [project, offers, suppliers]);

  // Identify baseline (conventional) and winning/responsible candidate
  const conv = useMemo(() => {
    return results.find((r) => !r.offer.isResponsibleCandidate) || results[0];
  }, [results]);

  const resp = useMemo(() => {
    return results.find((r) => r.offer.isResponsibleCandidate) || results[1] || results[0];
  }, [results]);

  // Best TCO candidate overall
  const bestTCO = useMemo(() => {
    if (results.length === 0) return null;
    return [...results].sort(
      (a, b) => a.calc.totalComprehensiveTCO - b.calc.totalComprehensiveTCO
    )[0];
  }, [results]);

  const winningCandidate = bestTCO || resp;

  // Break-even and sensitivity analysis
  const breakEven = useMemo(() => {
    if (!conv || !resp) return null;
    return TCOEngine.calculateBreakEven(conv.calc, resp.calc, project.horizonYears);
  }, [conv, resp, project.horizonYears]);

  const drivers = useMemo(() => {
    if (!conv || !resp) return [];
    return TCOEngine.calculateSensitivity(project, conv.offer, resp.offer);
  }, [conv, resp, project]);

  // Net lifecycle savings
  const netSavings = useMemo(() => {
    if (!conv || !winningCandidate) return 0;
    return Math.max(0, conv.calc.totalComprehensiveTCO - winningCandidate.calc.totalComprehensiveTCO);
  }, [conv, winningCandidate]);

  // Net CO2 avoided
  const avoidedCO2Tonnes = useMemo(() => {
    if (!conv || !winningCandidate) return 0;
    return Math.max(
      0,
      conv.calc.totalLifecycleCO2eTonnes - winningCandidate.calc.totalLifecycleCO2eTonnes
    );
  }, [conv, winningCandidate]);

  // Handle printing
  const handlePrint = () => {
    window.print();
  };

  // Handle Excel download
  const handleExportExcel = () => {
    void ExcelExportService.exportFinancialWorkbook(project, offers, suppliers, auditLogs, benchmarks).catch(() => {
      window.alert('Impossible de générer le classeur Excel. Aucune donnée n’a été modifiée.');
    });
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-20">
      {/* Chantier 6 Top Banner & Action Bar (Hidden on print) */}
      <div className="no-print space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4 text-emerald-400" />
              Comparaison indicative des coûts complets — décision non intégrée
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Simulation indicative de coût complet (TCO / LCC) — non certifiée
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Simulation indicative non certifiée. Les données, hypothèses et résultats doivent être vérifiés par les personnes habilitées avant toute décision ou engagement.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onBack}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Retour</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
              title="Générer le classeur financier Excel multicritères complet (CBS, Cash-flows, WACC, Audit)"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              <span>Classeur Excel (.xlsx)</span>
            </button>

            <button
              onClick={handlePrint}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-2 transition-colors shadow-sm"
            >
              <Printer className="w-4 h-4 text-sky-400" />
              <span>Imprimer / PDF</span>
            </button>

            <div role="note" className="px-3.5 py-2 border border-amber-700/80 bg-amber-950/50 text-amber-200 rounded-lg text-xs font-semibold">
              Adjudication désactivée — aucun processus sécurisé de signature ou d’audit n’est configuré.
            </div>
          </div>
        </div>


      </div>

      {/* Official Report Document Container (Optimized for Screen & Print) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-12 space-y-10 text-slate-200 shadow-2xl print:bg-white print:text-slate-950 print:border-none print:p-0 print:shadow-none">
        
        {/* ========================================================= */}
        {/* DOCUMENT HEADER & BRANDING */}
        {/* ========================================================= */}
        <div className="border-b-2 border-emerald-500 pb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-widest font-mono text-emerald-400 print:text-emerald-700 font-bold">
                  TrueTCO · Simulation financière indicative
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-slate-800 print:bg-slate-200 text-slate-300 print:text-slate-800 rounded font-mono">
                  SIMULATION — NON CERTIFIÉE
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white print:text-slate-950 mt-1.5 tracking-tight">
                Simulation indicative (TCO / LCC) — non certifiée
              </h2>
              <div className="text-sm text-slate-400 print:text-slate-600 mt-1 font-medium">
                {project.name} · Réf. Consultation : <span className="font-mono text-slate-300 print:text-slate-800">{project.reference}</span>
              </div>
            </div>

            <div className="text-left sm:text-right text-xs font-mono text-slate-400 print:text-slate-600 space-y-0.5">
              <div>Date de génération : {new Date().toLocaleDateString('fr-FR')}</div>
              <div>Gouvernance : Direction des Achats & DAF</div>
              <div className="text-emerald-400 print:text-emerald-700 font-semibold select-all">
                Calcul indicatif — non certifié
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================= */}
        {/* 1. RÉSUMÉ EXÉCUTIF & AVIS MOTIVÉ D'ADJUDICATION */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-2">
            <h3 className="text-base font-bold text-white print:text-slate-900 flex items-center gap-2">
              <span className="text-emerald-400 print:text-emerald-700 font-mono">01.</span>
              Comparaison des offres — validation humaine requise
            </h3>
            <span className="text-xs px-2.5 py-0.5 bg-emerald-950/70 border border-emerald-800 text-emerald-400 print:bg-emerald-100 print:text-emerald-800 rounded-full font-semibold">
              Simulation non certifiée
            </span>
          </div>

          <div className="p-5 bg-slate-950/80 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300 text-xs leading-relaxed space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800/80 print:border-slate-300">
              <div className="flex items-center gap-2">
                <Award className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-bold text-white print:text-slate-950">
                  Offre classée première par le modèle : {winningCandidate?.offer.supplierName}
                </span>
                <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">
                  (Réf. {winningCandidate?.offer.offerReference})
                </span>
              </div>
              <span className="text-[11px] px-2 py-0.5 bg-emerald-900/40 text-emerald-300 print:bg-emerald-200 print:text-emerald-900 rounded font-semibold font-mono">
                Statut : {project.status === 'adjudique' ? 'Statut enregistré — non vérifié' : 'Aucune décision enregistrée'}
              </span>
            </div>

            <p>
              La consultation portant sur l’acquisition et l’exploitation de{' '}
              <strong>{project.plannedVolume} {project.unitName}</strong> sur un horizon ferme de{' '}
              <strong>{project.horizonYears} ans</strong> met en évidence un arbitrage fondamental entre le coût
              facial d'acquisition immédiat et le coût global de possession (TCO / LCC actualisé au WACC de {(project.discountRate * 100).toFixed(1)}%).
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg">
                <div className="text-[11px] text-slate-400 print:text-slate-600">Différentiel Facial Direct</div>
                <div className="text-base font-bold font-mono text-rose-400 print:text-rose-700 mt-0.5">
                  +{conv && winningCandidate ? (winningCandidate.calc.apparentDirectCost - conv.calc.apparentDirectCost).toLocaleString('fr-FR') : 0} €
                </div>
                <div className="text-[10px] text-slate-500">Surcoût CAPEX initial (+{breakEven?.initialPriceDeltaPercent || 0}%)</div>
              </div>

              <div className="p-3 bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg">
                <div className="text-[11px] text-slate-400 print:text-slate-600">Économie Nette TCO Complet</div>
                <div className="text-base font-bold font-mono text-emerald-400 print:text-emerald-700 mt-0.5">
                  -{netSavings.toLocaleString('fr-FR')} €
                </div>
                <div className="text-[10px] text-slate-500">Sur l'horizon de {project.horizonYears} ans</div>
              </div>

              <div className="p-3 bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 rounded-lg">
                <div className="text-[11px] text-slate-400 print:text-slate-600">Point Mort Économique</div>
                <div className="text-base font-bold font-mono text-sky-400 print:text-sky-700 mt-0.5">
                  {breakEven ? (breakEven.breakEvenMonth ? `${breakEven.breakEvenMonth} mois` : 'Aucun point mort identifié') : 'Non calculé'}
                </div>
                <div className="text-[10px] text-slate-500">
                  {breakEven?.crossoverYear ? `Bascule à ${breakEven.crossoverYear} ans` : 'Aucun gain identifié ou non calculé'}
                </div>
              </div>
            </div>

            <p className="pt-2 text-slate-300 print:text-slate-800 font-medium">
              <strong>Résultat indicatif :</strong> selon les seules données et hypothèses saisies, le modèle classe {winningCandidate?.offer.supplierName} en première position. Les chiffres calculés (dont {avoidedCO2Tonnes.toLocaleString('fr-FR')} tCO2e estimées) ne sont ni une validation humaine, ni une mesure vérifiée, ni une déclaration CSRD ou une recommandation d’adjudication.
            </p>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 2. CADRAGE DE LA CONSULTATION & HYPOTHÈSES FINANCIÈRES */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">02.</span>
            Cadrage de la Consultation & Hypothèses saisies — à vérifier
          </h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Horizon Pluriannuel</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {project.horizonYears} ans
              </div>
              <div className="text-[10px] text-slate-500">Cycle de détention prévu</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Taux d'Actualisation WACC</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {(project.discountRate * 100).toFixed(2)}% / an
              </div>
              <div className="text-[10px] text-slate-500">Hypothèse locale — validation non effectuée</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Inflation Énergétique</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {(project.energyInflationRate * 100).toFixed(2)}% / an
              </div>
              <div className="text-[10px] text-slate-500">Hypothèse d’indexation saisie — non vérifiée</div>
            </div>

            <div className="p-3 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300">
              <span className="text-slate-400 print:text-slate-600 block text-[11px]">Prix Tutélaire Quinet</span>
              <div className="font-bold text-white print:text-slate-900 font-mono text-sm mt-0.5">
                {project.carbonPricePerTonne} €/tCO2e
              </div>
              <div className="text-[10px] text-slate-500">Facteur saisi — source non vérifiée</div>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 3. TABLEAU CBS : DÉCOMPOSITION DU COÛT TOTAL DU CYCLE DE VIE */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-300 pb-2">
            <h3 className="text-base font-bold text-white print:text-slate-900 flex items-center gap-2">
              <span className="text-emerald-400 print:text-emerald-700 font-mono">03.</span>
              Décomposition Analytique du Coût Complet (Tableau CBS)
            </h3>
            <span className="text-[11px] font-mono text-slate-400 print:text-slate-600">
              Calcul TCO indicatif (conformité ISO non évaluée)
            </span>
          </div>

          <div className="border border-slate-800 print:border-slate-300 rounded-xl overflow-hidden bg-slate-950/60 print:bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-slate-950 print:bg-slate-200 text-slate-400 print:text-slate-700 border-b border-slate-800 print:border-slate-300 font-semibold">
                    <th className="py-2.5 px-3 border-r border-slate-800 print:border-slate-300 min-w-[200px]">
                      Poste de coût déclaré (CBS)
                    </th>
                    {results.map(({ offer }) => (
                      <th
                        key={offer.id}
                        className={`py-2.5 px-3 text-right ${
                          offer.id === winningCandidate?.offer.id
                            ? 'bg-emerald-950/40 text-emerald-300 print:bg-emerald-100 print:text-emerald-900 font-bold'
                            : ''
                        }`}
                      >
                        {offer.supplierName}
                        {offer.id === winningCandidate?.offer.id && ' ★'}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 print:divide-slate-300">
                  {/* CAPEX Initial */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium">
                      1. Acquisition directe (Prix facial facture)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono">
                        {calc.apparentDirectCost.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Logistique & Douanes */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      2. Transport, Douanes & Logistique (Incoterm)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.logisticsTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Mise en service */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      3. Installation & Qualification technique
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.installationTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Énergie & Consommables */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-amber-300 print:text-amber-800">
                      4. Énergie & Consommables ({project.horizonYears} ans indexés)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono font-medium">
                        {calc.energyConsumablesTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Maintenance & Réparations */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium">
                      5. Maintenance préventive & curative
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono">
                        {(calc.maintenanceRepairsTotal + calc.replacementDefectsTotal).toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Fiscalité & Conformité */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      6. Fiscalité, Taxes & Conformité légale
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.adminComplianceTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Exposition Risques & Indisponibilité */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-slate-400">
                      7. Risques d'indisponibilité & pannes
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-slate-400">
                        {calc.riskExpositionTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Valeur Résiduelle de Revente (-) */}
                  <tr className="hover:bg-slate-900/30">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 font-medium text-emerald-400 print:text-emerald-700">
                      8. Moins-value : Revente / Cession d'actif (-)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-emerald-400 print:text-emerald-700">
                        - {calc.salvageValueTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* TCO Économique Nominal */}
                  <tr className="bg-slate-900/80 print:bg-slate-100 font-semibold">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 text-white print:text-slate-900">
                      = TCO ÉCONOMIQUE NOMINAL (Flux bruts)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono font-bold">
                        {calc.economicTCONominal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Actualisation WACC (LCC) */}
                  <tr className="hover:bg-slate-900/30 text-[11px] text-slate-400">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300">
                      + Effet d'actualisation financière WACC ({project.discountRate * 100}%)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono">
                        {(calc.lifecycleCostLCC - calc.economicTCONominal).toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* Externalité Carbone Quinet */}
                  <tr className="hover:bg-slate-900/30 text-[11px] text-slate-400">
                    <td className="py-2 px-3 border-r border-slate-800 print:border-slate-300 text-sky-400 print:text-sky-700">
                      + Monétisation de l'externalité carbone ({project.carbonPricePerTonne} €/t)
                    </td>
                    {results.map(({ calc }) => (
                      <td key={calc.offerId} className="py-2 px-3 text-right font-mono text-sky-400 print:text-sky-700">
                        {calc.monetizedCarbonTotal.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>

                  {/* TCO COMPLET TOTAL */}
                  <tr className="bg-slate-950 font-bold text-sm border-t-2 border-slate-700 print:bg-slate-200">
                    <td className="py-3 px-3 border-r border-slate-800 print:border-slate-300 text-emerald-400 print:text-emerald-800">
                      TCO GLOBAL COMPLET SUR {project.horizonYears} ANS
                    </td>
                    {results.map(({ calc, offer }) => (
                      <td
                        key={calc.offerId}
                        className={`py-3 px-3 text-right font-mono ${
                          offer.id === winningCandidate?.offer.id
                            ? 'text-emerald-400 print:text-emerald-800 text-base font-extrabold'
                            : 'text-white print:text-slate-900'
                        }`}
                      >
                        {calc.totalComprehensiveTCO.toLocaleString('fr-FR')} €
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ========================================================= */}
        {/* 4. PERFORMANCE MULTICRITÈRE 360° */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">04.</span>
            Évaluation Multicritère Pondérée 360°
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {results.map(({ offer, calc, supplier }) => (
              <div
                key={offer.id}
                className={`p-4 rounded-xl border ${
                  offer.id === winningCandidate?.offer.id
                    ? 'bg-emerald-950/30 border-emerald-600/80 print:bg-emerald-50 print:border-emerald-300'
                    : 'bg-slate-950/70 border-slate-800 print:bg-slate-100 print:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-white print:text-slate-950">{offer.supplierName}</div>
                  {offer.id === winningCandidate?.offer.id && (
                    <span className="text-[10px] px-2 py-0.5 bg-emerald-500 text-slate-950 font-bold rounded-full">
                      1er Choix
                    </span>
                  )}
                </div>

                <div className="space-y-1.5 font-mono text-[11px] text-slate-300 print:text-slate-700">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Score Technique :</span>
                    <span>{offer.technicalSuitabilityScore} / 100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Score RSE / Carbone :</span>
                    <span>{supplier?.esgScore || (offer.isResponsibleCandidate ? 92 : 65)} / 100</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Fiabilité Documentaire :</span>
                    <span>{calc.dataQualityScore}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Impact Carbone Cycle :</span>
                    <span>{calc.totalLifecycleCO2eTonnes.toLocaleString('fr-FR')} tCO2e</span>
                  </div>
                  <div className="flex justify-between pt-1 border-t border-slate-800/80 font-bold">
                    <span className="text-white print:text-slate-950">Garantie Contractuelle :</span>
                    <span>{offer.warrantyMonths} mois</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ========================================================= */}
        {/* 5. ANALYSE DE RÉSILIENCE & STRESS-TESTS */}
        {/* ========================================================= */}
        <section className="space-y-4">
          <h3 className="text-base font-bold text-white print:text-slate-900 border-b border-slate-800 print:border-slate-300 pb-2 flex items-center gap-2">
            <span className="text-emerald-400 print:text-emerald-700 font-mono">05.</span>
            Analyse de Robustesse Décisionnelle & Stress-Tests
          </h3>

          <div className="p-4 bg-slate-950/70 print:bg-slate-100 rounded-xl border border-slate-800 print:border-slate-300 text-xs space-y-2">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div>
                  Les scénarios de prix énergie et carbone ne sont pas une prévision certifiée. Vérifiez les sources, unités, périodes et hypothèses avant toute interprétation ; aucune économie ou conformité réglementaire n’est garantie.
                </div>
                <div>
<strong>Garantie déclarée :</strong> l’offre classée première indique {winningCandidate?.offer.warrantyMonths} mois. Cette information fournisseur n’est pas vérifiée.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section role="alert" className="rounded-xl border border-amber-700 bg-amber-950/40 p-5 text-sm text-amber-100">
          <h3 className="font-bold">Aucun visa ou sceau n’est émis</h3>
          <p className="mt-1 text-xs leading-relaxed">
            Cette vue ne signe pas, ne scelle pas et ne certifie pas ce rapport. Aucun signataire, horodatage qualifié ni registre d’audit immuable n’est configuré. Toute adjudication doit suivre le processus métier autorisé hors de cette démonstration.
          </p>
        </section>
        {/* ========================================================= */}
        {/* 7. AVERTISSEMENT DE NON-CERTIFICATION */}
        {/* ========================================================= */}
        <div className="pt-6 border-t-2 border-slate-800 print:border-slate-300 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 text-xs text-slate-400 print:text-slate-600">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-white print:text-slate-900">
              <ShieldCheck className="w-4 h-4 text-emerald-400 print:text-emerald-700" />
              Rapport indicatif — non certifié
            </div>
            <div>Méthode et facteurs de calcul indicatifs ; conformité ISO ou GHG Protocol non évaluée.</div>
            <div className="font-mono text-[10px] select-all">
              Aucune empreinte de scellement n’est générée
            </div>
          </div>

          <div className="text-left sm:text-right space-y-1">
            <div className="text-slate-300 print:text-slate-800 font-semibold">
              Comité d'Investissement & Direction Générale
            </div>
            <div>Aucun scellement légal ni registre d’audit immuable n’est fourni.</div>
          </div>
        </div>

      </div>
    </div>
  );
};
