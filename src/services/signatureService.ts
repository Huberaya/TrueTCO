import { AdjudicationCertificate, DigitalSignatureRecord, Project, SupplierOffer, SignatureRole } from '../types/domain';

const STORAGE_KEY = 'truetco_signatures_v1';

export class SignatureService {
  /**
   * Computes a deterministic pseudo-SHA256 hex string for a given payload
   */
  public static computeSha256(payload: string): string {
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    // Pad to 64 hex characters resembling SHA-256
    const hexPart = Math.abs(hash).toString(16).padStart(8, '0');
    const saltPart = '7f8a9e01b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789a';
    return (hexPart + saltPart).slice(0, 64);
  }

  public static getCertificate(projectId: string, winningOffer?: SupplierOffer, project?: Project): AdjudicationCertificate {
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(`${STORAGE_KEY}_${projectId}`);
        if (raw) {
          return JSON.parse(raw);
        }
      }
    } catch {}

    const hashPayload = `${projectId}_${winningOffer?.id || 'default'}_${winningOffer?.apparentTotal || 0}_${new Date().toISOString().split('T')[0]}`;
    const sealedHash = this.computeSha256(hashPayload);

    const defaultCert: AdjudicationCertificate = {
      certificateId: `CERT-EIDAS-${projectId.slice(-6).toUpperCase()}-2026`,
      projectId,
      projectReference: project?.reference || 'AO-2026-MOB-004',
      winningOfferId: winningOffer?.id || 'off-default',
      winningSupplierName: winningOffer?.supplierName || 'Fournisseur Adjugé',
      awardedTotalAmount: winningOffer?.apparentTotal || 3850000,
      awardedTcoAmount: winningOffer?.apparentTotal ? winningOffer.apparentTotal * 1.08 : 4158000,
      awardedCarbonAvoidedTonnes: 142.5,
      generatedAt: new Date().toISOString(),
      sealedHash,
      signatures: [
        {
          id: 'sig-acheteur-1',
          role: 'acheteur',
          signerName: 'Jean-Marc Delorme',
          signerTitle: 'Lead Buyer Mobilité & Flottes',
          signerEmail: 'jm.delorme@acme-group.com',
          signedAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
          status: 'signe',
          sha256Hash: this.computeSha256(`acheteur_${projectId}`),
          certificateSerial: 'FR-CE-2026-9048-A',
          certificateAuthority: 'CertEurope / ANSSI eIDAS AES',
          ipAddress: '194.254.120.45',
          auditTrailRef: 'AUDIT-SIG-8812',
          comment: 'Consultation conforme aux critères d’appel d’offres, grille de notation validée.',
        },
        {
          id: 'sig-rse-2',
          role: 'rse',
          signerName: 'Claire Vasseur',
          signerTitle: 'Directrice RSE & Décarbonation Groupe',
          signerEmail: 'c.vasseur@acme-group.com',
          signedAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
          status: 'signe',
          sha256Hash: this.computeSha256(`rse_${projectId}`),
          certificateSerial: 'FR-CE-2026-9048-B',
          certificateAuthority: 'CertEurope / ANSSI eIDAS AES',
          ipAddress: '194.254.120.52',
          auditTrailRef: 'AUDIT-SIG-8813',
          comment: 'Conforme trajectoire SBTi 1.5°C et exigences CSRD ESRS E1.',
        },
        {
          id: 'sig-finance-3',
          role: 'finance',
          signerName: 'Alexandre Mercier',
          signerTitle: 'Directeur du Contrôle de Gestion & M&A',
          signerEmail: 'a.mercier@acme-group.com',
          signedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
          status: 'signe',
          sha256Hash: this.computeSha256(`finance_${projectId}`),
          certificateSerial: 'FR-CE-2026-9048-C',
          certificateAuthority: 'CertEurope / ANSSI eIDAS QES',
          ipAddress: '82.64.19.108',
          auditTrailRef: 'AUDIT-SIG-8814',
          comment: 'Modèle LCC actualisé au WACC de 5.0% certifié. Point mort d’amortissement sous 3.2 ans.',
        },
        {
          id: 'sig-direction-4',
          role: 'direction',
          signerName: 'Sophie de Montmirail',
          signerTitle: 'Directrice Générale Déléguée & Membre du Comex',
          signerEmail: 's.montmirail@acme-group.com',
          signedAt: '',
          status: 'en_attente',
          sha256Hash: '',
          certificateSerial: 'FR-CE-2026-9048-D',
          certificateAuthority: 'Docusign QES / eIDAS Qualifié',
          ipAddress: '',
          auditTrailRef: 'AUDIT-SIG-8815',
          comment: '',
        },
      ],
      isFullyExecuted: false,
    };

    return defaultCert;
  }

  public static saveCertificate(cert: AdjudicationCertificate): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(`${STORAGE_KEY}_${cert.projectId}`, JSON.stringify(cert));
      }
    } catch {}
  }

  /**
   * Execute an electronic signature for a specific role
   */
  public static signRole(
    projectId: string,
    role: SignatureRole,
    signerName: string,
    signerTitle: string,
    signerEmail: string,
    comment: string,
    signatureDataUrl?: string
  ): AdjudicationCertificate {
    const cert = this.getCertificate(projectId);
    const now = new Date().toISOString();
    const sha256 = this.computeSha256(`${role}_${signerEmail}_${now}`);

    const idx = cert.signatures.findIndex((s) => s.role === role);
    const updatedRecord: DigitalSignatureRecord = {
      id: `sig-${role}-${Date.now()}`,
      role,
      signerName,
      signerTitle,
      signerEmail,
      signedAt: now,
      status: 'signe',
      sha256Hash: sha256,
      certificateSerial: `FR-EIDAS-2026-${Math.floor(10000 + Math.random() * 90000)}`,
      certificateAuthority: 'ANSSI CertEurope eIDAS QES (Niveau Qualifié)',
      signatureDataUrl,
      ipAddress: '194.254.120.' + Math.floor(10 + Math.random() * 80),
      auditTrailRef: `AUDIT-SEAL-${Date.now().toString(16).slice(-6).toUpperCase()}`,
      comment: comment || 'Approbation juridique et financière irrévocable.',
    };

    if (idx !== -1) {
      cert.signatures[idx] = updatedRecord;
    } else {
      cert.signatures.push(updatedRecord);
    }

    // Check if all 4 signatures are signed
    const allSigned = cert.signatures.every((s) => s.status === 'signe');
    cert.isFullyExecuted = allSigned;
    if (allSigned) {
      cert.sealedHash = this.computeSha256(
        `${cert.certificateId}_FULL_SEAL_${cert.signatures.map((s) => s.sha256Hash).join('_')}`
      );
    }

    this.saveCertificate(cert);
    return cert;
  }
}
