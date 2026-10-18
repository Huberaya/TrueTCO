import React, { useMemo } from 'react';
import { Project, SupplierOffer } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import { Activity, AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

interface SensitivityViewProps {
  project: Project;
  offers: SupplierOffer[];
}

const eur = (x: number) => `${Math.round(x).toLocaleString('fr-FR')} €`;
const signed = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x)).toLocaleString('fr-FR')} €`;
const num = (x: number) => (Math.abs(x) >= 100 ? Math.round(x).toString() : Number(x.toFixed(2)).toString());

export const SensitivityView: React.FC<SensitivityViewProps> = ({ project, offers }) => {
  const convOffer = offers.find((o) => !o.isResponsibleCandidate) || offers[0];
  const respOffer = offers.find((o) => o.isResponsibleCandidate) || offers[1] || offers[0];
  const ready = !!convOffer && !!respOffer && offers.length >= 2 && convOffer.id !== respOffer.id;

  const analysis = useMemo(() => {
    if (!ready) return null;
    const drivers = TCOEngine.calculateSensitivity(project, convOffer, respOffer);
    const a = TCOEngine.calculateOfferTCO(project, convOffer), b = TCOEngine.calculateOfferTCO(project, respOffer);
    const robustness = TCOEngine.calculateRobustness(project, convOffer, respOffer);
    return { drivers, baseDelta: b.exact.lifecycleCostLCC - a.exact.lifecycleCostLCC, robustness };
  }, [project, convOffer, respOffer, ready]);

  if (!ready || !analysis) {
    return (
      <div className="p-12 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto"><AlertCircle className="w-6 h-6" /></div>
        <h3 className="text-lg font-bold text-white">Offres insuffisantes pour l'analyse de sensibilité</h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto">Il faut au moins deux offres distinctes pour mesurer ce qui peut changer la décision.</p>
      </div>
    );
  }

  const { drivers, baseDelta, robustness } = analysis;
  const cheaper = baseDelta < 0 ? respOffer : convOffer;
  const critical = drivers.filter((d) => d.flipsDecision);
  const maxSpread = Math.max(...drivers.map((d) => Math.max(Math.abs(d.lowValueImpactOnDeltaTCO), Math.abs(d.highValueImpactOnDeltaTCO))), 1);
  const p = robustness.probabilityCandidateCheaper;

  return (
    <div className="space-y-6">
      <div className="pb-4 border-b border-slate-800">
        <h2 className="text-2xl font-bold text-white tracking-tight">Sensibilité : qu'est-ce qui peut changer la décision ?</h2>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl">
          Chaque variable est modifiée seule, dans une plage explicite, et l'on mesure l'effet sur l'<strong>écart de coût complet actualisé</strong> entre{' '}
          <strong className="text-white">{respOffer.supplierName}</strong> (candidate) et <strong className="text-white">{convOffer.supplierName}</strong> (référence).
        </p>
      </div>

      {/* Message principal : dérivé des résultats */}
      <div className={`p-4 rounded-xl border text-sm ${critical.length ? 'bg-amber-950/30 border-amber-800/60 text-amber-100' : 'bg-emerald-950/30 border-emerald-800/60 text-emerald-100'}`} role="status">
        <div className="flex gap-2">
          {critical.length ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
          <div className="space-y-1">
            <div>
              Cas central : <strong>{cheaper.supplierName}</strong> est moins chère de <strong>{eur(Math.abs(baseDelta))}</strong> en coût complet actualisé.
            </div>
            <div>
              {critical.length
                ? <>La décision <strong>peut basculer</strong> si l'on varie : {critical.map((d) => d.parameterName).join(' · ')}.</>
                : <>Aucune des variables testées ne change la décision dans les plages indiquées.</>}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="text-xs font-bold text-white uppercase tracking-wider">Variation de l'écart (candidate − référence) par rapport au cas central</div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1 text-sky-400"><span className="w-3 h-3 rounded-sm bg-sky-500" /> Valeur basse</span>
            <span className="flex items-center gap-1 text-rose-400"><span className="w-3 h-3 rounded-sm bg-rose-500" /> Valeur haute</span>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">Un écart négatif favorise la candidate ; une barre vers la gauche la rend relativement moins chère, vers la droite plus chère.</p>

        <div className="space-y-5">
          {drivers.map((d, i) => {
            const lo = d.lowValueImpactOnDeltaTCO, hi = d.highValueImpactOnDeltaTCO;
            const badge = d.sensitivityRank === 'critique' ? 'bg-rose-950/60 text-rose-300 border-rose-800/60'
              : d.sensitivityRank === 'fort' ? 'bg-amber-950/60 text-amber-300 border-amber-800/60' : 'bg-slate-800 text-slate-300 border-slate-700';
            return (
              <div key={d.parameterName} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-500 font-bold text-[11px]">{String(i + 1).padStart(2, '0')}.</span>
                    <span className="font-bold text-white text-sm">{d.parameterName}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium uppercase ${badge}`}>
                      {d.sensitivityRank === 'critique' ? 'peut changer la décision' : `impact ${d.sensitivityRank}`}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    base <strong className="text-white">{num(d.baseValue)}</strong> · testé de <strong className="text-sky-300">{num(d.lowValue ?? d.baseValue)}</strong> à <strong className="text-rose-300">{num(d.highValue ?? d.baseValue)}</strong> {d.unit}
                  </div>
                </div>
                <div className="relative h-7 bg-slate-950 rounded-lg border border-slate-800 flex items-center px-2" role="img" aria-label={`${d.parameterName} : ${signed(lo)} à ${signed(hi)}`}>
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700 z-10" />
                  {/* Le côté de chaque barre suit le SIGNE de la variation (négatif = vers la gauche). */}
                  {[{ v: lo, c: 'bg-sky-500' }, { v: hi, c: 'bg-rose-500' }].map(({ v, c }, k) => (
                    <div key={k} className={`absolute h-4 ${c} ${v < 0 ? 'rounded-l' : 'rounded-r'} opacity-90`}
                      style={{ [v < 0 ? 'right' : 'left']: '50%', width: `${Math.max((Math.abs(v) / maxSpread) * 45, Math.abs(v) < 0.5 ? 0 : 1)}%`, top: k === 0 ? '4px' : '9px', height: '8px' } as React.CSSProperties} />
                  ))}
                </div>
                <div className="flex flex-wrap justify-between gap-2 text-[11px] text-slate-400">
                  <span>{d.explanation}</span>
                  <span className="font-mono">
                    basse : {signed(lo)} · haute : {signed(hi)}
                    {d.switchingValue != null
                      ? <> · <strong className="text-amber-300">bascule à {num(d.switchingValue)} {d.unit}</strong></>
                      : <> · aucun basculement dans la plage étendue</>}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Robustesse */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-xs font-bold text-white uppercase tracking-wider"><Activity className="w-4 h-4 text-emerald-400" /> Robustesse de la décision (simulation)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
            <div className="text-slate-400">Probabilité que {respOffer.supplierName} reste la moins chère</div>
            <div className="text-2xl font-bold font-mono text-white mt-1">{Math.round(p * 100)} %</div>
            <div className="text-[10px] text-slate-500">{robustness.draws.toLocaleString('fr-FR')} tirages, graine {robustness.seed}</div>
          </div>
          <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg sm:col-span-2">
            <div className="text-slate-400">Écart de coût complet actualisé (candidate − référence)</div>
            <div className="mt-1 font-mono text-white">
              P10 {signed(robustness.deltaLCC.p10)} · médiane {signed(robustness.deltaLCC.p50)} · P90 {signed(robustness.deltaLCC.p90)}
            </div>
            <div className="text-[10px] text-slate-500 mt-1">8 tirages sur 10 donnent un écart compris entre P10 et P90.</div>
          </div>
        </div>
        <div className="flex gap-2 text-[11px] text-slate-400"><Info className="w-4 h-4 shrink-0 mt-0.5 text-sky-400" /><p>{robustness.note}</p></div>
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer text-slate-300">Plages utilisées (hypothèses de l'analyse)</summary>
          <table className="mt-2 w-full font-mono">
            <thead><tr className="text-slate-500 text-left"><th className="py-1">Variable</th><th>Basse</th><th>Centrale</th><th>Haute</th></tr></thead>
            <tbody>{robustness.assumptions.map((a) => (
              <tr key={a.driver} className="border-t border-slate-800"><td className="py-1 pr-2">{a.driver}</td><td>{num(a.low)}</td><td>{num(a.mode)}</td><td>{num(a.high)} <span className="text-slate-600">{a.unit}</span></td></tr>
            ))}</tbody>
          </table>
        </details>
      </div>
    </div>
  );
};
