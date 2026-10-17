import React, { useMemo, useState } from 'react';
import { Download, History, Info, Plus, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { AuditLogEntry } from '../types/domain';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
  onAddLog?: (entry: AuditLogEntry) => void;
}

const field = 'bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500';

const csvCell = (v: unknown) => {
  let s = String(v ?? '');
  // Neutralise l'injection de formules dans Excel/LibreOffice (=, +, -, @ en tête de cellule)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const AuditLogView: React.FC<AuditLogViewProps> = ({ logs, onAddLog }) => {
  const { user, isDemo } = useAuth();
  const [search, setSearch] = useState('');
  const [origin, setOrigin] = useState<'all' | 'server' | 'client_declared'>('all');
  const [showForm, setShowForm] = useState(false);
  const [entity, setEntity] = useState('');
  const [fieldChanged, setFieldChanged] = useState('');
  const [justification, setJustification] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      const o = l.origin ?? 'server';
      if (origin !== 'all' && o !== origin) return false;
      return !q || [l.entityName, l.fieldChanged, l.userName, l.justification, String(l.oldValue ?? ''), String(l.newValue ?? '')].some((v) => (v ?? '').toLowerCase().includes(q));
    });
  }, [logs, search, origin]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddLog || !user || !justification.trim() || !entity.trim() || !fieldChanged.trim()) return;
    // En mode connecté, userId/userName/userRole/timestamp sont ignorés et remplacés par le serveur.
    onAddLog({
      id: crypto.randomUUID(), timestamp: new Date().toISOString(), userId: user.id, userName: user.fullName, userRole: user.role,
      entityName: entity.trim(), fieldChanged: fieldChanged.trim(), oldValue: '', newValue: '', justification: justification.trim(), origin: 'client_declared',
    });
    setEntity(''); setFieldChanged(''); setJustification(''); setShowForm(false);
  };

  const exportCSV = () => {
    const header = ['Date', 'Auteur', 'Rôle', 'Objet', 'Champ', 'Ancienne valeur', 'Nouvelle valeur', 'Justification', 'Origine'];
    const rows = filtered.map((l) => [l.timestamp, l.userName, l.userRole, l.entityName, l.fieldChanged, l.oldValue, l.newValue, l.justification, l.origin ?? 'server']);
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `journal-audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><History className="w-5 h-5 text-emerald-400" /> Journal d'audit</h1>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            {isDemo
              ? 'Mode démonstration : ce journal est local à votre navigateur et n\'a aucune valeur de preuve.'
              : "Chaque modification est enregistrée par le serveur avec son auteur et sa date. Ce journal est en écriture seule : les entrées ne peuvent être ni modifiées ni supprimées via l'application."}
          </p>
        </div>
        <div className="flex gap-2">
          {onAddLog && (
            <button onClick={() => setShowForm((v) => !v)} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Ajouter une justification
            </button>
          )}
          <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white flex items-center gap-1.5" title="Copie CSV des entrées affichées (non signée)">
            <Download className="w-3.5 h-3.5" /> Exporter (CSV)
          </button>
        </div>
      </header>

      {showForm && (
        <form onSubmit={submit} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
          <p className="text-[11px] text-slate-400 flex gap-1.5"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Vous rédigez le <strong>contenu</strong> de la justification. L'auteur ({user?.fullName}), son rôle et la date sont attribués automatiquement et ne peuvent pas être modifiés.
            L'entrée sera marquée « déclarée par l'utilisateur ».
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            <input className={field} placeholder="Objet concerné (ex. Hypothèse WACC)" value={entity} onChange={(e) => setEntity(e.target.value)} maxLength={255} required aria-label="Objet" />
            <input className={field} placeholder="Champ ou sujet (ex. Taux d'actualisation)" value={fieldChanged} onChange={(e) => setFieldChanged(e.target.value)} maxLength={255} required aria-label="Champ" />
          </div>
          <textarea className={`${field} w-full h-24`} placeholder="Justification" value={justification} onChange={(e) => setJustification(e.target.value)} maxLength={2000} required aria-label="Justification" />
          <div className="flex justify-end"><button className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white">Enregistrer</button></div>
        </form>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
          <input className={`${field} pl-8 w-64`} placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher" />
        </div>
        <select className={field} value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)} aria-label="Origine">
          <option value="all">Toutes les origines</option>
          <option value="server">Constatées par le serveur</option>
          <option value="client_declared">Déclarées par l'utilisateur</option>
        </select>
        <span className="text-[11px] text-slate-500">{filtered.length} entrée(s) sur {logs.length}</span>
      </div>

      <div className="overflow-x-auto border border-slate-800 rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-slate-900 text-slate-400 text-left">
            <tr>{['Date', 'Auteur', 'Objet', 'Modification', 'Justification', 'Origine'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {filtered.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">Aucune entrée.</td></tr>}
            {filtered.map((l) => (
              <tr key={l.id} className="align-top hover:bg-slate-900/40">
                <td className="px-3 py-2 whitespace-nowrap text-slate-400">{new Date(l.timestamp).toLocaleString('fr-FR')}</td>
                <td className="px-3 py-2"><div className="text-slate-200">{l.userName}</div><div className="text-[10px] text-slate-500">{String(l.userRole).replace(/_/g, ' ')}</div></td>
                <td className="px-3 py-2 text-slate-200">{l.entityName}</td>
                <td className="px-3 py-2"><div className="text-slate-300">{l.fieldChanged}</div>{(l.oldValue || l.newValue) && <div className="text-[10px] text-slate-500">{String(l.oldValue ?? '')} → {String(l.newValue ?? '')}</div>}</td>
                <td className="px-3 py-2 text-slate-300 max-w-md">{l.justification}</td>
                <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded border ${(l.origin ?? 'server') === 'server' ? 'border-emerald-800 text-emerald-300' : 'border-amber-800 text-amber-300'}`}>
                  {(l.origin ?? 'server') === 'server' ? 'Serveur' : 'Déclarée'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
