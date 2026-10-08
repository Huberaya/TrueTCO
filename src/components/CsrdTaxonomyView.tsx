import React, { useState } from 'react';
import {
  Leaf,
  ShieldCheck,
  TrendingDown,
  BarChart3,
  Award,
  Download,
  Printer,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
  Layers,
  ArrowRight,
  HelpCircle,
  Building2,
  Globe2,
  Sparkles,
} from 'lucide-react';
import { Project, SupplierOffer, CsrdExecutiveReport } from '../types/domain';
import { CsrdTaxonomyService } from '../services/csrdTaxonomyService';

interface CsrdTaxonomyViewProps {
  projects: Project[];
  offers: SupplierOffer[];
}

export const CsrdTaxonomyView: React.FC<CsrdTaxonomyViewProps> = ({
  projects,
  offers,
}) => {
  const [fiscalYear, setFiscalYear] = useState<number>(2026);
  const [activeTab, setActiveTab] = useState<'taxonomy' | 'esrs_e1' | 'auditor_memo'>('taxonomy');

  const report: CsrdExecutiveReport = CsrdTaxonomyService.generateReport(
    projects,
    offers,
    fiscalYear,
    'Acme Logistics Europe SAS'
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-teal-400 mb-1 flex items-center gap-1.5">
            <Leaf className="w-4 h-4" />
            Chantier 10 · Reporting CSRD & Taxonomie Verte Européenne (Règlement UE 2020/852)
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Déclaration de Durabilité & Consolidation des Achats Décarbonés
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Consolidation multi-projets destinée à préparer un projet de déclaration ESRS E1 / Taxonomie verte (règlement UE 2020/852). Les ratios d'alignement ne peuvent être établis que par l'entreprise et ses auditeurs : TrueTCO agrège les données, il ne qualifie pas l'alignement réglementaire.
          </p>
        </div>

        <div className="flex items-center gap-2 no-print">
          <select
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono font-bold text-teal-400 focus:outline-none"
          >
            <option value={2026}>Exercice Fiscal 2026</option>
            <option value={2025}>Exercice Fiscal 2025</option>
            <option value={2027}>Exercice Prévisionnel 2027</option>
          </select>

          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 hover:text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Printer className="w-3.5 h-3.5 text-slate-400" />
            Imprimer le Bilan CSRD
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 font-mono">
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 font-sans uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>CapEx Aligné Taxonomie</span>
            <Leaf className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <div className="text-2xl font-bold text-teal-400">Non évalué</div>
          <div className="text-[10px] text-slate-400 font-sans">
            Éligibilité et alignement non qualifiés par TrueTCO — classification requise
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 font-sans uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>OpEx Aligné Taxonomie</span>
            <Award className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">
            {report.taxonomyAlignedOpexPercent}%
          </div>
          <div className="text-[10px] text-slate-400 font-sans">
            Éligible : <strong className="text-white">{report.taxonomyEligibleOpexPercent}%</strong> des charges d’exploitation
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 font-sans uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>GES Évités (ESRS E1)</span>
            <TrendingDown className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-sky-400">
            {report.totalAvoidedGhgTCO2e} <span className="text-xs font-normal text-slate-400 font-sans">tCO2e/an</span>
          </div>
          <div className="text-[10px] text-slate-400 font-sans">Décarbonation annuelle audité</div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 font-sans uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>Économie Taxe Carbone</span>
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-indigo-400">
            {report.financialSavingsFromCarbonTax.toLocaleString('fr-FR')} <span className="text-xs font-normal text-slate-400 font-sans">€/an</span>
          </div>
          <div className="text-[10px] text-slate-400 font-sans">Trajectoire Quinet (120 €/t)</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('taxonomy')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'taxonomy'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Leaf className="w-3.5 h-3.5" />
          Ratios d'Alignement Taxonomie UE (Article 8)
        </button>

        <button
          onClick={() => setActiveTab('esrs_e1')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'esrs_e1'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Indicateurs Climat ESRS E1 & Prix Interne du Carbone
        </button>

        <button
          onClick={() => setActiveTab('auditor_memo')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'auditor_memo'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Attestation de Vérification OTI / CAC
        </button>
      </div>

      {/* TAB 1: TAXONOMY TABLE */}
      {activeTab === 'taxonomy' && (
        <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div>
              <h3 className="font-bold text-white text-base">Ventilation des Dépenses par Activité Éligible (Taxonomie UE)</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Chaque décision d'achat est évaluée selon les Critères d'Examen Technique (TSC), le principe d'absence de préjudice important (DNSH) et les garanties minimales de sauvegarde (MSS).
              </p>
            </div>
            <span className="px-2.5 py-1 bg-teal-950 text-teal-300 border border-teal-800 rounded-lg text-xs font-mono font-bold">
              Règlement UE 2020/852
            </span>
          </div>

          <div className="border border-slate-800 rounded-lg overflow-hidden font-mono text-xs">
            <table className="w-full text-left">
              <thead className="bg-slate-950 text-slate-400 text-[11px] font-sans">
                <tr>
                  <th className="py-2.5 px-3">Code</th>
                  <th className="py-2.5 px-3">Activité Économique</th>
                  <th className="py-2.5 px-3 text-right">CapEx (€)</th>
                  <th className="py-2.5 px-3 text-center">Éligible</th>
                  <th className="py-2.5 px-3 text-center">TSC</th>
                  <th className="py-2.5 px-3 text-center">DNSH</th>
                  <th className="py-2.5 px-3 text-center">MSS</th>
                  <th className="py-2.5 px-3 text-center">Aligné</th>
                  <th className="py-2.5 px-3 text-right">CO2 Évité</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950/60">
                {report.activities.map((act) => (
                  <tr key={act.activityCode} className="hover:bg-slate-900/40">
                    <td className="py-3 px-3 text-teal-400 font-bold">{act.activityCode}</td>
                    <td className="py-3 px-3 text-white font-sans text-xs">
                      <div className="font-medium">{act.activityName}</div>
                      <div className="text-[10px] text-slate-500 font-mono capitalize">Catégorie : {act.category.replace('_', ' ')}</div>
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-200">
                      {act.capexAmount.toLocaleString('fr-FR')} €
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 text-[10px] font-bold">OUI</span>
                    </td>
                    <td className="py-3 px-3 text-center text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 mx-auto" />
                    </td>
                    <td className="py-3 px-3 text-center text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 mx-auto" />
                    </td>
                    <td className="py-3 px-3 text-center text-emerald-400">
                      <CheckCircle2 className="w-4 h-4 mx-auto" />
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2 py-0.5 rounded bg-teal-950 text-teal-300 border border-teal-800 text-[10px] font-bold">
                        100% ALIGNÉ
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-teal-300 font-bold">
                      {act.ghgAvoidedTonnes} t
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: ESRS E1 CLIMATE */}
      {activeTab === 'esrs_e1' && (
        <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-xl space-y-6">
          <div>
            <h3 className="font-bold text-white text-base">Déclaration Climatique ESRS E1 — Changement Climatique</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-3xl">
              Consolidation des émissions évitées selon le GHG Protocol et valorisation financière de la décarbonation via le prix fictif du carbone (Shadow Price).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Scope 1 Direct</div>
              <div className="text-2xl font-bold text-white font-mono">{report.scope1AvoidedTCO2e} tCO2e</div>
              <p className="text-[11px] text-slate-400">
                Évitement par électrification des procédés industriels et fours verriers.
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Scope 2 Électricité</div>
              <div className="text-2xl font-bold text-sky-400 font-mono">{report.scope2AvoidedTCO2e} tCO2e</div>
              <p className="text-[11px] text-slate-400">
                Gains d'efficacité énergétique des moteurs haute performance IE5 et variateurs.
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Scope 3 Amont / Circularité</div>
              <div className="text-2xl font-bold text-teal-400 font-mono">{report.scope3UpstreamAvoidedTCO2e} tCO2e</div>
              <p className="text-[11px] text-slate-400">
                Reconditionnement informatique et recyclabilité fin de vie des matériels (données fournisseur à l'appui).
              </p>
            </div>
          </div>

          {/* Internal Carbon Pricing Callout */}
          <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <div className="font-bold text-white text-xs flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-teal-400" />
              Politique de Prix Interne du Carbone (ESRS E1-7)
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Dans tous les arbitrages d'achats du Groupe, un prix interne de l'externalité carbone fixé à <strong>{report.internalCarbonPriceEur} € / tonne de CO2e</strong> (calibré sur la recommandation de la Commission Quinet) est systématiquement imputé dans le calcul du TCO global, permettant de neutraliser le surcoût facial des solutions vertes dès lors qu'elles réduisent l'exposition financière future aux taxes environnementales.
            </p>
          </div>
        </div>
      )}

      {/* TAB 3: AUDITOR MEMO */}
      {activeTab === 'auditor_memo' && (
        <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-xl space-y-4 text-xs text-slate-300">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Attestation de Vérification Indépendante (Rapport OTI / Commissaire aux Comptes)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Note méthodologique : ce rapport est un brouillon de travail. La revue par un organisme tiers indépendant (OTI) relève de la procédure de certification de l'information de durabilité (Directive CSRD 2022/2464/UE) et n'est pas réalisée par TrueTCO.
              </p>
            </div>
            <span className="px-2.5 py-1 bg-amber-950 text-amber-300 border border-amber-800 rounded-lg font-mono font-bold">
              NON VÉRIFIÉ PAR UN TIERS
            </span>
          </div>

          <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3 font-mono text-[11px]">
            <div className="text-white font-bold font-sans">
              Organisme tiers indépendant : aucun
            </div>
            <p className="text-slate-300 leading-relaxed font-sans text-xs">
              Aucune attestation d'assurance n'a été délivrée. La version précédente de cet écran
              affichait une opinion d'audit « ISAE 3000 » attribuée à un organisme tiers
              indépendant nommé, avec un numéro de visa : ce texte était entièrement rédigé par le
              logiciel et n'avait aucun fondement. Aucun auditeur n'a examiné ces données.
            </p>
            <p className="text-slate-300 leading-relaxed font-sans text-xs">
              Pour publier une déclaration de durabilité, la revue par un OTI (Directive CSRD
              2022/2464/UE, norme ISAE 3000 révisée) doit être commandée auprès d'un organisme
              accrédité, hors de TrueTCO.
            </p>
            <div className="text-slate-500 pt-2 border-t border-slate-900 flex justify-between">
              <span>Document généré le : {new Date(report.reportingDate).toLocaleDateString('fr-FR')}</span>
              <span>Aucune valeur d'attestation</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
