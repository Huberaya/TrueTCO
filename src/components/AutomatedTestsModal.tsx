import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react';

interface HealthResult {
  status: string;
  database: { connected: boolean; driver: string; version: string | null; appRoleAssumed: boolean };
  versions: { engine: string; methodology: string };
}

interface AutomatedTestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Ancien panneau d'auto-tests : il exécutait une copie du moteur dans le
 * navigateur et pouvait afficher un succès sans vérifier le serveur. Il ne fait
 * désormais qu'interroger la santé de l'API ; les tests restent dans Vitest/CI.
 */
export const AutomatedTestsModal: React.FC<AutomatedTestsModalProps> = ({ isOpen, onClose }) => {
  const [health, setHealth] = useState<HealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const checkHealth = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/health', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? `Erreur API ${response.status}`);
      setHealth(payload as HealthResult);
    } catch (caught) {
      setHealth(null);
      setError(caught instanceof Error ? caught.message : 'État du service indisponible.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isOpen) void checkHealth();
  }, [isOpen]);

  if (!isOpen) return null;

  const healthy = health?.status === 'ok' && health.database.connected;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div><div className="mb-1 text-xs font-semibold uppercase tracking-wider text-sky-400">État du service de calcul</div><h3 className="text-xl font-bold text-white">API et base de données</h3><p className="mt-1 text-xs text-slate-400">Vérification de disponibilité uniquement. Aucun test moteur n'est exécuté dans le navigateur.</p></div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Fermer"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex items-center justify-between gap-4 border-b border-slate-800/80 py-4">
          <div className="text-xs text-slate-400">Les tests unitaires, API et d'isolation s'exécutent via Vitest/CI. Voir <code>TESTING.md</code>.</div>
          <button onClick={() => void checkHealth()} disabled={busy} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />{busy ? 'Vérification…' : 'Vérifier à nouveau'}</button>
        </div>

        {error && <div role="alert" className="mt-4 rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-200">{error}</div>}
        {health && <div className={`mt-4 rounded-xl border p-4 ${healthy ? 'border-emerald-800 bg-emerald-950/30' : 'border-amber-800 bg-amber-950/30'}`}><div className="flex items-center gap-2 text-sm font-bold text-white">{healthy ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}{healthy ? 'API joignable et base connectée' : 'Service dégradé'}</div><dl className="mt-3 grid grid-cols-2 gap-3 text-xs"><Item label="État API" value={health.status} /><Item label="Pilote base" value={health.database.driver} /><Item label="Base de données" value={health.database.version ?? 'Version non fournie'} /><Item label="Rôle applicatif assumé" value={health.database.appRoleAssumed ? 'Oui' : 'Non'} /><Item label="Moteur déclaré par l'API" value={health.versions.engine} /><Item label="Méthodologie déclarée" value={health.versions.methodology} /></dl><p className="mt-3 text-[10px] text-slate-400">Cette vérification ne constitue ni une suite de tests, ni une certification de sécurité ou de conformité.</p></div>}
      </div>
    </div>
  );
};

const Item: React.FC<{label:string;value:string}> = ({label,value}) => <div><dt className="text-slate-400">{label}</dt><dd className="mt-0.5 font-mono text-slate-200">{value}</dd></div>;
