import { useTenant } from '../context/TenantContext';
import React, { useState } from 'react';
import { Supplier } from '../types/domain';
import { X, Building2, ShieldCheck, Award } from 'lucide-react';

interface AddSupplierModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddSupplier: (sup: Supplier) => void;
}

export const AddSupplierModal: React.FC<AddSupplierModalProps> = ({
  isOpen,
  onClose,
  onAddSupplier,
}) => {
  const { currentTenant } = useTenant();
  const [name, setName] = useState('');
  const [country, setCountry] = useState('France');
  const [sector, setSector] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [defaultIncoterm, setDefaultIncoterm] = useState('DDP');
  const [currency, setCurrency] = useState('EUR');
  const [paymentTerms, setPaymentTerms] = useState('30 jours fin de mois');
  // Aucune valeur présumée : chaque indicateur doit être saisi (une note par défaut fausserait les classements).
  const [moq, setMoq] = useState('');
  const [leadTimeDays, setLeadTimeDays] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState('');
  const [historicalDefectRate, setHistoricalDefectRate] = useState('');
  const [esgScore, setEsgScore] = useState('');
  const [performanceScore, setPerformanceScore] = useState('');
  const [certificationsText, setCertificationsText] = useState('');
  const [envDataText, setEnvDataText] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !contactEmail.trim()) return;

    const certList = certificationsText
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);

    const envList = envDataText
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    // Indicateur de COMPLÉTUDE de la fiche (part des informations documentaires renseignées), pas une mesure de fiabilité.
    const docFields = [certList.length > 0, envList.length > 0, contactPhone.trim() !== '', contactName.trim() !== '', sector.trim() !== ''];
    const quality = Math.round((100 * docFields.filter(Boolean).length) / docFields.length);

    const newSupplier: Supplier = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`,
      organizationId: currentTenant.id,
      name: name.trim(),
      country: country.trim(),
      sector: sector.trim(),
      contactName: contactName.trim() || undefined,
      contactEmail: contactEmail.trim(),
      contactPhone: contactPhone.trim() || undefined,
      certifications: certList,
      defaultIncoterm,
      currency,
      paymentTerms,
      moq: Number(moq),
      leadTimeDays: Number(leadTimeDays),
      historicalDefectRate: Number(historicalDefectRate) / 100,
      warrantyMonths: Number(warrantyMonths),
      performanceScore: Number(performanceScore),
      esgScore: Number(esgScore),
      environmentalDataAvailable: envList,
      dataQualityScore: quality,
    };

    onAddSupplier(newSupplier);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-emerald-400" />
            <div>
              <h3 className="text-base font-bold text-white">Référencer & Qualifier un Fournisseur</h3>
              <p className="text-xs text-slate-400">Renseignement des attributs de conformité, Incoterms et données RSE.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs text-slate-300">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Raison sociale du fournisseur *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: VoltFleet Mobilités Vertes"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Pays d'implantation</label>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Interlocuteur direct</label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Prénom Nom"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Email professionnel *</label>
              <input
                type="email"
                required
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="contact@fournisseur.com"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Téléphone</label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+33 1 00 00 00 00"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Incoterm par défaut</label>
              <select
                value={defaultIncoterm}
                onChange={(e) => setDefaultIncoterm(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
              >
                <option value="DDP">DDP (Rendu droits acquittés)</option>
                <option value="DAP">DAP (Rendu au lieu de destination)</option>
                <option value="FOB">FOB (Franco à bord)</option>
                <option value="EXW">EXW (Départ usine)</option>
                <option value="CIF">CIF (Coût, assurance et fret)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Conditions de règlement</label>
              <input
                type="text"
                value={paymentTerms}
                onChange={(e) => setPaymentTerms(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Délai moyen de livraison (j)</label>
              <input
                type="number"
                min="1"
                value={leadTimeDays}
                required
                onChange={(e) => setLeadTimeDays(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Commande minimale (qté) *</label>
              <input
                type="number"
                min="1"
                required
                value={moq}
                onChange={(e) => setMoq(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Garantie standard (mois)</label>
              <input
                type="number"
                min="6"
                value={warrantyMonths}
                required
                onChange={(e) => setWarrantyMonths(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Taux de défaut historique (%)</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={historicalDefectRate}
                required
                onChange={(e) => setHistoricalDefectRate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Performance historique (0-100) *</label>
              <input
                type="number"
                min="0"
                max="100"
                required
                value={performanceScore}
                onChange={(e) => setPerformanceScore(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Score ESG / RSE (sur 100)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={esgScore}
                required
                onChange={(e) => setEsgScore(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Certifications déclarées par le fournisseur (séparées par des virgules)</label>
            <input
              type="text"
              value={certificationsText}
              onChange={(e) => setCertificationsText(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Données environnementales fournies (séparées par des virgules)</label>
            <input
              type="text"
              value={envDataText}
              onChange={(e) => setEnvDataText(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
            >
              Enregistrer le Fournisseur
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
