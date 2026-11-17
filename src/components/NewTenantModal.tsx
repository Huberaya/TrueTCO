import React from 'react';
import { Building2, Lock, X } from 'lucide-react';

interface NewTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewTenantModal: React.FC<NewTenantModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-labelledby="tenant-unavailable-title">
      <section className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="tenant-unavailable-title" className="flex items-center gap-2 text-lg font-bold">
            <Building2 className="h-5 w-5 text-amber-400" /> Organisation indisponible
          </h2>
          <button onClick={onClose} aria-label="Fermer" className="rounded p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex gap-3 rounded-xl border border-amber-800 bg-amber-950/40 p-4 text-sm text-amber-100">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>La création et la sélection d’organisation sont désactivées tant que l’identité, l’appartenance et l’isolation côté serveur ne sont pas opérationnelles.</p>
        </div>
      </section>
    </div>
  );
};
