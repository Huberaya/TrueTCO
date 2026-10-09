import React, { useMemo, useState } from 'react';
import { AlertTriangle, Calculator, Database, FileCheck2 } from 'lucide-react';
import { Project, SupplierOffer } from '../types/domain';
import { DecisionRunResult } from '../services/serverData';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';

interface Chantier1ViewProps {
  project: Project;
  offers: SupplierOffer[];
  decisionRun: DecisionRunResult | null;
}

const money = (value: number, currency: string) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);

/** Vue technique de la sortie persistée : aucune exécution du moteur côté navigateur. */
export const Chantier1View: React.FC<Chantier1ViewProps> = ({ project, offers, decisionRun }) => {
  const availableOffers = useMemo(() => offers.filter((offer) => decisionRun?.calculationsByOfferId[offer.id]), [offers, decisionRun]);
  const [selectedOfferId, setSelectedOfferId] = useState('');
  const activeOffer = availableOffers.find((offer) => offer.id === selectedOfferId) ?? availableOffers[0];
  const calculation = activeOffer && decisionRun ? decisionRun.calculationsByOfferId[activeOffer.id] : undefined;
  const [tab, setTab] = useState<'flux' | 'traces' | 'tests'>('flux');

  if (!decisionRun || !calculation) return <ServerCalculationEmptyState title="Aucune sortie moteur serveur à inspecter" />;

  return (
    <div className="space-y-6">
      <header className="border-b border-slate-800 pb-4"><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400"><Calculator className="h-4 w-4" /> Résultat d'exécution serveur</div><h2 className="text-2xl font-bold tracking-tight text-white">Traçabilité du calcul du dossier</h2><p className="mt-1 max-w-3xl text-xs text-slate-400">Cette vue inspecte le résultat conservé par l'API. Le moteur n'est pas appelé par le navigateur.</p></header>

      <section className="grid grid-cols-1 gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4"><Meta label="Identifiant d'exécution" value={decisionRun.runId} /><Meta label="Version moteur / méthode" value={`${decisionRun.engineVersion} / ${decisionRun.methodologyVersion}`} /><Meta label="Révision des entrées" value={String(decisionRun.inputVersion)} /><Meta label="Empreinte d'entrée" value={decisionRun.inputFingerprint} /></section>

      <div className="flex flex-wrap items-center gap-2"><label htmlFor="server-calculation-offer" className="text-xs text-slate-400">Offre :</label><select id="server-calculation-offer" value={activeOffer.id} onChange={(event) => setSelectedOfferId(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white">{availableOffers.map((offer) => <option key={offer.id} value={offer.id}>{offer.offerReference} — {offer.supplierName}</option>)}</select><span className="text-[11px] text-slate-500">{project.horizonYears} ans · hypothèses du dossier lors du calcul</span></div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric label="TCO complet nominal" value={money(calculation.totalComprehensiveTCO, project.currency)} /><Metric label="LCC actualisé" value={money(calculation.lifecycleCostLCC, project.currency)} /><Metric label="Carbone" value={`${calculation.totalLifecycleCO2eTonnes.toLocaleString('fr-FR')} tCO2e`} /><Metric label="Exposition risque" value={money(calculation.riskExpositionTotal, project.currency)} /><Metric label="Qualité de données" value={`${calculation.dataQualityScore}/100`} /></div>

      <div className="flex gap-2 border-b border-slate-800"><Tab selected={tab === 'flux'} onClick={() => setTab('flux')}>Flux annuels</Tab><Tab selected={tab === 'traces'} onClick={() => setTab('traces')}>Postes & sources</Tab><Tab selected={tab === 'tests'} onClick={() => setTab('tests')}>Tests</Tab></div>

      {tab === 'flux' && <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900"><table className="w-full text-xs"><thead className="bg-slate-950 text-slate-400"><tr><th className="px-3 py-2 text-left">Année</th><th className="px-3 py-2 text-right">Flux nominal</th><th className="px-3 py-2 text-right">Facteur d'actualisation</th><th className="px-3 py-2 text-right">Flux actualisé</th><th className="px-3 py-2 text-right">Cumul actualisé</th><th className="px-3 py-2 text-right">Émissions</th></tr></thead><tbody className="divide-y divide-slate-800">{calculation.cashFlowsByYear.map((flow) => <tr key={flow.year}><td className="px-3 py-2 text-slate-300">Année {flow.year}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{money(flow.nominalCost, project.currency)}</td><td className="px-3 py-2 text-right font-mono text-slate-400">{flow.discountFactor.toLocaleString('fr-FR')}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{money(flow.discountedCost, project.currency)}</td><td className="px-3 py-2 text-right font-mono text-white">{money(flow.cumulativeDiscountedCost, project.currency)}</td><td className="px-3 py-2 text-right font-mono text-sky-300">{flow.carbonEmissionsTonnes.toLocaleString('fr-FR')} t</td></tr>)}</tbody></table></section>}

      {tab === 'traces' && <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900"><table className="w-full text-xs"><thead className="bg-slate-950 text-slate-400"><tr><th className="px-3 py-2 text-left">Poste</th><th className="px-3 py-2 text-left">Catégorie</th><th className="px-3 py-2 text-right">Nominal</th><th className="px-3 py-2 text-right">Actualisé</th><th className="px-3 py-2 text-left">Années</th><th className="px-3 py-2 text-right">Occurrences/an</th><th className="px-3 py-2 text-left">Source enregistrée</th><th className="px-3 py-2 text-right">Niveau déclaré</th></tr></thead><tbody className="divide-y divide-slate-800">{(calculation.costLineTrace ?? []).map((line) => <tr key={line.id}><td className="px-3 py-2 text-white">{line.label}{line.isCredit ? ' · crédit' : ''}</td><td className="px-3 py-2 text-slate-400">{line.category}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{money(line.amountNominal, project.currency)}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{money(line.amountDiscounted, project.currency)}</td><td className="px-3 py-2 text-slate-400">{line.occurrences.length ? line.occurrences.join(', ') : '—'}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{line.occurrencesPerYear ?? '—'}</td><td className="px-3 py-2 text-slate-400">{line.sourceName} · {line.sourceType}</td><td className="px-3 py-2 text-right font-mono text-slate-300">{line.confidenceLevel}%</td></tr>)}</tbody></table>{(!calculation.costLineTrace || calculation.costLineTrace.length === 0) && <p className="p-4 text-xs text-slate-400">Aucune trace par poste n'est présente dans ce résultat.</p>}</section>}

      {tab === 'tests' && <section className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900 p-5"><FileCheck2 className="mt-0.5 h-5 w-5 text-sky-400" /><div><h3 className="text-sm font-bold text-white">Les tests ne s'exécutent pas dans le navigateur</h3><p className="mt-1 text-xs leading-relaxed text-slate-400">Les tests unitaires et API du moteur sont exécutés dans la suite Vitest / CI du dépôt. Cette page n'affiche pas de résultat de test local simulé. Consultez <code>TESTING.md</code> pour les commandes et le périmètre vérifié.</p></div></section>}

      {calculation.warnings && calculation.warnings.length > 0 && <section className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4 text-xs text-amber-100"><div className="mb-2 flex items-center gap-2 font-bold"><AlertTriangle className="h-4 w-4" /> Avertissements du calcul serveur</div><ul className="list-disc space-y-1 pl-4">{calculation.warnings.map((warning) => <li key={warning.code}>{warning.message}</li>)}</ul></section>}
      <div className="flex items-start gap-2 text-[10px] text-slate-500"><Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />Les libellés de source reflètent les entrées enregistrées et ne constituent pas, à eux seuls, une vérification par un tiers.</div>
    </div>
  );
};

const Meta: React.FC<{label:string;value:string}> = ({label,value}) => <div className="min-w-0"><div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 break-all font-mono text-[10px] text-slate-300">{value}</div></div>;
const Metric: React.FC<{label:string;value:string}> = ({label,value}) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-[10px] text-slate-400">{label}</div><div className="mt-1 font-mono text-base font-bold text-white">{value}</div></div>;
const Tab: React.FC<React.PropsWithChildren<{selected:boolean;onClick:()=>void}>> = ({selected,onClick,children}) => <button onClick={onClick} className={`border-b-2 px-3 py-2 text-xs ${selected ? 'border-emerald-500 text-white' : 'border-transparent text-slate-400 hover:text-white'}`}>{children}</button>;
