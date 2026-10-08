import React, { useState } from 'react';
import { X, Play, CheckCircle2, XCircle, ShieldCheck, RefreshCw } from 'lucide-react';
import { runAllTCOEngineTests, TestResultItem } from '../engine/tcoEngine.test';

interface AutomatedTestsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AutomatedTestsModal: React.FC<AutomatedTestsModalProps> = ({ isOpen, onClose }) => {
  const [testOutput, setTestOutput] = useState<{
    total: number;
    passed: number;
    failed: number;
    results: TestResultItem[];
  } | null>(() => runAllTCOEngineTests());
  const [isRunning, setIsRunning] = useState(false);

  if (!isOpen) return null;

  const handleRunTests = () => {
    setIsRunning(true);
    setTimeout(() => {
      const output = runAllTCOEngineTests();
      setTestOutput(output);
      setIsRunning(false);
    }, 250);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> Auto-vérification du moteur de calcul
            </div>
            <h3 className="text-xl font-bold text-white">
              Suite de Tests Automatisés du Moteur TrueTCO
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Vérifie la rigueur des formules TCO, LCC actualisé, monétisation carbone, point mort et neutralité ESG.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action and Summary Bar */}
        <div className="py-4 flex items-center justify-between gap-4 border-b border-slate-800/80">
          <div className="flex items-center gap-4 text-xs">
            <span className="text-slate-300">
              Total tests : <strong className="text-white font-mono">{testOutput?.total ?? 0}</strong>
            </span>
            <span className="text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Réussis :{' '}
              <strong className="font-mono">{testOutput?.passed ?? 0}</strong>
            </span>
            {testOutput && testOutput.failed > 0 && (
              <span className="text-rose-400 flex items-center gap-1">
                <XCircle className="w-3.5 h-3.5" /> Échoués :{' '}
                <strong className="font-mono">{testOutput.failed}</strong>
              </span>
            )}
            <span className="text-slate-400 text-xs">
              Statut :{' '}
              {testOutput && testOutput.failed > 0 ? (
                <span className="text-rose-400 font-medium">
                  Échecs détectés — le moteur de calcul ne doit pas être utilisé en l'état
                </span>
              ) : (
                <span className="text-emerald-400 font-medium">
                  Contrôles du moteur de calcul passés sur ce navigateur
                </span>
              )}
            </span>
            <span className="text-[10px] text-slate-500">
              (contrôles internes : ils ne constituent ni un audit ni une certification externe)
            </span>
          </div>

          <button
            onClick={handleRunTests}
            disabled={isRunning}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 rounded-lg flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
            {isRunning ? 'Exécution...' : 'Relancer la suite'}
          </button>
        </div>

        {/* Tests List */}
        <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1">
          {testOutput?.results.map((test) => (
            <div
              key={test.id}
              className="p-3.5 bg-slate-950 border border-slate-800/90 rounded-lg hover:border-slate-700 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  {test.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span className="font-semibold text-white text-xs">{test.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <span className="px-2 py-0.5 bg-slate-900 border border-slate-800 rounded text-slate-400 text-[10px]">
                    {test.category}
                  </span>
                  <span>{test.durationMs} ms</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-900 text-xs">
                <div>
                  <div className="text-slate-400 text-[11px]">Condition attendue :</div>
                  <div className="text-slate-300 font-mono text-[11px] mt-0.5">{test.expected}</div>
                </div>
                <div>
                  <div className="text-slate-400 text-[11px]">Résultat calculé :</div>
                  <div className="text-emerald-300 font-mono text-[11px] mt-0.5">{test.actual}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-xs text-slate-400">
          <div>
            Démarche de coût du cycle de vie inspirée d’ISO 15686-5 et comptabilité carbone de type GHG Protocol :
            aucune certification de conformité n’est délivrée.
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
