import React from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { DecisionRunResult } from '../services/serverData';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';

interface ScenarioViewProps {
  decisionRun: DecisionRunResult | null;
  currency: string;
}

const percent = (value: number) => `${(value * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
const money = (value: number, currency: string) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

/** Scénarios du moteur renvoyés dans l'exécution serveur persistée. */
export const ScenarioView: React.FC<ScenarioViewProps> = ({ decisionRun, currency }) => {
  if (!decisionRun) return <ServerCalculationEmptyState title="Aucun scénario calculé par le serveur" />;
  if (!decisionRun.scenarios.length) return <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-300">Aucun résultat de scénario n'est présent dans cette exécution.</div>;

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">Sorties de l'exécution {decisionRun.runId.slice(0, 8)}</div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Scénarios exploratoires</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-400">Les valeurs ci-dessous sont recalculées côté serveur à partir des offres et des hypothèses enregistrées. Les multiplicateurs du moteur sont des hypothèses de stress internes, sans source externe : ce ne sont ni des prévisions macroéconomiques ni des scénarios officiels.</p>
      </header>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {decisionRun.scenarios.map((scenario, index) => {
          const entries = decisionRun.ranking.map((ranked) => ({
            ranked,
            scenarioResult: scenario.resultsByOfferId[ranked.offerId],
          })).filter((entry) => entry.scenarioResult);
          const best = entries.find((entry) => entry.scenarioResult.isBestChoiceByNpv) ?? entries.find((entry) => entry.scenarioResult.isBestChoice);
          return (
            <article key={`${scenario.scenarioName}-${index}`} className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <header className="mb-4 flex items-start justify-between gap-3">
                <div><div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Scénario {scenario.scenarioName}</div><h3 className="mt-1 text-lg font-bold text-white">Hypothèses de stress du moteur</h3></div>
                {best && <span className="flex items-center gap-1 text-[10px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Classement VAN #1</span>}
              </header>
              <dl className="mb-4 space-y-2 rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs">
                <Metric label="Inflation générale" value={percent(scenario.parameters.inflationRate)} />
                <Metric label="Inflation énergétique" value={percent(scenario.parameters.energyInflationRate)} />
                <Metric label="Taux d'actualisation" value={percent(scenario.parameters.discountRate)} />
                <Metric label="Prix carbone retenu — source à vérifier" value={`${scenario.parameters.carbonPricePerTonne.toLocaleString('fr-FR')} €/t`} />
                <Metric label="Multiplicateur de risque de panne" value={`${scenario.parameters.failureRateMultiplier.toLocaleString('fr-FR')}×`} />
              </dl>
              <div className="space-y-2">
                {entries.map(({ ranked, scenarioResult }) => (
                  <div key={ranked.offerId} className={`flex items-center justify-between gap-3 rounded-lg border p-2.5 text-xs ${scenarioResult.isBestChoiceByNpv ? 'border-emerald-700/60 bg-emerald-950/30' : 'border-slate-800 bg-slate-950/60'}`}>
                    <div><div className="font-semibold text-white">{ranked.supplierName}</div><div className="text-[10px] text-slate-400">{scenarioResult.deltaVsCheapestNpv === 0 ? 'VAN la plus faible dans ce scénario' : `Écart VAN : ${money(scenarioResult.deltaVsCheapestNpv ?? 0, currency)}`}</div></div>
                    <div className="text-right font-mono"><div className="font-bold text-white">{money(scenarioResult.nominalTCO, currency)}</div><div className="text-[10px] text-slate-400">VAN {money(scenarioResult.discountedLCC, currency)}</div></div>
                  </div>
                ))}
              </div>
              {best && <div className="mt-4 border-t border-slate-800 pt-3 text-[11px] text-slate-300">Classement VAN de ce scénario : <strong className="text-white">{best.ranked.supplierName}</strong>. Ce classement n'est pas une approbation de décision.</div>}
            </article>
          );
        })}
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 text-[11px] text-amber-100/80"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /><span>Les amplitudes ne sont pas sourcées et ne représentent pas une distribution probabiliste. Pour une analyse Monte-Carlo, consultez la simulation de risque séparée (quantiles de simulation, pas intervalle de confiance).</span></div>
    </div>
  );
};

const Metric: React.FC<{label: string; value: string}> = ({ label, value }) => <div className="flex justify-between gap-3"><dt className="text-slate-400">{label}</dt><dd className="text-right font-mono text-white">{value}</dd></div>;
