import React, { useState } from 'react';
import {
  Building2,
  X,
  Lock,
  AlertCircle,
} from 'lucide-react';

interface NewTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewTenantModal: React.FC<NewTenantModalProps> = ({ isOpen, onClose }) => {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [legalNumber, setLegalNumber] = useState('');
  const [tier, setTier] = useState('enterprise');
  const [currency, setCurrency] = useState('EUR');
  const [countryCode, setCountryCode] = useState('FR');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('Création indisponible : aucune identité vérifiée, autorisation serveur ni isolation tenant n’est configurée.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col">
        
        {/* Header */}
        <div className="p-5 bg-slate-950 border-b border-slate-800 flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-semibold text-emerald-400">
              <Building2 className="w-4 h-4 text-emerald-400" />
              Création d’organisation — démo
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Organisation de démonstration — création indisponible
            </h2>
            <p className="text-xs text-slate-400">
              Aucun environnement ou stockage d’organisation réel n’est créé par cette interface.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-slate-300 font-semibold block">
              Raison Sociale de l'Entreprise ou Filiale *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex: Société Exemple SAS"
              required
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">
                Domaine Email Professionnel
              </label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="ex: exemple.invalid"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">
                Numéro d'Immatriculation / SIREN
              </label>
              <input
                type="text"
                value={legalNumber}
                onChange={(e) => setLegalNumber(e.target.value)}
                placeholder="ex: 000 000 000 00000"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">
                Niveau de Souscription
              </label>
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="enterprise">Entreprise Dédié</option>
                <option value="sovereign">Option dite souveraine — non vérifiée</option>
                <option value="starter">Standard</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">
                Devise Principale
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
                <option value="GBP">GBP (£)</option>
                <option value="CHF">CHF (CHF)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-300 font-semibold block">
                Pays du Siège
              </label>
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="FR">France (FR)</option>
                <option value="DE">Allemagne (DE)</option>
                <option value="BE">Belgique (BE)</option>
                <option value="CH">Suisse (CH)</option>
                <option value="UK">Royaume-Uni (UK)</option>
              </select>
            </div>
          </div>

          <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800 space-y-1 text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 text-slate-200 font-semibold">
              <Lock className="w-3 h-3 text-emerald-400" />
              Isolation non configurée
            </div>
            <p>
              La création d’organisation est désactivée tant que l’authentification et l’isolation côté serveur ne sont pas en place. Les champs ci-dessus ne créent pas un tenant réel.
            </p>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-medium text-xs transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled
              className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg font-bold text-xs flex items-center gap-1.5 cursor-not-allowed"
            >
              <Building2 className="w-3.5 h-3.5" />
              <span>Création indisponible — sécurité non configurée</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
