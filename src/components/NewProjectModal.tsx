import React, { useState } from 'react';
import { X, Plus, FolderPlus, Info, AlertTriangle } from 'lucide-react';
import { Project, ProcurementCategory, HorizonYears } from '../types/domain';
import { CreateProjectDTOSchema, formatZodError } from '../schemas/validationSchemas';
import { useAuth } from '../context/AuthContext';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddProject: (newProject: Project) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onAddProject,
}) => {
  const [name, setName] = useState('');
  /*
   * L'entité et le porteur du dossier ne sont PAS pré-remplis avec des valeurs
   * inventées : ils viennent de la session (organisation et utilisateur réels)
   * lorsque celle-ci existe, sinon ils restent vides et l'utilisateur les saisit.
   */
  const { user } = useAuth();
  const [companyName, setCompanyName] = useState(user?.organizationName ?? '');
  const [reference, setReference] = useState(`AO-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`);
  const [category, setCategory] = useState<ProcurementCategory>('flotte_automobile');
  const [budgetCap, setBudgetCap] = useState(1200000);
  const [horizonYears, setHorizonYears] = useState<HorizonYears>(5);
  const [analysisDurationMonths, setAnalysisDurationMonths] = useState(3);
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [plannedVolume, setPlannedVolume] = useState(30);
  const [unitName, setUnitName] = useState('unités');
  const [purchaseFrequency, setPurchaseFrequency] = useState<'unique' | 'annuel' | 'pluriannuel'>('unique');
  const [objective, setObjective] = useState('');
  const [ownerName, setOwnerName] = useState(user?.fullName ?? '');
  const [discountRate, setDiscountRate] = useState(0.045);
  const [carbonPrice, setCarbonPrice] = useState(120);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const applyPreset = (cat: ProcurementCategory) => {
    setCategory(cat);
    if (cat === 'flotte_automobile') {
      setName('Renouvellement Flotte 50 Utilitaires Légers (VUL)');
      setBudgetCap(500000);
      setPlannedVolume(50);
      setUnitName('véhicules');
      setHorizonYears(5);
      setDiscountRate(0.045);
      setCarbonPrice(120);
      setObjective('Arbitrage VUL électrique vs thermique pour livraisons urbaines en ZFE.');
    } else if (cat === 'informatique_it') {
      setName('Renouvellement 120 Postes de Travail & Serveurs Datacenter');
      setBudgetCap(280000);
      setPlannedVolume(120);
      setUnitName('postes & serveurs');
      setHorizonYears(3);
      setDiscountRate(0.05);
      setCarbonPrice(100);
      setObjective('Remplacement du parc informatique avec prise en compte du PUE et du recyclage DEEE.');
    } else if (cat === 'equipements_industriels') {
      setName('Acquisition 8 Lignes Robotisées de Conditionnement');
      setBudgetCap(1800000);
      setPlannedVolume(8);
      setUnitName('lignes industrielles');
      setHorizonYears(10);
      setDiscountRate(0.06);
      setCarbonPrice(140);
      setObjective('Modernisation outil de production, analyse de la maintenance préventive et de la valeur résiduelle.');
    } else if (cat === 'packaging') {
      setName('Approvisionnement Annuel 150 000 Emballages Recyclés');
      setBudgetCap(320000);
      setPlannedVolume(150000);
      setUnitName('emballages');
      setHorizonYears(2);
      setDiscountRate(0.035);
      setCarbonPrice(90);
      setObjective('Transition vers un packaging circulaire biosourcé conforme aux exigences PPWR.');
    } else if (cat === 'energie_batiment') {
      setName('Rénovation CVC & Efficacité Énergétique 4 Sites Tertiaires');
      setBudgetCap(750000);
      setPlannedVolume(4);
      setUnitName('bâtiments');
      setHorizonYears(7);
      setDiscountRate(0.04);
      setCarbonPrice(150);
      setObjective('Conformité Décret Tertiaire et réduction des consommations énergétiques Scope 1 & 2.');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationErrors([]);

    const candidatePayload = {
      organizationId: 'org-acme-fr',
      name: name.trim(),
      companyName: companyName.trim(),
      reference,
      category,
      budgetCap: Number(budgetCap),
      currency: '€',
      startDate,
      analysisDurationMonths: Number(analysisDurationMonths),
      horizonYears,
      plannedVolume: Number(plannedVolume),
      unitName: unitName.trim() || 'unités',
      purchaseFrequency,
      objective: objective.trim() || 'Arbitrage économique et ESG multicritères TrueTCO',
      ownerId: 'u-acheteur',
      ownerName: ownerName.trim() || 'porteur non renseigné',
      status: 'collecte_offres' as const,
      discountRate: Number(discountRate),
      carbonScenario: 'central' as const,
      carbonPricePerTonne: Number(carbonPrice),
      inflationRate: 0.02,
      energyInflationRate: 0.04,
    };

    const validation = CreateProjectDTOSchema.safeParse(candidatePayload);
    if (!validation.success) {
      setValidationErrors(formatZodError(validation.error));
      return;
    }

    const project: Project = {
      ...validation.data,
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onAddProject(project);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 overflow-hidden">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-950/60 border border-emerald-800/60 rounded-lg text-emerald-400">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Nouveau Projet d'Achat</h3>
              <p className="text-xs text-slate-400">Paramétrage du cadre d'arbitrage et des hypothèses TCO</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {validationErrors.length > 0 && (
          <div className="mt-3 p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-rose-300 text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5 text-rose-200">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              Contraintes de validation Zod non respectées :
            </div>
            <ul className="list-disc list-inside space-y-0.5 text-[11px] text-rose-300">
              {validationErrors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <form onSubmit={handleSubmit} className="py-4 space-y-4 text-xs text-slate-300">
          {/* Quick Presets */}
          <div className="space-y-1.5 pb-2 border-b border-slate-800">
            <label className="block text-slate-400 font-semibold text-[11px]">
              Modèles Clés en Main par Catégorie (Préremplissage) :
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset('flotte_automobile')}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                  category === 'flotte_automobile'
                    ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                🚚 Flotte VUL
              </button>
              <button
                type="button"
                onClick={() => applyPreset('informatique_it')}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                  category === 'informatique_it'
                    ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                💻 IT & Serveurs
              </button>
              <button
                type="button"
                onClick={() => applyPreset('equipements_industriels')}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                  category === 'equipements_industriels'
                    ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                ⚙️ Industrie
              </button>
              <button
                type="button"
                onClick={() => applyPreset('packaging')}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                  category === 'packaging'
                    ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                📦 Packaging
              </button>
              <button
                type="button"
                onClick={() => applyPreset('energie_batiment')}
                className={`px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors ${
                  category === 'energie_batiment'
                    ? 'bg-emerald-950/80 border-emerald-600 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700'
                }`}
              >
                ⚡ Énergie
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Nom du projet d'achat *</label>
              <input
                type="text"
                required
                placeholder="ex: Renouvellement 35 Chariots Élévateurs"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 text-xs"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Entreprise / Entité juridique</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Date de début</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Durée d'analyse (mois)</label>
              <input
                type="number"
                min="1"
                max="24"
                value={analysisDurationMonths}
                onChange={(e) => setAnalysisDurationMonths(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Fréquence d'achat</label>
              <select
                value={purchaseFrequency}
                onChange={(e) => setPurchaseFrequency(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="unique">Achat unique (Spot/CAPEX)</option>
                <option value="annuel">Récurrent annuel</option>
                <option value="pluriannuel">Contrat-cadre pluriannuel</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Référence AO</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Catégorie d'achat</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ProcurementCategory)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
              >
                <option value="flotte_automobile">Flotte automobile & VUL</option>
                <option value="informatique_it">Informatique & Équipements IT</option>
                <option value="equipements_industriels">Équipements & Machines Pro</option>
                <option value="packaging">Packaging & Emballages</option>
                <option value="energie_batiment">Énergie & Bâtiment</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-400 mb-1">Budget plafond (€)</label>
              <input
                type="number"
                min="1000"
                value={budgetCap}
                onChange={(e) => setBudgetCap(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Volume prévu</label>
              <input
                type="number"
                min="1"
                value={plannedVolume}
                onChange={(e) => setPlannedVolume(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Nom de l'unité</label>
              <input
                type="text"
                placeholder="unités / machines"
                value={unitName}
                onChange={(e) => setUnitName(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-xs">
              <Info className="w-3.5 h-3.5 text-emerald-400" />
              Hypothèses Financières & ESG
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Horizon TCO</label>
                <select
                  value={horizonYears}
                  onChange={(e) => setHorizonYears(Number(e.target.value) as HorizonYears)}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-white text-xs font-mono"
                >
                  <option value={1}>1 an</option>
                  <option value={3}>3 ans</option>
                  <option value={5}>5 ans (Standard)</option>
                  <option value={7}>7 ans</option>
                  <option value={10}>10 ans</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">WACC actualisation</label>
                <input
                  type="number"
                  step="0.005"
                  value={discountRate}
                  onChange={(e) => setDiscountRate(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-[11px] mb-1">Carbone (€/tCO2e)</label>
                <input
                  type="number"
                  step="5"
                  value={carbonPrice}
                  onChange={(e) => setCarbonPrice(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded text-white font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-slate-400 mb-1">Objectif d'arbitrage / Périmètre</label>
            <textarea
              rows={2}
              placeholder="Décrivez les enjeux d'arbitrage (ex: arbitrage entre achat thermique classique et motorisation propre sur le coût global)..."
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 text-xs"
            />
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Créer le projet
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
