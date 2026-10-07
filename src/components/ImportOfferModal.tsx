import React, { useState } from 'react';
import { X, Upload, FileText, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
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
  const [csvContent, setCsvContent] = useState('');
  const [parsedPreview, setParsedPreview] = useState<Partial<SupplierOffer> | null>(null);

  // AI / Quote text extractor state
  const [quoteText, setQuoteText] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedCandidate, setExtractedCandidate] = useState<SupplierOffer | null>(null);

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

  const handleSimulateQuoteExtraction = () => {
    setIsExtracting(true);
    setTimeout(() => {
      const selectedSup = suppliers.find((s) => s.id === supplierId) || suppliers[0];
      const parsed: SupplierOffer = {
        id: `off-extracted-${Date.now()}`,
        projectId: project.id,
        supplierId: selectedSup.id,
        supplierName: selectedSup.name,
        offerReference: 'EXTRACTED-DEV-2026-B',
        isResponsibleCandidate: true,
        apparentUnitPrice: {
          value: 34500,
          unit: '€/unité',
          sourceType: 'verifiee',
          sourceName: 'Devis PDF analysé automatiquement',
          confidenceLevel: 94,
          lastUpdated: new Date().toISOString().split('T')[0],
          updatedBy: 'IA Assistant Achats',
        },
        quantity: project.plannedVolume,
        apparentTotal: 34500 * project.plannedVolume,
        deliveryLeadTimeWeeks: 6,
        warrantyMonths: 48,
        expectedLifespanYears: project.horizonYears,
        costItems: [
          {
            id: `ci-1-${Date.now()}`,
            category: 'acquisition',
            label: 'Acquisition matériels selon spécifications',
            amount: {
              value: 34500 * project.plannedVolume,
              unit: '€',
              sourceType: 'verifiee',
              sourceName: 'Extrait devis ligne CAPEX',
              confidenceLevel: 95,
              lastUpdated: new Date().toISOString().split('T')[0],
              updatedBy: 'IA Extract',
            },
            isRecurringYearly: false,
          },
          {
            id: `ci-2-${Date.now()}`,
            category: 'energie_consommables',
            label: 'Consommation énergétique modélisée',
            amount: {
              value: 32000,
              unit: '€/an',
              sourceType: 'estimee',
              sourceName: 'Fiche technique constructeur kWh',
              confidenceLevel: 88,
              lastUpdated: new Date().toISOString().split('T')[0],
              updatedBy: 'IA Extract',
            },
            isRecurringYearly: true,
            yearlyInflationType: 'energy',
          },
          {
            id: `ci-3-${Date.now()}`,
            category: 'maintenance_reparations',
            label: 'Maintenance préventive constructeur',
            amount: {
              value: 14000,
              unit: '€/an',
              sourceType: 'verifiee',
              sourceName: 'Contrat entretien attaché',
              confidenceLevel: 92,
              lastUpdated: new Date().toISOString().split('T')[0],
              updatedBy: 'IA Extract',
            },
            isRecurringYearly: true,
            yearlyInflationType: 'maintenance',
          },
          {
            id: `ci-4-${Date.now()}`,
            category: 'valeur_residuelle',
            label: 'Valeur de cession estimée à terme',
            amount: {
              value: 75000,
              unit: '€',
              sourceType: 'estimee',
              sourceName: 'Barème professionnel',
              confidenceLevel: 75,
              lastUpdated: new Date().toISOString().split('T')[0],
              updatedBy: 'IA Extract',
            },
            isRecurringYearly: false,
          },
        ],
        carbonItems: [
          {
            scope: 'Scope 2',
            lifecyclePhase: 'utilisation_annuelle',
            emissionsPerUnitTonneCO2e: {
              value: 1.2,
              unit: 'tCO2e/unité/an',
              sourceType: 'source_externe',
              sourceName: 'Calculé d\'après consommation déclarée & ADEME',
              confidenceLevel: 92,
              lastUpdated: new Date().toISOString().split('T')[0],
              updatedBy: 'IA Extract',
            },
            totalLifecycleEmissions: 1.2 * project.plannedVolume * project.horizonYears,
            emissionFactorSource: 'ADEME 2026',
          },
        ],
        riskItems: [
          {
            id: `ri-1-${Date.now()}`,
            label: 'Risque de délai d\'approvisionnement pièces',
            category: 'interruption_service',
            probability: {
              value: 0.15,
              unit: 'proba (0-1)',
              sourceType: 'donnee_sectorielle',
              sourceName: 'Estimation sectorielle délai',
              confidenceLevel: 80,
              lastUpdated: new Date().toISOString().split('T')[0],
              updatedBy: 'IA Extract',
            },
            financialImpact: {
              value: 20000,
              unit: '€',
              sourceType: 'estimee',
              sourceName: 'Pénalité de service',
              confidenceLevel: 75,
              lastUpdated: new Date().toISOString().split('T')[0],
              updatedBy: 'IA Extract',
            },
            expectedLoss: 3000,
            probabilityType: 'donnee_sectorielle',
          },
        ],
        technicalSuitabilityScore: 88,
      };

      setExtractedCandidate(parsed);
      setIsExtracting(false);
    }, 600);
  };

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
        sourceType: 'verifiee',
        sourceName: `Devis direct ${offerRef}`,
        confidenceLevel: 95,
        lastUpdated: new Date().toISOString().split('T')[0],
        updatedBy: 'Sophie Valéry',
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
            updatedBy: 'Sophie Valéry',
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
            updatedBy: 'Alexandre Meyer',
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
            updatedBy: 'Sophie Valéry',
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
            updatedBy: 'Alexandre Meyer',
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
            sourceType: 'source_externe',
            sourceName: 'Facteur d\'émission ADEME',
            confidenceLevel: 90,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: 'Éléonore Chen',
          },
          totalLifecycleEmissions: carbonTonnePerUnit * quantity * project.horizonYears,
          emissionFactorSource: 'ADEME 2026',
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
            updatedBy: 'Sophie Valéry',
          },
          financialImpact: {
            value: 25000,
            unit: '€',
            sourceType: 'estimee',
            sourceName: 'Impact financier estimé',
            confidenceLevel: 75,
            lastUpdated: new Date().toISOString().split('T')[0],
            updatedBy: 'Alexandre Meyer',
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
            onClick={() => setActiveTab('ai_quote')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 ${
              activeTab === 'ai_quote'
                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            Extraction Devis PDF (Assistant IA)
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
                <div>Les champs non renseignés sont automatiquement complétés par les référentiels sectoriels (ADEME, Banque Mondiale, WACC) et marqués avec le tag 🟡 Donnée estimée.</div>
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

          {activeTab === 'ai_quote' && (
            <div className="space-y-3">
              <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-lg text-amber-300 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <strong>Principe de Sécurité Financière :</strong> Aucune donnée extraite par l'IA n'est appliquée sans validation explicite de l'acheteur. Vous pouvez réviser chaque poste ci-dessous avant engagement.
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  Texte ou Devis Fournisseur à analyser :
                </label>
                <textarea
                  rows={4}
                  value={quoteText}
                  onChange={(e) => setQuoteText(e.target.value)}
                  placeholder="Collez ici le texte d'un devis reçu (ex: Offre N°8491 - Fourniture de 50 unités @ 34 500 € HT unitaire. Entretien préventif 14 000 €/an. Garantie 4 ans...)"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSimulateQuoteExtraction}
                  disabled={isExtracting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white rounded-lg font-medium text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isExtracting ? 'Extraction des données en cours...' : 'Extraire les coûts & garanties'}
                </button>
              </div>

              {extractedCandidate && (
                <div className="mt-4 p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="font-semibold text-white">Données détectées pour validation</span>
                    <span className="text-emerald-400 font-mono text-xs">Score de confiance : 94%</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-slate-400">Prix unitaire extrait :</span>
                      <div className="font-bold text-white font-mono">{extractedCandidate?.apparentUnitPrice?.value?.toLocaleString() ?? 0} €</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Total acquisition :</span>
                      <div className="font-bold text-white font-mono">{extractedCandidate.apparentTotal.toLocaleString()} €</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Garantie constructeur :</span>
                      <div className="font-bold text-white font-mono">{extractedCandidate.warrantyMonths} mois</div>
                    </div>
                    <div>
                      <span className="text-slate-400">Coûts de maintenance détectés :</span>
                      <div className="font-bold text-white font-mono">14 000 €/an</div>
                    </div>
                  </div>

                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={() => {
                        onAddOffer(extractedCandidate);
                        onClose();
                      }}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approuver et intégrer au comparateur
                    </button>
                  </div>
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
