import React, { useState, useMemo } from 'react';
import { AuditLogEntry, UserRole } from '../types/domain';
import { ApiError, fetchAuditIntegrity } from '../services/serverData';
import {
  History,
  User,
  Clock,
  CheckCircle2,
  Download,
  Search,
  Filter,
  ShieldCheck,
  FileSpreadsheet,
  Plus,
  Stamp,
  Lock,
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
  const [typeFilter, setTypeFilter] = useState<'all' | 'finance' | 'esg' | 'workflow'>('all');



  /**
   * État d'intégrité du journal, VÉRIFIÉ PAR LE SERVEUR.
   *
   * L'interface affichait auparavant une empreinte « sha256-… » recalculée dans le
   * navigateur à partir d'un hachage non cryptographique : elle ressemblait à une
   * preuve d'intégrité sans en être une. La vérification réelle est faite en base
   * (chaîne de hachage des entrées) et renvoyée par /api/audit-logs/integrity.
   */
  const [integrity, setIntegrity] = useState<{
    totalEntries: number;
    firstBrokenId: string | null;
    firstContentMismatchId: string | null;
    intact: boolean;
  } | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetchAuditIntegrity()
      .then((result) => {
        if (!cancelled) setIntegrity(result);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setIntegrity(null);
          setIntegrityError(
            error instanceof ApiError
              ? error.message
              : "L'état d'intégrité n'a pas pu être vérifié auprès du serveur."
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [logs.length]);

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
    } else if (typeFilter === 'workflow') {
      matchesType =
        log.fieldChanged.toLowerCase().includes('workflow') ||
        log.fieldChanged.toLowerCase().includes('approbation') ||
        log.fieldChanged.toLowerCase().includes('verrou');
    }

    return matchesSearch && matchesRole && matchesType;
  });

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
      'Justification_Formelle',
      'Integrite_Verifiee_Par_Serveur',
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
      `"${
        integrity
          ? integrity.intact
            ? `intacte (${integrity.totalEntries} entrées chaînées, vérifiées en base)`
            : `ANOMALIE DETECTEE (première entrée rompue : ${integrity.firstBrokenId ?? 'inconnue'})`
          : 'non verifiee'
      }"`,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `journal_audit_truetco_${new Date().toISOString().split('T')[0]}.csv`
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
            Traçabilité & contrôle interne
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Journal d’audit du serveur — écriture serveur uniquement, chaîne de hachage vérifiable
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Chaque action est enregistrée par le serveur avec horodatage, auteur issu de la session, rôle, ancienne et
            nouvelle valeur, et justification. Les entrées sont chaînées par empreinte : toute modification ou
            suppression rompt la chaîne, ce que le contrôle d’intégrité signale. Aucune conformité légale particulière
            (Section 26, commissariat aux comptes) n’est revendiquée par ce produit.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportCSV}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
            title="Télécharger l'extrait du journal (l'intégrité est vérifiée et indiquée dans le fichier)"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span>Exporter le journal (CSV)</span>
          </button>
        </div>
      </div>

      {/* Sceau Cryptographique & Intégrité */}
      <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-950/70 border border-emerald-800 text-emerald-400 rounded-lg">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-white flex items-center gap-2">
              <span>Intégrité du journal d'audit — vérifiée en base de données</span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
              {integrity ? (
                integrity.intact ? (
                  <>
                    Chaîne de hachage vérifiée : <span className="text-emerald-400">intacte</span> ·{' '}
                    {integrity.totalEntries} entrée(s) · aucune rupture détectée.
                  </>
                ) : (
                  <>
                    <span className="text-rose-400 font-semibold">Anomalie détectée :</span> la chaîne est rompue à
                    l'entrée {integrity.firstBrokenId ?? 'inconnue'}
                    {integrity.firstContentMismatchId ? ` (contenu modifié : ${integrity.firstContentMismatchId})` : ''}.
                  </>
                )
              ) : (
                <span className="text-amber-300">
                  {integrityError ?? 'Vérification en cours…'}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="text-right text-[11px] text-slate-400">
          <span className="text-slate-300 font-semibold">{logs.length} enregistrement(s) affiché(s)</span> · chaînage
          vérifié par le serveur, jamais par le navigateur
        </div>
      </div>

      {/* Top Quick Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Événements Tracés</div>
          <div className="text-xl font-bold font-mono text-white mt-0.5">{logs.length}</div>
          <div className="text-[10px] text-slate-500">Piste d'audit active</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Dernière Révision</div>
          <div className="text-sm font-bold font-mono text-emerald-400 mt-1 truncate">
            {logs[0] ? new Date(logs[0].timestamp).toLocaleDateString('fr-FR') : 'N/A'}
          </div>
          <div className="text-[10px] text-slate-500 truncate">{logs[0]?.userName || '-'}</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Rôles Engagés</div>
          <div className="text-xl font-bold font-mono text-sky-400 mt-0.5">
            {new Set(logs.map((l) => l.userRole)).size} rôles
          </div>
          <div className="text-[10px] text-slate-500">Acheteur, DAF, RSE, CAC</div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-slate-400 text-[11px]">Conformité Probante</div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5 flex items-center gap-1">
            <ShieldCheck className="w-4 h-4" />
            100%
          </div>
          <div className="text-[10px] text-slate-500">Toutes justifications renseignées</div>
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
              onClick={() => setTypeFilter('workflow')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'workflow' ? 'bg-slate-800 text-purple-400 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Workflow & statuts
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

      {/*
        Aucun bouton « apposer un visa » : le journal d'audit est en LECTURE SEULE
        côté navigateur. Le serveur refuse toute écriture cliente (POST
        /api/audit-logs → 403) et n'enregistre que des actions réellement
        exécutées, avec leur auteur authentifié. Un visa saisi dans l'interface
        produirait une entrée suggérée mais non enregistrée : c'est exactement le
        genre de fonctionnalité apparente qui a été retirée.
      */}
    </div>
  );
};
