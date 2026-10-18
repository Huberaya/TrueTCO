import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Project, SupplierOffer } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';

interface ScenarioViewProps {
  project: Project;
  offers: SupplierOffer[];
}

const eur = (x: number) => `${Math.round(x).toLocaleString('fr-FR')} €`;

export const ScenarioView: React.FC<ScenarioViewProps> = ({ project, offers }) => {
  const scenarios = useMemo(() => TCOEngine.calculateScenarios(project, offers), [project, offers]);
  const nameOf = (id: string) => offers.find((o) => o.id === id)?.supplierName ?? '—';

  // Synthèse DÉRIVÉE des résultats : le classement est-il stable d'un scénario à l'autre ?
  const winners = scenarios.map((s) => s.bestOfferId);
  const stable = offers.length > 1 && new Set(winners).size === 1;
  const counts = winners.reduce<Record<string, number>>((m, w) => ({ ...m, [w]: (m[w] ?? 0) + 1 }), {});

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-2xl font-bold text-white tracking-tight">Scénarios</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Trois jeux d'hypothèses de contexte (inflation, énergie, prix du carbone, coût des pannes) appliqués à toutes les offres.
          Critère de classement : le <strong>coût complet actualisé</strong> (direct + risques + carbone).
        </p>
      </div>

      <div className="flex gap-2 text-[11px] text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-3">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-400" />
        <p>
          Le scénario central reprend les valeurs de votre projet. Les chocs « pessimiste » et « optimiste » sont des <strong>conventions par défaut du modèle, non sourcées</strong> :
          à confronter à vos propres hypothèses. Le taux d'actualisation n'est volontairement pas modifié (il relève du financement, pas du contexte) :
          testez-le dans l'analyse de sensibilité.
        </p>
      </div>

      {offers.length > 1 && (
        <div className={`p-4 rounded-xl border text-sm ${stable ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200' : 'bg-amber-950/30 border-amber-800/60 text-amber-200'}`} role="status">
          {stable ? (
            <span className="flex gap-2"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>{nameOf(winners[0])}</strong> a le coût complet actualisé le plus bas dans les 3 scénarios : le classement est stable face à ces chocs.</span></span>
          ) : (
            <span className="flex gap-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Le classement <strong>change selon le scénario</strong> : {Object.entries(counts).map(([id, n]) => `${nameOf(id)} (${n}/3)`).join(', ')}. La décision dépend des hypothèses de contexte.</span></span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {scenarios.map((sc) => {
          const ranked = offers.map((o) => ({ o, r: sc.resultsByOfferId[o.id] })).filter((x) => x.r).sort((a, b) => a.r.discountedLCC - b.r.discountedLCC);
          const tone = sc.scenarioName === 'Pessimiste' ? 'border-rose-900/50' : sc.scenarioName === 'Optimiste' ? 'border-emerald-900/50' : 'border-slate-700/80';
          return (
            <div key={sc.scenarioName} className={`p-5 rounded-xl border bg-slate-900/90 flex flex-col gap-4 ${tone}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Scénario {sc.scenarioName}</h3>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${sc.parametersSource === 'project' ? 'text-emerald-300 border-emerald-800' : 'text-amber-300 border-amber-800'}`}
                  title={sc.parametersSource === 'project' ? 'Valeurs saisies dans le projet' : 'Convention par défaut du modèle, non sourcée'}>
                  {sc.parametersSource === 'project' ? 'valeurs du projet' : 'par défaut, non sourcé'}
                </span>
              </div>

              <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg space-y-1.5 text-xs font-mono text-slate-300">
                <div className="flex justify-between"><span className="text-slate-400">Inflation générale</span><span className="text-white">{(sc.parameters.inflationRate * 100).toFixed(1)} % / an</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Inflation énergie</span><span className="text-white">{(sc.parameters.energyInflationRate * 100).toFixed(1)} % / an</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Prix du carbone</span><span className="text-sky-400">{sc.parameters.carbonPricePerTonne} €/t</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Coût des pannes</span><span className="text-amber-400">× {sc.parameters.failureRateMultiplier}</span></div>
                <div className="flex justify-between border-t border-slate-800 pt-1.5"><span className="text-slate-400">Taux d'actualisation</span><span className="text-white">{(sc.parameters.discountRate * 100).toFixed(1)} %</span></div>
              </div>

              <div className="space-y-2">
                <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Coût complet actualisé</div>
                {ranked.map(({ o, r }) => (
                  <div key={o.id} className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${r.isBestChoice ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300' : 'bg-slate-950/60 border-slate-800/60 text-slate-300'}`}>
                    <div>
                      <div className="font-semibold text-white flex items-center gap-1.5">{o.supplierName}{r.isBestChoice && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-label="meilleure offre" />}</div>
                      <div className="text-[10px] text-slate-400">{r.isBestChoice ? 'Coût complet actualisé le plus bas' : `+${eur(r.deltaVsBestLCC)} par rapport à la meilleure`}</div>
                    </div>
                    <div className="text-right font-mono tabular-nums">
                      <div className="font-bold text-white">{eur(r.discountedLCC)}</div>
                      <div className="text-[10px] text-slate-400">nominal : {eur(r.nominalTCO)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
