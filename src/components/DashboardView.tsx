import React from 'react';
import { ArrowRight, BarChart3, ClipboardList, Info, Scale } from 'lucide-react';
import { Project, SupplierOffer } from '../types/domain';
import { DecisionRunResult } from '../services/serverData';
import { NavView } from './Sidebar';
import { ServerCalculationEmptyState } from './ServerCalculationEmptyState';

interface DashboardViewProps {
  project: Project;
  projects: Project[];
  offers: SupplierOffer[];
  decisionRun: DecisionRunResult | null;
  onNavigate: (view: NavView) => void;
  onSelectProject: (project: Project) => void;
}

const money = (value: number, currency: string) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
const STATUS: Record<string, string> = { ferme: 'Recommandation proposée — à approuver', conditionnel: 'Résultat conditionnel — validation requise', indetermine: 'Aucune recommandation ferme' };

/** Le tableau de bord ne calcule rien : il expose les résultats serveur du dossier actif. */
export const DashboardView: React.FC<DashboardViewProps> = ({ project, projects, offers, decisionRun, onNavigate, onSelectProject }) => {
  const projectOffers = offers.filter((offer) => offer.projectId === project.id);
  const recommended = decisionRun?.recommendation.status === 'indetermine'
    ? undefined
    : decisionRun?.ranking.find((entry) => entry.offerId === decisionRun.recommendation.offerId);
  const recommendedCalc = recommended ? decisionRun?.calculationsByOfferId[recommended.offerId] : undefined;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
        <div><div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-400"><BarChart3 className="h-4 w-4" /> Tableau de bord dossier</div><h2 className="text-2xl font-bold tracking-tight text-white">{project.name}</h2><p className="mt-1 text-xs text-slate-400">{project.reference} · {projectOffers.length} offre(s) chargée(s) · {projects.length} dossier(s) visibles dans la session.</p></div>
        <div className="flex flex-wrap gap-2"><button onClick={() => onNavigate('decision')} className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500">Décision serveur <ArrowRight className="h-3.5 w-3.5" /></button><button onClick={() => onNavigate('approvals')} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-700"><ClipboardList className="h-3.5 w-3.5" /> Approbations</button></div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label="Budget plafond saisi" value={money(project.budgetCap, project.currency)} note="Hypothèse du dossier ; pas un montant calculé." />
        <Summary label="Volume prévu" value={`${project.plannedVolume.toLocaleString('fr-FR')} ${project.unitName}`} note={`Horizon de dossier : ${project.horizonYears} ans.`} />
        <Summary label="Offres chargées" value={String(projectOffers.length)} note="Offres visibles pour le dossier sélectionné." />
        <Summary label="Dernière révision calculée" value={decisionRun ? `v${decisionRun.inputVersion}` : '—'} note={decisionRun ? `Moteur ${decisionRun.engineVersion} · ${new Date(decisionRun.createdAt).toLocaleString('fr-FR')}` : 'Aucun calcul serveur exploitable.'} />
      </div>

      {decisionRun ? (
        <>
          <section className={`rounded-2xl border p-5 ${decisionRun.recommendation.status === 'ferme' ? 'border-emerald-800/60 bg-emerald-950/25' : decisionRun.recommendation.status === 'conditionnel' ? 'border-amber-800/60 bg-amber-950/25' : 'border-rose-800/60 bg-rose-950/25'}`}>
            <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><div className="text-xs font-semibold uppercase tracking-wider text-slate-300">{STATUS[decisionRun.recommendation.status]}</div><h3 className="mt-1 text-lg font-bold text-white">{recommended?.supplierName ?? (decisionRun.recommendation.status === 'indetermine' ? 'Classement sans option recommandée' : 'Option proposée absente des résultats détaillés')}</h3><p className="mt-2 text-xs leading-relaxed text-slate-300">{decisionRun.recommendation.reason}</p></div>{recommended && recommendedCalc && <div className="grid grid-cols-2 gap-2 text-right sm:grid-cols-3"><SmallMetric label="TCO nominal" value={money(recommended.totalComprehensiveTCO, project.currency)} /><SmallMetric label="VAN LCC" value={money(recommended.lifecycleCostLCC, project.currency)} /><SmallMetric label="Carbone" value={`${recommended.carbonTonnes.toLocaleString('fr-FR')} tCO2e`} /></div>}</div>
            <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => onNavigate('comparator')} className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">Voir la décomposition</button><button onClick={() => onNavigate('sensitivity')} className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">Voir la sensibilité</button><button onClick={() => onNavigate('report')} className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">Ouvrir le rapport</button></div>
          </section>
          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3"><h3 className="text-sm font-bold text-white">Classement issu de l'exécution serveur</h3><span className="text-[10px] text-slate-500">VAN du coût complet croissante</span></header>
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-900 text-slate-400"><tr><th className="px-4 py-2 text-left">Rang</th><th className="px-4 py-2 text-left">Fournisseur</th><th className="px-4 py-2 text-right">TCO</th><th className="px-4 py-2 text-right">VAN</th><th className="px-4 py-2 text-right">Risque</th><th className="px-4 py-2 text-right">Qualité donnée</th></tr></thead><tbody className="divide-y divide-slate-800">{decisionRun.ranking.map((entry, index) => <tr key={entry.offerId} className={index === 0 ? 'bg-emerald-950/20' : ''}><td className="px-4 py-2 font-mono text-slate-400">{index + 1}</td><td className="px-4 py-2 font-semibold text-white">{entry.supplierName}<span className="ml-2 font-mono text-[10px] font-normal text-slate-500">{entry.offerReference}</span></td><td className="px-4 py-2 text-right font-mono text-slate-300">{money(entry.totalComprehensiveTCO, project.currency)}</td><td className="px-4 py-2 text-right font-mono text-white">{money(entry.lifecycleCostLCC, project.currency)}</td><td className="px-4 py-2 text-right font-mono text-amber-300">{money(entry.riskExposure, project.currency)}</td><td className="px-4 py-2 text-right font-mono text-slate-300">{entry.dataQualityScore}/100</td></tr>)}</tbody></table></div>
          </section>
          {decisionRun.warnings.length > 0 && <section className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-4 text-xs text-amber-100"><div className="mb-2 flex items-center gap-2 font-bold"><Info className="h-4 w-4" /> Points à vérifier</div><ul className="list-disc space-y-1 pl-4">{decisionRun.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></section>}
        </>
      ) : <ServerCalculationEmptyState />}

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-bold text-white"><Scale className="h-4 w-4 text-slate-400" /> Dossiers de la session</div><div className="grid grid-cols-1 gap-2 md:grid-cols-2">{projects.map((item) => <button key={item.id} onClick={() => onSelectProject(item)} className={`rounded-lg border p-3 text-left ${item.id === project.id ? 'border-emerald-700/60 bg-emerald-950/20' : 'border-slate-800 bg-slate-950 hover:border-slate-700'}`}><div className="font-semibold text-white">{item.name}</div><div className="mt-1 text-[11px] text-slate-400">{item.reference} · {item.status.replace(/_/g, ' ')}</div></button>)}</div></section>
    </div>
  );
};

const Summary: React.FC<{label:string;value:string;note:string}> = ({label,value,note}) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div><div className="mt-1 truncate font-mono text-lg font-bold text-white">{value}</div><div className="mt-1 text-[10px] text-slate-500">{note}</div></div>;
const SmallMetric: React.FC<{label:string;value:string}> = ({label,value}) => <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"><div className="text-[10px] text-slate-500">{label}</div><div className="mt-0.5 font-mono text-xs font-bold text-white">{value}</div></div>;
