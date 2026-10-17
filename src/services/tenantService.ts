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

import { ACTIVE_TENANT_KEY, apiFetch, hasServerSession, setActiveTenant } from './apiClient';

export const DEFAULT_TENANT: Tenant = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  name: 'Organisation de démonstration',
  slug: 'demo',
  domain: '',
  subscriptionTier: 'starter',
  dataResidency: 'Local (navigateur)',
  countryCode: 'FR',
  defaultCurrency: 'EUR',
  legalRegistrationNumber: '',
};

export class TenantService {
  public static getActiveTenantId(): string {
    if (typeof window === 'undefined') return DEFAULT_TENANT.id;
    return localStorage.getItem(ACTIVE_TENANT_KEY) || DEFAULT_TENANT.id;
  }

  public static setActiveTenantId(tenantId: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ACTIVE_TENANT_KEY, tenantId);
    setActiveTenant(tenantId);
  }

  public static async getTenants(): Promise<Tenant[]> {
    // Mode démo (aucune session serveur) : organisation locale fictive uniquement.
    if (!hasServerSession()) return [DEFAULT_TENANT];
    try {
      const res = await apiFetch('/api/tenants');
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.warn('[TenantService] Failed to fetch tenants:', err);
      return [];
    }
  }

  public static async getCurrentTenant(): Promise<Tenant | null> {
    try {
      const res = await apiFetch('/api/tenants/current');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  public static async createTenant(payload: {
    name: string;
    countryCode?: string;
    defaultCurrency?: string;
    legalRegistrationNumber?: string;
  }): Promise<Tenant> {
    const res = await apiFetch('/api/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Erreur lors de la création' }));
      throw new Error(err.message || err.error || `Erreur HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.tenant;
  }
}
