export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain: string;
  subscriptionTier: 'starter' | 'enterprise' | 'sovereign';
  dataResidency: string;
  countryCode: string;
  defaultCurrency: string;
  legalRegistrationNumber?: string | null;
  projectCount?: number | string;
  supplierCount?: number | string;
  userCount?: number | string;
}

const ACTIVE_TENANT_KEY = 'truetco_active_tenant_id';

export const DEFAULT_TENANT: Tenant = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  name: 'Acme Logistics Europe SAS',
  slug: 'acme-logistics',
  domain: 'acme.com',
  subscriptionTier: 'enterprise',
  dataResidency: 'EU-FRANCE-PARIS (SecNumCloud)',
  countryCode: 'FR',
  defaultCurrency: 'EUR',
  legalRegistrationNumber: '849 203 910 00024',
};

export class TenantService {
  public static getActiveTenantId(): string {
    if (typeof window === 'undefined') return DEFAULT_TENANT.id;
    return localStorage.getItem(ACTIVE_TENANT_KEY) || DEFAULT_TENANT.id;
  }

  public static setActiveTenantId(tenantId: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
  }

  public static async getTenants(): Promise<Tenant[]> {
    try {
      const res = await fetch('/api/tenants');
      if (!res.ok) return [DEFAULT_TENANT];
      const data = await res.json();
      return Array.isArray(data) && data.length > 0 ? data : [DEFAULT_TENANT];
    } catch (err) {
      console.warn('[TenantService] Failed to fetch tenants from Neon, using default:', err);
      return [DEFAULT_TENANT];
    }
  }

  public static async getCurrentTenant(): Promise<Tenant | null> {
    const tenantId = this.getActiveTenantId();
    try {
      const res = await fetch('/api/tenants/current', {
        headers: {
          'x-tenant-id': tenantId,
        },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  public static async createTenant(payload: {
    name: string;
    domain?: string;
    subscriptionTier?: string;
    countryCode?: string;
    defaultCurrency?: string;
    legalRegistrationNumber?: string;
  }): Promise<Tenant> {
    const res = await fetch('/api/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Erreur lors de la création du tenant' }));
      throw new Error(err.error || `Erreur HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.tenant;
  }
}
