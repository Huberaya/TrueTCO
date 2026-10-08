/**
 * TrueTCO — Écran DÉCISION
 * ---------------------------------------------------------------------------
 * Tout ce qui est affiché ici vient du serveur : classement, recommandation,
 * avantage économique, point mort, inversion. Aucun montant n'est recalculé dans
 * le navigateur, aucun n'est inventé en l'absence de données.
 *
 * Le produit doit répondre à quatre questions, et cet écran les rend explicites :
 *   1. Combien ça coûte ?            → coût complet nominal et VAN par offre
 *   2. Pourquoi ?                    → « Pourquoi ce montant » par nature de coût
 *   3. Quelle option est préférable ? → recommandation, avec son statut et sa raison
 *   4. Dans quelles hypothèses la décision change-t-elle ? → seuils d'inversion
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Gauge,
  HelpCircle,
  History,
  Info,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingDown,
} from 'lucide-react';
import {
  ApiError,
  DecisionRunDetail,
  DecisionRunResult,
  DecisionRunSummary,
  fetchDecisionRun,
  fetchDecisionRuns,
  replayDecisionRun,
  runDecisionOnServer,
} from '../services/serverData';

interface DecisionViewProps {
  projectId: string | null;
  projectName: string;
  currency: string;
  canRunDecision: boolean;
}

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 });

const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  ferme: {
    label: 'Recommandation ferme',
    className: 'bg-emerald-950 text-emerald-300 border-emerald-800',
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  conditionnel: {
    label: 'Recommandation conditionnelle',
    className: 'bg-amber-950 text-amber-300 border-amber-800',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  indetermine: {
    label: 'Aucune recommandation',
    className: 'bg-rose-950 text-rose-300 border-rose-800',
    icon: <ShieldAlert className="w-4 h-4" />,
  },
};

export const DecisionView: React.FC<DecisionViewProps> = ({ projectId, projectName, currency, canRunDecision }) => {
  const [result, setResult] = useState<DecisionRunResult | null>(null);
  const [history, setHistory] = useState<DecisionRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<DecisionRunDetail | null>(null);
  const [replay, setReplay] = useState<{ identical: boolean; differences: string[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const formatMoney = currencyFormatter(result?.currency ?? currency);

  const run = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const response = await runDecisionOnServer(projectId);
      setResult(response);
      setSelectedRun(null);
      setReplay(null);
      setHistory(await fetchDecisionRuns(projectId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Le calcul a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const openRun = async (runId: string) => {
    setBusy(true);
    setError(null);
    setReplay(null);
    try {
      setSelectedRun(await fetchDecisionRun(runId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "L'exécution n'a pas pu être chargée.");
    } finally {
      setBusy(false);
    }
  };

  const doReplay = async (runId: string) => {
    setBusy(true);
    setError(null);
    try {
      setReplay(await replayDecisionRun(runId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Le rejeu a échoué.');
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) {
    return (
      <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-300 flex items-start gap-2">
        <Info className="w-4 h-4 text-emerald-400 mt-0.5" />
        <span>
          Sélectionnez un dossier pour calculer une décision. Le calcul est exécuté par le serveur sur les données
          enregistrées du dossier : aucun montant n'est produit par le navigateur.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <Scale className="w-4 h-4" />
            Décision d'arbitrage
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">Quelle option est préférable, et pourquoi ?</h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Dossier « {projectName} ». Le classement se fait sur la valeur actualisée du coût complet (VAN), pas sur le
            prix affiché : une offre plus chère à l'achat peut être moins coûteuse sur son cycle de vie.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={busy || !canRunDecision}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
            title={
              canRunDecision
                ? 'Calculer et enregistrer une nouvelle décision'
                : "Votre rôle ne permet pas de lancer un calcul de décision"
            }
          >
            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>{busy ? 'Calcul en cours…' : 'Calculer la décision'}</span>
          </button>
          <button
            onClick={async () => setHistory(await fetchDecisionRuns(projectId))}
            disabled={busy}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <History className="w-3.5 h-3.5 text-emerald-400" />
            <span>Historique</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-200 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!canRunDecision && (
        <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-[11px] text-slate-400">
          Votre rôle autorise la consultation des décisions, mais pas leur exécution. La décision se lance par un rôle
          achats, finance ou administrateur.
        </div>
      )}

      {result && (
        <>
          <div className={`p-4 border rounded-xl flex items-start gap-3 ${STATUS_LABEL[result.recommendation.status].className}`}>
            <div className="mt-0.5">{STATUS_LABEL[result.recommendation.status].icon}</div>
            <div className="space-y-1.5">
              <div className="text-sm font-bold">{STATUS_LABEL[result.recommendation.status].label}</div>
              <p className="text-xs leading-relaxed">{result.recommendation.reason}</p>
              {result.recommendation.conditions.length > 0 && (
                <ul className="text-[11px] list-disc pl-4 space-y-0.5 opacity-90">
                  {result.recommendation.conditions.map((condition, index) => (
                    <li key={index}>{condition}</li>
                  ))}
                </ul>
              )}
              <div className="text-[11px] opacity-80">
                Moteur {result.engineVersion} · méthodologie {result.methodologyVersion} · données révision{' '}
                {result.inputVersion} · exécution {new Date(result.calculatedAt).toLocaleString('fr-FR')}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <MetricCard
              label="Couverture des données"
              value={`${result.completeness.coveragePercent} %`}
              hint={result.completeness.verdict}
            />
            <MetricCard
              label="Postes non sourcés"
              value={String(result.completeness.unsourcedCostItems)}
              hint="Conservés au calcul, jamais considérés comme vérifiés"
            />
            <MetricCard
              label="Écart avec la 2ᵉ option"
              value={
                result.recommendation.economicAdvantage.vsSecondBestNpv === null
                  ? '—'
                  : formatMoney.format(result.recommendation.economicAdvantage.vsSecondBestNpv)
              }
              hint="VAN du coût complet, sur l'horizon du dossier"
            />
            <MetricCard
              label="Écart avec la moins chère à l'achat"
              value={
                result.recommendation.economicAdvantage.vsCheapestApparentNpv === null
                  ? '—'
                  : formatMoney.format(result.recommendation.economicAdvantage.vsCheapestApparentNpv)
              }
              hint="L'option au prix affiché le plus bas n'est pas toujours la moins coûteuse"
            />
          </div>

          <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <header className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <div className="text-sm font-bold text-white">Classement sur la VAN du coût complet</div>
              <div className="text-[11px] text-slate-400">Horizon {result.horizonYears} ans · actualisation {(result.discountRate * 100).toFixed(2)} %</div>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-950/60 text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">#</th>
                    <th className="text-left px-3 py-2 font-semibold">Offre</th>
                    <th className="text-right px-3 py-2 font-semibold">Prix affiché</th>
                    <th className="text-right px-3 py-2 font-semibold">Coût complet (nominal)</th>
                    <th className="text-right px-3 py-2 font-semibold">VAN du coût complet</th>
                    <th className="text-right px-3 py-2 font-semibold">Carbone</th>
                    <th className="text-right px-3 py-2 font-semibold">Confiance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {result.ranking.map((entry) => (
                    <tr key={entry.offerId} className={entry.offerId === result.recommendedOfferId ? 'bg-emerald-950/30' : ''}>
                      <td className="px-3 py-2 font-mono text-slate-400">{entry.rank}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-white">{entry.offerReference}</div>
                        <div className="text-[11px] text-slate-400">
                          {entry.supplierName}
                          {entry.isApparentCheapest && (
                            <span className="ml-2 text-[10px] bg-slate-800 border border-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                              prix affiché le plus bas
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{formatMoney.format(entry.apparentTotal)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {formatMoney.format(entry.totalComprehensiveTCO)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white font-semibold">
                        {formatMoney.format(entry.lifecycleCostLCC)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">
                        {numberFormatter.format(entry.carbonTonnes)} t
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{entry.confidenceScore}/100</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <WhyThisAmount perOffer={result.results.perOffer} formatMoney={formatMoney} />

          {result.inversion && (
            <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
              <header className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                <ArrowLeftRight className="w-4 h-4 text-emerald-400" />
                <div>
                  <div className="text-sm font-bold text-white">Quand la décision change-t-elle ?</div>
                  <div className="text-[11px] text-slate-400">
                    Comparaison « {result.inversion.challenger} » contre « {result.inversion.winner} » (gagnant retenu).
                    Un écart positif signifie que l'option de tête reste préférable.
                  </div>
                </div>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-950/60 text-slate-400">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Hypothèse</th>
                      <th className="text-right px-3 py-2 font-semibold">Valeur actuelle</th>
                      <th className="text-right px-3 py-2 font-semibold">Plage explorée</th>
                      <th className="text-left px-3 py-2 font-semibold">Seuil d'inversion</th>
                      <th className="text-left px-3 py-2 font-semibold">Lecture</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {result.inversion.parameters.map((parameter) => (
                      <tr key={parameter.parameter}>
                        <td className="px-3 py-2 font-semibold text-white">{parameter.label}</td>
                        <td className="px-3 py-2 text-right font-mono text-slate-300">
                          {numberFormatter.format(parameter.currentValue)} {parameter.unit}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-400">
                          {numberFormatter.format(parameter.range.min)} → {numberFormatter.format(parameter.range.max)}{' '}
                          {parameter.unit}
                        </td>
                        <td className="px-3 py-2 font-mono">
                          {parameter.isReachable && parameter.nearestThreshold !== null ? (
                            <span className="text-amber-300">
                              {numberFormatter.format(parameter.nearestThreshold)} {parameter.unit}
                            </span>
                          ) : (
                            <span className="text-slate-500">aucun sur la plage</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-300">{parameter.statement}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-slate-800 text-[11px] text-slate-400">{result.inversion.note}</div>
            </section>
          )}

          {result.warnings.length > 0 && (
            <section className="bg-amber-950/40 border border-amber-900 rounded-xl p-4">
              <div className="text-sm font-bold text-amber-200 flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4" />
                Points d'attention sur la fiabilité du résultat
              </div>
              <ul className="text-[11px] text-amber-100/90 space-y-1 list-disc pl-4">
                {result.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {history.length > 0 && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <header className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-400" />
            <div className="text-sm font-bold text-white">Exécutions enregistrées</div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-950/60 text-slate-400">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Date</th>
                  <th className="text-right px-3 py-2 font-semibold">Révision des données</th>
                  <th className="text-left px-3 py-2 font-semibold">Moteur</th>
                  <th className="text-left px-3 py-2 font-semibold">Empreinte des entrées</th>
                  <th className="text-right px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="px-3 py-2 text-slate-300">{new Date(entry.created_at).toLocaleString('fr-FR')}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-300">v{entry.input_version}</td>
                    <td className="px-3 py-2 font-mono text-slate-400">{entry.engine_version}</td>
                    <td className="px-3 py-2 font-mono text-slate-500 text-[10px]">
                      {entry.input_fingerprint ? `${entry.input_fingerprint.slice(0, 16)}…` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right space-x-2">
                      <button
                        onClick={() => openRun(entry.id)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] text-white"
                      >
                        Consulter
                      </button>
                      <button
                        onClick={() => doReplay(entry.id)}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] text-white"
                        title="Recalculer depuis le snapshot enregistré et comparer"
                      >
                        Rejouer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedRun && (
        <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2 text-xs">
          <div className="text-sm font-bold text-white">Exécution du {new Date(selectedRun.created_at).toLocaleString('fr-FR')}</div>
          <div className="text-slate-300">{selectedRun.freshness.explanation}</div>
          <div className="font-mono text-[10px] text-slate-500 break-all">
            Empreinte enregistrée : {selectedRun.freshness.storedFingerprint}
          </div>
          {selectedRun.freshness.currentFingerprint && (
            <div className="font-mono text-[10px] text-slate-500 break-all">
              Empreinte actuelle du dossier : {selectedRun.freshness.currentFingerprint}
            </div>
          )}
        </section>
      )}

      {replay && (
        <section
          className={`border rounded-xl p-4 text-xs ${
            replay.identical ? 'bg-emerald-950/40 border-emerald-900 text-emerald-100' : 'bg-rose-950/40 border-rose-900 text-rose-100'
          }`}
        >
          <div className="font-bold flex items-center gap-2">
            {replay.identical ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            {replay.identical
              ? 'Rejeu identique : la décision est reproductible à partir de son snapshot.'
              : 'Le rejeu diffère du résultat enregistré.'}
          </div>
          {replay.differences.length > 0 && (
            <ul className="list-disc pl-4 mt-1.5 space-y-0.5">
              {replay.differences.map((difference, index) => (
                <li key={index}>{difference}</li>
              ))}
            </ul>
          )}
          <div className="mt-1.5 opacity-80">{replay.note}</div>
        </section>
      )}
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
    <div className="text-slate-400 text-[11px]">{label}</div>
    <div className="text-xl font-bold font-mono text-white mt-0.5">{value}</div>
    <div className="text-[10px] text-slate-500 mt-1 leading-snug">{hint}</div>
  </div>
);

/** « Pourquoi ce montant » : composition du coût par nature, avec la qualité associée. */
const WhyThisAmount: React.FC<{
  perOffer: DecisionRunResult['results']['perOffer'];
  formatMoney: Intl.NumberFormat;
}> = ({ perOffer, formatMoney }) => {
  const [openOffer, setOpenOffer] = useState<string | null>(null);

  return (
    <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
        <TrendingDown className="w-4 h-4 text-emerald-400" />
        <div>
          <div className="text-sm font-bold text-white">Pourquoi ce montant ?</div>
          <div className="text-[11px] text-slate-400">
            Décomposition du coût complet par nature, avec le statut de qualité de chaque poste.
          </div>
        </div>
      </header>
      <div className="divide-y divide-slate-800">
        {perOffer.map((offer) => {
          const isOpen = openOffer === offer.offerId;
          return (
            <div key={offer.offerId}>
              <button
                onClick={() => setOpenOffer(isOpen ? null : offer.offerId)}
                className="w-full px-4 py-3 flex items-center justify-between text-xs hover:bg-slate-950/40"
              >
                <span className="font-semibold text-white">
                  {offer.offerReference} — {offer.supplierName}
                </span>
                <span className="flex items-center gap-3 font-mono text-slate-300">
                  <span>{formatMoney.format(offer.totalComprehensiveTCO)}</span>
                  <span className="text-slate-500">{(offer.monthlyEquivalentCost ? formatMoney.format(offer.monthlyEquivalentCost) : '—') + ' / mois'}</span>
                  <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                </span>
              </button>
              {isOpen && (
                <div className="px-4 pb-3 space-y-2">
                  <table className="w-full text-[11px]">
                    <thead className="text-slate-400">
                      <tr>
                        <th className="text-left py-1 font-semibold">Nature du coût</th>
                        <th className="text-right py-1 font-semibold">Montant</th>
                        <th className="text-right py-1 font-semibold">Part</th>
                        <th className="text-left py-1 pl-3 font-semibold">Qualité de la donnée</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {offer.breakdown.map((line) => (
                        <tr key={line.category}>
                          <td className="py-1 text-slate-300">{line.category}</td>
                          <td className="py-1 text-right font-mono text-slate-200">{formatMoney.format(line.amount)}</td>
                          <td className="py-1 text-right font-mono text-slate-400">
                            {numberFormatter.format(line.share * 100)} %
                          </td>
                          <td className="py-1 pl-3 text-slate-400">{line.quality}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {offer.warnings.length > 0 && (
                    <ul className="text-[11px] text-amber-200/90 list-disc pl-4 space-y-0.5">
                      {offer.warnings.map((warning, index) => (
                        <li key={index}>{warning.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="px-4 py-2.5 border-t border-slate-800 text-[11px] text-slate-500 flex items-start gap-2">
        <HelpCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Les montants proviennent exclusivement des données du dossier. Un poste non renseigné n'est jamais compté zéro :
          il est exclu et signalé.
        </span>
      </div>
    </section>
  );
};
