import { AdjudicationCertificate, Project, SupplierOffer, SignatureRole } from '../types/domain';

/** A local UI cannot issue an eIDAS signature, certificate, trusted timestamp or seal. */
export class SignatureService {
  public static computeSha256(_payload: string): string {
    throw new Error('Scellement désactivé : aucun service cryptographique qualifié n’est configuré.');
  }

  public static getCertificate(projectId: string, winningOffer?: SupplierOffer, project?: Project): AdjudicationCertificate {
    return {
      certificateId: 'BROUILLON-NON-PROBANT',
      projectId,
      projectReference: project?.reference || 'Projet non renseigné',
      winningOfferId: winningOffer?.id || '',
      winningSupplierName: winningOffer?.supplierName || 'Aucune offre sélectionnée',
      awardedTotalAmount: winningOffer?.apparentTotal || 0,
      awardedTcoAmount: 0,
      awardedCarbonAvoidedTonnes: 0,
      generatedAt: new Date().toISOString(),
      sealedHash: '',
      signatures: [],
      isFullyExecuted: false,
    };
  }

  public static saveCertificate(_cert: AdjudicationCertificate): void {
    throw new Error('Persistance désactivée : aucun registre de signature sécurisé n’est configuré.');
  }

  public static signRole(
    _projectId: string,
    _role: SignatureRole,
    _signerName: string,
    _signerTitle: string,
    _signerEmail: string,
    _comment: string,
    _signatureDataUrl?: string
  ): AdjudicationCertificate {
    throw new Error('Signature désactivée : aucun prestataire eIDAS ni parcours d’authentification n’est configuré. Aucune signature n’a été créée.');
  }
}
