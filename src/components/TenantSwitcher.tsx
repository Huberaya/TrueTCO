import React, { useState, useRef, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import {
  Building2,
  ChevronDown,
  ShieldCheck,
  Check,
  Plus,
  Layers,
  Lock,
  Globe2,
} from 'lucide-react';

export const TenantSwitcher: React.FC = () => {
  const { tenants, currentTenant, switchTenant, openNewTenantModal } = useTenant();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getTierBadge = (tier: string) => {
    switch (tier) {
      case 'sovereign':
        return { label: 'Souverain SecNumCloud', color: 'bg-purple-950 text-purple-300 border-purple-800' };
      case 'enterprise':
        return { label: 'Entreprise Dédié', color: 'bg-emerald-950 text-emerald-300 border-emerald-800' };
      default:
        return { label: 'Standard', color: 'bg-slate-800 text-slate-300 border-slate-700' };
    }
  };

  const currentBadge = getTierBadge(currentTenant.subscriptionTier);

  return (
    <div className="relative" ref={containerRef}>
      {/* Switcher Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-900/90 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 rounded-lg transition-all text-xs group"
        title="Changer d'espace entreprise — chaque organisation est isolée en base (RLS)"
      >
        <div className="w-5 h-5 rounded bg-emerald-950 border border-emerald-800/80 flex items-center justify-center text-emerald-400">
          <Building2 className="w-3 h-3" />
        </div>

        <div className="text-left hidden md:block">
          <div className="text-[11px] font-bold text-white leading-tight truncate max-w-[140px] lg:max-w-[180px]">
            {currentTenant.name}
          </div>
          <div className="text-[9px] text-slate-400 font-mono leading-tight flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400"></span>
            <span>{currentTenant.domain}</span>
          </div>
        </div>

        <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-transform" />
      </button>

      {/* Switcher Dropdown Menu */}
      {isOpen && (
        <div className="absolute left-0 mt-2 w-84 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 text-xs z-50 animate-fade-in space-y-3">
          
          {/* Header */}
          <div className="px-1 pb-2 border-b border-slate-800 flex items-center justify-between">
            <div>
              <div className="font-bold text-white flex items-center gap-1.5 text-xs">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Espaces Entreprises & Filiales
              </div>
              <div className="text-[10px] text-slate-400">
                Partitionnement étanche (Row-Level Security)
              </div>
            </div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold border ${currentBadge.color}`}>
              {currentTenant.countryCode}
            </span>
          </div>

          {/* Tenants List */}
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {tenants.map((t) => {
              const isSelected = t.id === currentTenant.id;
              const badge = getTierBadge(t.subscriptionTier);

              return (
                <button
                  key={t.id}
                  onClick={() => {
                    switchTenant(t.id);
                    setIsOpen(false);
                  }}
                  className={`w-full p-2.5 rounded-xl border text-left transition-all flex items-start justify-between gap-2 ${
                    isSelected
                      ? 'bg-emerald-950/40 border-emerald-600/80 text-white'
                      : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <div className="space-y-0.5 flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-bold text-xs truncate text-white">{t.name}</span>
                      {isSelected && (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-0.5 font-mono">
                          <Check className="w-3 h-3" />
                          Actif
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-emerald-400 font-mono">{t.domain}</div>
                    <div className="text-[9px] text-slate-400 flex items-center gap-2 pt-0.5">
                      <span>{t.projectCount ?? 0} consultation(s)</span>
                      <span>•</span>
                      <span>{t.supplierCount ?? 0} fournisseur(s)</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Security Guarantee Box */}
          <div className="p-2.5 bg-slate-950/90 rounded-xl border border-slate-800/80 space-y-1 text-[10px] text-slate-400">
            <div className="flex items-center gap-1.5 text-slate-300 font-semibold text-[11px]">
              <Lock className="w-3 h-3 text-emerald-400" />
              Garantie d'Étanchéité Multi-Tenants
            </div>
            <p className="text-[10px] leading-relaxed text-slate-400">
              Les consultations, offres financières et métadonnées carbone sont hermétiquement cloisonnées. Aucun croisement de données n'est possible entre entités.
            </p>
          </div>

          {/* Create New Tenant CTA */}
          <div className="pt-1">
            <button
              onClick={() => {
                setIsOpen(false);
                openNewTenantModal();
              }}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Déployer une Nouvelle Entité / Filiale</span>
            </button>
          </div>

        </div>
      )}
    </div>
  );
};
