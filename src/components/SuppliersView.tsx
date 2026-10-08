import React, { useState } from 'react';
import { Supplier } from '../types/domain';
import {
  Building2,
  ShieldCheck,
  CheckCircle2,
  Award,
  Search,
  Plus,
  Filter,
  Phone,
  Mail,
  Clock,
  FileCheck,
  Leaf,
  BarChart,
  Truck,
  Download,
  AlertTriangle,
  Sliders,
  HelpCircle,
  TrendingDown,
  Info,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { AddSupplierModal } from './AddSupplierModal';
import { SupplierDetailModal } from './SupplierDetailModal';

interface SuppliersViewProps {
  suppliers: Supplier[];
  onAddSupplier?: (sup: Supplier) => void;
  onUpdateSupplier?: (updated: Supplier) => void;
}

export const SuppliersView: React.FC<SuppliersViewProps> = ({
  suppliers,
  onAddSupplier,
  onUpdateSupplier,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [certFilter, setCertFilter] = useState('all');
  const [activeTab, setActiveTab] = useState<'list' | 'incoterms' | 'kraljic'>('list');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);

  // Incoterm simulator state
  const [simulatedPurchaseAmount, setSimulatedPurchaseAmount] = useState(500000);
  const [simulatedIncoterm, setSimulatedIncoterm] = useState('EXW');

  const filtered = suppliers.filter((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.sector.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.country.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.contactName && s.contactName.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesSector = sectorFilter === 'all' || s.sector === sectorFilter;
    const matchesCert =
      certFilter === 'all' ||
      s.certifications.some((c) => c.toLowerCase().includes(certFilter.toLowerCase()));

    return matchesSearch && matchesSector && matchesCert;
  });

  const avgEsg = Math.round(
    suppliers.reduce((acc, s) => acc + s.esgScore, 0) / (suppliers.length || 1)
  );

  const avgDataQuality = Math.round(
    suppliers.reduce((acc, s) => acc + s.dataQualityScore, 0) / (suppliers.length || 1)
  );

  const iso14001Count = suppliers.filter((s) =>
    s.certifications.some((c) => c.includes('14001'))
  ).length;

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Nom',
      'Pays',
      'Secteur',
      'Contact',
      'Email',
      'Incoterm',
      'Score_ESG',
      'Qualite_Donnees',
      'Taux_Defauts_Pct',
      'Delai_Jours',
      'Garantie_Mois',
      'Certifications',
    ];
    const rows = suppliers.map((s) => [
      `"${s.name.replace(/"/g, '""')}"`,
      `"${s.country}"`,
      `"${s.sector}"`,
      `"${s.contactName || ''}"`,
      `"${s.contactEmail}"`,
      `"${s.defaultIncoterm}"`,
      s.esgScore,
      s.dataQualityScore,
      (s.historicalDefectRate * 100).toFixed(2),
      s.leadTimeDays,
      s.warrantyMonths,
      `"${s.certifications.join('; ')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `referentiel_fournisseurs_truetco_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <Building2 className="w-4 h-4 text-emerald-400" />
            Base fournisseurs & qualité des données
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Référentiel Fournisseurs, Incoterms & Scoring Qualité
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Gestion des tiers conforme à la Section 6 : Incoterms contractuels (frais cachés logistiques), taux de défaillance $P \times I$, certifications environnementales et pénalités d'incertitude documentaire.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCSV}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Exporter tout le référentiel au format CSV"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Référencer un Fournisseur
          </button>
        </div>
      </div>

      {/* Top 4 Performance & Quality KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Fournisseurs Qualifiés</div>
          <div className="text-xl font-bold font-mono text-white mt-0.5">{suppliers.length}</div>
          <div className="text-[10px] text-slate-500">Tiers actifs dans Neon DB</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Score ESG Moyen</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">{avgEsg}/100</div>
          <div className="text-[10px] text-slate-500">Évaluation RSE globale</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Qualité Moyenne Données</div>
          <div className="text-xl font-bold font-mono text-sky-400 mt-0.5">{avgDataQuality}%</div>
          <div className="text-[10px] text-slate-500">Fiabilité des pièces justificatives</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Déclarent ISO 14001 / EcoVadis</div>
          <div className="text-xl font-bold font-mono text-indigo-400 mt-0.5">{iso14001Count}</div>
          <div className="text-[10px] text-slate-500">Management environnemental</div>
        </div>
      </div>

      {/* Chantier 4 Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 text-xs">
        <button
          onClick={() => setActiveTab('list')}
          className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'list'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Building2 className="w-3.5 h-3.5" />
          Annuaire & Fiches Fournisseurs ({suppliers.length})
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
          Simulateur d'Incoterms & Coûts Cachés
        </button>
        <button
          onClick={() => setActiveTab('kraljic')}
          className={`pb-2.5 font-semibold px-2 border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'kraljic'
              ? 'border-emerald-500 text-emerald-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <BarChart className="w-3.5 h-3.5" />
          Matrice de Dépendance & Risque Tiers
        </button>
      </div>

      {/* TAB 1: LISTE ET FICHES FOURNISSEURS */}
      {activeTab === 'list' && (
        <div className="space-y-4">
          {/* Filter and Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="Rechercher par raison sociale, pays, interlocuteur ou secteur..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={sectorFilter}
                onChange={(e) => setSectorFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">Tous les secteurs</option>
                <option value="Véhicules & Mobilité Pro">Véhicules & Mobilité Pro</option>
                <option value="Mobilité Zéro Émission">Mobilité Zéro Émission</option>
                <option value="Économie Circulaire & Rétrofit">Économie Circulaire & Rétrofit</option>
                <option value="Matériel Informatique & Postes">Matériel Informatique & Postes</option>
                <option value="Informatique Reconditionnée B2B">Informatique Reconditionnée B2B</option>
              </select>

              <select
                value={certFilter}
                onChange={(e) => setCertFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">Toutes certifications</option>
                <option value="14001">ISO 14001</option>
                <option value="9001">ISO 9001</option>
                <option value="EcoVadis">EcoVadis</option>
                <option value="B Corp">B Corp</option>
              </select>
            </div>
          </div>

          {/* Suppliers Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map((s) => (
              <div
                key={s.id}
                className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4 hover:border-slate-700 transition-colors shadow-sm"
              >
                {/* Top Identity Block */}
                <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-emerald-400" />
                      {s.name}
                    </h3>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {s.sector} · <strong className="text-slate-300">{s.country}</strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelectedSupplier(s)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      title="Consulter et modifier la fiche détaillée"
                    >
                      <Sliders className="w-3 h-3 text-emerald-400" />
                      <span>Fiche Tiers</span>
                    </button>

                    <div className="p-1 bg-slate-950 border border-slate-800 rounded-lg text-right">
                      <div className="text-[8px] text-slate-500 uppercase tracking-wider">Score ESG</div>
                      <div className={`font-mono font-bold text-xs ${s.esgScore >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {s.esgScore}/100
                      </div>
                    </div>
                  </div>
                </div>

                {/* Direct Contacts */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80">
                  {s.contactName && (
                    <span className="font-medium text-white">{s.contactName}</span>
                  )}
                  <span className="flex items-center gap-1 text-slate-400">
                    <Mail className="w-3 h-3 text-slate-500" />
                    <a href={`mailto:${s.contactEmail}`} className="hover:text-emerald-400 transition-colors">
                      {s.contactEmail}
                    </a>
                  </span>
                  {s.contactPhone && (
                    <span className="flex items-center gap-1 text-slate-400 font-mono">
                      <Phone className="w-3 h-3 text-slate-500" />
                      {s.contactPhone}
                    </span>
                  )}
                </div>

                {/* Certifications */}
                <div className="space-y-1.5">
                  <div className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-sky-400" />
                    Certifications officielles :
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.certifications.map((c, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300 font-medium"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Commercial terms & Performance */}
                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                  <div>
                    <span className="text-slate-400 text-[11px]">Incoterm & Devise</span>
                    <div className="font-mono text-emerald-400 font-medium mt-0.5">
                      {s.defaultIncoterm} ({s.currency})
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px]">Conditions Règlement</span>
                    <div className="text-slate-200 mt-0.5 truncate">{s.paymentTerms}</div>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px]">Délai Livraison</span>
                    <div className="font-mono text-white font-medium mt-0.5">
                      {s.leadTimeDays || 30} jours
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px]">Garantie Standard</span>
                    <div className="font-mono text-white font-medium mt-0.5">{s.warrantyMonths} mois</div>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px]">Défauts Historiques</span>
                    <div className="font-mono text-amber-400 font-medium mt-0.5">
                      {(s.historicalDefectRate * 100).toFixed(1)}%
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-400 text-[11px]">MOQ Minimal</span>
                    <div className="font-mono text-white font-medium mt-0.5">{s.moq} unités</div>
                  </div>
                </div>

                {/* Data Quality Score Bar with Uncertainty Warning */}
                <div className="pt-2 border-t border-slate-800/80 space-y-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[11px] text-slate-400 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      Indice de Fiabilité Documentaire :
                    </span>
                    <span className="font-mono font-bold text-white">{s.dataQualityScore}%</span>
                  </div>
                  <div className="h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      style={{ width: `${s.dataQualityScore}%` }}
                      className={`h-full rounded-full transition-all ${
                        s.dataQualityScore >= 90
                          ? 'bg-emerald-500'
                          : s.dataQualityScore >= 75
                          ? 'bg-sky-500'
                          : 'bg-amber-500'
                      }`}
                    />
                  </div>
                  {s.dataQualityScore < 75 && (
                    <div className="text-[10px] text-amber-400/90 flex items-center gap-1 mt-0.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      Incertitude modérée : intervalle de confiance élargi à ±15%
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: SIMULATEUR D'INCOTERMS & COUTS LOGISTIQUES */}
      {activeTab === 'incoterms' && (
        <div className="space-y-6">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-4 text-xs">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Truck className="w-4 h-4 text-emerald-400" />
                Simulateur d'Impact TCO des Incoterms (Coûts Cachés Logistiques & Douanes)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Le prix facial d'une offre est trompeur s'il est exprimé en EXW (départ usine) ou FOB (franco à bord).
                TrueTCO réintègre les surcoûts réels de transport amont, assurances de transit et frais de dédouanement.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <label className="block text-slate-400 font-semibold">Montant d'Achat Facial Simulé (€)</label>
                <div className="relative">
                  <input
                    type="number"
                    step="10000"
                    value={simulatedPurchaseAmount}
                    onChange={(e) => setSimulatedPurchaseAmount(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <span className="absolute right-3 top-2.5 text-slate-500 font-mono">€</span>
                </div>

                <div className="space-y-1">
                  <label className="block text-slate-400 text-[11px]">Incoterm de l'Offre</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {['DDP', 'DAP', 'CIF', 'FOB', 'EXW'].map((inc) => (
                      <button
                        key={inc}
                        onClick={() => setSimulatedIncoterm(inc)}
                        className={`py-1.5 font-mono font-bold rounded-lg border text-xs transition-colors ${
                          simulatedIncoterm === inc
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {inc}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Simulation Result Box */}
              {(() => {
                const rates: Record<string, { rate: number; label: string; desc: string }> = {
                  DDP: { rate: 0, label: 'Rendu Droits Acquittés', desc: 'Le fournisseur prend tout en charge jusqu\'à vos quais. 0 € de frais cachés.' },
                  DAP: { rate: 0.03, label: 'Rendu au Lieu de Destination', desc: 'Dédouanement import et taxes de transit locales à la charge de l\'acheteur.' },
                  CIF: { rate: 0.07, label: 'Coût, Assurance et Fret', desc: 'Post-acheminement portuaire et dédouanement à la charge de l\'acheteur.' },
                  FOB: { rate: 0.10, label: 'Franco à Bord', desc: 'Fret maritime/aérien principal, assurance transit et formalités d\'importation à votre charge.' },
                  EXW: { rate: 0.15, label: 'Départ Usine', desc: 'L\'acheteur supporte l\'intégralité de la chaîne logistique, risques d\'avaries et douanes export/import.' },
                };
                const current = rates[simulatedIncoterm] || rates.EXW;
                const hiddenCost = simulatedPurchaseAmount * current.rate;
                const realisticTotal = simulatedPurchaseAmount + hiddenCost;

                return (
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-400 text-[11px] uppercase font-semibold">Surcoût Logistique Estimé</span>
                        <span className="text-xs font-mono font-bold text-amber-400">
                          +{(current.rate * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-2xl font-bold font-mono text-rose-400 mt-1">
                        +{hiddenCost.toLocaleString('fr-FR')} €
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{current.desc}</div>
                    </div>

                    <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                      <span className="text-slate-300 font-semibold">Coût Réel Ajusté TCO :</span>
                      <span className="text-base font-bold font-mono text-emerald-400">
                        {realisticTotal.toLocaleString('fr-FR')} €
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MATRICE DE KRALJIC & CRITICITE TIERS */}
      {activeTab === 'kraljic' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-4 text-xs">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <BarChart className="w-4 h-4 text-emerald-400" />
                Matrice de Dépendance & Risque Fournisseur (Cadre Kraljic)
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Classification des fournisseurs du référentiel selon leur criticité opérationnelle (délais, taux de panne) et leur performance ESG/qualité documentaire.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Cadran 1: Stratégiques */}
              <div className="p-4 bg-slate-950 border border-emerald-900/60 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-400 text-xs uppercase tracking-wider">
                    Partenaires Stratégiques (Fort Impact & Haute Fiabilité)
                  </span>
                  <Award className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-[11px] text-slate-400">
                  Fournisseurs dont les scores saisis (ESG &gt; 80, qualité &gt; 85 %) sont élevés. Ces scores sont
                  déclarés ou saisis dans le dossier : ils ne sont pas vérifiés par un tiers.
                </p>
                <div className="space-y-1.5 pt-2">
                  {suppliers
                    .filter((s) => s.esgScore >= 80 && s.dataQualityScore >= 80)
                    .map((s) => (
                      <div
                        key={s.id}
                        onClick={() => setSelectedSupplier(s)}
                        className="p-2 bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center justify-between cursor-pointer transition-colors border border-slate-800"
                      >
                        <span className="font-bold text-white text-xs">{s.name}</span>
                        <span className="font-mono text-emerald-400 text-[11px]">ESG {s.esgScore} · {s.defaultIncoterm}</span>
                      </div>
                    ))}
                </div>
              </div>

              {/* Cadran 2: À Surveiller / Risque documentaire */}
              <div className="p-4 bg-slate-950 border border-amber-900/60 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-amber-400 text-xs uppercase tracking-wider">
                    Tiers sous Surveillance (Qualité Documentaire &lt; 80%)
                  </span>
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                </div>
                <p className="text-[11px] text-slate-400">
                  Fournisseurs nécessitant des audits complémentaires pour consolider les données d'ACV et garanties de livraison.
                </p>
                <div className="space-y-1.5 pt-2">
                  {suppliers
                    .filter((s) => s.dataQualityScore < 80 || s.historicalDefectRate > 0.02)
                    .map((s) => (
                      <div
                        key={s.id}
                        onClick={() => setSelectedSupplier(s)}
                        className="p-2 bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center justify-between cursor-pointer transition-colors border border-slate-800"
                      >
                        <span className="font-bold text-white text-xs">{s.name}</span>
                        <span className="font-mono text-amber-400 text-[11px]">Qualité {s.dataQualityScore}% · Pannes {(s.historicalDefectRate*100).toFixed(1)}%</span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Supplier Modal */}
      <AddSupplierModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddSupplier={(newSup) => {
          if (onAddSupplier) {
            onAddSupplier(newSup);
          }
        }}
      />

      {/* Edit / Detail Supplier Modal */}
      {selectedSupplier && (
        <SupplierDetailModal
          isOpen={Boolean(selectedSupplier)}
          onClose={() => setSelectedSupplier(null)}
          supplier={selectedSupplier}
          onUpdateSupplier={(updated) => {
            if (onUpdateSupplier) {
              onUpdateSupplier(updated);
            }
            setSelectedSupplier(updated);
          }}
        />
      )}
    </div>
  );
};
