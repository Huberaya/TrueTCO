import React, { useState } from 'react';
import { AuditLogEntry, UserRole } from '../types/domain';
import {
  History,
  User,
  Clock,
  CheckCircle2,
  Download,
  Search,
  Filter,
  FileSpreadsheet,
  Stamp,
  FileText,
  AlertCircle,
  X,
  Layers,
} from 'lucide-react';

interface AuditLogViewProps {
  logs: AuditLogEntry[];
  onAddLog?: (entry: AuditLogEntry) => void;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ logs, onAddLog }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'finance' | 'esg' | 'visas'>('all');

  // Visa Modal state
  const [isVisaModalOpen, setIsVisaModalOpen] = useState(false);
  const [visaRole, setVisaRole] = useState<UserRole>('finance_controleur');
  const [visaAuthor, setVisaAuthor] = useState('');
  const [visaSubject, setVisaSubject] = useState('');
  const [visaJustification, setVisaJustification] = useState(
    ''
  );

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.entityName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.fieldChanged.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.justification.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRole = roleFilter === 'all' || log.userRole === roleFilter;

    let matchesType = true;
    if (typeFilter === 'finance') {
      matchesType =
        log.fieldChanged.toLowerCase().includes('wacc') ||
        log.fieldChanged.toLowerCase().includes('budget') ||
        log.fieldChanged.toLowerCase().includes('inflation') ||
        log.fieldChanged.toLowerCase().includes('prix');
    } else if (typeFilter === 'esg') {
      matchesType =
        log.fieldChanged.toLowerCase().includes('carbone') ||
        log.fieldChanged.toLowerCase().includes('co2') ||
        log.fieldChanged.toLowerCase().includes('esg') ||
        log.fieldChanged.toLowerCase().includes('ademe');
    } else if (typeFilter === 'visas') {
      matchesType =
        log.fieldChanged.toLowerCase().includes('visa') ||
        log.fieldChanged.toLowerCase().includes('approbation') ||
        log.fieldChanged.toLowerCase().includes('statut');
    }

    return matchesSearch && matchesRole && matchesType;
  });

  const handleAddVisa = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onAddLog || !visaJustification.trim()) return;

    const newLog: AuditLogEntry = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      userId: 'local-unverified',
      userName: visaAuthor.trim() || 'Auditeur Légal',
      userRole: visaRole,
      entityName: 'Gouvernance & Conformité',
      fieldChanged: visaSubject.trim() || 'Déclaration utilisateur',
      oldValue: 'En attente de visa',
      newValue: 'Déclaration enregistrée — non vérifiée',
      justification: visaJustification.trim(),
    };

    onAddLog(newLog);
    setIsVisaModalOpen(false);
  };

  const exportCSV = () => {
    const headers = [
      'ID_Audit',
      'Date_ISO',
      'Auteur',
      'Role_Metier',
      'Entite_Affectee',
      'Champ_Modifie',
      'Valeur_Precedente',
      'Nouvelle_Valeur',
      'Commentaire',
    ];
    const rows = logs.map((l) => [
      `"${l.id}"`,
      `"${l.timestamp}"`,
      `"${l.userName}"`,
      `"${l.userRole}"`,
      `"${l.entityName}"`,
      `"${l.fieldChanged}"`,
      `"${l.oldValue}"`,
      `"${l.newValue}"`,
      `"${l.justification.replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `journal_evenements_truetco_${new Date().toISOString().split('T')[0]}.csv`
    );
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
            <History className="w-4 h-4 text-emerald-400" />
            Chantier 5 · Module « Traçabilité & Contrôle Interne »
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Journal d’événements — non certifié
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Cette vue présente des événements de l’application. Elle ne garantit ni l’immutabilité, ni l’identité de l’auteur, ni un horodatage de confiance, ni la conformité à une exigence d’audit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onAddLog && (
            <button
              onClick={() => setIsVisaModalOpen(true)}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
              title="Ajouter une déclaration non vérifiée"
            >
              <Stamp className="w-3.5 h-3.5" />
              <span>Ajouter une déclaration</span>
            </button>
          )}

          <button
            onClick={exportCSV}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Télécharger un export des événements affichés"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Exporter les événements (CSV)</span>
          </button>
        </div>
      </div>

      <div role="note" className="rounded-xl border border-amber-800 bg-amber-950/30 p-3.5 text-xs text-amber-100">
        Les événements affichés/exportés ne sont pas scellés cryptographiquement ni stockés dans un registre immuable vérifié.
      </div>

      {/* Top Quick Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Événements Tracés</div>
          <div className="text-xl font-bold font-mono text-white mt-0.5">{logs.length}</div>
          <div className="text-[10px] text-slate-500">Événements affichés</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Dernière Révision</div>
          <div className="text-sm font-bold font-mono text-emerald-400 mt-1 truncate">
            {logs[0] ? new Date(logs[0].timestamp).toLocaleDateString('fr-FR') : 'N/A'}
          </div>
          <div className="text-[10px] text-slate-500 truncate">{logs[0]?.userName || '-'}</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Rôles déclarés</div>
          <div className="text-xl font-bold font-mono text-sky-400 mt-0.5">
            {new Set(logs.map((l) => l.userRole)).size} rôles
          </div>
          <div className="text-[10px] text-slate-500">Valeurs saisies dans l’application</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Vérification probante</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5 flex items-center gap-1">
            Non établie
          </div>
          <div className="text-[10px] text-slate-500">Aucun contrôle de conformité</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Rechercher par auteur, poste révisé ou justification..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Category Type Filter */}
          <div className="flex rounded-lg border border-slate-800 bg-slate-950 p-0.5 text-[11px]">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'all' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => setTypeFilter('finance')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'finance' ? 'bg-slate-800 text-emerald-400 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Finance & WACC
            </button>
            <button
              onClick={() => setTypeFilter('esg')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'esg' ? 'bg-slate-800 text-sky-400 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Carbone & ESG
            </button>
            <button
              onClick={() => setTypeFilter('visas')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'visas' ? 'bg-slate-800 text-purple-400 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Déclarations & Statuts
            </button>
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="all">Tous les rôles</option>
            <option value="acheteur">Acheteur</option>
            <option value="directeur_achats">Directeur Achats</option>
            <option value="finance_controleur">Finance / Contrôleur</option>
            <option value="rse_esg">Responsable RSE</option>
            <option value="direction_generale">Direction Générale</option>
            <option value="admin">Administrateur</option>
          </select>
        </div>
      </div>

      {/* Audit Log Entries Table */}
      <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-900/80 text-slate-400 border-b border-slate-800">
                <th className="py-3 px-4 font-semibold text-white">Date & Heure</th>
                <th className="py-3 px-4 font-semibold text-white">Auteur & Rôle</th>
                <th className="py-3 px-4 font-semibold text-white">Élément Révisé</th>
                <th className="py-3 px-4 font-semibold text-white">Évolution des Valeurs</th>
                <th className="py-3 px-4 font-semibold text-white min-w-[340px]">
                  Justification Formelle d'Audit (Section 26)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500">
                    Aucun enregistrement d'audit ne correspond aux filtres sélectionnés.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                      {new Date(log.timestamp).toLocaleString('fr-FR', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-white text-xs flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        {log.userName}
                      </div>
                      <div className="text-[10px] text-emerald-400 font-mono mt-0.5 uppercase">
                        {log.userRole.replace(/_/g, ' ')}
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-200">{log.entityName}</div>
                      <div className="text-[11px] text-slate-400">{log.fieldChanged}</div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs">
                      <div className="text-rose-400 line-through text-[11px]">{log.oldValue}</div>
                      <div className="text-emerald-400 font-bold">{log.newValue}</div>
                    </td>

                    <td className="py-3.5 px-4 text-xs text-slate-300 leading-relaxed">
                      <div className="p-2.5 bg-slate-900/90 border border-slate-800/80 rounded-lg text-[11px] font-sans">
                        {log.justification}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Ajouter une déclaration */}
      {isVisaModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-6 overflow-hidden">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-950/60 border border-emerald-800/60 rounded-lg text-emerald-400">
                  <Stamp className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">Ajouter une déclaration</h3>
                  <p className="text-xs text-slate-400">Déclaration non vérifiée, enregistrée dans l’état local de l’application</p>
                </div>
              </div>
              <button
                onClick={() => setIsVisaModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddVisa} className="py-4 space-y-4 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Nom déclaré *</label>
                  <input
                    type="text"
                    required
                    value={visaAuthor}
                    onChange={(e) => setVisaAuthor(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Rôle Métier *</label>
                  <select
                    value={visaRole}
                    onChange={(e) => setVisaRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                  >
                    <option value="finance_controleur">Finance / DAF</option>
                    <option value="directeur_achats">Directeur des Achats</option>
                    <option value="acheteur">Acheteur Référent</option>
                    <option value="rse_esg">Responsable RSE</option>
                    <option value="direction_generale">Direction Générale</option>
                    <option value="admin">Administrateur</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Intitulé de la déclaration *</label>
                <input
                  type="text"
                  required
                  value={visaSubject}
                  onChange={(e) => setVisaSubject(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">
                  Commentaire *
                </label>
                <textarea
                  rows={4}
                  required
                  value={visaJustification}
                  onChange={(e) => setVisaJustification(e.target.value)}
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs leading-relaxed focus:outline-none focus:border-emerald-500"
                  placeholder="Ajoutez un commentaire non vérifié..."
                />
              </div>

              <div className="p-3 bg-sky-950/30 border border-sky-900/60 rounded-xl flex items-start gap-2 text-sky-300 text-[11px]">
                <AlertCircle className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>
                  Cette déclaration ne vérifie pas l’identité de son auteur et n’est pas envoyée dans un registre Neon par cette action.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsVisaModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg text-xs transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg text-xs transition-colors shadow-sm flex items-center gap-1.5"
                >
                  <Stamp className="w-3.5 h-3.5" />
                  <span>Enregistrer la déclaration</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
