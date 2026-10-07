import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Tenant, TenantService, DEFAULT_TENANT } from '../services/tenantService';

interface TenantContextType {
  tenants: Tenant[];
  currentTenant: Tenant;
  isLoading: boolean;
  isNewTenantModalOpen: boolean;
  openNewTenantModal: () => void;
  closeNewTenantModal: () => void;
  switchTenant: (tenantId: string) => Promise<void>;
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
  const [tenants, setTenants] = useState<Tenant[]>([DEFAULT_TENANT]);
  const [currentTenant, setCurrentTenant] = useState<Tenant>(DEFAULT_TENANT);
  const [isLoading, setIsLoading] = useState(true);
  const [isNewTenantModalOpen, setIsNewTenantModalOpen] = useState(false);

  const refreshTenants = useCallback(async () => {
    try {
      const list = await TenantService.getTenants();
      setTenants(list);

      const activeId = TenantService.getActiveTenantId();
      const match = list.find((t) => t.id === activeId) || list[0] || DEFAULT_TENANT;
      setCurrentTenant(match);
      TenantService.setActiveTenantId(match.id);
    } catch (err) {
      console.warn('Failed to load tenants:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTenants();
  }, [refreshTenants]);

  const switchTenant = async (tenantId: string) => {
    const target = tenants.find((t) => t.id === tenantId);
    if (!target) return;

    TenantService.setActiveTenantId(target.id);
    setCurrentTenant(target);

    // Reload window or trigger data refetch
    window.dispatchEvent(new CustomEvent('truetco:tenant-switched', { detail: { tenantId: target.id } }));
  };

  const createTenant = async (payload: {
    name: string;
    domain?: string;
    subscriptionTier?: string;
    countryCode?: string;
    defaultCurrency?: string;
    legalRegistrationNumber?: string;
  }) => {
    setIsLoading(true);
    try {
      const created = await TenantService.createTenant(payload);
      setTenants((prev) => [...prev, created]);
      setCurrentTenant(created);
      TenantService.setActiveTenantId(created.id);
      setIsNewTenantModalOpen(false);
      window.dispatchEvent(new CustomEvent('truetco:tenant-switched', { detail: { tenantId: created.id } }));
      return created;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <TenantContext.Provider
      value={{
        tenants,
        currentTenant,
        isLoading,
        isNewTenantModalOpen,
        openNewTenantModal: () => setIsNewTenantModalOpen(true),
        closeNewTenantModal: () => setIsNewTenantModalOpen(false),
        switchTenant,
        createTenant,
        refreshTenants,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
};

export const useTenant = (): TenantContextType => {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};
