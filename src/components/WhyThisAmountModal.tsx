import React from 'react';
import { X, CheckCircle, AlertTriangle, User, Calendar, ExternalLink, ShieldCheck } from 'lucide-react';
import { AuditedValue, DataSourceType } from '../types/domain';

interface WhyThisAmountModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  categoryLabel: string;
  auditedValue?: AuditedValue<number | string>;
  calculatedFormula?: string;
  calculationExplanation?: string;
  relatedAssumptions?: { label: string; value: string }[];
}

export const WhyThisAmountModal: React.FC<WhyThisAmountModalProps> = ({
  isOpen,
  onClose,
  title,
  categoryLabel,
  auditedValue,
  calculatedFormula,
  calculationExplanation,
  relatedAssumptions,
}) => {
  if (!isOpen) return null;

  const getSourceTypeBadge = (type?: DataSourceType) => {
    switch (type) {
      case 'verifiee':
        return {
          label: 'Donnée vérifiée contractuelle',
          badgeClass: 'text-emerald-400 bg-emerald-950/50 border-emerald-800/60',
          icon: <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />,
        };
      case 'source_externe':
        return {
          label: 'Référentiel externe certifié',
          badgeClass: 'text-sky-400 bg-sky-950/50 border-sky-800/60',
          icon: <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />,
        };
      case 'estimee':
        return {
          label: 'Donnée modélisée / estimée',
          badgeClass: 'text-amber-400 bg-amber-950/50 border-amber-800/60',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />,
        };
      case 'utilisateur':
        return {
          label: 'Hypothèse fournie par l\'acheteur',
          badgeClass: 'text-indigo-400 bg-indigo-950/50 border-indigo-800/60',
          icon: <User className="w-3.5 h-3.5 text-indigo-400" />,
        };
      default:
        return {
          label: 'Hypothèse standard par défaut',
          badgeClass: 'text-slate-400 bg-slate-800 border-slate-700',
          icon: <AlertTriangle className="w-3.5 h-3.5 text-slate-400" />,
        };
    }
  };

  const badgeInfo = getSourceTypeBadge(auditedValue?.sourceType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-800">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400 font-semibold mb-1">
              Audit & Explicabilité Financière · {categoryLabel}
            </div>
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <span>Pourquoi ce montant ?</span>
            </h3>
            <p className="text-sm text-slate-400 mt-0.5">{title}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="py-5 space-y-5 text-sm text-slate-300">
          {/* Main Figure & Reliability Score */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-950 border border-slate-800/80 rounded-lg">
            <div>
              <div className="text-xs text-slate-400 mb-1">Valeur retenue dans le calcul</div>
              <div className="text-2xl font-bold font-mono text-white tabular-nums">
                {typeof auditedValue?.value === 'number'
                  ? auditedValue.value.toLocaleString('fr-FR')
                  : auditedValue?.value ?? 'Calcul dérivé'}
                <span className="text-sm font-normal text-slate-400 ml-1.5">{auditedValue?.unit || '€'}</span>
              </div>
            </div>

            <div className="flex flex-col items-end">
              <div className="text-xs text-slate-400 mb-1">Niveau de confiance des données</div>
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{ width: `${auditedValue?.confidenceLevel ?? 85}%` }}
                  />
                </div>
                <span className="text-sm font-semibold font-mono text-emerald-400 tabular-nums">
                  {auditedValue?.confidenceLevel ?? 85}%
                </span>
              </div>
            </div>
          </div>

          {/* Source and Provenance */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Traçabilité & Source Primaire
            </h4>
            <div className="p-3.5 bg-slate-800/40 border border-slate-800 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Type de donnée :</span>
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded border font-medium ${badgeInfo.badgeClass}`}>
                  {badgeInfo.icon}
                  {badgeInfo.label}
                </span>
              </div>

              <div className="flex items-start justify-between gap-4 pt-1">
                <span className="text-slate-400 text-xs">Source documentaire :</span>
                <span className="text-right text-xs font-medium text-slate-200">
                  {auditedValue?.sourceName || 'Moteur de calcul TrueTCO — source non renseignée pour cette valeur'}
                  {auditedValue?.sourceUrl && (
                    <a
                      href={auditedValue.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1.5 inline-flex items-center text-sky-400 hover:underline"
                    >
                      <ExternalLink className="w-3 h-3 ml-0.5" />
                    </a>
                  )}
                </span>
              </div>

              {auditedValue?.updatedBy && (
                <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-xs text-slate-400">
                  <span className="flex items-center gap-1">
                    <User className="w-3 h-3" /> Modifié par {auditedValue.updatedBy}
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <Calendar className="w-3 h-3" /> {auditedValue.lastUpdated}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Formula & Calculation Logic */}
          {(calculatedFormula || calculationExplanation) && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Formule Mathématique & Hypothèses
              </h4>
              <div className="p-3.5 bg-slate-950/80 border border-slate-800 rounded-lg font-mono text-xs text-emerald-300 overflow-x-auto">
                {calculatedFormula}
              </div>
              {calculationExplanation && (
                <p className="text-xs text-slate-400 leading-relaxed pt-1">
                  {calculationExplanation}
                </p>
              )}
            </div>
          )}

          {/* Related Assumptions */}
          {relatedAssumptions && relatedAssumptions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Hypothèses de Calcul Liées
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {relatedAssumptions.map((assump, idx) => (
                  <div key={idx} className="p-2.5 bg-slate-800/30 border border-slate-800 rounded text-xs">
                    <div className="text-slate-400">{assump.label}</div>
                    <div className="font-semibold text-slate-200 mt-0.5 font-mono tabular-nums">{assump.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Internal Audit Defense Statement */}
          <div className="p-3 bg-indigo-950/30 border border-indigo-900/40 rounded-lg text-xs text-indigo-300">
            <strong>Garantie d'auditabilité :</strong> Ce poste a été normalisé et peut être présenté devant le Comité d'Investissement, la DAF ou le Commissaire aux Comptes sans zone d'ombre.
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end pt-3 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Fermer l'audit
          </button>
        </div>
      </div>
    </div>
  );
};
