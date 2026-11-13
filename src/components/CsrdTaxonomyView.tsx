import React, { useState } from 'react';
import { AlertTriangle, Leaf } from 'lucide-react';
import { Project, SupplierOffer } from '../types/domain';
import { CsrdTaxonomyService } from '../services/csrdTaxonomyService';

interface CsrdTaxonomyViewProps {
  projects: Project[];
  offers: SupplierOffer[];
}

export const CsrdTaxonomyView: React.FC<CsrdTaxonomyViewProps> = ({ projects, offers }) => {
  const [fiscalYear, setFiscalYear] = useState<number>(new Date().getUTCFullYear());
  const report = CsrdTaxonomyService.generateReport(projects, offers, fiscalYear);

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-400">
            <Leaf className="h-4 w-4" /> Reporting climat & Taxonomie UE
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-white">État des données de reporting</h2>
          <p className="mt-1 max-w-3xl text-xs text-slate-400">
            Cette vue ne constitue pas un rapport CSRD/ESRS ni une déclaration de conformité.
          </p>
        </div>
        <label className="text-xs text-slate-400">
          Exercice
          <select value={fiscalYear} onChange={(event) => setFiscalYear(Number(event.target.value))}
            className="ml-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 font-mono text-teal-300">
            {[2024, 2025, 2026, 2027].map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
      </header>

      <div role="alert" className="flex gap-3 rounded-xl border border-amber-700 bg-amber-950/40 p-5 text-sm text-amber-100">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
        <div>
          <h3 className="font-bold">Rapport non disponible — données probantes manquantes</h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
            TrueTCO ne dispose pas ici d’un jeu de données source consolidé et vérifié permettant de calculer les ratios d’éligibilité/alignement, les émissions ou les indicateurs ESRS pour {report.fiscalYear}. Les valeurs ne sont pas évaluées (les zéros ne signifient pas 0 émission ni 0 dépense). Aucun auditeur indépendant n’a vérifié ces données.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {['Dépenses Taxonomie UE', 'Émissions GES', 'Vérification indépendante'].map((label) => (
          <div key={label} className="rounded-xl border border-slate-800 bg-slate-900/80 p-5">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-2 text-lg font-bold text-slate-300">Non évalué</div>
            <p className="mt-1 text-[11px] text-slate-500">Aucune donnée vérifiée disponible</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        Statut interne : {report.auditorVerificationStatus}. Aucun document d’assurance, organisme tiers, alignement Taxonomie ou conformité réglementaire n’est revendiqué.
      </p>
    </section>
  );
};
