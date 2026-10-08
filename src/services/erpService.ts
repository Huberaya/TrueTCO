import { ErpConnector, ErpSyncLog, SupplierOffer } from '../types/domain';

/**
 * ===========================================================================
 * STATUT D'IMPLÉMENTATION — INTÉGRATION ERP
 * ===========================================================================
 * ❌ AUCUNE intégration ERP réelle n'est implémentée à ce jour.
 *
 * Ce qu'il manque pour parler d'intégration réelle :
 *   - un adaptateur serveur par éditeur (SAP Ariba cXML, Coupa REST, Ivalua,
 *     Oracle, Workday) avec mapping des schémas de commande ;
 *   - une authentification sortante réellement négociée avec le client
 *     (OAuth2 client credentials / mTLS) et des secrets stockés dans un coffre
 *     (KMS/Vault) côté serveur, jamais dans le navigateur ;
 *   - une file d'attente idempotente avec reprise sur erreur et journal de
 *     synchronisation côté serveur ;
 *   - des tests de contrat et un environnement de recette fourni par le client.
 *
 * En attendant, les connecteurs ci-dessous sont des JEUX DE DÉMONSTRATION et
 * les actions de synchronisation échouent explicitement, au lieu de produire
 * des données fictives présentées comme des données ERP réelles.
 */
export const ERP_INTEGRATION_IMPLEMENTED = false;

export const ERP_NOT_IMPLEMENTED_MESSAGE =
  "Intégration ERP non implémentée dans cette version : aucune donnée n'a été lue ni écrite dans un système tiers.";

const STORAGE_KEYS = {
  CONNECTORS: 'truetco_erp_connectors_v1',
  LOGS: 'truetco_erp_logs_v1',
};

export const INITIAL_ERP_CONNECTORS: ErpConnector[] = [
  {
    id: 'erp-sap-ariba',
    name: 'SAP Ariba Sourcing & Procurement',
    code: 'sap_ariba',
    version: 'Ariba Cloud Network 24R1',
    status: 'connected',
    protocol: 'cXML 1.2',
    endpointUrl: 'https://openapi.ariba.com/api/sourcing/v1/rfq-events',
    authType: 'oauth2_client_credentials',
    clientId: 'ariba-eu-app-truetco-prod-902',
    apiKeyMasked: '••••••••••••••••3a9f',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: new Date(Date.now() - 24 * 60 * 1000).toISOString(),
    syncFrequency: 'realtime_webhook',
    autoPushWinnerAward: true,
    costCenterMapping: {
      'CC-MOBILITE-604': 'Centre de Coûts Flotte & Mobilité Durable',
      'CC-IT-INFRA-401': 'Direction des Systèmes d’Information & Infra',
      'CC-INDUSTRIE-702': 'Direction Industrielle & Capex Équipements',
    },
    inboundOffersCount: 14,
    outboundAwardsCount: 6,
    description: 'Passerelle certifiée SAP Ariba pour la synchronisation bidirectionnelle des consultations RFQ et l’émission automatique des bons de commande (PO) après arbitrage TCO.',
  },
  {
    id: 'erp-coupa',
    name: 'Coupa Business Spend Management (BSM)',
    code: 'coupa',
    version: 'Coupa Enterprise v38.2',
    status: 'connected',
    protocol: 'REST / JSON',
    endpointUrl: 'https://acme-europe.coupahost.com/api/sourcing_events',
    authType: 'oauth2_client_credentials',
    clientId: 'coupa-client-acme-eu-881',
    apiKeyMasked: '••••••••••••••••b714',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    syncFrequency: 'hourly',
    autoPushWinnerAward: true,
    costCenterMapping: {
      'CC-LOGISTIQUE-501': 'Supply Chain & Plates-formes Hubs Europe',
      'CC-ESG-CAPEX-102': 'Fonds d’Investissement Décarbonation Groupe',
    },
    inboundOffersCount: 8,
    outboundAwardsCount: 3,
    description: 'Synchronisation REST v2 des grilles fournisseurs Coupa et création d’un engagement de dépenses (Purchase Requisition) dès validation du visa direction.',
  },
  {
    id: 'erp-ivalua',
    name: 'Ivalua Strategic Sourcing',
    code: 'ivalua',
    version: 'Ivalua Platform 10.4',
    status: 'idle',
    protocol: 'Webhook HMAC',
    endpointUrl: 'https://sourcing.ivaluacloud.com/ws/acme/truetco/sync',
    authType: 'api_key_bearer',
    clientId: 'ivalua-webhook-srv-01',
    apiKeyMasked: '••••••••••••••••e420',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
    syncFrequency: 'daily',
    autoPushWinnerAward: false,
    costCenterMapping: {
      'CC-SERVICES-301': 'Achats Généraux & Prestations Intellectuelles',
    },
    inboundOffersCount: 5,
    outboundAwardsCount: 2,
    description: 'Connecteur Webhook pour la remontée des offres fournisseurs issues des appels d’offres Ivalua et alimentation de la grille de critères ESG.',
  },
  {
    id: 'erp-jaggaer',
    name: 'Jaggaer Enterprise Sourcing',
    code: 'jaggaer',
    version: 'Jaggaer ONE 23.3',
    status: 'disabled',
    protocol: 'SOAP / XML',
    endpointUrl: 'https://gateway.jaggaer.com/ws/procurement/acme',
    authType: 'basic_cxml',
    clientId: 'jaggaer_svc_acme',
    apiKeyMasked: '••••••••••••••••91a2',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
    syncFrequency: 'manual',
    autoPushWinnerAward: false,
    costCenterMapping: {},
    inboundOffersCount: 0,
    outboundAwardsCount: 0,
    description: 'Interface de secours SOAP pour sites industriels hérités utilisant la suite Jaggaer BravoSolution.',
  },
  {
    id: 'erp-generic-rest',
    name: 'Passerelle Universelle REST / Webhook',
    code: 'generic_rest',
    version: 'TrueTCO Gateway v1.0',
    status: 'connected',
    protocol: 'REST / JSON',
    endpointUrl: 'https://api.truetco.internal/v1/inbound-offers',
    authType: 'api_key_bearer',
    clientId: 'truetco-open-api-gateway',
    apiKeyMasked: '••••••••••••••••105f',
    organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    lastSyncTimestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    syncFrequency: 'realtime_webhook',
    autoPushWinnerAward: true,
    costCenterMapping: {
      'CC-DEFAULT-000': 'Compte Général Achats Responsables',
    },
    inboundOffersCount: 22,
    outboundAwardsCount: 11,
    description: 'API ouverte protégée par clé API Bearer permettant à tout ERP (Microsoft Dynamics 365, Infor, Cegid, Oracle NetSuite) d’injecter des devis et récupérer les résultats TCO.',
  },
];

export const INITIAL_ERP_LOGS: ErpSyncLog[] = [
  {
    id: 'log-erp-001',
    connectorId: 'erp-sap-ariba',
    connectorName: 'SAP Ariba',
    direction: 'inbound',
    timestamp: new Date(Date.now() - 18 * 60 * 1000).toISOString(),
    status: 'success',
    action: 'Réception cXML RFQ-2026-MOB-004',
    entityReference: 'Offre Renault Trucks E-Tech (AO-2026-MOB-004)',
    payloadPreview: '<?xml version="1.0"?><cXML payloadID="ariba-rfq-441"><Request><QuoteMessage><SupplierName>Renault Trucks</SupplierName><TotalAmount currency="EUR">3850000</TotalAmount></QuoteMessage></Request></cXML>',
    httpCode: 200,
    durationMs: 342,
    details: 'Extraction réussie de 50 utilitaires électriques, 1 poste IRVE et 5 ans de maintenance. Rattaché au projet Flotte VUL.',
  },
  {
    id: 'log-erp-002',
    connectorId: 'erp-coupa',
    connectorName: 'Coupa BSM',
    direction: 'outbound',
    timestamp: new Date(Date.now() - 85 * 60 * 1000).toISOString(),
    status: 'success',
    action: 'Push Adjudication Comex PO-2026-IT-901',
    entityReference: 'Dossier CircularPC Reconditionné (Projet IT-200)',
    payloadPreview: '{"purchase_order":{"project_ref":"AO-2026-IT-012","winner_supplier":"CircularPC","tco_total":298400,"wacc_rate":0.045,"esg_co2_avoided_tonnes":78.4,"comex_visas":["Acheteur","RSE","Finance"]}}',
    httpCode: 201,
    durationMs: 418,
    details: 'Bon de commande généré avec succès dans Coupa. Budget réservé sous le centre de coûts CC-ESG-CAPEX-102.',
  },
  {
    id: 'log-erp-003',
    connectorId: 'erp-generic-rest',
    connectorName: 'Passerelle Universelle',
    direction: 'inbound',
    timestamp: new Date(Date.now() - 140 * 60 * 1000).toISOString(),
    status: 'success',
    action: 'Webhook Devis Fournisseur Grundfos IE5',
    entityReference: 'Réf. GRUNDFOS-CR-IE5-2026 (Station Veolia)',
    payloadPreview: '{"supplier_name":"Grundfos SAS","apparent_total":215000,"kwh_annual":72000,"fdes_ref":"INIES-GRUNDFOS-2026-PUMP"}',
    httpCode: 200,
    durationMs: 195,
    details: 'Normalisation automatique des coûts d’exploitation électrique et calcul du LCC actualisé.',
  },
  {
    id: 'log-erp-004',
    connectorId: 'erp-ivalua',
    connectorName: 'Ivalua Strategic Sourcing',
    direction: 'outbound',
    timestamp: new Date(Date.now() - 310 * 60 * 1000).toISOString(),
    status: 'warning',
    action: 'Synchronisation statut d’arbitrage',
    entityReference: 'Projet Verrier Fours Saint-Gobain (AO-2026-IND-003)',
    payloadPreview: '{"status_update":"arbitrage_en_cours","preferred_candidate":"Fives Stein","review_deadline":"2026-10-15"}',
    httpCode: 200,
    durationMs: 760,
    details: 'Avertissement : Le serveur Ivalua a répondu avec un délai élevé (760ms), statut pris en compte avec succès.',
  },
];

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
    return this.load<ErpConnector[]>(STORAGE_KEYS.CONNECTORS, INITIAL_ERP_CONNECTORS);
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
    return this.load<ErpSyncLog[]>(STORAGE_KEYS.LOGS, INITIAL_ERP_LOGS);
  }

  public static addLog(entry: ErpSyncLog): void {
    const list = this.getLogs();
    const updated = [entry, ...list.slice(0, 49)];
    this.save(STORAGE_KEYS.LOGS, updated);
  }

  /**
   * Test connection / Handshake ping with ERP
   */
  public static async testHandshake(connectorId: string): Promise<{ success: boolean; durationMs: number; message: string; httpCode: number }> {
    const start = Date.now();
    try {
      const res = await fetch(`/api/erp/connectors/${connectorId}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      const durationMs = Date.now() - start;

      const log: ErpSyncLog = {
        id: `log-test-${Date.now()}`,
        connectorId,
        connectorName: data.connectorName || 'ERP Connecteur',
        direction: 'outbound',
        timestamp: new Date().toISOString(),
        status: data.success ? 'success' : 'failed',
        action: 'Test de connectivité / Handshake Ping',
        entityReference: `Endpoint ${data.endpointUrl || 'distant'}`,
        payloadPreview: JSON.stringify(data.handshakeResponse || { ping: 'OK', protocol: 'TLS 1.3', cipher: 'AES-256-GCM' }, null, 2),
        httpCode: data.httpCode || (data.success ? 200 : 502),
        durationMs,
        details: data.message || (data.success ? 'Handshake cryptographique et token validés avec succès.' : 'Échec de connexion au serveur distant.'),
      };
      this.addLog(log);

      return {
        success: data.success,
        durationMs,
        message: data.message,
        httpCode: data.httpCode || 200,
      };
    } catch {
      // AUCUNE simulation de succès : un test de connectivité qui ne joint pas
      // le serveur ne prouve rien sur le connecteur. On retourne un échec
      // explicite plutôt qu'une latence inventée et un faux « mTLS validé ».
      const log: ErpSyncLog = {
        id: `log-test-${Date.now()}`,
        connectorId,
        connectorName: connectorId,
        direction: 'outbound',
        timestamp: new Date().toISOString(),
        status: 'failed',
        action: 'Test de connectivité — NON EXÉCUTÉ',
        entityReference: 'Serveur TrueTCO indisponible',
        payloadPreview: JSON.stringify({ error: 'SERVER_UNREACHABLE' }, null, 2),
        httpCode: 503,
        durationMs: Date.now() - start,
        details: ERP_NOT_IMPLEMENTED_MESSAGE,
      };
      this.addLog(log);

      return {
        success: false,
        durationMs: Date.now() - start,
        message: ERP_NOT_IMPLEMENTED_MESSAGE,
        httpCode: 503,
      };
    }
  }

  /**
   * Inbound sync: Fetch supplier offers from ERP for a project
   */
  public static async syncInboundOffers(
    connectorId: string,
    projectId: string
  ): Promise<{ success: boolean; offersImported: number; offers: SupplierOffer[]; message: string }> {
    try {
      const res = await fetch(`/api/erp/connectors/${connectorId}/sync-inbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch {}

    // AUCUN fallback ne fabrique d'offre : la version précédente créait une
    // proposition commerciale de 3 725 000 € notée « Prix d'achat vérifié,
    // confiance 96 % » alors qu'aucun système externe n'avait été contacté.
    this.addLog({
      id: `log-sync-${Date.now()}`,
      connectorId,
      connectorName: connectorId,
      direction: 'inbound',
      timestamp: new Date().toISOString(),
      status: 'failed',
      action: 'Importation devis consultation RFQ — NON EXÉCUTÉE',
      entityReference: 'Aucune',
      payloadPreview: JSON.stringify({ error: 'ERP_NOT_IMPLEMENTED', projectId }, null, 2),
      httpCode: 501,
      durationMs: 0,
      details: ERP_NOT_IMPLEMENTED_MESSAGE,
    });

    return {
      success: false,
      offersImported: 0,
      offers: [],
      message: ERP_NOT_IMPLEMENTED_MESSAGE,
    };
  }

  /**
   * Outbound push: Send procurement award decision to ERP
   */
  public static async pushAwardDecision(
    connectorId: string,
    projectId: string,
    offerId: string,
    rationale: string
  ): Promise<{ success: boolean; poReference: string; message: string }> {
    try {
      const res = await fetch(`/api/erp/connectors/${connectorId}/push-award`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, offerId, rationale }),
      });
      if (res.ok) {
        const data = await res.json();
        return data;
      }
    } catch {}

    // AUCUN bon de commande fictif : la version précédente retournait une
    // référence PO aléatoire présentée comme créée dans l'ERP du client.
    this.addLog({
      id: `log-award-${Date.now()}`,
      connectorId,
      connectorName: connectorId,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
      status: 'failed',
      action: 'Transmission adjudication TCO — NON EXÉCUTÉE',
      entityReference: 'Aucun bon de commande émis',
      payloadPreview: JSON.stringify({ error: 'ERP_NOT_IMPLEMENTED', projectId, offerId }, null, 2),
      httpCode: 501,
      durationMs: 0,
      details: ERP_NOT_IMPLEMENTED_MESSAGE,
    });

    return {
      success: false,
      poReference: '',
      message: ERP_NOT_IMPLEMENTED_MESSAGE,
    };
  }
}
