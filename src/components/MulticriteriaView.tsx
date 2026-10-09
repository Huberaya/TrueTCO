import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Scale } from 'lucide-react';
import { DecisionRunResult } from '../services/serverData';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';

interface MulticriteriaViewProps {
  decisionRun: DecisionRunResult | null;
  currency: string;
}

const money = (value: number, currency: string) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

/**
 * Comparaison des critères issus du serveur. Aucun score ESG, score de fiabilité,
 * poids ou défaut fournisseur n'est inventé dans le navigateur.
 */
export const MulticriteriaView: React.FC<MulticriteriaViewProps> = ({ decisionRun, currency }) => {
  if (!decisionRun) return <ServerCalculationEmptyState title="Aucun classement serveur à comparer" />;

  const status = decisionRun.recommendation.status;
  const recommendationClass = status === 'ferme' ? 'border-emerald-800 bg-emerald-950/40 text-emerald-200' : status === 'conditionnel' ? 'border-amber-800 bg-amber-950/40 text-amber-200' : 'border-rose-800 bg-rose-950/40 text-rose-200';
  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400"><Scale className="h-4 w-4" /> Comparaison des critères effectivement calculés</div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Arbitrage économique, carbone et risques</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">Classement sur la VAN du coût complet, produit par le serveur. Les autres colonnes sont des mesures brutes et ne sont pas transformées en scores synthétiques sans données et pondérations approuvées.</p>
      </header>

      <section className={`rounded-xl border p-4 ${recommendationClass}`}>
        <div className="flex items-start gap-3"><div className="mt-0.5">{status === 'ferme' ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}</div><div><div className="text-sm font-bold">{status === 'ferme' ? 'Recommandation proposée — à approuver' : status === 'conditionnel' ? 'Résultat conditionnel — validation requise' : 'Aucune recommandation ferme'}</div><p className="mt-1 text-xs leading-relaxed">{decisionRun.recommendation.reason}</p></div></div>
      </section>

      <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-900 text-slate-400"><tr><th className="px-4 py-3">Rang VAN</th><th className="px-4 py-3">Offre / fournisseur</th><th className="px-4 py-3 text-right">TCO nominal</th><th className="px-4 py-3 text-right">VAN LCC</th><th className="px-4 py-3 text-right">Émissions</th><th className="px-4 py-3 text-right">Exposition risque</th><th className="px-4 py-3 text-right">Qualité des données</th></tr></thead>
          <tbody className="divide-y divide-slate-800">{decisionRun.ranking.map((entry, index) => <tr key={entry.offerId} className={index === 0 ? 'bg-emerald-950/20' : ''}><td className="px-4 py-3 font-mono text-slate-300">{index + 1}</td><td className="px-4 py-3"><div className="font-semibold text-white">{entry.supplierName}</div><div className="font-mono text-[10px] text-slate-400">{entry.offerReference}{entry.isResponsibleCandidate ? ' · candidat responsable (saisi)' : ''}</div></td><td className="px-4 py-3 text-right font-mono text-slate-300">{money(entry.totalComprehensiveTCO, currency)}</td><td className="px-4 py-3 text-right font-mono font-semibold text-white">{money(entry.lifecycleCostLCC, currency)}</td><td className="px-4 py-3 text-right font-mono text-sky-300">{entry.carbonTonnes.toLocaleString('fr-FR')} tCO2e</td><td className="px-4 py-3 text-right font-mono text-amber-300">{money(entry.riskExposure, currency)}</td><td className="px-4 py-3 text-right font-mono text-slate-300">{entry.dataQualityScore}/100</td></tr>)}</tbody>
        </table>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-900 p-3 text-[11px] text-slate-400"><Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" /><span>Le système ne calcule pas ici de score RSE ou de « score 360° » : les données nécessaires (ex. indicateurs ESG validés par fournisseur) et une méthode de pondération gouvernée ne sont pas disponibles dans l'API décisionnelle. Les anciennes notes par défaut et poids locaux ont été retirés pour éviter une recommandation fabriquée.</span></div>
    </div>
  );
};
