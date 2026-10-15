import React, { useState } from 'react';
import { SignIn } from '@clerk/clerk-react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { TenantService } from '../services/tenantService';
import { setActiveTenant } from '../services/apiClient';

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 gap-6">
    <div className="flex items-center gap-2 text-emerald-400 font-extrabold text-xl tracking-tight">
      <ShieldCheck className="w-7 h-7" /> TrueTCO
    </div>
    {children}
  </div>
);

export const AuthLoadingScreen: React.FC = () => (
  <Shell>
    <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Vérification de la session…</div>
  </Shell>
);

export const SignInScreen: React.FC = () => (
  <Shell>
    <SignIn routing="hash" />
  </Shell>
);

export const AuthErrorScreen: React.FC<{ onRetry: () => void; onLogout: () => void }> = ({ onRetry, onLogout }) => (
  <Shell>
    <p className="text-sm text-slate-300 max-w-sm text-center">Impossible de joindre le serveur TrueTCO pour vérifier votre session.</p>
    <div className="flex gap-3">
      <button onClick={onRetry} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold">Réessayer</button>
      <button onClick={onLogout} className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">Se déconnecter</button>
    </div>
  </Shell>
);

/** Première connexion sans invitation : création de l'organisation (le créateur en devient administrateur). */
export const OnboardingScreen: React.FC<{ onCreated: () => void; onLogout: () => void }> = ({ onCreated, onLogout }) => {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('FR');
  const [currency, setCurrency] = useState('EUR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const tenant = await TenantService.createTenant({ name: name.trim(), countryCode: country, defaultCurrency: currency });
      setActiveTenant(tenant.id);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Création impossible');
      setBusy(false);
    }
  };

  const field = 'w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500';
  return (
    <Shell>
      <form onSubmit={submit} className="w-full max-w-md bg-slate-900/70 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold">Créer votre organisation</h1>
          <p className="text-xs text-slate-400 mt-1">
            Vous n'êtes rattaché à aucune organisation. Si votre entreprise utilise déjà TrueTCO, demandez à un administrateur de vous inviter
            avec votre adresse email, puis reconnectez-vous.
          </p>
        </div>
        <label className="block text-xs text-slate-300 space-y-1">Raison sociale
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-slate-300 space-y-1">Pays (ISO)
            <input className={field} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} minLength={2} required />
          </label>
          <label className="block text-xs text-slate-300 space-y-1">Devise
            <select className={field} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['EUR', 'USD', 'GBP', 'CHF', 'CAD'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        {error && <p className="text-xs text-rose-400" role="alert">{error}</p>}
        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={onLogout} className="text-xs text-slate-400 hover:text-slate-200">Se déconnecter</button>
          <button disabled={busy || name.trim().length < 2} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-sm font-semibold">
            {busy ? 'Création…' : 'Créer'}
          </button>
        </div>
      </form>
    </Shell>
  );
};
