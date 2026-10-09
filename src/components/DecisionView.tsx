/**
 * Écran DÉCISION — résultat complet d'une exécution persistée par l'API.
 * Aucun calcul financier n'est lancé dans le navigateur.
 */
import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock,
  Gauge,
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
import { TCOCalculationResult } from '../types/domain';

interface DecisionViewProps {
  projectId: string | null;
  projectName: string;
  currency: string;
  horizonYears: number;
  discountRate: number;
  canRunDecision: boolean;
  initialRun?: DecisionRunResult | null;
  onRunCompleted?: (run: DecisionRunResult) => void;
}

const currencyFormatter = (currency: string) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 });
const numberFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  ferme: { label: 'Recommandation conditionnellement ferme', className: 'border-emerald-800 bg-emerald-950 text-emerald-200', icon: <CheckCircle2 className="h-4 w-4" /> },
  conditionnel: { label: 'Recommandation conditionnelle', className: 'border-amber-800 bg-amber-950 text-amber-200', icon: <AlertTriangle className="h-4 w-4" /> },
  indetermine: { label: 'Aucune recommandation ferme', className: 'border-rose-800 bg-rose-950 text-rose-200', icon: <ShieldAlert className="h-4 w-4" /> },
};

export const DecisionView: React.FC<DecisionViewProps> = ({
  projectId,
  projectName,
  currency,
  horizonYears,
  discountRate,
  canRunDecision,
  initialRun = null,
  onRunCompleted,
}) => {
  const [result, setResult] = useState<DecisionRunResult | null>(initialRun);
  const [history, setHistory] = useState<DecisionRunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<DecisionRunDetail | null>(null);
  const [replay, setReplay] = useState<{ identical: boolean; differences: string[]; note: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formatMoney = currencyFormatter(currency);

  useEffect(() => {
    setResult(initialRun);
  }, [projectId, initialRun]);

  const loadHistory = async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      setHistory(await fetchDecisionRuns(projectId));
    } catch (caught) {
      setError(caught instanceof ApiError ? `${caught.message} (${caught.code})` : "L'historique n'a pas pu être lu.");
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!projectId || !canRunDecision) return;
    setBusy(true);
    setError(null);
    try {
      const response = await runDecisionOnServer(projectId);
      setResult(response);
      setSelectedRun(null);
      setReplay(null);
      onRunCompleted?.(response);
      setHistory(await fetchDecisionRuns(projectId));
    } catch (caught) {
      setError(caught instanceof ApiError ? `${caught.message} (${caught.code})` : 'Le calcul serveur a échoué.');
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
      setError(caught instanceof ApiError ? `${caught.message} (${caught.code})` : "L'exécution n'a pas pu être chargée.");
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
      setError(caught instanceof ApiError ? `${caught.message} (${caught.code})` : 'Le rejeu serveur a échoué.');
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) {
    return <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300">Sélectionnez un dossier pour consulter ou exécuter une décision serveur.</div>;
  }

  const recommendedOfferId = result?.recommendation.status === 'indetermine' ? null : result?.recommendation.offerId ?? null;
  const status = result ? STATUS_LABEL[result.recommendation.status] : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400"><Scale className="h-4 w-4" /> Décision d'arbitrage</div>
          <h2 className="text-2xl font-bold tracking-tight text-white">Quelle option est préférable, et pourquoi ?</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">Dossier « {projectName} ». Le classement ci-dessous provient d'une exécution sauvegardée par l'API ; aucun montant n'est calculé par cette page.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void run()} disabled={busy || !canRunDecision} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50" title={canRunDecision ? 'Calculer et enregistrer une décision côté serveur' : "Votre rôle ne permet pas de lancer une décision"}>
            {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {busy ? 'Calcul en cours…' : 'Calculer la décision'}
          </button>
          <button onClick={() => void loadHistory()} disabled={busy} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50">
            <History className="h-3.5 w-3.5 text-emerald-400" /> Historique
          </button>
        </div>
      </div>

      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-800 bg-rose-950/60 p-3.5 text-xs text-rose-200"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span></div>}
      {!canRunDecision && <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 text-[11px] text-slate-400">Votre rôle peut consulter les décisions, mais ne peut pas lancer un nouveau calcul. L'API applique elle-même cette permission.</div>}

      {result && status && (
        <>
          <div className={`flex items-start gap-3 rounded-xl border p-4 ${status.className}`}>
            <div className="mt-0.5">{status.icon}</div>
            <div className="space-y-1.5">
              <div className="text-sm font-bold">{status.label}</div>
              <p className="text-xs leading-relaxed">{result.recommendation.reason}</p>
              {result.recommendation.supplierName && <div className="text-xs">Option classée première : <strong>{result.recommendation.supplierName}</strong>{result.recommendation.status === 'indetermine' ? ' — ce classement ne constitue pas une recommandation ferme.' : ''}</div>}
              <div className="text-[11px] opacity-80">Moteur {result.engineVersion} · méthodologie {result.methodologyVersion} · révision {result.inputVersion} · exécuté le {new Date(result.createdAt).toLocaleString('fr-FR')} · empreinte {result.inputFingerprint.slice(0, 16)}…</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <MetricCard label="Postes de coût" value={String(result.dataCompleteness.totalCostItems)} hint={`${result.dataCompleteness.byQualityStatus.valid ?? 0} valides ; les statuts restent distincts.`} />
            <MetricCard label="Postes non sourcés" value={String(result.dataCompleteness.byQualityStatus.unsourced ?? 0)} hint="Conservés au calcul avec qualité de source explicitement signalée." />
            <MetricCard label="Écart avec la 2ᵉ offre (VAN)" value={result.recommendation.economicAdvantage ? formatMoney.format(result.recommendation.economicAdvantage.vsSecondBestNpv) : '—'} hint="Valeur renvoyée par le moteur serveur." />
            <MetricCard label="Écart face au prix facial le plus bas (VAN)" value={result.recommendation.economicAdvantage ? formatMoney.format(result.recommendation.economicAdvantage.vsCheapestApparentNpv) : '—'} hint="Écart de VAN, pas une économie comptable constatée." />
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div className="text-sm font-bold text-white">Classement serveur sur la VAN du coût complet</div>
              <div className="text-[11px] text-slate-400">Horizon {horizonYears} ans · taux d'actualisation saisi {(discountRate * 100).toFixed(2)} %</div>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-950/60 text-slate-400"><tr>
                  <th className="px-3 py-2 text-left font-semibold">#</th><th className="px-3 py-2 text-left font-semibold">Offre</th>
                  <th className="px-3 py-2 text-right font-semibold">Prix facial</th><th className="px-3 py-2 text-right font-semibold">TCO nominal</th>
                  <th className="px-3 py-2 text-right font-semibold">VAN LCC</th><th className="px-3 py-2 text-right font-semibold">Carbone</th>
                  <th className="px-3 py-2 text-right font-semibold">Qualité des données</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-800">
                  {result.ranking.map((entry, index) => {
                    const calc = result.calculationsByOfferId[entry.offerId];
                    return <tr key={entry.offerId} className={entry.offerId === recommendedOfferId ? 'bg-emerald-950/30' : ''}>
                      <td className="px-3 py-2 font-mono text-slate-400">{index + 1}</td>
                      <td className="px-3 py-2"><div className="font-semibold text-white">{entry.offerReference}</div><div className="text-[11px] text-slate-400">{entry.supplierName}{entry.isResponsibleCandidate && <span className="ml-2 rounded border border-emerald-800 bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-300">candidat responsable (saisi)</span>}</div></td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{calc ? formatMoney.format(calc.apparentDirectCost) : '—'}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{formatMoney.format(entry.totalComprehensiveTCO)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-white">{formatMoney.format(entry.lifecycleCostLCC)}</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{numberFormatter.format(entry.carbonTonnes)} tCO2e</td>
                      <td className="px-3 py-2 text-right font-mono text-slate-300">{entry.dataQualityScore}/100</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <WhyThisAmount ranking={result.ranking} calculations={result.calculationsByOfferId} formatMoney={formatMoney} />

          {result.decisionReversal && (
            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3"><ArrowLeftRight className="h-4 w-4 text-emerald-400" /><div><div className="text-sm font-bold text-white">Quand la décision change-t-elle ?</div><div className="text-[11px] text-slate-400">Vainqueur : {result.decisionReversal.winnerSupplierName} · challenger : {result.decisionReversal.challengerSupplierName} · delta = VAN challenger − VAN vainqueur ({formatMoney.format(result.decisionReversal.baseDelta)}).</div></div></header>
              <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-950/60 text-slate-400"><tr><th className="px-3 py-2 text-left">Hypothèse</th><th className="px-3 py-2 text-right">Valeur dossier</th><th className="px-3 py-2 text-right">Plage explorée</th><th className="px-3 py-2 text-left">Seuil d'inversion</th><th className="px-3 py-2 text-left">Lecture du moteur</th></tr></thead><tbody className="divide-y divide-slate-800">{result.decisionReversal.parameters.map((parameter) => <tr key={parameter.parameter}><td className="px-3 py-2 font-semibold text-white">{parameter.label}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{numberFormatter.format(parameter.currentValue)} {parameter.unit}</td><td className="px-3 py-2 text-right font-mono text-slate-400">{numberFormatter.format(parameter.exploredRange.min)} → {numberFormatter.format(parameter.exploredRange.max)} {parameter.unit}</td><td className="px-3 py-2 font-mono">{parameter.isReachable && parameter.nearestThreshold !== null ? <span className="text-amber-300">{numberFormatter.format(parameter.nearestThreshold)} {parameter.unit}</span> : <span className="text-slate-500">aucun seuil détecté sur la plage explorée</span>}</td><td className="px-3 py-2 text-slate-300">{parameter.statement}</td></tr>)}</tbody></table></div>
              <div className="border-t border-slate-800 px-4 py-2.5 text-[11px] text-slate-400">{result.decisionReversal.signConvention} · méthode : {result.decisionReversal.method}</div>
            </section>
          )}

          {result.sensitivity.length > 0 && <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="mb-3 text-sm font-bold text-white">Sensibilité des hypothèses (calcul serveur)</div><div className="space-y-2">{result.sensitivity.map((driver) => <div key={driver.parameterName} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-800 pb-2 text-xs"><strong className="text-white">{driver.parameterName}</strong><span className="font-mono text-slate-300">{driver.lowValueImpactOnDeltaTCO.toLocaleString('fr-FR')} € → {driver.highValueImpactOnDeltaTCO.toLocaleString('fr-FR')} €</span><span className="text-slate-400">{driver.explanation}</span></div>)}</div></section>}

          {result.warnings.length > 0 && <section className="rounded-xl border border-amber-900 bg-amber-950/40 p-4"><div className="mb-2 flex items-center gap-2 text-sm font-bold text-amber-200"><AlertTriangle className="h-4 w-4" /> Points d'attention sur les données et le calcul</div><ul className="list-disc space-y-1 pl-4 text-[11px] text-amber-100/90">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></section>}
        </>
      )}

      {history.length > 0 && <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3"><Clock className="h-4 w-4 text-emerald-400" /><div className="text-sm font-bold text-white">Exécutions enregistrées</div></header><div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-950/60 text-slate-400"><tr><th className="px-3 py-2 text-left">Date</th><th className="px-3 py-2 text-right">Révision</th><th className="px-3 py-2 text-left">Moteur</th><th className="px-3 py-2 text-left">Empreinte</th><th className="px-3 py-2 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-800">{history.map((entry) => <tr key={entry.id}><td className="px-3 py-2 text-slate-300">{new Date(entry.created_at).toLocaleString('fr-FR')}</td><td className="px-3 py-2 text-right font-mono text-slate-300">v{entry.input_version}</td><td className="px-3 py-2 font-mono text-slate-400">{entry.engine_version}</td><td className="px-3 py-2 font-mono text-[10px] text-slate-500">{entry.input_fingerprint ? `${entry.input_fingerprint.slice(0, 16)}…` : '—'}</td><td className="space-x-2 px-3 py-2 text-right"><button onClick={() => void openRun(entry.id)} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-white hover:bg-slate-700">Consulter</button><button onClick={() => void doReplay(entry.id)} disabled={!canRunDecision} className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-white hover:bg-slate-700 disabled:opacity-50" title="Recalculer le snapshot enregistré côté serveur et comparer">Rejouer</button></td></tr>)}</tbody></table></div></section>}

      {selectedRun && <section className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs"><div className="text-sm font-bold text-white">Exécution du {new Date(selectedRun.created_at).toLocaleString('fr-FR')}</div><div className="text-slate-300">{selectedRun.freshness.explanation}</div><div className="break-all font-mono text-[10px] text-slate-500">Empreinte enregistrée : {selectedRun.freshness.storedFingerprint}</div>{selectedRun.freshness.currentFingerprint && <div className="break-all font-mono text-[10px] text-slate-500">Empreinte actuelle : {selectedRun.freshness.currentFingerprint}</div>}</section>}

      {replay && <section className={`rounded-xl border p-4 text-xs ${replay.identical ? 'border-emerald-900 bg-emerald-950/40 text-emerald-100' : 'border-rose-900 bg-rose-950/40 text-rose-100'}`}><div className="flex items-center gap-2 font-bold">{replay.identical ? <CheckCircle2 className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}{replay.identical ? 'Rejeu identique : le snapshot serveur est reproductible.' : 'Le rejeu diffère du résultat enregistré.'}</div>{replay.differences.length > 0 && <ul className="mt-1.5 list-disc space-y-0.5 pl-4">{replay.differences.map((difference, index) => <li key={index}>{difference}</li>)}</ul>}<div className="mt-1.5 opacity-80">{replay.note}</div></section>}
      {!result && <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs text-slate-400"><Info className="mr-2 inline h-4 w-4 text-emerald-400" />Aucun résultat n'est actuellement chargé. Lancez une exécution autorisée pour créer un calcul serveur enregistré ; une erreur ne sera jamais remplacée par un résultat local.</div>}
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-3.5"><div className="text-[11px] text-slate-400">{label}</div><div className="mt-0.5 font-mono text-xl font-bold text-white">{value}</div><div className="mt-1 text-[10px] leading-snug text-slate-500">{hint}</div></div>;

/** Trace provenant du résultat enregistré : aucun texte de source n'est recréé dans le client. */
const WhyThisAmount: React.FC<{
  ranking: DecisionRunResult['ranking'];
  calculations: Record<string, TCOCalculationResult>;
  formatMoney: Intl.NumberFormat;
}> = ({ ranking, calculations, formatMoney }) => {
  const [openOffer, setOpenOffer] = useState<string | null>(null);
  return <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3"><TrendingDown className="h-4 w-4 text-emerald-400" /><div><div className="text-sm font-bold text-white">Pourquoi ce montant ?</div><div className="text-[11px] text-slate-400">Traçabilité par poste telle que renvoyée avec le calcul serveur.</div></div></header><div className="divide-y divide-slate-800">{ranking.map((offer) => {
    const calculation = calculations[offer.offerId];
    const lines = calculation?.costLineTrace ?? [];
    const isOpen = openOffer === offer.offerId;
    return <div key={offer.offerId}><button onClick={() => setOpenOffer(isOpen ? null : offer.offerId)} className="flex w-full items-center justify-between px-4 py-3 text-left text-xs hover:bg-slate-950/40"><span className="font-semibold text-white">{offer.offerReference} — {offer.supplierName}</span><span className="flex items-center gap-3 font-mono text-slate-300"><span>{formatMoney.format(offer.totalComprehensiveTCO)}</span><Gauge className="h-3.5 w-3.5 text-emerald-400" /></span></button>{isOpen && <div className="overflow-x-auto px-4 pb-3"><table className="w-full text-[11px]"><thead className="text-slate-400"><tr><th className="py-1 text-left">Poste / catégorie</th><th className="py-1 text-right">Nominal</th><th className="py-1 text-right">Actualisé</th><th className="py-1 text-left">Source déclarée</th><th className="py-1 text-right">Qualité source</th></tr></thead><tbody className="divide-y divide-slate-800">{lines.map((line) => <tr key={line.id}><td className="py-1.5 text-slate-200">{line.label}<span className="ml-1 text-slate-500">({line.category}){line.isCredit ? ' · crédit' : ''}</span></td><td className="py-1.5 text-right font-mono text-slate-300">{formatMoney.format(line.amountNominal)}</td><td className="py-1.5 text-right font-mono text-slate-300">{formatMoney.format(line.amountDiscounted)}</td><td className="py-1.5 text-slate-400">{line.sourceName} · {line.sourceType}</td><td className="py-1.5 text-right font-mono text-slate-300">{line.confidenceLevel}%</td></tr>)}{lines.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-500">Aucune trace détaillée n'est présente dans cette exécution.</td></tr>}</tbody></table></div>}</div>;
  })}</div></section>;
};
