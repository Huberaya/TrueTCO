import React, { useState, useRef, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import {
  Building2,
  ChevronDown,
  Check,
  Plus,
  Layers,
  Lock,
} from 'lucide-react';

export const TenantSwitcher: React.FC = () => {
  const { tenants, currentTenant, switchTenant } = useTenant();
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
        return { label: 'Option — non vérifiée', color: 'bg-purple-950 text-purple-300 border-purple-800' };
      case 'enterprise':
        return { label: 'Démo', color: 'bg-emerald-950 text-emerald-300 border-emerald-800' };
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
        title="Changer l’espace de démonstration local; aucune isolation serveur n’est configurée."
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
                Espaces de démonstration
              </div>
              <div className="text-[10px] text-slate-400">
                Sélection locale uniquement — RLS non configurée
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

          {/* No isolation claim: tenant selection is currently local demo state. */}
          <div className="p-2.5 bg-amber-950/40 rounded-xl border border-amber-800/80 space-y-1 text-[10px] text-amber-200">
            <div className="flex items-center gap-1.5 font-semibold text-[11px]">
              <Lock className="w-3 h-3" />
              Isolation des données non configurée
            </div>
            <p className="text-[10px] leading-relaxed">
              Ce sélecteur ne prouve pas l’identité de l’organisation et ne cloisonne pas les données côté serveur. N’utilisez pas de données client.
            </p>
          </div>

          {/* Create New Tenant CTA */}
          <div className="pt-1">
            <button
              type="button"
              disabled
              title="Création d’organisation désactivée jusqu’à la mise en place de l’authentification et de l’isolation tenant."
              className="w-full py-2 bg-slate-800 text-slate-400 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Création d’organisation indisponible</span>
            </button>
          </div>

        </div>
      )}
    </div>
  );
};
