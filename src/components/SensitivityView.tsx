import React from 'react';
import { Project, SupplierOffer } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import { Activity, AlertCircle, TrendingDown, TrendingUp } from 'lucide-react';

interface SensitivityViewProps {
  project: Project;
  offers: SupplierOffer[];
}

export const SensitivityView: React.FC<SensitivityViewProps> = ({ project, offers }) => {
  const convOffer = offers.find((o) => !o.isResponsibleCandidate) || offers[0];
  const respOffer = offers.find((o) => o.isResponsibleCandidate) || offers[1] || offers[0];

  if (!convOffer || !respOffer || offers.length < 2) {
    return (
      <div className="p-12 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">Offres insuffisantes pour l'analyse de sensibilité</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            L'analyse de sensibilité (Tornado) requiert au moins deux offres dans cette consultation pour mesurer la volatilité des écarts de coût complet.
          </p>
        </div>
      </div>
    );
  }

  const drivers = TCOEngine.calculateSensitivity(project, convOffer, respOffer);

  // Maximum spread for SVG scaling
  const maxSpread = Math.max(
    ...drivers.map((d) => Math.max(Math.abs(d.lowValueImpactOnDeltaTCO), Math.abs(d.highValueImpactOnDeltaTCO))),
    10000
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1">
            Hiérarchisation des Risques d'Arbitrage
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Analyse de Sensibilité (Graphique Tornado)
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Identification quantitative des variables clés exerçant le plus fort effet de levier sur le différentiel de coût complet entre l'offre conventionnelle et l'offre responsable.
          </p>
        </div>

        <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300">
          Offres comparées : <strong className="text-white">{convOffer.supplierName}</strong> vs <strong className="text-emerald-400">{respOffer.supplierName}</strong>
        </div>
      </div>

      {/* Tornado Chart Card */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="text-xs font-bold text-white uppercase tracking-wider">
            Sensibilité du Différentiel Économique (Δ TCO en €)
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1 text-sky-400">
              <span className="w-3 h-3 rounded-sm bg-sky-500" /> Hypothèse Basse
            </span>
            <span className="flex items-center gap-1 text-rose-400">
              <span className="w-3 h-3 rounded-sm bg-rose-500" /> Hypothèse Haute
            </span>
          </div>
        </div>

        {/* Drivers List with Tornado Bars */}
        <div className="space-y-5">
          {drivers.map((driver, index) => {
            const lowVal = driver.lowValueImpactOnDeltaTCO;
            const highVal = driver.highValueImpactOnDeltaTCO;

            // Bar percentages relative to center (0)
            const leftWidthPct = (Math.abs(lowVal) / maxSpread) * 45;
            const rightWidthPct = (Math.abs(highVal) / maxSpread) * 45;

            const badgeColor = 
              driver.sensitivityRank === 'critique'
                ? 'bg-rose-950/60 text-rose-400 border-rose-800/60'
                : driver.sensitivityRank === 'fort'
                ? 'bg-amber-950/60 text-amber-400 border-amber-800/60'
                : 'bg-slate-800 text-slate-300 border-slate-700';

            return (
              <div key={driver.parameterName} className="space-y-1.5">
                <div className="flex flex-wrap items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-500 font-bold text-[11px]">
                      0{index + 1}.
                    </span>
                    <span className="font-bold text-white text-sm">{driver.parameterName}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded border font-medium uppercase ${badgeColor}`}>
                      Impact {driver.sensitivityRank}
                    </span>
                  </div>

                  <div className="text-xs font-mono text-slate-400">
                    Valeur pivot : <strong className="text-white">{driver.baseValue} {driver.unit}</strong>
                  </div>
                </div>

                {/* Tornado graphic line */}
                <div className="relative h-7 bg-slate-950 rounded-lg border border-slate-800 flex items-center px-2">
                  {/* Center vertical axis (0 point) */}
                  <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700 z-10" />

                  {/* Left wing (low scenario effect) */}
                  <div className="w-1/2 flex justify-end pr-0.5">
                    <div
                      style={{ width: `${Math.max(leftWidthPct, 4)}%` }}
                      className="h-4 bg-sky-500 rounded-l transition-all flex items-center justify-start pl-1.5 text-[10px] font-mono text-white font-semibold"
                    >
                      {lowVal.toLocaleString('fr-FR')} €
                    </div>
                  </div>

                  {/* Right wing (high scenario effect) */}
                  <div className="w-1/2 flex justify-start pl-0.5">
                    <div
                      style={{ width: `${Math.max(rightWidthPct, 4)}%` }}
                      className="h-4 bg-rose-500 rounded-r transition-all flex items-center justify-end pr-1.5 text-[10px] font-mono text-white font-semibold"
                    >
                      +{highVal.toLocaleString('fr-FR')} €
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 leading-relaxed pt-0.5">
                  {driver.explanation}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Synthesis Box */}
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl flex items-start gap-3">
        <Activity className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 leading-relaxed">
          <strong className="text-white">Recommandation du Contrôleur Achats :</strong> Les paramètres énergétiques et la fiscalité carbone représentent plus de 68% de la variance globale du modèle. Sécuriser un contrat d'approvisionnement d'électricité à tarif fixe pluriannuel garantira le retour sur investissement modélisé.
        </div>
      </div>
    </div>
  );
};
