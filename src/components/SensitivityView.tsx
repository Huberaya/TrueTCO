import React from 'react';
import { AlertCircle, Info } from 'lucide-react';
import { DecisionRunResult } from '../services/serverData';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';

interface SensitivityViewProps {
  decisionRun: DecisionRunResult | null;
  currency: string;
}

const money = (value: number, currency: string) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

/** Sensibilité issue de la même exécution serveur que le classement. */
export const SensitivityView: React.FC<SensitivityViewProps> = ({ decisionRun, currency }) => {
  if (!decisionRun) return <ServerCalculationEmptyState title="Aucune sensibilité calculée par le serveur" />;
  if (decisionRun.sensitivity.length === 0) {
    return <div className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300"><AlertCircle className="mt-0.5 h-5 w-5 text-amber-400" /><div><h3 className="font-bold text-white">Sensibilité indisponible</h3><p className="mt-1 text-xs text-slate-400">Le serveur n'a pas renvoyé de facteurs de sensibilité (par exemple, faute de deux offres évaluables). Aucun tableau de remplacement n'est généré.</p></div></div>;
  }
  const maxSpread = Math.max(...decisionRun.sensitivity.map((driver) => Math.max(Math.abs(driver.lowValueImpactOnDeltaTCO), Math.abs(driver.highValueImpactOnDeltaTCO))), 1);

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">Analyse de sensibilité — moteur {decisionRun.engineVersion}</div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Dans quelles hypothèses le classement bouge-t-il ?</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">Les impacts sont calculés côté serveur sur les hypothèses explorées. Ils sont exprimés en euros selon la convention signée par le moteur ; ils ne constituent pas à eux seuls une prévision ni une recommandation.</p>
      </header>

      <section className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-white">Impact des hypothèses sur le différentiel de VAN</div>
          <div className="flex items-center gap-4 text-xs"><span className="flex items-center gap-1 text-sky-400"><span className="h-3 w-3 rounded-sm bg-sky-500" /> Borne basse</span><span className="flex items-center gap-1 text-rose-400"><span className="h-3 w-3 rounded-sm bg-rose-500" /> Borne haute</span></div>
        </div>
        {decisionRun.sensitivity.map((driver, index) => {
          const leftWidth = Math.min(50, Math.abs(driver.lowValueImpactOnDeltaTCO) / maxSpread * 45);
          const rightWidth = Math.min(50, Math.abs(driver.highValueImpactOnDeltaTCO) / maxSpread * 45);
          const rankClass = driver.sensitivityRank === 'critique' ? 'border-rose-800 bg-rose-950/60 text-rose-300' : driver.sensitivityRank === 'fort' ? 'border-amber-800 bg-amber-950/60 text-amber-300' : 'border-slate-700 bg-slate-800 text-slate-300';
          return <div key={driver.parameterName} className="space-y-1.5"><div className="flex flex-wrap items-center justify-between gap-2 text-xs"><div className="flex items-center gap-2"><span className="font-mono font-bold text-slate-500">{String(index + 1).padStart(2, '0')}.</span><strong className="text-sm text-white">{driver.parameterName}</strong><span className={`rounded border px-2 py-0.5 text-[10px] uppercase ${rankClass}`}>Impact {driver.sensitivityRank}</span></div><div className="font-mono text-slate-400">Pivot : <strong className="text-white">{driver.baseValue.toLocaleString('fr-FR')} {driver.unit}</strong></div></div>
            <div className="relative flex h-8 items-center rounded-lg border border-slate-800 bg-slate-950 px-2"><div className="absolute bottom-0 left-1/2 top-0 z-10 w-px bg-slate-700" /><div className="flex w-1/2 justify-end pr-0.5"><div title={`Borne basse : ${money(driver.lowValueImpactOnDeltaTCO, currency)}`} style={{ width: `${Math.max(leftWidth, 2)}%` }} className="flex h-4 items-center justify-start rounded-l bg-sky-600 pl-1 text-[9px] font-mono font-semibold text-white">{money(driver.lowValueImpactOnDeltaTCO, currency)}</div></div><div className="flex w-1/2 justify-start pl-0.5"><div title={`Borne haute : ${money(driver.highValueImpactOnDeltaTCO, currency)}`} style={{ width: `${Math.max(rightWidth, 2)}%` }} className="flex h-4 items-center justify-end rounded-r bg-rose-600 pr-1 text-[9px] font-mono font-semibold text-white">{money(driver.highValueImpactOnDeltaTCO, currency)}</div></div></div>
            <p className="text-[11px] leading-relaxed text-slate-400">{driver.explanation}</p>
          </div>;
        })}
      </section>
      <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-400"><Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" /><span>Les barres visualisent les sorties reçues ; leur longueur est une mise à l'échelle graphique. Aucun pourcentage de variance ni conseil d'achat n'est déduit dans le navigateur.</span></div>
    </div>
  );
};
