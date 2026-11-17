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

export const TENANT_UNAVAILABLE_MESSAGE =
  'Organisation indisponible : aucune identité vérifiée ni appartenance serveur n’est configurée.';

/** Tenant discovery and selection are disabled; browser state is never authority. */
export class TenantService {
  public static getActiveTenantId(): null {
    return null;
  }

  public static setActiveTenantId(_tenantId: string): void {
    // Deliberately do not persist a selected organization in browser storage.
  }

  public static async getTenants(): Promise<Tenant[]> {
    return [];
  }

  public static async getCurrentTenant(): Promise<null> {
    return null;
  }

  public static async createTenant(_payload: {
    name: string;
    domain?: string;
    subscriptionTier?: string;
    countryCode?: string;
    defaultCurrency?: string;
    legalRegistrationNumber?: string;
  }): Promise<never> {
    throw new Error(TENANT_UNAVAILABLE_MESSAGE);
  }
}
