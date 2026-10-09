import React from 'react';
import { Calendar, ExternalLink, X } from 'lucide-react';
import { CostLineTrace, DataSourceType } from '../types/domain';

export interface CalculationTraceRow {
  supplierName: string;
  offerReference: string;
  amount: number | null;
  source?: {
    value: number;
    unit: string;
    sourceType: DataSourceType | string;
    sourceName: string;
    sourceUrl?: string;
    confidenceLevel: number;
    lastUpdated?: string;
  };
  lines: CostLineTrace[];
}

interface WhyThisAmountModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  categoryLabel: string;
  runId: string;
  engineVersion: string;
  methodologyVersion: string;
  rows: CalculationTraceRow[];
  methodology?: Record<string, string>;
}

/**
 * Présente le résultat persisté et ses métadonnées réelles. Aucune source,
 * formule, date ou note de confiance n'est fabriquée par ce composant.
 */
export const WhyThisAmountModal: React.FC<WhyThisAmountModalProps> = ({
  isOpen,
  onClose,
  title,
  categoryLabel,
  runId,
  engineVersion,
  methodologyVersion,
  rows,
  methodology = {},
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="why-amount-title">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Détail du résultat serveur · {categoryLabel}</div>
            <h3 id="why-amount-title" className="text-xl font-bold text-white">Pourquoi ce montant ?</h3>
            <p className="mt-0.5 text-sm text-slate-400">{title}</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 py-5 text-sm text-slate-300">
          <p className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
            Résultat issu de l’exécution persistée <span className="font-mono text-slate-300">{runId}</span> · moteur {engineVersion} · méthode {methodologyVersion}. Les noms de source et niveaux de confiance ci-dessous sont les valeurs déclarées dans les entrées ; leur présence ne constitue pas une vérification indépendante.
          </p>

          <section className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Montants par offre</h4>
            {rows.map((row) => (
              <article key={`${row.offerReference}-${row.supplierName}`} className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="font-semibold text-white">{row.supplierName}</div>
                    <div className="font-mono text-[11px] text-slate-500">{row.offerReference}</div>
                  </div>
                  <div className="font-mono text-lg font-bold tabular-nums text-white">{row.amount === null ? 'Non disponible dans cette exécution' : `${row.amount.toLocaleString('fr-FR')} €`}</div>
                </div>

                {row.source && (
                  <div className="mt-3 grid gap-1 border-t border-slate-800 pt-3 text-xs sm:grid-cols-2">
                    <div><span className="text-slate-500">Source déclarée :</span> {row.source.sourceName || 'Non renseignée'}</div>
                    <div><span className="text-slate-500">Type saisi :</span> {row.source.sourceType || 'Non renseigné'}</div>
                    <div><span className="text-slate-500">Valeur source :</span> {row.source.value.toLocaleString('fr-FR')} {row.source.unit}</div>
                    <div><span className="text-slate-500">Niveau déclaré :</span> {row.source.confidenceLevel}%</div>
                    {row.source.lastUpdated && <div className="flex items-center gap-1 text-slate-500"><Calendar className="h-3 w-3" /> Date déclarée : {row.source.lastUpdated}</div>}
                    {row.source.sourceUrl && <a href={row.source.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sky-400 hover:underline">Source liée <ExternalLink className="h-3 w-3" /></a>}
                  </div>
                )}

                {row.lines.length > 0 ? (
                  <div className="mt-3 overflow-x-auto border-t border-slate-800 pt-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Traces de postes incluses dans cette sortie</div>
                    <table className="w-full text-[11px]">
                      <thead className="text-slate-500"><tr><th className="py-1 text-left">Poste / catégorie</th><th className="py-1 text-right">Nominal</th><th className="py-1 text-right">Actualisé</th><th className="py-1 text-left">Années / occurrences par an / indexation</th><th className="py-1 text-left">Source déclarée / niveau</th></tr></thead>
                      <tbody className="divide-y divide-slate-800">
                        {row.lines.map((line) => (
                          <tr key={line.id}>
                            <td className="py-1.5 pr-2 text-slate-200">{line.label}<span className="ml-1 text-slate-500">({line.category}){line.isCredit ? ' · crédit' : ''}</span></td>
                            <td className="py-1.5 text-right font-mono text-slate-300">{line.amountNominal.toLocaleString('fr-FR')} €</td>
                            <td className="py-1.5 text-right font-mono text-slate-300">{line.amountDiscounted.toLocaleString('fr-FR')} €</td>
                            <td className="py-1.5 px-2 text-slate-400">{line.occurrences.map((year) => `A${year}`).join(', ') || 'Aucune'} · {line.occurrencesPerYear === undefined ? 'fréquence non présente dans la trace' : `${line.occurrencesPerYear} occurrence(s)/an`} · {line.indexation}</td>
                            <td className="py-1.5 text-slate-400">{line.sourceName} · {line.sourceType} · {line.confidenceLevel}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="mt-3 border-t border-slate-800 pt-3 text-xs text-amber-200">Aucune trace détaillée de poste n’est exposée pour cette sortie dans le résultat enregistré ; aucun détail n’est reconstruit ici.</p>
                )}
              </article>
            ))}
          </section>

          {Object.keys(methodology).length > 0 && (
            <section className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Conventions renvoyées avec le résultat</h4>
              <dl className="space-y-2 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs">
                {Object.entries(methodology).map(([key, value]) => (
                  <div key={key} className="grid gap-1 sm:grid-cols-[10rem_1fr]">
                    <dt className="font-mono text-slate-500">{key}</dt>
                    <dd className="text-slate-300">{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-800 pt-3">
          <button onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-700">Fermer</button>
        </div>
      </div>
    </div>
  );
};
