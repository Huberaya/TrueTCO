import React, { useState } from 'react';
import { Project, SupplierOffer, Supplier, AuditLogEntry, UserRole } from '../types/domain';
import { TCOEngine } from '../engine/tcoEngine';
import {
  Award,
  SlidersHorizontal,
  Scale,
  Leaf,
  ShieldAlert,
  Building2,
  CheckCircle2,
  Sparkles,
  Info,
  RotateCcw,
  FileCheck2,
  TrendingUp,
} from 'lucide-react';

interface MulticriteriaViewProps {
  project: Project;
  offers: SupplierOffer[];
  suppliers: Supplier[];
  activeRole: UserRole;
  onLogAudit?: (log: AuditLogEntry) => void;
}

export interface WeightingPillars {
  tcoWeight: number; // e.g. 45%
  carbonWeight: number; // e.g. 25%
  riskWeight: number; // e.g. 15%
  esgWeight: number; // e.g. 15%
}

export const MulticriteriaView: React.FC<MulticriteriaViewProps> = ({
  project,
  offers,
  suppliers,
  activeRole,
  onLogAudit,
}) => {
  // Default Balanced Preset: 45% TCO, 25% Carbone, 15% Risques, 15% RSE
  const [weights, setWeights] = useState<WeightingPillars>({
    tcoWeight: 45,
    carbonWeight: 25,
    riskWeight: 15,
    esgWeight: 15,
  });

  const [activePreset, setActivePreset] = useState<string>('balanced');
  const [justificationNote, setJustificationNote] = useState<string>('');
  const [auditFeedback, setAuditFeedback] = useState<string | null>(null);

  const totalWeights = weights.tcoWeight + weights.carbonWeight + weights.riskWeight + weights.esgWeight;

  // Calculate detailed TCO for each offer
  const calculatedOffers = offers.map((offer) => {
    const calc = TCOEngine.calculateOfferTCO(project, offer);
    const supplier = suppliers.find((s) => s.id === offer.supplierId);
    return {
      offer,
      calc,
      supplier,
    };
  });

  // Determine Minima / Benchmarks for normalization
  const minTCO = Math.min(...calculatedOffers.map((o) => o.calc.totalComprehensiveTCO));
  const minCarbon = Math.min(...calculatedOffers.map((o) => o.calc.totalLifecycleCO2eTonnes));
  const minRisk = Math.min(...calculatedOffers.map((o) => o.calc.riskExpositionTotal));

  // Compute 4 individual pillar scores on 0-100 scale
  const scoredOffers = calculatedOffers.map(({ offer, calc, supplier }) => {
    // 1. TCO Score: 100 * (minTCO / offerTCO)
    const tcoScore = calc.totalComprehensiveTCO > 0
      ? Math.min(100, Math.max(0, (minTCO / calc.totalComprehensiveTCO) * 100))
      : 100;

    // 2. Carbon Score: 100 * (minCarbon / offerCarbon)
    const carbonScore = calc.totalLifecycleCO2eTonnes > 0
      ? Math.min(100, Math.max(0, (minCarbon / calc.totalLifecycleCO2eTonnes) * 100))
      : 100;

    // 3. Risk & Reliability Score: 100 - defect penalties - failure exposure
    const defectPenalty = ((supplier?.historicalDefectRate || 0.02) * 100) * 10; // e.g. 1.2% -> 12 pts deduction
    const warrantyBonus = Math.min(20, ((supplier?.warrantyMonths || 24) / 12) * 4); // up to +20 pts for 5y warranty
    const riskScore = Math.min(100, Math.max(20, Math.round(90 - defectPenalty + warrantyBonus)));

    // 4. ESG & Quality Score
    const esgScore = supplier?.esgScore || 70;

    // Weighted Overall Score 360°
    const safeTotalWeights = totalWeights > 0 ? totalWeights : 100;
    const overallScore = Number(
      (
        (tcoScore * weights.tcoWeight +
          carbonScore * weights.carbonWeight +
          riskScore * weights.riskWeight +
          esgScore * weights.esgWeight) /
        safeTotalWeights
      ).toFixed(1)
    );

    return {
      offer,
      calc,
      supplier,
      tcoScore: Math.round(tcoScore),
      carbonScore: Math.round(carbonScore),
      riskScore: Math.round(riskScore),
      esgScore: Math.round(esgScore),
      overallScore,
    };
  });

  // Sort descending by overall score
  const rankedOffers = [...scoredOffers].sort((a, b) => b.overallScore - a.overallScore);
  const bestOffer = rankedOffers[0];

  // Presets Handlers
  const applyPreset = (presetKey: string) => {
    setActivePreset(presetKey);
    switch (presetKey) {
      case 'balanced':
        setWeights({ tcoWeight: 45, carbonWeight: 25, riskWeight: 15, esgWeight: 15 });
        break;
      case 'csrd_carbon':
        setWeights({ tcoWeight: 30, carbonWeight: 45, riskWeight: 10, esgWeight: 15 });
        break;
      case 'cfo_cash':
        setWeights({ tcoWeight: 70, carbonWeight: 10, riskWeight: 10, esgWeight: 10 });
        break;
      case 'operational_risk':
        setWeights({ tcoWeight: 35, carbonWeight: 15, riskWeight: 40, esgWeight: 10 });
        break;
      default:
        break;
    }
  };

  const handleAuditValidation = () => {
    if (!onLogAudit) return;

    const log: AuditLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: 'u-dir-achats',
      userName: 'Sophie Valéry',
      userRole: activeRole,
      projectId: project.id,
      entityName: 'Grille Multicritères 360°',
      fieldChanged: 'Pondérations officielles d\'attribution',
      oldValue: 'Grille standard 45/25/15/15',
      newValue: `TCO: ${weights.tcoWeight}% | Climat: ${weights.carbonWeight}% | Risque: ${weights.riskWeight}% | RSE: ${weights.esgWeight}%`,
      justification: justificationNote.trim() || `Validation de la grille multicritères (${activePreset}) pour arbitrage en commission d'appels d'offres.`,
    };

    onLogAudit(log);
    setAuditFeedback('Pondération multicritères consignée avec succès dans le Journal d\'Audit.');
    setTimeout(() => setAuditFeedback(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <Award className="w-4 h-4 text-emerald-400" />
            Matrice de Pondération Multicritères 360° · Aide à la Décision
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Arbitrage Global : Coût Complet, Climat, Risques & RSE
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Conforme aux règles de la commande responsable : personnalisez les 4 piliers d'attribution pour concilier performance financière (LCC), neutralité carbone et sûreté d'exploitation.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">
            Somme des poids :{' '}
            <strong
              className={`text-sm ${
                totalWeights === 100 ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {totalWeights}%
            </strong>
          </span>
        </div>
      </div>

      {/* Preset Selector */}
      <div className="flex flex-wrap items-center gap-2 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs">
        <span className="text-slate-400 font-semibold flex items-center gap-1.5 pr-2 border-r border-slate-800">
          <SlidersHorizontal className="w-3.5 h-3.5 text-sky-400" />
          Profils types d'attribution :
        </span>

        <button
          onClick={() => applyPreset('balanced')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            activePreset === 'balanced'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          Équilibré & Responsable (45/25/15/15)
        </button>

        <button
          onClick={() => applyPreset('csrd_carbon')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            activePreset === 'csrd_carbon'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          Décarbonation Prioritaire (30/45/10/15)
        </button>

        <button
          onClick={() => applyPreset('cfo_cash')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            activePreset === 'cfo_cash'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          Performance Éco & Cash (70/10/10/10)
        </button>

        <button
          onClick={() => applyPreset('operational_risk')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            activePreset === 'operational_risk'
              ? 'bg-emerald-600 text-white shadow-sm'
              : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
          }`}
        >
          Sûreté & Zéro Défaillance (35/15/40/10)
        </button>
      </div>

      {/* 4 Interactive Sliders Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        {/* Pilier 1 : TCO */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Scale className="w-4 h-4 text-emerald-400" />
              1. Coût Complet TCO
            </span>
            <span className="font-mono font-bold text-emerald-400 text-sm">{weights.tcoWeight}%</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Évalue le coût global actualisé (CAPEX, énergie, maintenance, fin de vie).
          </p>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={weights.tcoWeight}
            onChange={(e) => {
              setWeights({ ...weights, tcoWeight: Number(e.target.value) });
              setActivePreset('custom');
            }}
            className="w-full accent-emerald-500 cursor-pointer"
          />
        </div>

        {/* Pilier 2 : Carbone */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Leaf className="w-4 h-4 text-sky-400" />
              2. Décarbonation & Climat
            </span>
            <span className="font-mono font-bold text-sky-400 text-sm">{weights.carbonWeight}%</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Émissions directes et indirectes Scope 1-2-3 (fabrication + usage).
          </p>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={weights.carbonWeight}
            onChange={(e) => {
              setWeights({ ...weights, carbonWeight: Number(e.target.value) });
              setActivePreset('custom');
            }}
            className="w-full accent-sky-500 cursor-pointer"
          />
        </div>

        {/* Pilier 3 : Risques */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              3. Fiabilité & Risques
            </span>
            <span className="font-mono font-bold text-amber-400 text-sm">{weights.riskWeight}%</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Taux de défaillance historique, durées de garantie et risque d'interruption.
          </p>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={weights.riskWeight}
            onChange={(e) => {
              setWeights({ ...weights, riskWeight: Number(e.target.value) });
              setActivePreset('custom');
            }}
            className="w-full accent-amber-500 cursor-pointer"
          />
        </div>

        {/* Pilier 4 : RSE */}
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-indigo-400" />
              4. Engagement RSE Tiers
            </span>
            <span className="font-mono font-bold text-indigo-400 text-sm">{weights.esgWeight}%</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Score ESG fournisseur (EcoVadis, B-Corp) et solidité des preuves ACV.
          </p>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={weights.esgWeight}
            onChange={(e) => {
              setWeights({ ...weights, esgWeight: Number(e.target.value) });
              setActivePreset('custom');
            }}
            className="w-full accent-indigo-500 cursor-pointer"
          />
        </div>
      </div>

      {/* Winner Recommendation Banner */}
      {bestOffer && (
        <div className="p-5 bg-gradient-to-r from-emerald-950/70 via-slate-900 to-slate-900 border border-emerald-600/60 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wider font-semibold text-emerald-400 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              Recommandation Formelle du Comité d'Attribution
            </div>
            <div className="text-xl font-bold text-white flex items-center gap-2">
              <span>{bestOffer.offer.supplierName}</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Score Global : {bestOffer.overallScore} / 100
              </span>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              L'offre <strong>{bestOffer.offer.offerReference}</strong> arrive en tête du classement 360°.
              Elle combine un avantage économique de{' '}
              <strong className="text-emerald-400 font-mono">
                {bestOffer.calc.totalComprehensiveTCO.toLocaleString('fr-FR')} €
              </strong>{' '}
              sur {project.horizonYears} ans et une réduction d'empreinte carbone majeure (
              {bestOffer.calc.totalLifecycleCO2eTonnes.toFixed(1)} tCO2e), tout en garantissant une note de fiabilité
              opérationnelle de {bestOffer.riskScore}/100.
            </p>
          </div>

          <div className="text-right">
            <div className="text-xs text-slate-400">Statut Proposition</div>
            <div className="text-emerald-400 font-bold text-sm mt-0.5">Offre Économiquement la Plus Avantageuse (OEPA)</div>
            <div className="text-[11px] text-slate-500 mt-1 font-mono">Pondération active : {activePreset}</div>
          </div>
        </div>
      )}

      {/* Multicriteria Ranking Table */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <th className="py-3 px-4 font-semibold text-white">Rang</th>
                <th className="py-3 px-4 font-semibold text-white">Offre & Fournisseur</th>
                <th className="py-3 px-4 font-semibold text-white text-center">Score TCO ({weights.tcoWeight}%)</th>
                <th className="py-3 px-4 font-semibold text-white text-center">Score Climat ({weights.carbonWeight}%)</th>
                <th className="py-3 px-4 font-semibold text-white text-center">Score Risques ({weights.riskWeight}%)</th>
                <th className="py-3 px-4 font-semibold text-white text-center">Score RSE ({weights.esgWeight}%)</th>
                <th className="py-3 px-4 font-semibold text-white text-right">Score 360° Total</th>
                <th className="py-3 px-4 font-semibold text-white text-right">Écart Leader</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rankedOffers.map((item, index) => {
                const isLeader = index === 0;
                const deltaPoints = Number((item.overallScore - rankedOffers[0].overallScore).toFixed(1));

                return (
                  <tr
                    key={item.offer.id}
                    className={`transition-colors ${
                      isLeader ? 'bg-emerald-950/20 hover:bg-emerald-950/30' : 'hover:bg-slate-900/40'
                    }`}
                  >
                    {/* Rank */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                            isLeader
                              ? 'bg-emerald-500 text-slate-950'
                              : index === 1
                              ? 'bg-slate-700 text-white'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {index + 1}
                        </span>
                      </div>
                    </td>

                    {/* Candidate */}
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-white text-sm flex items-center gap-1.5">
                        {item.offer.supplierName}
                        {item.offer.isResponsibleCandidate && (
                          <span className="text-[10px] text-emerald-400 px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 font-normal">
                            Éco-responsable
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Réf: {item.offer.offerReference}
                      </div>
                    </td>

                    {/* 1. TCO Score */}
                    <td className="py-3.5 px-4 text-center font-mono">
                      <div className="font-bold text-white">{item.tcoScore}/100</div>
                      <div className="text-[10px] text-slate-400">
                        {item.calc.totalComprehensiveTCO.toLocaleString('fr-FR')} €
                      </div>
                    </td>

                    {/* 2. Carbon Score */}
                    <td className="py-3.5 px-4 text-center font-mono">
                      <div className="font-bold text-sky-400">{item.carbonScore}/100</div>
                      <div className="text-[10px] text-slate-400">
                        {item.calc.totalLifecycleCO2eTonnes.toFixed(1)} tCO2e
                      </div>
                    </td>

                    {/* 3. Risk Score */}
                    <td className="py-3.5 px-4 text-center font-mono">
                      <div className="font-bold text-amber-400">{item.riskScore}/100</div>
                      <div className="text-[10px] text-slate-400">
                        {((item.supplier?.historicalDefectRate || 0.02) * 100).toFixed(1)}% pannes
                      </div>
                    </td>

                    {/* 4. ESG Score */}
                    <td className="py-3.5 px-4 text-center font-mono">
                      <div className="font-bold text-indigo-400">{item.esgScore}/100</div>
                      <div className="text-[10px] text-slate-400">
                        Qualité: {item.supplier?.dataQualityScore || 90}%
                      </div>
                    </td>

                    {/* Overall Score */}
                    <td className="py-3.5 px-4 text-right font-mono">
                      <div className="text-base font-bold text-emerald-400">{item.overallScore}</div>
                      <div className="w-24 ml-auto h-1.5 bg-slate-900 rounded-full overflow-hidden mt-1 border border-slate-800">
                        <div
                          style={{ width: `${item.overallScore}%` }}
                          className={`h-full rounded-full ${
                            isLeader ? 'bg-emerald-500' : 'bg-slate-500'
                          }`}
                        />
                      </div>
                    </td>

                    {/* Delta points */}
                    <td className="py-3.5 px-4 text-right font-mono text-xs">
                      {isLeader ? (
                        <span className="text-emerald-400 font-bold">Vainqueur</span>
                      ) : (
                        <span className="text-rose-400 font-medium">{deltaPoints} pts</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Visual Pillar Contribution Chart */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            Décomposition Graphique des Points par Pilier d'Attribution
          </h3>
          <div className="flex items-center gap-3 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> TCO Économique
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> Décarbonation
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Fiabilité
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> Engagement RSE
            </span>
          </div>
        </div>

        <div className="space-y-3">
          {rankedOffers.map((item) => {
            const tcoPoints = (item.tcoScore * (weights.tcoWeight / 100));
            const carbonPoints = (item.carbonScore * (weights.carbonWeight / 100));
            const riskPoints = (item.riskScore * (weights.riskWeight / 100));
            const esgPoints = (item.esgScore * (weights.esgWeight / 100));

            return (
              <div key={item.offer.id} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-semibold text-white">{item.offer.supplierName}</span>
                  <span className="font-mono text-emerald-400 font-bold">{item.overallScore} / 100 pts</span>
                </div>
                <div className="h-4 w-full bg-slate-950 rounded-lg overflow-hidden flex border border-slate-800">
                  <div
                    style={{ width: `${tcoPoints}%` }}
                    className="bg-emerald-500 h-full transition-all"
                    title={`Points TCO : ${tcoPoints.toFixed(1)}`}
                  />
                  <div
                    style={{ width: `${carbonPoints}%` }}
                    className="bg-sky-500 h-full transition-all"
                    title={`Points Carbone : ${carbonPoints.toFixed(1)}`}
                  />
                  <div
                    style={{ width: `${riskPoints}%` }}
                    className="bg-amber-500 h-full transition-all"
                    title={`Points Risques : ${riskPoints.toFixed(1)}`}
                  />
                  <div
                    style={{ width: `${esgPoints}%` }}
                    className="bg-indigo-500 h-full transition-all"
                    title={`Points RSE : ${esgPoints.toFixed(1)}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Official Sign-off & Audit Log Box */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <FileCheck2 className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-white text-xs">Consignation de la Grille d'Arbitrage Officielle</span>
          </div>
          <span className="text-[11px] text-slate-400">Rôle actif : <strong className="text-white uppercase font-mono">{activeRole}</strong></span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          <div className="md:col-span-3">
            <input
              type="text"
              value={justificationNote}
              onChange={(e) => setJustificationNote(e.target.value)}
              placeholder="Motivation formelle pour la commission (ex: Validation de la grille 360° pour arbitrage conforme CSRD)"
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
            />
          </div>
          <button
            onClick={handleAuditValidation}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Consigner au Journal d'Audit
          </button>
        </div>

        {auditFeedback && (
          <div className="p-2.5 bg-emerald-950/60 border border-emerald-800 rounded-lg text-xs text-emerald-300 flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            {auditFeedback}
          </div>
        )}
      </div>
    </div>
  );
};
