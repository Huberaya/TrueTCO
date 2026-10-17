import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import { AiExtraction, AiParserService, Evidence, FICTIONAL_SAMPLES } from '../services/aiParserService';
import { PROVENANCE_CONFIDENCE } from '../constants/provenance';
import { useAuth } from '../context/AuthContext';
import type { AuditedValue, CostBreakdownItem, DataSourceType, Project, Supplier, SupplierOffer } from '../types/domain';

interface Props {
  project: Project;
  offers: SupplierOffer[];
  suppliers: Supplier[];
  onAddOffer: (offer: SupplierOffer) => void;
  onNavigateToSuppliers: () => void;
  onNavigateToComparator: () => void;
}

const EVIDENCE: Record<Evidence, { label: string; cls: string }> = {
  verified_in_document: { label: 'Retrouvé dans le document', cls: 'text-emerald-300 border-emerald-700 bg-emerald-950/50' },
  value_not_in_quote: { label: 'Valeur absente de l\'extrait (conversion ou erreur ?)', cls: 'text-amber-300 border-amber-700 bg-amber-950/50' },
  quote_not_in_document: { label: 'Extrait introuvable dans le document', cls: 'text-rose-300 border-rose-700 bg-rose-950/50' },
  no_quote: { label: 'Aucun extrait fourni par l\'IA', cls: 'text-rose-300 border-rose-700 bg-rose-950/50' },
  not_found: { label: 'Non trouvé dans le document', cls: 'text-slate-400 border-slate-700 bg-slate-900' },
};
const Badge: React.FC<{ e: Evidence }> = ({ e }) => <span className={`text-[10px] px-1.5 py-0.5 rounded border ${EVIDENCE[e].cls}`}>{EVIDENCE[e].label}</span>;

const input = 'bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100 w-full focus:outline-none focus:border-emerald-500';
const num = (s: string): number | null => (s.trim() === '' || !Number.isFinite(Number(s)) ? null : Number(s));

export const AiDocumentParserView: React.FC<Props> = ({ project, suppliers, onAddOffer, onNavigateToSuppliers, onNavigateToComparator }) => {
  const { user, isDemo } = useAuth();
  const [filename, setFilename] = useState('devis.txt');
  const [category, setCategory] = useState('devis_fournisseur');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ex, setEx] = useState<AiExtraction | null>(null);
  const [added, setAdded] = useState(false);

  // Valeurs de travail éditables (préremplies par l'IA, jamais considérées comme validées)
  const [supplierId, setSupplierId] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [score, setScore] = useState('');
  const [items, setItems] = useState<{ tempId: string; use: boolean; category: string; label: string; amount: string; basis: string }[]>([]);

  const run = async () => {
    setBusy(true); setError(null); setEx(null); setAdded(false);
    try {
      const r = await AiParserService.parseDocument({ filename, category, text });
      setEx(r);
      const val = (k: keyof AiExtraction['fields']) => (r.fields[k].value === null ? '' : String(r.fields[k].value));
      setF({ quantity: val('quantity'), apparentUnitPrice: val('apparentUnitPrice'), apparentTotal: val('apparentTotal'),
        deliveryLeadTimeWeeks: val('deliveryLeadTimeWeeks'), warrantyMonths: val('warrantyMonths'), expectedLifespanYears: val('expectedLifespanYears'),
        offerReference: r.offerReference ?? '' });
      setConfirmed({});
      setScore('');
      setItems(r.costItems.map((c) => ({ tempId: c.tempId, use: false, category: c.category, label: c.label, amount: String(c.amount), basis: c.amountBasis ?? 'total' })));
      const match = r.supplier.name ? suppliers.find((s) => s.name.trim().toLowerCase() === r.supplier.name!.trim().toLowerCase()) : undefined;
      setSupplierId(match?.id ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analyse impossible');
    } finally {
      setBusy(false);
    }
  };

  const required = ['quantity', 'apparentUnitPrice', 'apparentTotal', 'deliveryLeadTimeWeeks', 'warrantyMonths', 'expectedLifespanYears'] as const;
  const problems = useMemo(() => {
    const p: string[] = [];
    if (!supplierId) p.push('Choisissez le fournisseur (référencé).');
    for (const k of required) {
      if (num(f[k] ?? '') === null) p.push(`Renseignez « ${LABEL[k]} ».`);
      else if (!confirmed[k]) p.push(`Confirmez « ${LABEL[k]} » après contrôle dans le document.`);
    }
    const sc = num(score);
    if (sc === null || sc < 0 || sc > 100) p.push("Saisissez votre évaluation d'adéquation technique (0-100) : elle ne peut pas venir de l'IA.");
    if ((num(f.quantity ?? '') ?? 0) < 1) p.push('La quantité doit être ≥ 1.');
    return p;
  }, [supplierId, f, confirmed, score]);

  const addOffer = () => {
    if (!ex || problems.length > 0 || !user) return;
    const supplier = suppliers.find((s) => s.id === supplierId)!;
    const today = new Date().toISOString().slice(0, 10);
    const prov = (value: number, unit: string, notes?: string): AuditedValue => ({
      value, unit, sourceType: 'utilisateur' as DataSourceType,
      sourceName: `${ex.filename} — extraction IA (${ex.engine.model}), contrôlée par ${user.fullName}`,
      confidenceLevel: PROVENANCE_CONFIDENCE.humanValidatedFromDocument, lastUpdated: today, updatedBy: user.fullName, notes,
    });
    const quantity = num(f.quantity)!;
    const costItems: CostBreakdownItem[] = items.filter((i) => i.use && num(i.amount) !== null).map((i) => {
      const amount = num(i.amount)!;
      const retained = i.basis === 'per_unit' ? amount * quantity : amount;
      const recurring = i.basis === 'per_year';
      return {
        id: crypto.randomUUID(), category: i.category as CostBreakdownItem['category'], label: i.label,
        amount: prov(retained, '€', i.basis === 'per_unit' ? `${amount} € par unité × ${quantity}` : undefined),
        isRecurringYearly: recurring, yearOccurrences: recurring ? Array.from({ length: project.horizonYears }, (_, k) => k + 1) : [],
      };
    });
    const total = num(f.apparentTotal)!;
    onAddOffer({
      id: crypto.randomUUID(), projectId: project.id, supplierId: supplier.id, supplierName: supplier.name,
      offerReference: f.offerReference || `OFF-${Date.now().toString(16).slice(-6).toUpperCase()}`,
      isResponsibleCandidate: false,
      apparentUnitPrice: prov(num(f.apparentUnitPrice)!, `€/${ex.fields.unitName.value ?? 'unité'}`),
      quantity, apparentTotal: total,
      deliveryLeadTimeWeeks: num(f.deliveryLeadTimeWeeks)!, warrantyMonths: num(f.warrantyMonths)!, expectedLifespanYears: num(f.expectedLifespanYears)!,
      costItems, carbonItems: [], riskItems: [],   // aucun risque ni carbone « inventé » : à saisir par l'utilisateur
      technicalSuitabilityScore: num(score)!,
      notes: `Créée à partir de « ${ex.filename} » par extraction IA, valeurs contrôlées par ${user.fullName}. Postes de coût non retenus : ${items.filter((i) => !i.use).length}.`,
    });
    setAdded(true);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Sparkles className="w-5 h-5 text-purple-400" /> Extraction de documents (IA)</h1>
        <p className="text-xs text-slate-400 mt-1">
          L'IA <strong>propose</strong> des valeurs lues dans le texte d'un devis ; rien n'est utilisé dans un calcul avant votre contrôle explicite, valeur par valeur.
        </p>
      </header>

      <div className="flex gap-2 text-[11px] text-amber-200 bg-amber-950/40 border border-amber-800/50 rounded-lg p-3">
        <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
        <p>
          Le texte collé est transmis à un service d'IA tiers (Google) pour analyse. Ne collez pas de données personnelles ni de contenus confidentiels
          que vous n'êtes pas autorisé à partager. Seul le <strong>texte</strong> est analysé (pas d'OCR de PDF ou d'image dans cette version).
        </p>
      </div>

      {isDemo && (
        <div className="text-xs text-slate-300 bg-slate-900 border border-slate-800 rounded-lg p-3">
          Cette fonction nécessite une session connectée : elle n'est pas disponible en mode démonstration (aucune extraction n'est simulée).
        </div>
      )}

      <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-[11px] text-slate-400 space-y-1">Nom du document
            <input className={input} value={filename} onChange={(e) => setFilename(e.target.value)} maxLength={255} />
          </label>
          <label className="text-[11px] text-slate-400 space-y-1">Type
            <select className={input} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="devis_fournisseur">Devis fournisseur</option>
              <option value="fiche_fdes_epd">Fiche environnementale (FDES / EPD)</option>
            </select>
          </label>
          <label className="text-[11px] text-slate-400 space-y-1">Exemple fictif (pour tester)
            <select className={input} value="" onChange={(e) => { const s = FICTIONAL_SAMPLES.find((x) => x.id === e.target.value); if (s) { setText(s.content); setFilename(s.title); } }}>
              <option value="">— charger un exemple —</option>
              {FICTIONAL_SAMPLES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
        </div>
        <textarea className={`${input} h-40 font-mono`} value={text} onChange={(e) => setText(e.target.value)} maxLength={60000}
          placeholder="Collez ici le texte du devis…" aria-label="Texte du document" />
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-500">{text.length.toLocaleString('fr-FR')} / 60 000 caractères</span>
          <button onClick={run} disabled={busy || isDemo || text.trim().length < 20}
            className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-2">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSearch className="w-3.5 h-3.5" />} Analyser
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-rose-300 bg-rose-950/40 border border-rose-800/50 rounded p-2">{error}</p>}
      </section>

      {ex && (
        <section className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
            <h2 className="text-sm font-bold text-white">Proposition de l'IA — à contrôler</h2>
            <p className="text-[11px] text-slate-500">Modèle : {ex.engine.provider}/{ex.engine.model}. Aucune de ces valeurs n'est encore enregistrée.</p>
            {ex.summary && <p className="text-xs text-slate-300">{ex.summary}</p>}
            {ex.warnings.map((w, i) => <p key={i} className="text-xs text-amber-300 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</p>)}
            {ex.inconsistencies.map((w, i) => <p key={i} className="text-xs text-rose-300 flex gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{w}</p>)}
            {ex.missingInformation.length > 0 && (
              <div className="text-xs text-slate-400"><strong>Informations absentes du document :</strong> {ex.missingInformation.join(' · ')}</div>
            )}
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-white">1. Fournisseur</h3>
            <p className="text-[11px] text-slate-400">Lu dans le document : <strong>{ex.supplier.name ?? 'non trouvé'}</strong>{ex.supplier.siren ? ` (SIREN ${ex.supplier.siren})` : ''}. Choisissez le fournisseur référencé correspondant.</p>
            <div className="flex gap-2 items-center">
              <select className={`${input} max-w-sm`} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Fournisseur">
                <option value="">— choisir —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button onClick={onNavigateToSuppliers} className="text-[11px] text-sky-400 hover:underline whitespace-nowrap">Référencer un nouveau fournisseur</button>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-white">2. Conditions de l'offre (chaque valeur doit être confirmée)</h3>
            <div className="space-y-2">
              {required.map((k) => (
                <div key={k} className="grid grid-cols-12 gap-2 items-center">
                  <span className="col-span-3 text-[11px] text-slate-300">{LABEL[k]}</span>
                  <input className={`${input} col-span-2`} value={f[k] ?? ''} onChange={(e) => { setF({ ...f, [k]: e.target.value }); setConfirmed({ ...confirmed, [k]: false }); }} inputMode="decimal" aria-label={LABEL[k]} />
                  <div className="col-span-5 space-y-0.5">
                    <Badge e={ex.fields[k].evidence} />
                    {ex.fields[k].quote && <div className="text-[10px] text-slate-500 italic truncate" title={ex.fields[k].quote!}>« {ex.fields[k].quote} »</div>}
                  </div>
                  <label className="col-span-2 text-[11px] text-slate-300 flex items-center gap-1.5">
                    <input type="checkbox" checked={!!confirmed[k]} onChange={(e) => setConfirmed({ ...confirmed, [k]: e.target.checked })} /> J'ai vérifié
                  </label>
                </div>
              ))}
              <div className="grid grid-cols-12 gap-2 items-center">
                <span className="col-span-3 text-[11px] text-slate-300">Référence de l'offre</span>
                <input className={`${input} col-span-4`} value={f.offerReference ?? ''} onChange={(e) => setF({ ...f, offerReference: e.target.value })} />
              </div>
              <div className="grid grid-cols-12 gap-2 items-center">
                <span className="col-span-3 text-[11px] text-slate-300">Adéquation technique (0-100)</span>
                <input className={`${input} col-span-2`} value={score} onChange={(e) => setScore(e.target.value)} inputMode="decimal" aria-label="Adéquation technique" />
                <span className="col-span-7 text-[10px] text-slate-500">Votre évaluation : l'IA ne la produit pas.</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-white">3. Postes de coût (cochez ceux que vous retenez)</h3>
            {items.length === 0 && <p className="text-[11px] text-slate-500">Aucun poste de coût détaillé trouvé dans le document.</p>}
            {items.map((it, idx) => {
              const src = ex.costItems.find((c) => c.tempId === it.tempId)!;
              return (
                <div key={it.tempId} className="grid grid-cols-12 gap-2 items-center border-t border-slate-800 pt-2">
                  <label className="col-span-1"><input type="checkbox" checked={it.use} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, use: e.target.checked } : x)))} aria-label={`Retenir ${it.label}`} /></label>
                  <div className="col-span-4 text-[11px] text-slate-300">{it.label}<div className="text-[10px] text-slate-500">{it.category}</div></div>
                  <input className={`${input} col-span-2`} value={it.amount} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} inputMode="decimal" aria-label={`Montant ${it.label}`} />
                  <select className={`${input} col-span-2`} value={it.basis} onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, basis: e.target.value } : x)))}>
                    <option value="total">Montant total</option><option value="per_unit">Par unité</option><option value="per_year">Par an</option>
                  </select>
                  <div className="col-span-3 space-y-0.5"><Badge e={src.evidence} />{src.quote && <div className="text-[10px] text-slate-500 italic truncate" title={src.quote}>« {src.quote} »</div>}</div>
                </div>
              );
            })}
            {ex.carbonItems.length > 0 && (
              <p className="text-[11px] text-slate-500">{ex.carbonItems.length} donnée(s) carbone détectée(s) dans le document : non importées automatiquement (à saisir dans le référentiel avec leur source).</p>
            )}
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
            {problems.length > 0 && <ul className="text-[11px] text-amber-300 list-disc pl-4 space-y-0.5">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
            <div className="flex items-center gap-3">
              <button onClick={addOffer} disabled={problems.length > 0 || added}
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-semibold text-white flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" /> Ajouter l'offre validée au projet
              </button>
              {added && <button onClick={onNavigateToComparator} className="text-xs text-sky-400 hover:underline">Offre ajoutée — ouvrir le comparateur</button>}
            </div>
            <p className="text-[10px] text-slate-500">
              Les valeurs enregistrées sont marquées « fournies par l'utilisateur » (confiance provisoire {PROVENANCE_CONFIDENCE.humanValidatedFromDocument} %), avec le nom du document et le vôtre.
              Aucun risque ni facteur carbone n'est généré automatiquement.
            </p>
          </div>
        </section>
      )}
    </div>
  );
};

const LABEL: Record<string, string> = {
  quantity: 'Quantité', apparentUnitPrice: 'Prix unitaire (€)', apparentTotal: 'Total (€)',
  deliveryLeadTimeWeeks: 'Délai (semaines)', warrantyMonths: 'Garantie (mois)', expectedLifespanYears: 'Durée de vie (ans)',
};
