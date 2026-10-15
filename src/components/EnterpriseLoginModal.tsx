import React from 'react';
import { X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface EnterpriseLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * L'ancienne modale permettait de « choisir » n'importe quelle identité, rôle et organisation
 * (aucune vérification). Elle est remplacée par une information de session : l'authentification
 * se fait exclusivement via Clerk (écran de connexion), et le rôle est celui attribué par l'administrateur.
 */
export const EnterpriseLoginModal: React.FC<EnterpriseLoginModalProps> = ({ isOpen, onClose }) => {
  const { user, isDemo, memberships, logout } = useAuth();
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md" role="dialog" aria-modal="true">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div className="flex items-start justify-between">
          <h2 className="text-base font-bold text-white">Session</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        {isDemo ? (
          <p className="text-sm text-slate-300">
            Mode démonstration : profil et données <strong>locaux</strong>, non synchronisés. Configurez <code>VITE_CLERK_PUBLISHABLE_KEY</code> pour
            activer la connexion sécurisée.
          </p>
        ) : (
          <div className="text-sm text-slate-300 space-y-2">
            <p><strong>{user?.fullName}</strong> — {user?.email}</p>
            <p>Rôle attribué par votre administrateur : <code>{user?.role}</code></p>
            <p className="text-xs text-slate-400">{memberships.length} organisation(s) accessible(s).</p>
            <button onClick={() => void logout()} className="mt-2 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs">Se déconnecter</button>
          </div>
        )}
      </div>
    </div>
  );
};
