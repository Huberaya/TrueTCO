import React, { useState } from 'react';
import { Supplier } from '../types/domain';
import {
  X,
  Building2,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Award,
  Phone,
  Mail,
  Truck,
  Leaf,
  Scale,
  Save,
  HelpCircle,
  Clock,
  TrendingDown,
  Info,
} from 'lucide-react';

interface SupplierDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  supplier: Supplier;
  onUpdateSupplier?: (updated: Supplier) => void;
}

const INCOTERMS_INFO: Record<string, { label: string; desc: string; hiddenCostRate: number; riskLevel: string }> = {
  DDP: {
    label: 'DDP (Delivered Duty Paid)',
    desc: 'Rendu droits acquittés. Le fournisseur supporte tous les coûts de transport, douanes et risques jusqu\'à vos locaux.',
    hiddenCostRate: 0,
    riskLevel: 'Risque Acheteur Nul (0%)',
  },
  DAP: {
    label: 'DAP (Delivered at Place)',
    desc: 'Marchandises mises à disposition à destination. Frais de dédouanement import à la charge de l\'acheteur.',
    hiddenCostRate: 0.03,
    riskLevel: 'Risque Faible (+3%)',
  },
  CIF: {
    label: 'CIF (Cost, Insurance & Freight)',
    desc: 'Coût, assurance et fret payés jusqu\'au port d\'arrivée. Post-acheminement et douanes à charge acheteur.',
    hiddenCostRate: 0.07,
    riskLevel: 'Risque Modéré (+7%)',
  },
  FOB: {
    label: 'FOB (Free on Board)',
    desc: 'Franco à bord. L\'acheteur organise et paie le fret principal, l\'assurance maritime et l\'import.',
    hiddenCostRate: 0.10,
    riskLevel: 'Risque Moyen (+10%)',
  },
  EXW: {
    label: 'EXW (Ex Works)',
    desc: 'Départ usine. L\'acheteur prend TOUT en charge depuis les locaux du fournisseur (enlèvement, transit, douanes).',
    hiddenCostRate: 0.15,
    riskLevel: 'Risque Élevé (+15% de frais cachés)',
  },
};

export const SupplierDetailModal: React.FC<SupplierDetailModalProps> = ({
  isOpen,
  onClose,
  supplier,
  onUpdateSupplier,
}) => {
  const [name, setName] = useState(supplier.name);
  const [country, setCountry] = useState(supplier.country);
  const [sector, setSector] = useState(supplier.sector);
  const [contactName, setContactName] = useState(supplier.contactName || '');
  const [contactEmail, setContactEmail] = useState(supplier.contactEmail);
  const [contactPhone, setContactPhone] = useState(supplier.contactPhone || '');
  const [defaultIncoterm, setDefaultIncoterm] = useState(supplier.defaultIncoterm || 'DDP');
  const [leadTimeDays, setLeadTimeDays] = useState(supplier.leadTimeDays || 30);
  const [warrantyMonths, setWarrantyMonths] = useState(supplier.warrantyMonths || 24);
  const [historicalDefectRate, setHistoricalDefectRate] = useState(supplier.historicalDefectRate || 0.02);
  const [esgScore, setEsgScore] = useState(supplier.esgScore || 70);
  const [dataQualityScore, setDataQualityScore] = useState(supplier.dataQualityScore || 85);
  const [paymentTerms, setPaymentTerms] = useState(supplier.paymentTerms || '30j fin de mois');
  const [moq, setMoq] = useState(supplier.moq || 1);
  const [certificationsText, setCertificationsText] = useState(supplier.certifications.join(', '));

  const [activeTab, setActiveTab] = useState<'profile' | 'incoterms' | 'quality'>('profile');
  const [isSavedNotice, setIsSavedNotice] = useState(false);

  if (!isOpen) return null;

  const currentIncoterm = INCOTERMS_INFO[defaultIncoterm] || INCOTERMS_INFO.DDP;

  const handleSave = () => {
    const updated: Supplier = {
      ...supplier,
      name: name.trim(),
      country: country.trim(),
      sector: sector.trim(),
      contactName: contactName.trim(),
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim(),
      defaultIncoterm,
      leadTimeDays: Number(leadTimeDays),
      warrantyMonths: Number(warrantyMonths),
      historicalDefectRate: Number(historicalDefectRate),
      esgScore: Number(esgScore),
      dataQualityScore: Number(dataQualityScore),
      paymentTerms: paymentTerms.trim(),
      moq: Number(moq),
      certifications: certificationsText
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    };

    if (onUpdateSupplier) {
      onUpdateSupplier(updated);
    }

    setIsSavedNotice(true);
    setTimeout(() => setIsSavedNotice(false), 3000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="relative w-full max-w-3xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-950/60 border border-emerald-800/60 rounded-xl text-emerald-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold text-white tracking-tight">{supplier.name}</h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {supplier.country}
                </span>
                <span className="text-[10px] text-emerald-400 font-mono font-semibold bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-800">
                  Fournisseur Qualifié
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Chantier 4 · Référentiel Tiers, Incoterms & Indice de Fiabilité Documentaire
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-800 bg-slate-900/50 text-xs">
          <button
            onClick={() => setActiveTab('profile')}
            className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'profile'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            Identité & Conditions Commerciales
          </button>
          <button
            onClick={() => setActiveTab('incoterms')}
            className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'incoterms'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Truck className="w-3.5 h-3.5" />
            Incoterm & Coûts Logistiques Cachés
          </button>
          <button
            onClick={() => setActiveTab('quality')}
            className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'quality'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Qualité des Données & Scoring RSE
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs text-slate-300">
          {/* TAB 1: IDENTITE ET CONDITIONS */}
          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Raison Sociale *</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Pays d'Implantation *</label>
                  <input
                    type="text"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Interlocuteur Commercial</label>
                  <input
                    type="text"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Courriel de Contact *</label>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Téléphone Direct</label>
                  <input
                    type="text"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800/80">
                <div>
                  <label className="block text-slate-400 mb-1">Conditions de Paiement</label>
                  <input
                    type="text"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="30j fin de mois"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Délai Livraison Moyen (jours)</label>
                  <input
                    type="number"
                    value={leadTimeDays}
                    onChange={(e) => setLeadTimeDays(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Garantie Contractuelle (mois)</label>
                  <input
                    type="number"
                    value={warrantyMonths}
                    onChange={(e) => setWarrantyMonths(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Certifications (séparées par une virgule)</label>
                <input
                  type="text"
                  value={certificationsText}
                  onChange={(e) => setCertificationsText(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  placeholder="ISO 14001, EcoVadis Gold, ISO 9001..."
                />
              </div>
            </div>
          )}

          {/* TAB 2: INCOTERMS ET COUTS CACHES */}
          {activeTab === 'incoterms' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-sky-950/30 border border-sky-900/60 rounded-xl flex items-start gap-2.5 text-sky-300">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="text-[11px] leading-relaxed">
                  L'Incoterm détermine le transfert de frais et de risques entre le vendeur et l'acheteur. Dans le calcul du TCO global, un Incoterm défavorable (ex: EXW ou FOB) génère des coûts cachés de dédouanement, transport amont et assurances qui sont réintégrés dans l'évaluation économique.
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-semibold">Incoterm Contractuel par Défaut</label>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  {Object.entries(INCOTERMS_INFO).map(([key, info]) => {
                    const isSelected = defaultIncoterm === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDefaultIncoterm(key)}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          isSelected
                            ? 'bg-emerald-950/80 border-emerald-600 ring-1 ring-emerald-500/40'
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="font-bold text-white font-mono">{key}</div>
                        <div
                          className={`text-[10px] font-medium mt-1 ${
                            info.hiddenCostRate === 0
                              ? 'text-emerald-400'
                              : info.hiddenCostRate <= 0.05
                              ? 'text-sky-400'
                              : 'text-amber-400'
                          }`}
                        >
                          {info.riskLevel}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Incoterm Explanation Box */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <div className="font-bold text-white text-xs flex items-center justify-between">
                  <span>{currentIncoterm.label}</span>
                  <span className="font-mono text-emerald-400">
                    Impact TCO estimé : +{(currentIncoterm.hiddenCostRate * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed">{currentIncoterm.desc}</p>
              </div>

              {/* Defect Rate and Operational Risk */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white text-xs">
                    Taux Historique de Défaillance & Non-Qualité (P x I)
                  </div>
                  <span className="font-mono font-bold text-amber-400 text-xs">
                    {(historicalDefectRate * 100).toFixed(1)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.002"
                  max="0.08"
                  step="0.001"
                  value={historicalDefectRate}
                  onChange={(e) => setHistoricalDefectRate(Number(e.target.value))}
                  className="w-full accent-amber-500 bg-slate-800"
                />
                <p className="text-[10px] text-slate-400 leading-tight">
                  Ce taux alimente directement le module de risque $P \times I$ du moteur TCO pour modéliser le coût des pannes, réparations sous garantie et temps d'arrêt de production.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: QUALITE DES DONNEES ET ESG */}
          {activeTab === 'quality' && (
            <div className="space-y-4">
              {/* Data Quality Score Slider */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white text-xs flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Indice de Fiabilité & Qualité des Données Fournisseur
                    </div>
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Mesure l'exhaustivité des pièces justificatives (devis fermes, factures, ACV tierce partie).
                    </p>
                  </div>
                  <span
                    className={`font-mono font-bold text-sm ${
                      dataQualityScore >= 90
                        ? 'text-emerald-400'
                        : dataQualityScore >= 75
                        ? 'text-sky-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {dataQualityScore}%
                  </span>
                </div>

                <input
                  type="range"
                  min="30"
                  max="100"
                  value={dataQualityScore}
                  onChange={(e) => setDataQualityScore(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-slate-800"
                />

                {dataQualityScore < 75 && (
                  <div className="p-2.5 bg-amber-950/40 border border-amber-800/80 rounded-lg text-amber-300 text-[11px] flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                    <span>
                      Qualité documentaire insuffisante (&lt; 75%) : une pénalité d'incertitude de ±15% sera appliquée sur l'intervalle de confiance du TCO.
                    </span>
                  </div>
                )}
              </div>

              {/* ESG Score Slider */}
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-white text-xs flex items-center gap-1.5">
                    <Leaf className="w-4 h-4 text-emerald-400" />
                    Score de Maturité RSE & Environnementale
                  </div>
                  <span className="font-mono font-bold text-emerald-400 text-sm">{esgScore}/100</span>
                </div>

                <input
                  type="range"
                  min="10"
                  max="100"
                  value={esgScore}
                  onChange={(e) => setEsgScore(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-slate-800"
                />

                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Score EcoVadis / B Corp audité</span>
                  <span>Impacte la pondération ESG dans la matrice 360°</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            {isSavedNotice && (
              <span className="text-emerald-400 font-mono flex items-center gap-1.5 animate-fadeIn">
                <CheckCircle2 className="w-4 h-4" />
                Fiche fournisseur mise à jour dans Neon DB !
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-xs transition-colors"
            >
              Fermer
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs transition-colors shadow-sm flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Enregistrer les Modifications</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
