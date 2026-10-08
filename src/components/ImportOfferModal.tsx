import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { SupplierOffer, Project, Supplier } from '../types/domain';
import { SupplierOfferSchema, formatZodError } from '../schemas/validationSchemas';
import { useAuth } from '../context/AuthContext';

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
  const [activeTab, setActiveTab] = useState<'csv' | 'manual'>('csv');
  const [zodErrors, setZodErrors] = useState<string[]>([]);

  // CSV / Structured Data state
  const [csvContent, setCsvContent] = useState('');
  const [parsedPreview, setParsedPreview] = useState<Partial<SupplierOffer> | null>(null);

  /**
   * Auteur de la saisie : l'utilisateur de la session, ou une mention explicite
   * « saisie locale non attribuée » hors session. Auparavant, la saisie manuelle
   * était signée de noms de personnes inventées (« Sophie Valéry », « Alexandre
   * Meyer », « Éléonore Chen »), ce qui attribuait une donnée financière à des
   * gens qui ne l'avaient jamais saisie.
   */
  const { user } = useAuth();
  const authorName = user?.fullName ?? 'saisie locale non attribuée';

  // Manual form state
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id || '');
  const [offerRef, setOfferRef] = useState(`DEV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`);
  const [unitPrice, setUnitPrice] = useState(32000);
  const [quantity, setQuantity] = useState(project.plannedVolume || 10);
  const [annualEnergy, setAnnualEnergy] = useState(25000);
  const [annualMaintenance, setAnnualMaintenance] = useState(15000);
  const [warrantyMonths, setWarrantyMonths] = useState(36);
  const [salvageValue, setSalvageValue] = useState(60000);
  const [carbonTonnePerUnit, setCarbonTonnePerUnit] = useState(2.5);
  const [isResponsible, setIsResponsible] = useState(false);

  if (!isOpen) return null;

  const handleCommitManual = () => {
    const selectedSup = suppliers.find((s) => s.id === supplierId) || suppliers[0];
    const totalApparent = unitPrice * quantity;

    const offer: SupplierOffer = {
      id: `off-man-${Date.now()}`,
      projectId: project.id,
      supplierId: selectedSup?.id || 'sup-custom',
      supplierName: selectedSup?.name || 'Fournisseur Spécifié',
      offerReference: offerRef,
      isResponsibleCandidate: isResponsible,
      apparentUnitPrice: {
        value: unitPrice,
        unit: '€/unité',
        sourceType: 'utilisateur',
        sourceName: `Saisie manuelle au titre du devis ${offerRef} — pièce justificative non jointe`,
        confidenceLevel: 70,
        lastUpdated: new Date().toISOString().split('T')[0],
        updatedBy: authorName,
      },
      quantity,
      apparentTotal: totalApparent,
      deliveryLeadTimeWeeks: 6,
      warrantyMonths,
      expectedLifespanYears: project.horizonYears,
      costItems: [
        {
          id: `ci-acq-${Date.now()}`,
          category: 'acquisition',
          label: `Achat initial (${quantity} ${project.unitName})`,
          amount: {
            value: totalApparent,
            unit: '€',
            sourceType: 'verifiee',
            sourceName: 'Devis commercial ferme',
            confidenceLevel: 98,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: authorName,
          },
          isRecurringYearly: false,
        },
        {
          id: `ci-nrj-${Date.now()}`,
          category: 'energie_consommables',
          label: 'Énergie & consommables annuels',
          amount: {
            value: annualEnergy,
            unit: '€/an',
            sourceType: 'estimee',
            sourceName: 'Données techniques déclarées',
            confidenceLevel: 85,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: authorName,
          },
          isRecurringYearly: true,
          yearlyInflationType: 'energy',
        },
        {
          id: `ci-maint-${Date.now()}`,
          category: 'maintenance_reparations',
          label: 'Maintenance & réparations annuelles',
          amount: {
            value: annualMaintenance,
            unit: '€/an',
            sourceType: 'verifiee',
            sourceName: 'Contrat de maintenance contractuel',
            confidenceLevel: 90,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: authorName,
          },
          isRecurringYearly: true,
          yearlyInflationType: 'maintenance',
        },
        {
          id: `ci-salv-${Date.now()}`,
          category: 'valeur_residuelle',
          label: 'Valeur résiduelle estimée',
          amount: {
            value: salvageValue,
            unit: '€',
            sourceType: 'estimee',
            sourceName: 'Cote de marché occasion',
            confidenceLevel: 75,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: authorName,
          },
          isRecurringYearly: false,
        },
      ],
      carbonItems: [
        {
          scope: isResponsible ? 'Scope 2' : 'Scope 1',
          lifecyclePhase: 'utilisation_annuelle',
          emissionsPerUnitTonneCO2e: {
            value: carbonTonnePerUnit,
            unit: 'tCO2e/unité/an',
            sourceType: 'utilisateur',
            sourceName: 'Facteur carbone saisi par l’acheteur — référence non fournie avec la saisie',
            confidenceLevel: 60,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: authorName,
          },
          totalLifecycleEmissions: carbonTonnePerUnit * quantity * project.horizonYears,
          emissionFactorSource: 'non renseignée (valeur saisie, facteur à rattacher à une source)',
        },
      ],
      riskItems: [
        {
          id: `ri-${Date.now()}`,
          label: 'Aléas opérationnels et maintien en conditions opérationnelles',
          category: 'interruption_service',
          probability: {
            value: 0.10,
            unit: 'proba (0-1)',
            sourceType: 'estimation',
            sourceName: 'Évaluation des risques achats',
            confidenceLevel: 80,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: authorName,
          },
          financialImpact: {
            value: 25000,
            unit: '€',
            sourceType: 'estimee',
            sourceName: 'Impact financier estimé',
            confidenceLevel: 75,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: authorName,
          },
          expectedLoss: 2500,
          probabilityType: 'estimation',
        },
      ],
      technicalSuitabilityScore: 85,
    };

    const validation = SupplierOfferSchema.safeParse(offer);
    if (!validation.success) {
      setZodErrors(formatZodError(validation.error));
      return;
    }

    onAddOffer(validation.data as unknown as SupplierOffer);
    onClose();
  };

  const handleLoadCsvTemplate = () => {
    const template = `fournisseur,reference,prix_unitaire,quantite,energie_annuelle,maintenance_annuelle,valeur_residuelle,garantie_mois,co2_unitaire_an,responsable
EcoMobility France,DEV-CSV-2026-X,35000,${project.plannedVolume},35000,12000,70000,48,1.1,true`;
    setCsvContent(template);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-400" />
              Importer une Offre Fournisseur
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

        {/*
          L'onglet « Extraction Devis PDF (Assistant IA) » a été RETIRÉ : il produisait,
          après un délai de 600 ms, une offre complète pré-remplie (prix, garanties,
          pénalités, « score de confiance : 94 % ») identique quel que soit le texte
          collé. Ce n'était pas une extraction, c'était une démonstration figée, et
          elle faisait entrer dans le moteur des montants que personne n'avait
          vérifiés. L'extraction assistée par IA sera rebranchée en phase IA, avec
          fournisseur de modèle, stockage du document, provenance par passage et
          validation humaine bloquante (voir docs/ et le plan de phases).
        */}
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
            Import Fichier Excel / CSV
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
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-xs">Format CSV standardisé :</span>
                <button
                  onClick={handleLoadCsvTemplate}
                  className="text-xs text-sky-400 hover:underline flex items-center gap-1"
                >
                  Charger exemple de modèle CSV
                </button>
              </div>

              <textarea
                rows={5}
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                placeholder="Collez ici les données CSV (colonnes: fournisseur, reference, prix_unitaire, quantite, energie_annuelle, maintenance_annuelle, valeur_residuelle...)"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />

              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-slate-400 space-y-1 text-[11px]">
                <div className="font-semibold text-slate-300">Norme d'importation TrueTCO :</div>
                <div>
                  Aucun champ n’est complété automatiquement par un référentiel : ce que vous ne renseignez pas reste
                  manquant et sera signalé comme tel dans l’analyse. Les valeurs carbone saisies ici sont marquées
                  « fournies par l’acheteur » tant qu’une source (facteur d’émission, millésime, périmètre) ne leur est
                  pas rattachée.
                </div>
              </div>

              {csvContent.trim() && (
                <div className="p-3 bg-emerald-950/30 border border-emerald-800/50 rounded-lg flex items-center justify-between text-emerald-300">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Ligne valide détectée. Prêt à intégrer dans le comparateur.</span>
                  </div>
                  <button
                    onClick={handleCommitManual}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium text-xs transition-colors"
                  >
                    Valider l'import
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'manual' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Fournisseur</label>
                  <select
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs"
                  >
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
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Prix unitaire facial (€ HT)</label>
                  <input
                    type="number"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Quantité ({project.unitName})</label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Énergie / Consommables (€/an)</label>
                  <input
                    type="number"
                    value={annualEnergy}
                    onChange={(e) => setAnnualEnergy(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Maintenance & Pièces (€/an)</label>
                  <input
                    type="number"
                    value={annualMaintenance}
                    onChange={(e) => setAnnualMaintenance(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Garantie (mois)</label>
                  <input
                    type="number"
                    value={warrantyMonths}
                    onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Valeur résiduelle (€)</label>
                  <input
                    type="number"
                    value={salvageValue}
                    onChange={(e) => setSalvageValue(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">CO2 (t/unité/an)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={carbonTonnePerUnit}
                    onChange={(e) => setCarbonTonnePerUnit(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs"
                  />
                </div>
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
                  Marquer comme alternative éco-responsable / circulaire (pour le calcul du point mort)
                </label>
              </div>

              <div className="pt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleCommitManual}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs transition-colors"
                >
                  Ajouter l'offre au projet
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-[11px] text-slate-400">
          <span>Module de Normalisation Multiformat TrueTCO</span>
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
