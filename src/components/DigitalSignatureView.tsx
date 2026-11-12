import React from 'react';
import { AlertTriangle, Fingerprint } from 'lucide-react';
import { Project, SupplierOffer } from '../types/domain';
import { SignatureService } from '../services/signatureService';

interface DigitalSignatureViewProps {
  project: Project;
  offers: SupplierOffer[];
}

export const DigitalSignatureView: React.FC<DigitalSignatureViewProps> = ({ project, offers }) => {
  const selectedOffer = offers.find((offer) => offer.isResponsibleCandidate) || offers[0];
  const draft = SignatureService.getCertificate(project.id, selectedOffer, project);

  return (
    <section className="space-y-6">
      <header className="border-b border-slate-800 pb-4">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-amber-400">
          <Fingerprint className="h-4 w-4" /> Parcours de signature — indisponible
        </div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Aucune signature électronique n’est émise</h2>
        <p className="mt-1 text-xs text-slate-400">Projet : {draft.projectReference} · Fournisseur : {draft.winningSupplierName}</p>
      </header>
      <div role="alert" className="flex gap-3 rounded-xl border border-amber-700 bg-amber-950/40 p-5 text-sm text-amber-100">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-400" />
        <div>
          <h3 className="font-bold">Démonstration uniquement — valeur juridique non établie</h3>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/90">
            Aucun prestataire de confiance, certificat, horodatage RFC 3161, authentification du signataire ni registre d’audit sécurisé n’est configuré. Le dessin d’une signature ou une empreinte locale ne constitue pas une signature eIDAS qualifiée. Cette vue ne permet pas de signer, sceller ni engager une dépense.
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-5 text-xs text-slate-400">
        Brouillon non probant : {draft.certificateId}. Aucune signature enregistrée. Empreinte cryptographique et statut d’exécution non disponibles.
      </div>
    </section>
  );
};
