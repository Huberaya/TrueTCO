import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { DecisionRunResult } from '../services/serverData';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';

interface BreakEvenViewProps {
  decisionRun: DecisionRunResult | null;
  currency: string;
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

/** Le point mort est lu dans l'exécution serveur, jamais recalculé dans le navigateur. */
export const BreakEvenView: React.FC<BreakEvenViewProps> = ({ decisionRun, currency }) => {
  if (!decisionRun) return <ServerCalculationEmptyState title="Aucun point mort calculé par le serveur" />;

  const best = decisionRun.ranking[0];
  const challenger = decisionRun.ranking[1];
  const analysis = decisionRun.breakEven;

  if (!best || !challenger || !analysis) {
    return <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">Le serveur n'a pas produit de point mort calculable : il faut au moins deux offres évaluables. Aucune valeur n'est substituée.</div>;
  }

  const bestCalc = decisionRun.calculationsByOfferId[best.offerId];
  const challengerCalc = decisionRun.calculationsByOfferId[challenger.offerId];

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">Analyse calculée par le serveur</div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Point de bascule entre les deux offres en tête</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">Comparaison du classement enregistré (VAN du coût complet). Le scénario présenté correspond aux hypothèses du dossier lors de l'exécution ; ce n'est pas une simulation personnalisée.</p>
      </header>

      <section className={`flex flex-wrap items-center justify-between gap-5 rounded-xl border p-5 ${analysis.hasBreakEven ? 'border-emerald-800/60 bg-emerald-950/30' : 'border-amber-800/60 bg-amber-950/30'}`}>
        <div className="max-w-3xl space-y-2">
          <div className="flex items-center gap-2">
            {analysis.hasBreakEven ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <AlertCircle className="h-5 w-5 text-amber-400" />}
            <h3 className="text-base font-bold text-white">{analysis.breakEvenDescription}</h3>
          </div>
          <p className="pl-7 text-xs leading-relaxed text-slate-300">
            Option classée première : <strong>{best.supplierName}</strong> · challenger : <strong>{challenger.supplierName}</strong>.
            {analysis.method && <> Méthode renvoyée par le moteur : <span className="font-mono text-slate-200">{analysis.method}</span>.</>}
          </p>
        </div>
        {analysis.hasBreakEven && analysis.breakEvenMonth !== null && (
          <div className="min-w-40 rounded-xl border border-emerald-800/40 bg-slate-950/70 p-4 text-center">
            <div className="mb-0.5 text-[11px] uppercase tracking-wider text-slate-400">Mois de bascule</div>
            <div className="font-mono text-3xl font-extrabold tabular-nums text-emerald-400">{analysis.breakEvenMonth}</div>
            <div className="text-[11px] text-slate-400">mois</div>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Metric label="Écart initial retenu" value={analysis.initialOutlayDelta === undefined ? 'Non disponible' : money(analysis.initialOutlayDelta, currency)} note="Valeur renvoyée par le calcul serveur." />
        <Metric label="Écart de prix facial" value={`${analysis.initialPriceDeltaPercent.toLocaleString('fr-FR')} %`} note="Information descriptive, distincte du point de bascule." />
        <Metric label="Écart actualisé final" value={analysis.finalDiscountedDelta === undefined ? 'Non disponible' : money(analysis.finalDiscountedDelta, currency)} note="Delta de VAN du moteur pour la paire analysée." />
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <header className="border-b border-slate-800 px-4 py-3 text-sm font-bold text-white">Flux annuels issus des calculs serveur</header>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-950/60 text-slate-400"><tr><th className="px-3 py-2 text-left">Année</th><th className="px-3 py-2 text-right">{challenger.supplierName} · flux actualisé</th><th className="px-3 py-2 text-right">{best.supplierName} · flux actualisé</th></tr></thead>
            <tbody className="divide-y divide-slate-800">{(bestCalc?.cashFlowsByYear ?? []).map((flow, index) => {
              const otherFlow = challengerCalc?.cashFlowsByYear[index];
              return <tr key={flow.year}><td className="px-3 py-2 text-slate-300">Année {flow.year}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{otherFlow ? money(otherFlow.discountedCost, currency) : '—'}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{money(flow.discountedCost, currency)}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-[11px] text-slate-400"><Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" /><span>Les anciens curseurs modifiaient les données dans le navigateur (notamment volume et économies de maintenance) sans trace serveur. Ils sont retirés de cet écran plutôt que présentés comme une simulation vérifiable. Les explorations interactives seront réintroduites via une API de simulation versionnée et traçable.</span></div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string; note: string }> = ({ label, value, note }) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="text-[11px] text-slate-400">{label}</div><div className="mt-1 font-mono text-lg font-bold text-white">{value}</div><div className="mt-1 text-[10px] text-slate-500">{note}</div></div>;
