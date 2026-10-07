import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Smartphone, X, CheckCircle2, ShieldCheck, WifiOff } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);

  // If already running as an installed PWA, hide or show subtle installed badge
  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowModal(true);
    }
  };

  return (
    <>
      <button
        onClick={handleAction}
        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-700/60 text-emerald-300 hover:text-white rounded-lg text-xs font-semibold transition-all shadow-sm group"
        title="Installer TrueTCO sur votre poste ou smartphone pour un fonctionnement 100% hors-ligne"
      >
        <Download className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-y-0.5 transition-transform" />
        <span className="hidden sm:inline">Installer l'App</span>
        <span className="text-[10px] px-1 py-0.2 bg-emerald-800 text-emerald-100 rounded font-mono">PWA</span>
      </button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl text-xs text-slate-300">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-white">Installation Progressive Web App (PWA)</h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-slate-300 leading-relaxed">
                TrueTCO est certifiée <strong>PWA (Progressive Web App)</strong> avec mise en cache Workbox et Service Worker. Vous pouvez l'utiliser directement comme une application de bureau ou mobile native, <strong>même en déplacement sans aucune connexion Internet</strong>.
              </p>

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  Avantages du mode PWA Hors-Ligne :
                </div>
                <ul className="space-y-1 text-slate-400 text-[11px] list-disc list-inside">
                  <li>Calculs LCC, WACC et actualisations 100% locaux dans le navigateur.</li>
                  <li>Fonctionnement sur site industriel, entrepôt ou en vol sans réseau.</li>
                  <li>Persistance automatique des dossiers et journal d'audit chiffré.</li>
                  <li>Lancement instantané depuis le bureau ou l'écran d'accueil.</li>
                </ul>
              </div>

              {isIOS ? (
                <div className="p-3 bg-sky-950/50 border border-sky-800 rounded-xl text-sky-200 space-y-1">
                  <div className="font-semibold">Procédure iOS Safari :</div>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-sky-300">
                    <li>Touchez l'icône <strong>Partager</strong> (carré avec flèche vers le haut) dans la barre Safari.</li>
                    <li>Faites défiler vers le bas et touchez <strong>Sur l'écran d'accueil</strong>.</li>
                    <li>Validez en haut à droite en appuyant sur <strong>Ajouter</strong>.</li>
                  </ol>
                </div>
              ) : (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1 text-[11px] text-slate-400">
                  <div className="font-semibold text-white">Navigateurs Chromium / Edge / Chrome :</div>
                  <p>
                    Cliquez sur l'icône d'installation dans la barre d'adresse de votre navigateur (icône écran avec flèche descendante) ou utilisez le raccourci du menu <strong>« Installer TrueTCO »</strong>.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors"
              >
                Compris
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
