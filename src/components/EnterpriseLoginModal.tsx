import React from 'react';
import { Lock, X } from 'lucide-react';

interface EnterpriseLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EnterpriseLoginModal: React.FC<EnterpriseLoginModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-labelledby="login-unavailable-title">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="login-unavailable-title" className="text-lg font-bold">Connexion indisponible</h2>
          <button onClick={onClose} aria-label="Fermer" className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-3 rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-100">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Aucun fournisseur d’identité n’est configuré pour authentifier les utilisateurs. Aucun compte, rôle ou session de démonstration ne peut ouvrir une session.</p>
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700">
          Fermer
        </button>
      </section>
    </div>
  );
};
