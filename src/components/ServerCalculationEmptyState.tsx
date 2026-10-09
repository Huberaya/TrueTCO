import React from 'react';
import { Info } from 'lucide-react';

/** État honnête lorsque le dossier n'a pas encore d'exécution serveur exploitable. */
export const ServerCalculationEmptyState: React.FC<{ title?: string }> = ({
  title = 'Aucun calcul serveur exploitable pour ce dossier',
}) => (
  <div className="rounded-xl border border-slate-700 bg-slate-900 p-6 text-sm text-slate-300" role="status">
    <div className="flex items-start gap-3">
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
      <div>
        <h3 className="font-semibold text-white">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Aucun montant n'est recalculé dans le navigateur. Dans une session serveur, lancez une exécution depuis
          l'écran « Décision » ; dans le mode démonstration local, les résultats financiers ne sont volontairement
          pas simulés.
        </p>
      </div>
    </div>
  </div>
);
