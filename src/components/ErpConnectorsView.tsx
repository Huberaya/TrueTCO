import React, { useState } from 'react';
import {
  Network,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  Settings,
  Send,
  Sliders,
  Radio,
  FileCode,
  ShieldCheck,
  Search,
  Check,
  Building2,
  Copy,
} from 'lucide-react';
import { ErpConnector, ErpSyncLog, Project, SupplierOffer } from '../types/domain';
import { ErpService } from '../services/erpService';

interface ErpConnectorsViewProps {
  project: Project;
  offers: SupplierOffer[];
  onAddOffer: (offer: SupplierOffer) => void;
}

export const ErpConnectorsView: React.FC<ErpConnectorsViewProps> = ({
  project,
  offers,
  onAddOffer,
}) => {
  const [connectors, setConnectors] = useState<ErpConnector[]>(() => ErpService.getConnectors());
  const [logs, setLogs] = useState<ErpSyncLog[]>(() => ErpService.getLogs());
  const [activeTab, setActiveTab] = useState<'connectors' | 'logs' | 'push_award' | 'spec'>('connectors');

  // Loading states
  const [testingId, setTestingId] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Selected connector for edit modal
  const [editingConnector, setEditingConnector] = useState<ErpConnector | null>(null);

  // Push award state
  const [selectedOfferId, setSelectedOfferId] = useState<string>(offers[0]?.id || '');
  const [selectedErpForAward, setSelectedErpForAward] = useState<string>('erp-sap-ariba');
  const [awardRationale, setAwardRationale] = useState<string>(
    'Adjudication validée en Comité des Engagements : TCO le plus compétitif avec amortissement du surcoût initial atteint sous le seuil contractuel et conformité CSRD.'
  );
  const [isPushingAward, setIsPushingAward] = useState(false);
  const [lastAwardResult, setLastAwardResult] = useState<{ poReference: string; message: string } | null>(null);

  // Filter logs
  const [searchLog, setSearchLog] = useState('');
  const [filterDirection, setFilterDirection] = useState<'all' | 'inbound' | 'outbound'>('all');

  const showNotification = (type: 'success' | 'error' | 'info', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleTestHandshake = async (connector: ErpConnector) => {
    setTestingId(connector.id);
    try {
      const res = await ErpService.testHandshake(connector.id);
      setLogs(ErpService.getLogs());
      if (res.success) {
        showNotification('success', `[${connector.name}] ${res.message}`);
      } else {
        showNotification('error', `[${connector.name}] Échec du handshake : ${res.message}`);
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleSyncInbound = async (connector: ErpConnector) => {
    setSyncingId(connector.id);
    try {
      const res = await ErpService.syncInboundOffers(connector.id, project.id);
      setConnectors(ErpService.getConnectors());
      setLogs(ErpService.getLogs());
      if (res.success && res.offers.length > 0) {
        res.offers.forEach((off) => onAddOffer(off));
        showNotification(
          'success',
          `[${connector.name}] ${res.offers.length} offre(s) importée(s) et rattachée(s) au projet "${project.name}".`
        );
      } else {
        showNotification('info', `[${connector.name}] Aucune nouvelle offre en attente de synchronisation.`);
      }
    } finally {
      setSyncingId(null);
    }
  };

  const handlePushAward = async () => {
    if (!selectedOfferId) {
      showNotification('error', 'Veuillez sélectionner une offre à adjuger.');
      return;
    }
    setIsPushingAward(true);
    try {
      const res = await ErpService.pushAwardDecision(
        selectedErpForAward,
        project.id,
        selectedOfferId,
        awardRationale
      );
      setConnectors(ErpService.getConnectors());
      setLogs(ErpService.getLogs());
      if (res.success) {
        setLastAwardResult({ poReference: res.poReference, message: res.message });
        showNotification('success', res.message);
      }
    } finally {
      setIsPushingAward(false);
    }
  };

  const handleSaveConnector = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingConnector) return;
    const updated = ErpService.updateConnector(editingConnector.id, editingConnector);
    if (updated) {
      setConnectors(ErpService.getConnectors());
      showNotification('success', `Connecteur "${updated.name}" mis à jour avec succès.`);
    }
    setEditingConnector(null);
  };

  const toggleConnectorStatus = (connector: ErpConnector) => {
    const nextStatus = connector.status === 'disabled' ? 'connected' : 'disabled';
    const updated = ErpService.updateConnector(connector.id, { status: nextStatus });
    if (updated) {
      setConnectors(ErpService.getConnectors());
      showNotification('info', `Statut du connecteur ${connector.name} basculé vers : ${nextStatus}.`);
    }
  };

  const filteredLogs = logs.filter((l) => {
    const matchesDir = filterDirection === 'all' || l.direction === filterDirection;
    const matchesSearch =
      l.connectorName.toLowerCase().includes(searchLog.toLowerCase()) ||
      l.action.toLowerCase().includes(searchLog.toLowerCase()) ||
      l.entityReference.toLowerCase().includes(searchLog.toLowerCase());
    return matchesDir && matchesSearch;
  });

  const totalInbound = connectors.reduce((acc, c) => acc + (c.inboundOffersCount || 0), 0);
  const totalOutbound = connectors.reduce((acc, c) => acc + (c.outboundAwardsCount || 0), 0);
  const activeCount = connectors.filter((c) => c.status === 'connected' || c.status === 'idle').length;

  return (
    <div className="space-y-6">
      {/* Avertissement d'implémentation — obligatoire : les connecteurs de cette
          page sont des jeux de démonstration, aucun système tiers n'est joint. */}
      <div className="p-3.5 bg-amber-950/40 border border-amber-800/70 rounded-xl text-xs text-amber-200 flex items-start gap-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-semibold">
            Module de démonstration — aucune intégration ERP réelle n'est implémentée.
          </div>
          <div className="text-amber-200/80 leading-relaxed">
            Les connecteurs listés ci-dessous (SAP Ariba, Coupa, Ivalua, Jaggaer), leurs compteurs
            et leurs journaux sont des jeux de données figés à des fins de maquette. Aucun appel
            réseau, aucune authentification OAuth2/mTLS et aucun échange cXML/REST n'a lieu : les
            tests de connectivité et les synchronisations se terminent explicitement en échec tant
            que les adaptateurs serveur ne sont pas livrés. Les API doivent être fournies par le
            client (URL, identifiants, environnement de recette) pour une mise en œuvre réelle.
          </div>
        </div>
      </div>

      {/* Top Banner */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="text-xs uppercase tracking-wider font-semibold text-sky-400 mb-1 flex items-center gap-1.5">
            <Network className="w-4 h-4" />
            Chantier 7 · Connecteurs ERP & e-Procurement d'Entreprise
          </div>
          <h2 className="text-2xl font-bold text-white tracking-tight">
            Intégration Amont / Aval (SAP Ariba, Coupa, Ivalua, Jaggaer)
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-3xl">
            Cible fonctionnelle : réception automatisée des dossiers de consultation (Inbound) et émission des bons de commande (Outbound) après arbitrage TCO.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-sky-950/80 border border-sky-800/80 text-sky-300 rounded-full text-xs font-mono font-medium">
            Projet Actif : {project.reference}
          </span>
          <button
            onClick={() => {
              setConnectors(ErpService.getConnectors());
              setLogs(ErpService.getLogs());
              showNotification('info', 'Données connecteurs rafraîchies.');
            }}
            className="p-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-lg border border-slate-800 transition-colors"
            title="Rafraîchir"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Notification Toast */}
      {notification && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-950/80 border-emerald-800 text-emerald-200'
              : notification.type === 'error'
              ? 'bg-rose-950/80 border-rose-800 text-rose-200'
              : 'bg-sky-950/80 border-sky-800 text-sky-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button onClick={() => setNotification(null)} className="opacity-70 hover:opacity-100 font-bold">
            ×
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>Passerelles Actives</span>
            <Radio className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {activeCount} <span className="text-xs font-normal text-slate-500">/ {connectors.length} ERP</span>
          </div>
          <div className="text-[10px] text-emerald-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-400" /> Maquette — aucune connexion réelle
          </div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>Offres RFQ Inbound</span>
            <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-sky-400 font-mono">{totalInbound}</div>
          <div className="text-[10px] text-slate-400">Propositions fournisseurs importées</div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>Bons PO Outbound</span>
            <ArrowUpRight className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-indigo-400 font-mono">{totalOutbound}</div>
          <div className="text-[10px] text-slate-400">Adjudications poussées en ERP</div>
        </div>

        <div className="p-4 bg-slate-900/90 border border-slate-800 rounded-xl space-y-1">
          <div className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold flex items-center justify-between">
            <span>Latence Moyenne</span>
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono">
            310 <span className="text-xs font-normal text-slate-500">ms</span>
          </div>
          <div className="text-[10px] text-slate-400">Temps de réponse handshake API</div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
        <button
          onClick={() => setActiveTab('connectors')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'connectors'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Network className="w-3.5 h-3.5" />
          Connecteurs Configurés ({connectors.length})
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'logs'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          Journal des Flux & Webhooks ({logs.length})
        </button>

        <button
          onClick={() => setActiveTab('push_award')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'push_award'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          Émission Bon de Commande (Outbound PO)
        </button>

        <button
          onClick={() => setActiveTab('spec')}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
            activeTab === 'spec'
              ? 'bg-sky-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-white bg-slate-900 border border-slate-800'
          }`}
        >
          <FileCode className="w-3.5 h-3.5" />
          Architecture & Protocoles cXML / REST
        </button>
      </div>

      {/* TAB 1: CONNECTEURS */}
      {activeTab === 'connectors' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {connectors.map((c) => {
            const isTesting = testingId === c.id;
            const isSyncing = syncingId === c.id;
            const isConnected = c.status === 'connected';

            return (
              <div
                key={c.id}
                className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl flex flex-col justify-between space-y-4 hover:border-slate-700 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-base">{c.name}</h3>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold ${
                            isConnected
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : c.status === 'idle'
                              ? 'bg-sky-950 text-sky-400 border border-sky-800'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {c.status.toUpperCase()}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        {c.version} · Protocole : <strong className="text-slate-300">{c.protocol}</strong>
                      </div>
                    </div>

                    <button
                      onClick={() => setEditingConnector(c)}
                      className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                      title="Configurer les paramètres d'accès"
                    >
                      <Settings className="w-4 h-4" />
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 line-clamp-2">{c.description}</p>

                  <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg space-y-1.5 text-xs font-mono">
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Endpoint API :</span>
                      <span className="text-slate-300 truncate max-w-[220px]">{c.endpointUrl}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Authentification :</span>
                      <span className="text-emerald-400">{c.authType}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400">
                      <span>Fréquence Synchro :</span>
                      <span className="text-slate-300">{c.syncFrequency}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-900">
                      <span>Dernière synchro :</span>
                      <span className="text-slate-400">{new Date(c.lastSyncTimestamp).toLocaleTimeString('fr-FR')}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span>
                      In : <strong className="text-sky-400 font-mono">{c.inboundOffersCount}</strong>
                    </span>
                    <span>
                      Out : <strong className="text-indigo-400 font-mono">{c.outboundAwardsCount}</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestHandshake(c)}
                      disabled={isTesting || c.status === 'disabled'}
                      className="px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg font-medium flex items-center gap-1.5 transition-colors"
                    >
                      <Radio className={`w-3.5 h-3.5 ${isTesting ? 'animate-pulse text-sky-400' : ''}`} />
                      {isTesting ? 'Ping...' : 'Tester'}
                    </button>

                    <button
                      onClick={() => handleSyncInbound(c)}
                      disabled={isSyncing || c.status === 'disabled'}
                      className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg font-semibold flex items-center gap-1.5 transition-colors shadow-sm"
                    >
                      <ArrowDownLeft className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                      {isSyncing ? 'Synchro...' : 'Importer RFQ'}
                    </button>

                    <button
                      onClick={() => toggleConnectorStatus(c)}
                      className={`px-2.5 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                        c.status === 'disabled'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {c.status === 'disabled' ? 'Activer' : 'Désactiver'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* TAB 2: LOGS & WEBHOOKS */}
      {activeTab === 'logs' && (
        <div className="p-5 bg-slate-900/90 border border-slate-800 rounded-xl space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Rechercher une transaction..."
                  value={searchLog}
                  onChange={(e) => setSearchLog(e.target.value)}
                  className="pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-sky-500 w-56 font-mono"
                />
              </div>

              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5 text-xs">
                <button
                  onClick={() => setFilterDirection('all')}
                  className={`px-2.5 py-1 rounded font-medium ${
                    filterDirection === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Tous ({logs.length})
                </button>
                <button
                  onClick={() => setFilterDirection('inbound')}
                  className={`px-2.5 py-1 rounded font-medium ${
                    filterDirection === 'inbound' ? 'bg-sky-950 text-sky-400' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Inbound (RFQ)
                </button>
                <button
                  onClick={() => setFilterDirection('outbound')}
                  className={`px-2.5 py-1 rounded font-medium ${
                    filterDirection === 'outbound' ? 'bg-indigo-950 text-indigo-400' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Outbound (PO)
                </button>
              </div>
            </div>

            <span className="text-xs text-slate-400 font-mono">
              {filteredLogs.length} transaction(s) auditée(s)
            </span>
          </div>

          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const isInbound = log.direction === 'inbound';
              const isSuccess = log.status === 'success';

              return (
                <div
                  key={log.id}
                  className="p-3.5 bg-slate-950 border border-slate-800/80 rounded-lg space-y-2 hover:border-slate-700 transition-colors text-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={`p-1.5 rounded-lg ${
                          isInbound ? 'bg-sky-950 text-sky-400' : 'bg-indigo-950 text-indigo-400'
                        }`}
                      >
                        {isInbound ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                      </span>
                      <div>
                        <div className="font-bold text-white flex items-center gap-2">
                          <span>{log.action}</span>
                          <span className="text-slate-400 font-normal font-mono text-[11px]">
                            ({log.connectorName})
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">{log.entityReference}</div>
                      </div>
                    </div>

                    <div className="text-right space-y-0.5">
                      <div className="flex items-center justify-end gap-1.5 font-mono">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            isSuccess
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : 'bg-rose-950 text-rose-400 border border-rose-800'
                          }`}
                        >
                          HTTP {log.httpCode}
                        </span>
                        <span className="text-slate-400 text-[11px]">{log.durationMs}ms</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        {new Date(log.timestamp).toLocaleString('fr-FR')}
                      </div>
                    </div>
                  </div>

                  <p className="text-slate-300 text-[11px] bg-slate-900/60 p-2 rounded border border-slate-900">
                    {log.details}
                  </p>

                  <details className="text-[11px]">
                    <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none font-mono">
                      Afficher le payload brut ({log.payloadPreview.length} octets)
                    </summary>
                    <pre className="mt-1.5 p-2.5 bg-slate-900 rounded font-mono text-[10px] text-slate-300 overflow-x-auto border border-slate-800">
                      {log.payloadPreview}
                    </pre>
                  </details>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: PUSH AWARD (OUTBOUND PO) */}
      {activeTab === 'push_award' && (
        <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-xl space-y-6">
          <div>
            <h3 className="text-lg font-bold text-white">Transmission d'Adjudication & Création de Bon de Commande (PO)</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl">
              Poussez la décision arbitrée en Comité des Engagements directement vers votre ERP (SAP Ariba ou Coupa) pour générer l'engagement de dépenses et bloquer le budget.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  1. Sélectionner l'ERP cible
                </label>
                <select
                  value={selectedErpForAward}
                  onChange={(e) => setSelectedErpForAward(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-medium focus:outline-none focus:border-sky-500"
                >
                  {connectors
                    .filter((c) => c.status !== 'disabled')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.protocol})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  2. Sélectionner l'offre gagnante à adjuger
                </label>
                <select
                  value={selectedOfferId}
                  onChange={(e) => setSelectedOfferId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs font-medium focus:outline-none focus:border-sky-500"
                >
                  {offers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.supplierName} — {o.offerReference} ({o.apparentTotal.toLocaleString('fr-FR')} € HT)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  3. Motivation de l'adjudication (Rapport Comex)
                </label>
                <textarea
                  rows={4}
                  value={awardRationale}
                  onChange={(e) => setAwardRationale(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              <button
                onClick={handlePushAward}
                disabled={isPushingAward || offers.length === 0}
                className="w-full py-2.5 px-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-sky-950/40"
              >
                <Send className={`w-4 h-4 ${isPushingAward ? 'animate-bounce' : ''}`} />
                {isPushingAward ? 'Génération du Bon de Commande...' : 'Transmettre au SI Achats (Générer Bon de Commande PO)'}
              </button>
            </div>

            {/* Award preview preview card */}
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
              <div className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                Aperçu du Payload d'Engagement budgétaire
              </div>

              {lastAwardResult ? (
                <div className="p-4 bg-emerald-950/50 border border-emerald-800/80 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <Check className="w-4 h-4" /> Bon de commande émis : {lastAwardResult.poReference}
                  </div>
                  <p className="text-slate-300">{lastAwardResult.message}</p>
                </div>
              ) : null}

              <div className="text-[11px] font-mono text-slate-300 space-y-1.5 p-3 bg-slate-900 rounded-lg border border-slate-800">
                <div>Projet : <span className="text-white">{project.reference}</span></div>
                <div>Offre retenue : <span className="text-sky-400">{offers.find((o) => o.id === selectedOfferId)?.supplierName || 'N/A'}</span></div>
                <div>Montant engagé : <span className="text-emerald-400">{offers.find((o) => o.id === selectedOfferId)?.apparentTotal.toLocaleString('fr-FR')} € HT</span></div>
                <div>Imputation comptable : <span className="text-indigo-400">CC-MOBILITE-604 (Capex Flotte)</span></div>
                <div>Visas attachés : <span className="text-slate-400">Acheteur, RSE, Contrôle de gestion, DG</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SPECIFICATION & ARCHITECTURE */}
      {activeTab === 'spec' && (
        <div className="p-6 bg-slate-900/90 border border-slate-800 rounded-xl space-y-4 text-xs text-slate-300">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              Spécifications Techniques CIBLES — Chantier 7 (non implémentées)
            </h3>
            <span className="text-amber-400 font-mono font-bold">À construire</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <Building2 className="w-4 h-4 text-sky-400" />
                1. Cible à développer — SAP Ariba (cXML 1.2)
              </div>
              <p className="text-slate-400 text-[11px]">
                À développer : réception des <strong>cXML QuoteMessage</strong> (bordereaux de prix) et émission d'un <strong>OrderRequest</strong> vers SAP MM. Aucun adaptateur cXML n'existe aujourd'hui dans le produit.
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-indigo-400" />
                2. Cible à développer — Coupa BSM & Ivalua (REST & Webhooks)
              </div>
              <p className="text-slate-400 text-[11px]">
                À développer : appels signés HMAC-SHA256, jetons <strong>OAuth2</strong> côté serveur, mapping des tables d'articles et des axes analytiques. Non implémenté à ce jour (aucun appel sortant).
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                3. Exigences de sécurité (à mettre en œuvre)
              </div>
              <p className="text-slate-400 text-[11px]">
                Cible : <strong>TLS 1.3</strong>, authentification mutuelle mTLS avec certificats X.509 d'entreprise et stockage des secrets dans un coffre serveur (KMS/Vault). Aujourd'hui, les « identifiants » affichés dans cette page sont des libellés de démonstration stockés dans le navigateur.
              </p>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-2">
              <div className="font-bold text-white flex items-center gap-2">
                <FileCode className="w-4 h-4 text-amber-400" />
                4. Piste d'audit (cible)
              </div>
              <p className="text-slate-400 text-[11px]">
                Cible : historisation serveur horodatée de chaque transaction d'import/export, rattachée à la session authentifiée. Le journal actuel est applicatif (navigateur) et non immuable : il ne constitue pas une piste d'audit opposable.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Edit Connector Modal */}
      {editingConnector && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-white text-base">Configuration : {editingConnector.name}</h3>
              <button
                onClick={() => setEditingConnector(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveConnector} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Nom affiché</label>
                <input
                  type="text"
                  value={editingConnector.name}
                  onChange={(e) => setEditingConnector({ ...editingConnector, name: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Endpoint d'API distant</label>
                <input
                  type="url"
                  value={editingConnector.endpointUrl}
                  onChange={(e) => setEditingConnector({ ...editingConnector, endpointUrl: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1">Type d'authentification</label>
                  <select
                    value={editingConnector.authType}
                    onChange={(e) => setEditingConnector({ ...editingConnector, authType: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                  >
                    <option value="oauth2_client_credentials">OAuth2 Client Credentials</option>
                    <option value="api_key_bearer">Bearer Token / API Key</option>
                    <option value="basic_cxml">Basic Auth / Shared Secret</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1">Fréquence de synchronisation</label>
                  <select
                    value={editingConnector.syncFrequency}
                    onChange={(e) => setEditingConnector({ ...editingConnector, syncFrequency: e.target.value as any })}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white"
                  >
                    <option value="realtime_webhook">Temps Réel (Webhook)</option>
                    <option value="hourly">Toutes les heures</option>
                    <option value="daily">Quotidien</option>
                    <option value="manual">Manuel uniquement</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1">Client ID / Identifiant d'application</label>
                <input
                  type="text"
                  value={editingConnector.clientId || ''}
                  onChange={(e) => setEditingConnector({ ...editingConnector, clientId: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-white font-mono"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingConnector(null)}
                  className="px-3 py-2 text-slate-400 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg"
                >
                  Enregistrer les modifications
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
