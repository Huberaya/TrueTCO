import { ErpConnector, ErpSyncLog, SupplierOffer } from '../types/domain';

const STORAGE_KEYS = {
  CONNECTORS: 'truetco_erp_connectors_v1',
  LOGS: 'truetco_erp_logs_v1',
};

export const INITIAL_ERP_CONNECTORS: ErpConnector[] = [
  {
    id: 'erp-sap-ariba',
    name: 'SAP Ariba Sourcing & Procurement',
    code: 'sap_ariba',
    version: 'Exemple non configuré',
    status: 'idle',
    protocol: 'cXML 1.2',
    endpointUrl: 'Non configuré',
    authType: 'oauth2_client_credentials',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: '',
    syncFrequency: 'realtime_webhook',
    autoPushWinnerAward: false,
    costCenterMapping: {
      'CC-MOBILITE-604': 'Centre de Coûts Flotte & Mobilité Durable',
      'CC-IT-INFRA-401': 'Direction des Systèmes d’Information & Infra',
      'CC-INDUSTRIE-702': 'Direction Industrielle & Capex Équipements',
    },
    inboundOffersCount: 0,
    outboundAwardsCount: 0,
    description: 'Exemple de connecteur. Non connecté : aucun échange RFQ ni bon de commande ne sera exécuté.',
  },
  {
    id: 'erp-coupa',
    name: 'Coupa Business Spend Management (BSM)',
    code: 'coupa',
    version: 'Exemple non configuré',
    status: 'idle',
    protocol: 'REST / JSON',
    endpointUrl: 'Non configuré',
    authType: 'oauth2_client_credentials',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: '',
    syncFrequency: 'hourly',
    autoPushWinnerAward: false,
    costCenterMapping: {
      'CC-LOGISTIQUE-501': 'Supply Chain & Plates-formes Hubs Europe',
      'CC-ESG-CAPEX-102': 'Fonds d’Investissement Décarbonation Groupe',
    },
    inboundOffersCount: 0,
    outboundAwardsCount: 0,
    description: 'Exemple de connecteur. Non connecté : aucune synchronisation ni demande d’achat ne sera exécutée.',
  },
  {
    id: 'erp-ivalua',
    name: 'Ivalua Strategic Sourcing',
    code: 'ivalua',
    version: 'Exemple non configuré',
    status: 'idle',
    protocol: 'Webhook HMAC',
    endpointUrl: 'Non configuré',
    authType: 'api_key_bearer',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: '',
    syncFrequency: 'daily',
    autoPushWinnerAward: false,
    costCenterMapping: {
      'CC-SERVICES-301': 'Achats Généraux & Prestations Intellectuelles',
    },
    inboundOffersCount: 0,
    outboundAwardsCount: 0,
    description: 'Exemple de connecteur non configuré. Aucun webhook fournisseur n’est actif.',
  },
  {
    id: 'erp-jaggaer',
    name: 'Jaggaer Enterprise Sourcing',
    code: 'jaggaer',
    version: 'Exemple non configuré',
    status: 'disabled',
    protocol: 'SOAP / XML',
    endpointUrl: 'Non configuré',
    authType: 'basic_cxml',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: '',
    syncFrequency: 'manual',
    autoPushWinnerAward: false,
    costCenterMapping: {},
    inboundOffersCount: 0,
    outboundAwardsCount: 0,
    description: 'Exemple de connecteur désactivé, à configurer avant tout usage.',
  },
  {
    id: 'erp-generic-rest',
    name: 'Passerelle Universelle REST / Webhook',
    code: 'generic_rest',
    version: 'Exemple non configuré',
    status: 'idle',
    protocol: 'REST / JSON',
    endpointUrl: 'Non configuré',
    authType: 'api_key_bearer',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: '',
    syncFrequency: 'realtime_webhook',
    autoPushWinnerAward: false,
    costCenterMapping: {
      'CC-DEFAULT-000': 'Compte Général Achats Responsables',
    },
    inboundOffersCount: 0,
    outboundAwardsCount: 0,
    description: 'Exemple de connecteur non configuré. Aucune API externe n’est reliée.',
  },
];

export const INITIAL_ERP_LOGS: ErpSyncLog[] = [];

export class ErpService {
  private static load<T>(key: string, fallback: T): T {
    try {
      if (typeof window === 'undefined') return fallback;
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  private static save<T>(key: string, data: T): void {
    try {
      if (typeof window === 'undefined') return;
      localStorage.setItem(key, JSON.stringify(data));
    } catch {}
  }

  public static getConnectors(): ErpConnector[] {
    return this.load<ErpConnector[]>(STORAGE_KEYS.CONNECTORS, INITIAL_ERP_CONNECTORS).map((connector) => ({
      ...connector,
      status: connector.status === 'disabled' ? 'disabled' : 'idle',
      inboundOffersCount: 0,
      outboundAwardsCount: 0,
      lastSyncTimestamp: '',
    }));
  }

  public static saveConnectors(connectors: ErpConnector[]): void {
    this.save(STORAGE_KEYS.CONNECTORS, connectors);
  }

  public static updateConnector(id: string, updates: Partial<ErpConnector>): ErpConnector | null {
    const list = this.getConnectors();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    const updated = { ...list[idx], ...updates };
    list[idx] = updated;
    this.saveConnectors(list);
    return updated;
  }

  public static getLogs(): ErpSyncLog[] {
    return this.load<ErpSyncLog[]>(STORAGE_KEYS.LOGS, INITIAL_ERP_LOGS).filter((entry) => entry.status !== 'success');
  }

  public static addLog(entry: ErpSyncLog): void {
    const list = this.getLogs();
    const updated = [entry, ...list.slice(0, 49)];
    this.save(STORAGE_KEYS.LOGS, updated);
  }

  private static async request(path: string, body?: unknown): Promise<{ response: Response; data: any; durationMs: number }> {
    const start = Date.now();
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await response.json().catch(() => ({}));
    return { response, data, durationMs: Date.now() - start };
  }

  private static recordFailure(connectorId: string, action: string, message: string, httpCode: number, durationMs: number): void {
    const connector = this.getConnectors().find((item) => item.id === connectorId);
    this.addLog({
      id: `log-failed-${Date.now()}`,
      connectorId,
      connectorName: connector?.name || 'Connecteur ERP',
      direction: 'outbound',
      timestamp: new Date().toISOString(),
      status: 'failed',
      action,
      entityReference: 'Aucune opération ERP confirmée',
      payloadPreview: '',
      httpCode,
      durationMs,
      details: message,
    });
  }

  public static async testHandshake(connectorId: string): Promise<{ success: boolean; durationMs: number; message: string; httpCode: number }> {
    try {
      const { response, data, durationMs } = await this.request(`/api/erp/connectors/${encodeURIComponent(connectorId)}/test`);
      const success = response.ok && data.success === true;
      const message = typeof data.message === 'string' ? data.message : `Test de connexion refusé (HTTP ${response.status}).`;
      this.addLog({
        id: `log-test-${Date.now()}`,
        connectorId,
        connectorName: data.connectorName || 'Connecteur ERP',
        direction: 'outbound',
        timestamp: new Date().toISOString(),
        status: success ? 'success' : 'failed',
        action: 'Test de connectivité / Handshake',
        entityReference: success ? 'Connexion testée' : 'Aucune connexion confirmée',
        payloadPreview: '',
        httpCode: response.status,
        durationMs,
        details: message,
      });
      return { success, durationMs, message, httpCode: response.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Service ERP inaccessible.';
      this.recordFailure(connectorId, 'Test de connectivité / Handshake', message, 0, 0);
      return { success: false, durationMs: 0, message, httpCode: 0 };
    }
  }

  public static async syncInboundOffers(connectorId: string, projectId: string): Promise<{ success: boolean; offersImported: number; offers: SupplierOffer[]; message: string }> {
    try {
      const { response, data } = await this.request(`/api/erp/connectors/${encodeURIComponent(connectorId)}/sync-inbound`, { projectId });
      if (!response.ok || data.success !== true || !Array.isArray(data.offers)) {
        return { success: false, offersImported: 0, offers: [], message: data.message || `Import impossible (HTTP ${response.status}). Aucune offre n'a été créée.` };
      }
      return data;
    } catch (error) {
      return { success: false, offersImported: 0, offers: [], message: error instanceof Error ? error.message : 'Service ERP inaccessible. Aucune offre n’a été créée.' };
    }
  }

  public static async pushAwardDecision(connectorId: string, projectId: string, offerId: string, rationale: string): Promise<{ success: boolean; poReference: string; message: string }> {
    try {
      const { response, data } = await this.request(`/api/erp/connectors/${encodeURIComponent(connectorId)}/push-award`, { projectId, offerId, rationale });
      const success = response.ok && data.success === true && typeof data.poReference === 'string' && data.poReference.length > 0;
      return { success, poReference: success ? data.poReference : '', message: data.message || `Transmission non confirmée (HTTP ${response.status}). Aucun bon de commande n'est confirmé.` };
    } catch (error) {
      return { success: false, poReference: '', message: error instanceof Error ? error.message : 'Service ERP inaccessible. Aucun bon de commande n’est confirmé.' };
    }
  }

}
