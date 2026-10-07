import React from 'react';
import { Project, SupplierOffer } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import { CheckCircle2, TrendingUp, AlertTriangle } from 'lucide-react';

interface ScenarioViewProps {
  project: Project;
  offers: SupplierOffer[];
}

export const ScenarioView: React.FC<ScenarioViewProps> = ({ project, offers }) => {
  const scenarios = TCOEngine.calculateScenarios(project, offers);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1">
            Résilience Financière & Stress-Test
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Simulateur de Scénarios Macro-Économiques
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Testez la robustesse de chaque décision face aux chocs d'inflation, flambée des cours de l'énergie, durcissement du prix carbone et défaillances techniques.
          </p>
        </div>
      </div>

      {/* 3 Scenario Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {scenarios.map((sc) => {
          const isPessimistic = sc.scenarioName === 'Pessimiste';
          const isOptimistic = sc.scenarioName === 'Optimiste';

          return (
            <div
              key={sc.scenarioName}
              className={`p-5 rounded-xl border flex flex-col justify-between ${
                isPessimistic
                  ? 'bg-slate-900/90 border-rose-900/50'
                  : isOptimistic
                  ? 'bg-slate-900/90 border-emerald-900/50'
                  : 'bg-slate-900/90 border-slate-700/80'
              }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Scénario {sc.scenarioName}
                  </span>
                  {isPessimistic && (
                    <span className="text-[10px] text-rose-400 bg-rose-950/60 border border-rose-800/60 px-2 py-0.5 rounded font-mono">
                      Stress-Test Sévère
                    </span>
                  )}
                  {isOptimistic && (
                    <span className="text-[10px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-2 py-0.5 rounded font-mono">
                      Conditions Favorables
                    </span>
                  )}
                </div>

                <h3 className="text-lg font-bold text-white mb-3">
                  {isPessimistic
                    ? 'Choc Énergétique & Quotas'
                    : isOptimistic
                    ? 'Désinflation & Tarifs Modérés'
                    : 'Hypothèses de Consensus (Central)'}
                </h3>

                {/* Macro Parameters Table */}
                <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg space-y-1.5 text-xs font-mono text-slate-300 mb-4">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Inflation générale :</span>
                    <span className="text-white">{(sc.parameters.inflationRate * 100).toFixed(1)}% / an</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Inflation énergie :</span>
                    <span className="text-white">{(sc.parameters.energyInflationRate * 100).toFixed(1)}% / an</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Prix Carbone :</span>
                    <span className="text-sky-400">{sc.parameters.carbonPricePerTonne} €/t</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Multiplicateur pannes :</span>
                    <span className="text-amber-400">{sc.parameters.failureRateMultiplier}x</span>
                  </div>
                </div>

                {/* Results for Each Offer */}
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    TCO Global Calculé :
                  </div>
                  {offers.map((offer) => {
                    const res = sc.resultsByOfferId[offer.id];
                    if (!res) return null;

                    return (
                      <div
                        key={offer.id}
                        className={`p-2.5 rounded-lg border text-xs flex items-center justify-between transition-colors ${
                          res.isBestChoice
                            ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300'
                            : 'bg-slate-950/60 border-slate-800/60 text-slate-300'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            <span>{offer.supplierName}</span>
                            {res.isBestChoice && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {res.deltaVsCheapestNominal === 0
                              ? '🏆 Choix le plus économique'
                              : `+${res.deltaVsCheapestNominal.toLocaleString('fr-FR')} € d'écart`}
                          </div>
                        </div>

                        <div className="text-right font-mono tabular-nums">
                          <div className="font-bold text-white">
                            {res.nominalTCO.toLocaleString('fr-FR')} €
                          </div>
                          <div className="text-[10px] text-slate-400">
                            LCC: {res.discountedLCC.toLocaleString('fr-FR')} €
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                {isPessimistic && (
                  <span>En période de crise énergétique, l'écart en faveur de l'alternative sobre s'accentue drastiquement.</span>
                )}
                {isOptimistic && (
                  <span>Même avec une énergie bon marché, le gain TCO reste favorable grâce à la maintenance réduite.</span>
                )}
                {!isPessimistic && !isOptimistic && (
                  <span>Scénario de référence retenu pour les validations budgétaires en Comité d'Investissement.</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
