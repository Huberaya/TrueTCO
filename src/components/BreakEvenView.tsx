import React, { useState, useMemo } from 'react';
import { Project, SupplierOffer } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import { TrendingUp, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';

interface BreakEvenViewProps {
  project: Project;
  offers: SupplierOffer[];
}

export const BreakEvenView: React.FC<BreakEvenViewProps> = ({ project, offers }) => {
  // Find conventional vs responsible candidates
  const convOffer = offers.find((o) => !o.isResponsibleCandidate) || offers[0];
  const respOffer = offers.find((o) => o.isResponsibleCandidate) || offers[1] || offers[0];

  // Interactive Sliders State
  const [energyInflation, setEnergyInflation] = useState((project?.energyInflationRate || 0.04) * 100);
  const [carbonPrice, setCarbonPrice] = useState(project?.carbonPricePerTonne || 120);
  const [failureMultiplier, setFailureMultiplier] = useState(1.0);
  const [maintenanceSavingsMultiplier, setMaintenanceSavingsMultiplier] = useState(1.0);
  const [volume, setVolume] = useState(project?.plannedVolume || 1);

  // Recalculate with active slider values
  const { convResult, respResult, breakEven, monthlyData } = useMemo(() => {
    if (!convOffer || !respOffer) {
      return {
        convResult: null,
        respResult: null,
        breakEven: null,
        monthlyData: [],
      };
    }

    const convUnitPrice = convOffer?.apparentUnitPrice?.value ?? (convOffer?.apparentTotal ? convOffer.apparentTotal / (convOffer.quantity || 1) : 0);
    const respUnitPrice = respOffer?.apparentUnitPrice?.value ?? (respOffer?.apparentTotal ? respOffer.apparentTotal / (respOffer.quantity || 1) : 0);

    // Clone offers with adjusted volume
    const adjustedConv: SupplierOffer = {
      ...convOffer,
      quantity: volume,
      apparentTotal: convUnitPrice * volume,
    };
    const adjustedResp: SupplierOffer = {
      ...respOffer,
      quantity: volume,
      apparentTotal: respUnitPrice * volume,
    };

    const cRes = TCOEngine.calculateOfferTCO(project, adjustedConv, {
      energyInflationRate: energyInflation / 100,
      carbonPricePerTonne: carbonPrice,
      failureRateMultiplier: failureMultiplier,
    });

    const rRes = TCOEngine.calculateOfferTCO(project, adjustedResp, {
      energyInflationRate: energyInflation / 100,
      carbonPricePerTonne: carbonPrice,
      failureRateMultiplier: failureMultiplier,
    });

    const bEven = TCOEngine.calculateBreakEven(cRes, rRes, project.horizonYears);

    // Generate monthly cumulative data for chart (from month 0 to horizon * 12)
    const totalMonths = project.horizonYears * 12;
    const initialConv = cRes.apparentDirectCost + cRes.installationTotal;
    const initialResp = rRes.apparentDirectCost + rRes.installationTotal;

    const monthlyConvOperating = 
      (cRes.energyConsumablesTotal + cRes.maintenanceRepairsTotal + cRes.replacementDefectsTotal + cRes.riskExpositionTotal + cRes.monetizedCarbonTotal) / totalMonths;

    const monthlyRespOperating = 
      (rRes.energyConsumablesTotal + (rRes.maintenanceRepairsTotal * maintenanceSavingsMultiplier) + rRes.replacementDefectsTotal + rRes.riskExpositionTotal + rRes.monetizedCarbonTotal) / totalMonths;

    const points: { month: number; convCumul: number; respCumul: number }[] = [];
    for (let m = 0; m <= totalMonths; m += 3) {
      points.push({
        month: m,
        convCumul: Math.round(initialConv + monthlyConvOperating * m),
        respCumul: Math.round(initialResp + monthlyRespOperating * m),
      });
    }

    return {
      convResult: cRes,
      respResult: rRes,
      breakEven: bEven,
      monthlyData: points,
    };
  }, [
    convOffer,
    respOffer,
    project,
    energyInflation,
    carbonPrice,
    failureMultiplier,
    maintenanceSavingsMultiplier,
    volume,
  ]);

  if (!convOffer || !respOffer || !convResult || !respResult || !breakEven) {
    return (
      <div className="p-12 bg-slate-900 border border-slate-800 rounded-2xl text-center space-y-4">
        <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-white">Offres insuffisantes pour le calcul du Point de Bascule</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Le calcul dynamique de Break-Even (point mort économique & carbone) nécessite au moins une offre conventionnelle et une offre éco-responsable dans cette consultation.
          </p>
        </div>
      </div>
    );
  }

  // Chart coordinate mapping
  const chartHeight = 260;
  const chartWidth = 650;
  const maxCost = Math.max(
    ...monthlyData.map((d) => Math.max(d.convCumul, d.respCumul)),
    100000
  );
  const minCost = Math.min(
    ...monthlyData.map((d) => Math.min(d.convCumul, d.respCumul)),
    0
  );

  const totalMonths = project.horizonYears * 12;

  const getX = (month: number) => 50 + (month / totalMonths) * (chartWidth - 70);
  const getY = (val: number) => chartHeight - 30 - ((val - minCost) / (maxCost - minCost || 1)) * (chartHeight - 60);

  const convPath = monthlyData.reduce(
    (acc, pt, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${getX(pt.month)} ${getY(pt.convCumul)}`,
    ''
  );

  const respPath = monthlyData.reduce(
    (acc, pt, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${getX(pt.month)} ${getY(pt.respCumul)}`,
    ''
  );

  const crossoverX = breakEven.breakEvenMonth && breakEven.breakEvenMonth <= totalMonths
    ? getX(breakEven.breakEvenMonth)
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1">
            Arbitrage d'Amortissement & Point Mort
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Calculateur de Point Mort (Break-Even Crossover)
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Mesure dynamique du moment où l'alternative responsable devient économiquement plus rentable que l'offre conventionnelle grâce aux économies cumulées d'énergie, de maintenance et d'externalités.
          </p>
        </div>

        <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono text-slate-300">
          Horizon d'analyse : <strong className="text-white">{project.horizonYears} ans</strong> ({totalMonths} mois)
        </div>
      </div>

      {/* Break-Even Result Summary Box */}
      <div className={`p-5 rounded-xl border flex flex-wrap items-center justify-between gap-6 ${
        breakEven.hasBreakEven
          ? 'bg-emerald-950/30 border-emerald-800/60'
          : 'bg-amber-950/30 border-amber-800/60'
      }`}>
        <div className="space-y-2 max-w-2xl">
          <div className="flex items-center gap-2">
            {breakEven.hasBreakEven ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0" />
            )}
            <h3 className="text-base font-bold text-white">
              {breakEven.breakEvenDescription}
            </h3>
          </div>

          <div className="text-xs text-slate-300 leading-relaxed pl-7">
            Comparaison entre <strong>{convOffer.supplierName}</strong> (Offre de base) et{' '}
            <strong>{respOffer.supplierName}</strong> (Candidate responsable).
            {breakEven.hasBreakEven && breakEven.breakEvenMonth ? (
              <>
                {' '}Le surcoût initial de{' '}
                <span className="font-mono font-semibold text-white">
                  {(respResult.apparentDirectCost - convResult.apparentDirectCost).toLocaleString('fr-FR')} €
                </span>{' '}
                ({breakEven.initialPriceDeltaPercent > 0 ? `+${breakEven.initialPriceDeltaPercent}%` : `${breakEven.initialPriceDeltaPercent}%`}) est absorbé en{' '}
                <span className="text-emerald-400 font-bold font-mono">
                  {breakEven.breakEvenMonth} mois
                </span>{' '}
                grâce à une économie d'exploitation de{' '}
                <span className="text-emerald-400 font-bold font-mono">
                  {breakEven.monthlyOperatingSavings.toLocaleString('fr-FR')} € / mois
                </span>.
              </>
            ) : null}
          </div>
        </div>

        {breakEven.hasBreakEven && breakEven.breakEvenMonth && (
          <div className="text-center p-4 bg-slate-950/70 border border-emerald-800/40 rounded-xl min-w-[170px]">
            <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-0.5">Point Mort Atteint À</div>
            <div className="text-3xl font-extrabold font-mono text-emerald-400 tabular-nums">
              {breakEven.breakEvenMonth} <span className="text-sm font-sans font-medium text-slate-300">mois</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
              soit {breakEven.crossoverYear} ans d'usage
            </div>
          </div>
        )}
      </div>

      {/* Main Grid: Interactive Parameters vs SVG Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Interactive Parameters (Sliders) */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">
              Paramètres de Simulation en Direct
            </h4>
            <button
              onClick={() => {
                setEnergyInflation(project.energyInflationRate * 100);
                setCarbonPrice(project.carbonPricePerTonne);
                setFailureMultiplier(1.0);
                setMaintenanceSavingsMultiplier(1.0);
                setVolume(project.plannedVolume);
              }}
              className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
              title="Réinitialiser aux valeurs de référence"
            >
              <RefreshCw className="w-3 h-3" /> Reset
            </button>
          </div>

          {/* Slider 1: Volume */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Volume commandé ({project.unitName})</span>
              <span className="font-mono text-white font-semibold">{volume}</span>
            </div>
            <input
              type="range"
              min="5"
              max="150"
              step="5"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Slider 2: Energy Inflation */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Inflation annuelle de l'énergie</span>
              <span className="font-mono text-emerald-400 font-semibold">{energyInflation.toFixed(1)} %/an</span>
            </div>
            <input
              type="range"
              min="0"
              max="12"
              step="0.5"
              value={energyInflation}
              onChange={(e) => setEnergyInflation(Number(e.target.value))}
              className="w-full accent-emerald-500 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
            />
            <div className="text-[10px] text-slate-400 flex justify-between">
              <span>0% (Stable)</span>
              <span>12% (Choc géopolitique)</span>
            </div>
          </div>

          {/* Slider 3: Carbon Price */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Prix de la tonne CO2e</span>
              <span className="font-mono text-sky-400 font-semibold">{carbonPrice} €/t</span>
            </div>
            <input
              type="range"
              min="30"
              max="300"
              step="10"
              value={carbonPrice}
              onChange={(e) => setCarbonPrice(Number(e.target.value))}
              className="w-full accent-sky-500 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
            />
            <div className="text-[10px] text-slate-400 flex justify-between">
              <span>30 €/t (Marché spot)</span>
              <span>250 €/t (Trajectoire 2030)</span>
            </div>
          </div>

          {/* Slider 4: Failure Multiplier */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Sensibilité aux pannes hors garantie</span>
              <span className="font-mono text-amber-400 font-semibold">{failureMultiplier.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.1"
              value={failureMultiplier}
              onChange={(e) => setFailureMultiplier(Number(e.target.value))}
              className="w-full accent-amber-500 bg-slate-950 h-1.5 rounded-lg appearance-none cursor-pointer"
            />
            <div className="text-[10px] text-slate-400 flex justify-between">
              <span>0.5x (Faible usure)</span>
              <span>2.5x (Usage intensif sévère)</span>
            </div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-[11px] text-slate-400 leading-relaxed">
            💡 <strong>Observation de sensibilité :</strong> Plus le coût de l'énergie ou du carbone est élevé, plus le point mort se rapproche rapidement dans le temps.
          </div>
        </div>

        {/* Right Column: Dynamic Crossover Chart */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Trajectoires Cumulées des Coûts Réels dans le Temps
                </h4>
                <p className="text-[11px] text-slate-400">
                  Évolution mois par mois des sorties de fonds réelles (Investissement initial + OPEX cumulé)
                </p>
              </div>

              {/* Chart Legend */}
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="w-3 h-0.5 bg-rose-400 inline-block" /> {convOffer.supplierName}
                </span>
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <span className="w-3 h-0.5 bg-emerald-400 inline-block" /> {respOffer.supplierName}
                </span>
              </div>
            </div>

            {/* SVG Visual Graph */}
            <div className="w-full overflow-hidden bg-slate-950 border border-slate-800/80 rounded-lg p-2 relative">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-auto text-slate-600 select-none"
              >
                {/* Horizontal Grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
                  const y = chartHeight - 30 - ratio * (chartHeight - 60);
                  const val = minCost + ratio * (maxCost - minCost);
                  return (
                    <g key={i}>
                      <line
                        x1="50"
                        y1={y}
                        x2={chartWidth - 20}
                        y2={y}
                        stroke="#1e293b"
                        strokeDasharray="3 3"
                      />
                      <text
                        x="45"
                        y={y + 3}
                        fontSize="9"
                        fill="#64748b"
                        textAnchor="end"
                        fontFamily="JetBrains Mono"
                      >
                        {(val / 1000).toFixed(0)} k€
                      </text>
                    </g>
                  );
                })}

                {/* Vertical Grid lines (Years) */}
                {Array.from({ length: project.horizonYears + 1 }).map((_, yearIdx) => {
                  const m = yearIdx * 12;
                  const x = getX(m);
                  return (
                    <g key={yearIdx}>
                      <line
                        x1={x}
                        y1="20"
                        x2={x}
                        y2={chartHeight - 30}
                        stroke="#1e293b"
                        strokeDasharray="2 2"
                      />
                      <text
                        x={x}
                        y={chartHeight - 15}
                        fontSize="9"
                        fill="#94a3b8"
                        textAnchor="middle"
                        fontFamily="JetBrains Mono"
                      >
                        An {yearIdx} ({m}m)
                      </text>
                    </g>
                  );
                })}

                {/* Trajectory 1: Conventional (Starts lower, steeper slope) */}
                <path
                  d={convPath}
                  fill="none"
                  stroke="#f43f5e"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Trajectory 2: Responsible (Starts higher, flatter slope) */}
                <path
                  d={respPath}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />

                {/* Break-even Crossover Line and Highlight */}
                {crossoverX && (
                  <g>
                    <line
                      x1={crossoverX}
                      y1="20"
                      x2={crossoverX}
                      y2={chartHeight - 30}
                      stroke="#10b981"
                      strokeWidth="1.5"
                      strokeDasharray="4 4"
                    />
                    <circle
                      cx={crossoverX}
                      cy={getY(initialConvCostAtCrossover(monthlyData, breakEven.breakEvenMonth!))}
                      r="5"
                      fill="#10b981"
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                    <text
                      x={crossoverX}
                      y="15"
                      fontSize="10"
                      fill="#10b981"
                      fontWeight="bold"
                      textAnchor="middle"
                      fontFamily="JetBrains Mono"
                    >
                      Point Mort: {breakEven.breakEvenMonth} mois
                    </text>
                  </g>
                )}
              </svg>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-xs text-slate-400">
            <div>
              Coût total conventionnel à terme :{' '}
              <strong className="text-rose-300 font-mono">
                {convResult.totalComprehensiveTCO.toLocaleString('fr-FR')} €
              </strong>
            </div>
            <div>
              Coût total responsable à terme :{' '}
              <strong className="text-emerald-300 font-mono">
                {respResult.totalComprehensiveTCO.toLocaleString('fr-FR')} €
              </strong>
            </div>
            <div>
              Gain net cumulé :{' '}
              <strong className="text-white font-mono">
                {(convResult.totalComprehensiveTCO - respResult.totalComprehensiveTCO).toLocaleString('fr-FR')} €
              </strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function initialConvCostAtCrossover(data: { month: number; convCumul: number; respCumul: number }[], targetMonth: number) {
  if (!data.length) return 0;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i].month <= targetMonth && data[i + 1].month >= targetMonth) {
      return (data[i].convCumul + data[i + 1].convCumul) / 2;
    }
  }
  return data[data.length - 1].convCumul;
}
