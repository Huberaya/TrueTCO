import React, { useState } from 'react';
import { X, Upload, FileText, AlertTriangle, Sparkles } from 'lucide-react';
import { SupplierOffer, Project, Supplier } from '../types/domain';
import { SupplierOfferSchema, formatZodError } from '../schemas/validationSchemas';

interface ImportOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  suppliers: Supplier[];
  onAddOffer: (offer: SupplierOffer) => void;
}

export const ImportOfferModal: React.FC<ImportOfferModalProps> = ({
  isOpen,
  onClose,
  project,
  suppliers,
  onAddOffer,
}) => {
  const [activeTab, setActiveTab] = useState<'csv' | 'ai_quote' | 'manual'>('csv');
  const [zodErrors, setZodErrors] = useState<string[]>([]);
  
  // CSV / Structured Data state

  // AI / Quote text extractor state

  // Manual form state
  const [supplierId, setSupplierId] = useState('');
  const [offerRef, setOfferRef] = useState('');
  const [unitPrice, setUnitPrice] = useState<number | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [annualEnergy, setAnnualEnergy] = useState<number | null>(null);
  const [annualMaintenance, setAnnualMaintenance] = useState<number | null>(null);
  const [warrantyMonths, setWarrantyMonths] = useState<number | null>(null);
  const [deliveryLeadTimeWeeks, setDeliveryLeadTimeWeeks] = useState<number | null>(null);
  const [salvageValue, setSalvageValue] = useState<number | null>(null);
  const [carbonTonnePerUnit, setCarbonTonnePerUnit] = useState<number | null>(null);
  const [carbonScope, setCarbonScope] = useState<'Scope 1' | 'Scope 2' | 'Scope 3 - Amont' | 'Scope 3 - Fin de vie'>('Scope 3 - Amont');
  const [isResponsible, setIsResponsible] = useState(false);

  if (!isOpen) return null;

  const handleCommitManual = () => {
    const enteredNumbers = [unitPrice, quantity, annualEnergy, annualMaintenance, warrantyMonths, deliveryLeadTimeWeeks, salvageValue, carbonTonnePerUnit];
    if (
      !supplierId ||
      !offerRef.trim() ||
      enteredNumbers.some((value) => value === null || !Number.isFinite(value) || value < 0) ||
      unitPrice === 0 || quantity === 0 || warrantyMonths === 0
    ) {
      setZodErrors(['Sélectionnez un fournisseur, saisissez une référence et renseignez explicitement tous les champs numériques. Prix, quantité et garantie doivent être supérieurs à zéro.']);
      return;
    }
    const selectedSup = suppliers.find((s) => s.id === supplierId);
    if (!selectedSup) {
      setZodErrors(['Le fournisseur sélectionné n’existe pas dans les données affichées.']);
      return;
    }
    const values = {
      unitPrice: unitPrice as number,
      quantity: quantity as number,
      annualEnergy: annualEnergy as number,
      annualMaintenance: annualMaintenance as number,
      warrantyMonths: warrantyMonths as number,
      deliveryLeadTimeWeeks: deliveryLeadTimeWeeks as number,
      salvageValue: salvageValue as number,
      carbonTonnePerUnit: carbonTonnePerUnit as number,
    };
    const totalApparent = values.unitPrice * values.quantity;

    const offer: SupplierOffer = {
      id: `off-man-${Date.now()}`,
      projectId: project.id,
      supplierId: selectedSup.id,
      supplierName: selectedSup.name,
      offerReference: offerRef,
      isResponsibleCandidate: isResponsible,
      apparentUnitPrice: {
        value: values.unitPrice,
        unit: '€/unité',
        sourceType: 'utilisateur',
        sourceName: 'Saisie manuelle — justificatif non vérifié',
        confidenceLevel: 0,
        lastUpdated: new Date().toISOString().split('T')[0],
        updatedBy: 'Utilisateur non vérifié',
      },
      quantity: values.quantity,
      apparentTotal: totalApparent,
      deliveryLeadTimeWeeks: values.deliveryLeadTimeWeeks,
      warrantyMonths: values.warrantyMonths,
      expectedLifespanYears: project.horizonYears,
      costItems: [
        {
          id: `ci-acq-${Date.now()}`,
          category: 'acquisition',
          label: `Achat initial (${values.quantity} ${project.unitName})`,
          amount: {
            value: totalApparent,
            unit: '€',
            sourceType: 'utilisateur',
            sourceName: 'Saisie manuelle — justificatif non vérifié',
            confidenceLevel: 0,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: 'Utilisateur non vérifié',
          },
          isRecurringYearly: false,
        },
        {
          id: `ci-nrj-${Date.now()}`,
          category: 'energie_consommables',
          label: 'Énergie & consommables annuels',
          amount: {
            value: values.annualEnergy,
            unit: '€/an',
            sourceType: 'utilisateur',
            sourceName: 'Saisie manuelle — justificatif non vérifié',
            confidenceLevel: 0,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: 'Utilisateur non vérifié',
          },
          isRecurringYearly: true,
          yearlyInflationType: 'energy',
        },
        {
          id: `ci-maint-${Date.now()}`,
          category: 'maintenance_reparations',
          label: 'Maintenance & réparations annuelles',
          amount: {
            value: values.annualMaintenance,
            unit: '€/an',
            sourceType: 'utilisateur',
            sourceName: 'Saisie manuelle — justificatif non vérifié',
            confidenceLevel: 0,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: 'Utilisateur non vérifié',
          },
          isRecurringYearly: true,
          yearlyInflationType: 'maintenance',
        },
        {
          id: `ci-salv-${Date.now()}`,
          category: 'valeur_residuelle',
          label: 'Valeur résiduelle estimée',
          amount: {
            value: values.salvageValue,
            unit: '€',
            sourceType: 'estimee',
            sourceName: 'Hypothèse de saisie — source non vérifiée',
            confidenceLevel: 0,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: 'Utilisateur non vérifié',
          },
          isRecurringYearly: false,
        },
      ],
      carbonItems: [
        {
          scope: carbonScope,
          lifecyclePhase: 'utilisation_annuelle',
          emissionsPerUnitTonneCO2e: {
            value: values.carbonTonnePerUnit,
            unit: 'tCO2e/unité/an',
            sourceType: 'utilisateur',
            sourceName: 'Saisie manuelle — source non vérifiée',
            confidenceLevel: 0,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: 'Utilisateur non vérifié',
          },
          totalLifecycleEmissions: values.carbonTonnePerUnit * values.quantity * project.horizonYears,
          emissionFactorSource: 'Source déclarée — non vérifiée',
        },
      ],
      riskItems: [],
      technicalSuitabilityScore: 0,
      notes: 'Saisie manuelle de démonstration ; les valeurs, sources et scores ne sont pas vérifiés. La durée de vie n’est pas renseignée : horizon du projet utilisé comme hypothèse.',
    };

    const validation = SupplierOfferSchema.safeParse(offer);
    if (!validation.success) {
      setZodErrors(formatZodError(validation.error));
      return;
    }

    onAddOffer(validation.data as unknown as SupplierOffer);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-400" />
              Ajouter une offre — démonstration locale
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Projet : <strong className="text-white">{project.name}</strong> ({project.plannedVolume} {project.unitName} sur {project.horizonYears} ans)
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switchers */}
        <div className="py-3 flex items-center gap-2 border-b border-slate-800/80">
          <button
            onClick={() => setActiveTab('csv')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'csv'
                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            Import CSV/Excel — indisponible
          </button>
          <button
            onClick={() => setActiveTab('ai_quote')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'ai_quote'
                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Analyse de document — indisponible
          </button>
          <button
            onClick={() => setActiveTab('manual')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'manual'
                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Saisie Manuelle
          </button>
        </div>

        {zodErrors.length > 0 && (
          <div className="mt-3 p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-rose-300 text-xs space-y-1 shrink-0">
            <div className="font-semibold flex items-center gap-1.5 text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              Contraintes de validation Zod non respectées sur l'offre :
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-300">
              {zodErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Body content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 text-xs">
          {activeTab === 'csv' && (
            <div className="p-4 bg-amber-950/40 border border-amber-800 rounded-xl text-sm text-amber-200 space-y-2">
              <div className="font-semibold">Import CSV/Excel indisponible</div>
              <p className="text-xs text-amber-100/80">
                Le parsing et la validation de fichiers ne sont pas implémentés. Aucun fichier ou contenu CSV ne sera interprété ni ajouté. Utilisez la saisie manuelle et vérifiez les justificatifs séparément.
              </p>
            </div>
          )}

          {activeTab === 'ai_quote' && (
            <div className="p-4 bg-amber-950/40 border border-amber-800 rounded-xl text-sm text-amber-200 space-y-2">
              <div className="font-semibold">Analyse documentaire indisponible</div>
              <p className="text-xs text-amber-100/80">
                Aucun extracteur n’est configuré. Aucun document ni texte ne sera transmis ou analysé, et aucun résultat d’offre ne sera généré ici.
              </p>
            </div>
          )}

          {activeTab === 'manual' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-950/40 border border-amber-800 rounded-lg text-[11px] text-amber-200">
                Saisie locale de démonstration. Aucun champ n’est vérifié par le système; les champs sont vides par défaut et les données ne sont pas transmises à une base distante.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Fournisseur</label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                  >
                    <option value="">Sélectionnez un fournisseur</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.country})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Référence Devis</label>
                  <input
                    type="text"
                    value={offerRef}
                    onChange={(e) => setOfferRef(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Délai de livraison (semaines)</label>
                  <input
                    type="number"
                    min="0"
                    value={deliveryLeadTimeWeeks ?? ''}
                    onChange={(e) => setDeliveryLeadTimeWeeks(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Prix unitaire facial (€ HT)</label>
                  <input
                    type="number"
                    value={unitPrice ?? ''}
                    onChange={(e) => setUnitPrice(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Quantité ({project.unitName})</label>
                  <input
                    type="number"
                    value={quantity ?? ''}
                    onChange={(e) => setQuantity(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Énergie / Consommables (€/an)</label>
                  <input
                    type="number"
                    value={annualEnergy ?? ''}
                    onChange={(e) => setAnnualEnergy(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Maintenance & Pièces (€/an)</label>
                  <input
                    type="number"
                    value={annualMaintenance ?? ''}
                    onChange={(e) => setAnnualMaintenance(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Garantie (mois)</label>
                  <input
                    type="number"
                    value={warrantyMonths ?? ''}
                    onChange={(e) => setWarrantyMonths(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Valeur résiduelle (€)</label>
                  <input
                    type="number"
                    value={salvageValue ?? ''}
                    onChange={(e) => setSalvageValue(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">CO2 (t/unité/an)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={carbonTonnePerUnit ?? ''}
                    onChange={(e) => setCarbonTonnePerUnit(e.target.value === '' ? null : Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Périmètre carbone déclaré — non vérifié</label>
                <select
                  value={carbonScope}
                  onChange={(e) => setCarbonScope(e.target.value as typeof carbonScope)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                >
                  <option value="Scope 1">Scope 1</option>
                  <option value="Scope 2">Scope 2</option>
                  <option value="Scope 3 - Amont">Scope 3 — amont</option>
                  <option value="Scope 3 - Fin de vie">Scope 3 — fin de vie</option>
                </select>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isRespCheck"
                  checked={isResponsible}
                  onChange={(e) => setIsResponsible(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-emerald-500 focus:ring-0"
                />
                <label htmlFor="isRespCheck" className="text-slate-300 cursor-pointer">
                  Marquer comme candidat éco-responsable selon la saisie — non vérifié
                </label>
              </div>

              <div className="pt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleCommitManual}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors"
                >
                  Ajouter à la démo locale
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-[11px] text-slate-400">
          <span>Outil de démonstration — aucune normalisation externe</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-white"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
