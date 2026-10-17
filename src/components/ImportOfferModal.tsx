import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Upload, X } from 'lucide-react';
import type { Project, Supplier, SupplierOffer } from '../types/domain';
import { SupplierOfferSchema, formatZodError } from '../schemas/validationSchemas';
import { useAuth } from '../context/AuthContext';
import { CSV_COLUMNS, buildOffer, parseOfferCsv, type OfferInputValues } from '../services/offerImport';

interface ImportOfferModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: Project;
  suppliers: Supplier[];
  onAddOffer: (offer: SupplierOffer) => void;
}

const input = 'w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono text-xs focus:outline-none focus:border-emerald-500';
const FIELDS: { key: string; label: string; min?: number; max?: number; step?: string }[] = [
  { key: 'unitPrice', label: 'Prix unitaire (€)', min: 0, step: 'any' },
  { key: 'quantity', label: 'Quantité', min: 1 },
  { key: 'annualEnergy', label: 'Énergie / consommables (€ par an)', min: 0, step: 'any' },
  { key: 'annualMaintenance', label: 'Maintenance (€ par an)', min: 0, step: 'any' },
  { key: 'salvageValue', label: 'Valeur résiduelle (€)', min: 0, step: 'any' },
  { key: 'warrantyMonths', label: 'Garantie (mois)', min: 0 },
  { key: 'deliveryLeadTimeWeeks', label: 'Délai de livraison (semaines)', min: 0 },
  { key: 'expectedLifespanYears', label: 'Durée de vie (années)', min: 1 },
  { key: 'technicalSuitabilityScore', label: 'Adéquation technique (0-100, votre évaluation)', min: 0, max: 100 },
  { key: 'carbonTonnePerUnitYear', label: 'Émissions (tCO₂e / unité / an) — optionnel', min: 0, step: 'any' },
];

export const ImportOfferModal: React.FC<ImportOfferModalProps> = ({ isOpen, onClose, project, suppliers, onAddOffer }) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'csv' | 'manual'>('csv');
  const [errors, setErrors] = useState<string[]>([]);
  const [csv, setCsv] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [offerRef, setOfferRef] = useState('');
  const [isResponsible, setIsResponsible] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  if (!isOpen) return null;

  const author = user?.fullName ?? 'Utilisateur';
  const csvRows = csv.trim() ? parseOfferCsv(csv, suppliers) : [];
  const csvValid = csvRows.length > 0 && csvRows.every((r) => r.values && r.errors.length === 0);

  const commit = (values: OfferInputValues, origin: string): string[] => {
    const supplier = suppliers.find((s) => s.id === values.supplierId);
    if (!supplier) return ['Fournisseur introuvable.'];
    const offer = buildOffer(values, project, supplier, author, origin);
    const v = SupplierOfferSchema.safeParse(offer);
    if (!v.success) return formatZodError(v.error);
    onAddOffer(v.data as unknown as SupplierOffer);
    return [];
  };

  const importCsv = () => {
    const all = csvRows.flatMap((r) => (r.values ? commit(r.values, 'Import CSV') : []));
    if (all.length) { setErrors(all); return; }
    onClose();
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const n = (k: string) => (vals[k] === undefined || vals[k].trim() === '' ? NaN : Number(vals[k]));
    const missing = FIELDS.filter((f) => f.key !== 'carbonTonnePerUnitYear' && !Number.isFinite(n(f.key))).map((f) => f.label);
    if (!supplierId) missing.unshift('Fournisseur');
    if (!offerRef.trim()) missing.push('Référence de l\'offre');
    if (missing.length) { setErrors([`À renseigner : ${missing.join(' ; ')}`]); return; }
    const errs = commit({
      supplierId, offerReference: offerRef.trim(), unitPrice: n('unitPrice'), quantity: n('quantity'), annualEnergy: n('annualEnergy'),
      annualMaintenance: n('annualMaintenance'), salvageValue: n('salvageValue'), warrantyMonths: n('warrantyMonths'),
      deliveryLeadTimeWeeks: n('deliveryLeadTimeWeeks'), expectedLifespanYears: n('expectedLifespanYears'),
      technicalSuitabilityScore: n('technicalSuitabilityScore'), isResponsibleCandidate: isResponsible,
      carbonTonnePerUnitYear: Number.isFinite(n('carbonTonnePerUnitYear')) ? n('carbonTonnePerUnitYear') : undefined,
    }, 'Saisie manuelle');
    if (errs.length) setErrors(errs); else onClose();
  };

  const template = `${CSV_COLUMNS.join(';')}\n${suppliers[0]?.name ?? 'NomDuFournisseurReference'};REF-001;;${project.plannedVolume};;;;;;;;;`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Upload className="w-5 h-5 text-emerald-400" /> Ajouter une offre</h3>
            <p className="text-xs text-slate-400 mt-0.5">Projet : <strong className="text-white">{project.name}</strong> — {project.plannedVolume} {project.unitName} sur {project.horizonYears} ans</p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex gap-1 pt-3 text-xs" role="tablist">
          {([['csv', 'Import CSV'], ['manual', 'Saisie manuelle']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErrors([]); }}
              className={`px-3 py-1.5 rounded-lg font-semibold ${tab === k ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}>{l}</button>
          ))}
        </div>

        <div className="overflow-y-auto pt-4 space-y-3 text-xs">
          <p className="text-[11px] text-slate-400">
            Toutes les valeurs sont celles <strong>que vous fournissez</strong> ; aucune n'est complétée automatiquement. Elles sont enregistrées comme « fournies par l'utilisateur »
            avec votre nom. Pour extraire des valeurs d'un devis, utilisez « Extraction de documents (IA) ».
          </p>

          {tab === 'csv' && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Colonnes : {CSV_COLUMNS.join(' ; ')}</span>
                <button onClick={() => setCsv(template)} className="text-sky-400 hover:underline whitespace-nowrap">Charger l'en-tête type</button>
              </div>
              <textarea rows={6} value={csv} onChange={(e) => { setCsv(e.target.value); setErrors([]); }} className={input} aria-label="Contenu CSV"
                placeholder="Collez le CSV (séparateur « ; » ou « , »). Le fournisseur doit déjà être référencé." />
              {csvRows.map((r) => (
                <div key={r.line} className={`p-2.5 rounded-lg border flex gap-2 ${r.errors.length ? 'border-rose-800/60 bg-rose-950/30 text-rose-200' : 'border-emerald-800/50 bg-emerald-950/30 text-emerald-200'}`}>
                  {r.errors.length ? <AlertTriangle className="w-4 h-4 shrink-0" /> : <CheckCircle2 className="w-4 h-4 shrink-0" />}
                  <div>Ligne {r.line}{r.supplierName ? ` — ${r.supplierName}` : ''} : {r.errors.length ? r.errors.join(' ') : 'valide.'}</div>
                </div>
              ))}
              <div className="flex justify-end">
                <button onClick={importCsv} disabled={!csvValid} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg font-semibold">
                  Importer {csvValid ? csvRows.length : ''} offre(s)
                </button>
              </div>
            </div>
          )}

          {tab === 'manual' && (
            <form onSubmit={submitManual} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-slate-400">Fournisseur *
                  <select className={input} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                    <option value="">— choisir —</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-slate-400">Référence de l'offre *
                  <input className={input} value={offerRef} onChange={(e) => setOfferRef(e.target.value)} required maxLength={100} />
                </label>
                {FIELDS.map((f) => (
                  <label key={f.key} className="space-y-1 text-slate-400">{f.label}{f.key !== 'carbonTonnePerUnitYear' && ' *'}
                    <input type="number" className={input} min={f.min} max={f.max} step={f.step ?? '1'} required={f.key !== 'carbonTonnePerUnitYear'}
                      value={vals[f.key] ?? ''} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
                  </label>
                ))}
              </div>
              <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={isResponsible} onChange={(e) => setIsResponsible(e.target.checked)} /> Offre « responsable » (candidate à une analyse ESG)</label>
              <div className="flex justify-end"><button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold">Ajouter l'offre</button></div>
            </form>
          )}

          {errors.length > 0 && (
            <ul role="alert" className="p-3 bg-rose-950/40 border border-rose-800/60 rounded-lg text-rose-200 list-disc pl-6 space-y-0.5">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
        </div>
      </div>
    </div>
  );
};
