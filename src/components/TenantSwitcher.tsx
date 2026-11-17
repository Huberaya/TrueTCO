import React from 'react';
import { Building2, Lock } from 'lucide-react';

export const TenantSwitcher: React.FC = () => (
  <div
    className="flex items-center gap-2 rounded-lg border border-amber-900/70 bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-200"
    aria-label="Organisation indisponible"
    title="Aucune organisation n’est sélectionnée ou considérée authentifiée."
  >
    <Building2 className="h-4 w-4" />
    <span>Organisation indisponible</span>
    <Lock className="h-3.5 w-3.5" />
  </div>
);
