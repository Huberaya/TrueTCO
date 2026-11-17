import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { Tenant, TenantService, TENANT_UNAVAILABLE_MESSAGE } from '../services/tenantService';

interface TenantContextType {
  tenants: Tenant[];
  currentTenant: null;
  isLoading: false;
  isNewTenantModalOpen: boolean;
  openNewTenantModal: () => void;
  closeNewTenantModal: () => void;
  switchTenant: (tenantId: string) => Promise<never>;
  createTenant: (payload: {
    name: string;
    domain?: string;
    subscriptionTier?: string;
    countryCode?: string;
    defaultCurrency?: string;
    legalRegistrationNumber?: string;
  }) => Promise<Tenant>;
  refreshTenants: () => Promise<void>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);
  const refreshTenants = useCallback(async () => {
    // An empty list is intentional; do not select or invent a default tenant.
    await TenantService.getTenants();
  }, []);

  const switchTenant = async (_tenantId: string): Promise<never> => {
    throw new Error(TENANT_UNAVAILABLE_MESSAGE);
  };

  const createTenant = (payload: Parameters<typeof TenantService.createTenant>[0]) =>
    TenantService.createTenant(payload);

  const value: TenantContextType = {
    tenants: [],
    currentTenant: null,
    isLoading: false,
    isNewTenantModalOpen,
    openNewTenantModal: () => setIsNewTenantModalOpen(true),
    closeNewTenantModal: () => setIsNewTenantModalOpen(false),
    switchTenant,
    createTenant,
    refreshTenants,
  };

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
};

export const useTenant = (): TenantContextType => {
  const context = useContext(TenantContext);
  if (!context) throw new Error('useTenant must be used within a TenantProvider');
  return context;
};
