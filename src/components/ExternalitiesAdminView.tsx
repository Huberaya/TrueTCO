import React, { useState } from 'react';
import { ExternalityReferenceBenchmark } from '../types/domain';
import {
  Database,
  ExternalLink,
  ShieldCheck,
  Edit3,
  Check,
  Plus,
  Search,
  Filter,
  X,
  History,
  AlertCircle,
  AlertTriangle,
  FileCheck2,
} from 'lucide-react';

interface ExternalitiesAdminViewProps {
  benchmarks: ExternalityReferenceBenchmark[];
  onUpdateBenchmark: (updated: ExternalityReferenceBenchmark, justification: string) => void;
  onAddBenchmark?: (newBench: ExternalityReferenceBenchmark) => void;
}

export const ExternalitiesAdminView: React.FC<ExternalitiesAdminViewProps> = ({
  benchmarks,
  onUpdateBenchmark,
  onAddBenchmark,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  // Edit Factor with Justification Modal state
  const [selectedBenchmark, setSelectedBenchmark] = useState<ExternalityReferenceBenchmark | null>(null);
  const [editValue, setEditValue] = useState<number>(0);
  const [editRangeMin, setEditRangeMin] = useState<number>(0);
  const [editRangeMax, setEditRangeMax] = useState<number>(0);
  const [justification, setJustification] = useState<string>('');

  // Add Factor Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<'carbone' | 'energie' | 'dechets' | 'wacc' | 'pollution_locale'>('carbone');
  const [newValue, setNewValue] = useState(0);
  const [newUnit, setNewUnit] = useState('€/tCO2e');
  // Plus aucune source institutionnelle pré-remplie : un référentiel saisi par
  // défaut (« Commission Quinet », « ADEME »…) laissait croire à une donnée
  // officielle alors qu'elle n'était pas renseignée par l'utilisateur.
  const [newSource, setNewSource] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newCountryScope, setNewCountryScope] = useState('France');
  const [newMethodology, setNewMethodology] = useState('');
  const [newDocumentRef, setNewDocumentRef] = useState('');
  const [newRangeMin, setNewRangeMin] = useState('');
  const [newRangeMax, setNewRangeMax] = useState('');
  const [newConfidence, setNewConfidence] = useState(50);

  const filteredBenchmarks = benchmarks.filter((b) => {
    const matchesSearch =
      b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
      b.countryScope.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || b.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  const openEditModal = (b: ExternalityReferenceBenchmark) => {
    setSelectedBenchmark(b);
    setEditValue(b.value);
    setEditRangeMin(b.valueRange ? b.valueRange[0] : b.value * 0.9);
    setEditRangeMax(b.valueRange ? b.valueRange[1] : b.value * 1.1);
    setJustification('');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBenchmark || !justification.trim()) return;

    onUpdateBenchmark(
      {
        ...selectedBenchmark,
        value: Number(editValue),
        valueRange: [Number(editRangeMin), Number(editRangeMax)],
        lastUpdated: new Date().toISOString().split('T')[0],
      },
      justification.trim()
    );

    setSelectedBenchmark(null);
  };

  const handleSaveAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !onAddBenchmark) return;

    // Un intervalle d'incertitude ne se déduit pas automatiquement de la valeur
    // pivot (±15 % était appliqué sans base méthodologique) : il est soit saisi,
    // soit absent.
    const hasRange = newRangeMin.trim() !== '' && newRangeMax.trim() !== '';

    const newBench: ExternalityReferenceBenchmark = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`,
      name: newName.trim(),
      category: newCategory,
      value: Number(newValue),
      unit: newUnit.trim(),
      source: newSource.trim(),
      sourceUrl: newSourceUrl.trim() || undefined,
      lastUpdated: new Date().toISOString().split('T')[0],
      countryScope: newCountryScope.trim(),
      methodology: newMethodology.trim(),
      valueRange: hasRange ? [Number(newRangeMin), Number(newRangeMax)] : undefined,
      confidenceLevel: Number(newConfidence),
      documentRef: newDocumentRef.trim() || 'NON RENSEIGNÉ — référence non vérifiable',
      isDemoHypothesis: true,
      verificationNote:
        'Référentiel saisi manuellement dans cette instance : vérifier la publication d’origine (émetteur, millésime, périmètre) avant tout usage décisionnel.',
    };

    onAddBenchmark(newBench);
    setIsAddModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
            <Database className="w-4 h-4 text-emerald-400" />
            Référentiels d'externalités & traçabilité
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Base de Données des Externalités (ADEME / Quinet / WACC)
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Conforme à la Section 12 : gestion des 10 attributs normatifs (nom, valeur, unité, source, URL, date, pays, méthode, intervalle, confiance). Toute révision exige une justification formelle inscrite au journal d'audit.
          </p>
        </div>

        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          Nouveau Facteur Référentiel
        </button>
      </div>

      {/* Top 4 Indicator Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Facteurs Indexés</div>
          <div className="text-xl font-bold font-mono text-white mt-0.5">{benchmarks.length}</div>
          <div className="text-[10px] text-slate-500">ADEME, Quinet, WACC, CRE</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Prix interne du carbone utilisé</div>
          <div className="text-xl font-bold font-mono text-sky-400 mt-0.5">
            {benchmarks.find((b) => b.category === 'carbone')?.value ?? '—'} €/tCO2e
          </div>
          <div className="text-[10px] text-slate-500">
            Hypothèse paramétrable — à valider par la Direction Financière
          </div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Confiance Moyenne</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
            {Math.round(benchmarks.reduce((acc, b) => acc + b.confidenceLevel, 0) / (benchmarks.length || 1))}%
          </div>
          <div className="text-[10px] text-slate-500">
            Aucune donnée n'est certifiée automatiquement
          </div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Traçabilité des révisions</div>
          <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
            {benchmarks.length} facteur(s)
          </div>
          <div className="text-[10px] text-slate-500">
            Justification requise à chaque révision — journal d'audit applicatif
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Rechercher par nom, organisme source ou zone géographique..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-500" />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Toutes les catégories</option>
            <option value="carbone">Carbone & GES</option>
            <option value="energie">Énergie & Électricité</option>
            <option value="wacc">WACC & Taux d'actualisation</option>
            <option value="dechets">Fin de vie & Déchets</option>
            <option value="pollution_locale">Pollution locale (ZFE)</option>
          </select>
        </div>
      </div>

      {/* Benchmarks Table with 10 Standardized Fields */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <th className="py-3 px-4 font-semibold text-white">Référentiel & Document</th>
                <th className="py-3 px-4 font-semibold text-white">Valeur Pivot & Unité</th>
                <th className="py-3 px-4 font-semibold text-white">Intervalle Min/Max</th>
                <th className="py-3 px-4 font-semibold text-white">Source Institutionnelle & URL</th>
                <th className="py-3 px-4 font-semibold text-white">Méthodologie & Périmètre</th>
                <th className="py-3 px-4 font-semibold text-white">Confiance</th>
                <th className="py-3 px-4 font-semibold text-white text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredBenchmarks.map((b) => (
                <tr key={b.id} className="hover:bg-slate-900/40 transition-colors">
                  {/* 1. Nom & Doc */}
                  <td className="py-3.5 px-4">
                    <div className="font-bold text-white text-sm">{b.name}</div>
                    {b.isDemoHypothesis && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded border border-amber-600/60 bg-amber-950/40 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
                        <AlertTriangle className="w-3 h-3" />
                        Hypothèse de démonstration
                      </span>
                    )}
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Réf: {b.documentRef} · Catégorie: <span className="uppercase text-slate-400">{b.category}</span>
                    </div>
                    {b.verificationNote && (
                      <div className="text-[10px] text-amber-300/80 mt-1 max-w-xs">{b.verificationNote}</div>
                    )}
                  </td>

                  {/* 2 & 3. Valeur & Unité */}
                  <td className="py-3.5 px-4 font-mono tabular-nums">
                    <div className="font-bold text-emerald-400 text-sm">{b.value}</div>
                    <div className="text-slate-400 text-[11px]">{b.unit}</div>
                  </td>

                  {/* 9. Intervalle */}
                  <td className="py-3.5 px-4 font-mono text-[11px] text-slate-300">
                    {b.valueRange ? (
                      <div>
                        [{b.valueRange[0]} – {b.valueRange[1]}]
                      </div>
                    ) : (
                      <span className="text-slate-500">-</span>
                    )}
                  </td>

                  {/* 4 & 5. Source & URL */}
                  <td className="py-3.5 px-4 text-xs">
                    <div className="text-slate-200 font-medium flex items-center gap-1">
                      {b.source}
                      {b.sourceUrl && (
                        <a
                          href={b.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sky-400 hover:text-sky-300 transition-colors"
                          title="Consulter la publication source"
                        >
                          <ExternalLink className="w-3.5 h-3.5 inline ml-0.5" />
                        </a>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                      Mis à jour le {b.lastUpdated}
                    </div>
                  </td>

                  {/* 7 & 8. Pays & Méthode */}
                  <td className="py-3.5 px-4 text-xs max-w-xs">
                    <div className="text-slate-300 font-medium">{b.countryScope}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-snug line-clamp-2">
                      {b.methodology}
                    </div>
                  </td>

                  {/* 10. Niveau de confiance */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5 font-mono text-xs text-emerald-400">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{b.confidenceLevel}%</span>
                    </div>
                  </td>

                  {/* Action Révision */}
                  <td className="py-3.5 px-4 text-right">
                    <button
                      onClick={() => openEditModal(b)}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 ml-auto transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Réviser</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Factor Modal with Mandatory Justification (Section 26 Compliance) */}
      {selectedBenchmark && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileCheck2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Révision d'un Facteur de Référence</h3>
                  <p className="text-xs text-slate-400">{selectedBenchmark.name}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedBenchmark(null)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4 text-xs text-slate-300">
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1">
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Valeur actuelle :</span>
                  <span className="font-mono text-white">
                    {selectedBenchmark.value} {selectedBenchmark.unit}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400 text-[11px]">
                  <span>Source officielle :</span>
                  <span className="text-slate-300">{selectedBenchmark.source}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Nouvelle valeur pivot *</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={editValue}
                    onChange={(e) => setEditValue(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-emerald-500/60 rounded-lg text-white font-mono text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Borne min</label>
                  <input
                    type="number"
                    step="0.001"
                    value={editRangeMin}
                    onChange={(e) => setEditRangeMin(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Borne max</label>
                  <input
                    type="number"
                    step="0.001"
                    value={editRangeMax}
                    onChange={(e) => setEditRangeMax(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  Justification d'audit obligatoire * (Section 26)
                </label>
                <textarea
                  required
                  rows={3}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="ex: Actualisation suite à la publication du rapport Quinet 2026 et projection CRE sur les tarifs régulés."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs placeholder:text-slate-600"
                />
                <span className="text-[10px] text-amber-400/90 flex items-center gap-1 mt-1">
                  <AlertCircle className="w-3 h-3" />
                  Cette justification sera inscrite de manière irréversible dans le journal d'audit.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setSelectedBenchmark(null)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
                >
                  Enregistrer & Journaliser
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Factor Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-6 space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Ajouter un Facteur d'Externalité</h3>
                  <p className="text-xs text-slate-400">Enregistrement dans le référentiel d'entreprise.</p>
                </div>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdd} className="space-y-4 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Nom du facteur *</label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="ex: Prix Quota Carbone EU ETS 2026"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Catégorie</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white focus:outline-none focus:border-emerald-500 text-xs"
                  >
                    <option value="carbone">Carbone & GES</option>
                    <option value="energie">Énergie & Électricité</option>
                    <option value="wacc">WACC & Actualisation</option>
                    <option value="dechets">Fin de vie & Déchets</option>
                    <option value="pollution_locale">Pollution locale (ZFE)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Valeur pivot *</label>
                  <input
                    type="number"
                    step="0.001"
                    required
                    value={newValue}
                    onChange={(e) => setNewValue(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Unité de mesure *</label>
                  <input
                    type="text"
                    required
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    placeholder="ex: €/tCO2e"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Indice de confiance (%)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newConfidence}
                    onChange={(e) => setNewConfidence(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Organisme source *</label>
                  <input
                    type="text"
                    required
                    value={newSource}
                    onChange={(e) => setNewSource(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">URL de référence</label>
                  <input
                    type="url"
                    value={newSourceUrl}
                    onChange={(e) => setNewSourceUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">
                    Référence documentaire (publication, millésime, fiche)
                  </label>
                  <input
                    type="text"
                    value={newDocumentRef}
                    onChange={(e) => setNewDocumentRef(e.target.value)}
                    placeholder="ex: Base Empreinte ADEME — fiche 28419 — édition 2025"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Aucune référence n'est générée automatiquement : un identifiant inventé ne
                    serait pas vérifiable par un auditeur.
                  </p>
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">
                    Intervalle Min / Max (optionnel)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.001"
                      value={newRangeMin}
                      onChange={(e) => setNewRangeMin(e.target.value)}
                      placeholder="Min"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="number"
                      step="0.001"
                      value={newRangeMax}
                      onChange={(e) => setNewRangeMax(e.target.value)}
                      placeholder="Max"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Laissez vide si la source ne publie pas d'intervalle.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Périmètre / Zone géographique</label>
                  <input
                    type="text"
                    value={newCountryScope}
                    onChange={(e) => setNewCountryScope(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Méthodologie de calcul</label>
                  <input
                    type="text"
                    value={newMethodology}
                    onChange={(e) => setNewMethodology(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors shadow-sm"
                >
                  Créer le Référentiel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
