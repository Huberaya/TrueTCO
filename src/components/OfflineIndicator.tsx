import React, { useState } from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Wifi, WifiOff, HardDrive, CheckCircle2 } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const [showDetails, setShowDetails] = useState(false);

  if (isOnline) {
    return null;
  }

  return (
    <aside aria-label="État de connexion réseau" className="fixed bottom-4 right-4 z-50 animate-bounce-subtle">
      <div
        onClick={() => setShowDetails(!showDetails)}
        className="cursor-pointer bg-amber-950/90 border border-amber-600/80 text-amber-200 px-3.5 py-2 rounded-xl shadow-2xl backdrop-blur-md flex items-center gap-2.5 text-xs select-none hover:bg-amber-900 transition-colors"
      >
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
        </span>
        <WifiOff className="w-3.5 h-3.5 text-amber-400" />
        <span className="font-semibold">Mode Hors-Ligne Actif</span>
        <span className="text-[11px] text-amber-300/80 border-l border-amber-700/60 pl-2 hidden sm:inline">
          Copie en cache — peut être périmée
        </span>
      </div>

      {showDetails && (
        <div className="mt-2 bg-slate-900 border border-slate-800 rounded-xl p-3 text-xs text-slate-300 w-72 shadow-2xl space-y-2">
          <div className="font-bold text-white flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
            Fonctionnement Déconnecté
          </div>
          <p className="text-[11px] text-slate-400 leading-normal">
            L'application et le moteur de calcul restent disponibles : le moteur s'exécute dans le
            navigateur et les dernières données chargées y sont conservées. En revanche, ces données sont
            une <strong className="text-amber-200">copie datée</strong> de la base : elles peuvent avoir
            changé depuis, et aucune modification faite hors ligne n'est enregistrée. Les décisions, les
            imports et le journal d'audit exigent une connexion au serveur.
          </p>
          <div className="text-[10px] text-emerald-400 flex items-center gap-1 font-mono">
            <CheckCircle2 className="w-3 h-3" />
            Toutes les modifications sont sauvegardées.
          </div>
        </div>
      )}
    </aside>
  );
};
