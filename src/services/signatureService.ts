import { AdjudicationCertificate, DigitalSignatureRecord, Project, SupplierOffer, SignatureRole } from '../types/domain';

const STORAGE_KEY = 'truetco_signatures_v1';

/**
 * ===========================================================================
 * STATUT D'IMPLÉMENTATION — SIGNATURE ÉLECTRONIQUE
 * ===========================================================================
 * ❌ AUCUNE signature électronique qualifiée n'est implémentée.
 *
 * CE QUE FAISAIT LA VERSION PRÉCÉDENTE (dangereux) :
 *   - `computeSha256` n'était pas un SHA-256 mais un condensé 32 bits complété
 *     par une constante : deux contenus différents pouvaient produire la même
 *     empreinte, et l'empreinte était reproductible sans aucune clé ;
 *   - `getCertificate` renvoyait un certificat pré-rempli avec quatre
 *     signataires fictifs, des numéros de série et des adresses IP inventés,
 *     et des autorités (« CertEurope / ANSSI eIDAS QES », « Docusign QES »)
 *     jamais consultées ;
 *   - un document portant ces mentions laissait croire à une signature
 *     qualifiée au sens du règlement eIDAS, ce qui est juridiquement faux.
 *
 * CE QUE FAIT LE CODE CI-DESSOUS DÉSORMAIS :
 *   - SHA-256 réellement calculé (implémentation conforme FIPS 180-4) ;
 *   - certificat construit à partir des données réelles du projet et de l'offre
 *     lauréate, sans aucune identité, série ou IP inventée ;
 *   - marquage `legalStatus: 'non_qualifiee'` + avertissement légal explicite,
 *     affiché dans l'interface ;
 *   - aucun appel réseau : ce module ne produit PAS une signature opposable.
 *
 * CE QU'IL FAUT POUR UNE SIGNATURE À VALEUR JURIDIQUE : intégrer un prestataire
 * de confiance qualifié (par ex. certificat qualifié + horodatage RFC 3161),
 * faire signer côté serveur avec une clé privée en coffre (HSM), et conserver
 * l'ensemble des preuves (identité vérifiée, horodatage, journal serveur).
 */

/** Implémentation SHA-256 synchrone conforme FIPS 180-4. */
export function sha256Hex(message: string): string {
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  // Encodage UTF-8 sans dépendance à TextEncoder (disponible partout, mais on
  // reste déterministe y compris en environnement de test).
  const bytes: number[] = [];
  for (let i = 0; i < message.length; i++) {
    let code = message.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < message.length) {
      const next = message.charCodeAt(i + 1);
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      i++;
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // Longueur sur 64 bits (les charges utiles de cette application restent très
  // inférieures à 2^32 bits).
  bytes.push(0, 0, 0, 0, (bitLength >>> 24) & 0xff, (bitLength >>> 16) & 0xff, (bitLength >>> 8) & 0xff, bitLength & 0xff);

  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        (bytes[offset + i * 4] << 24) |
        (bytes[offset + i * 4 + 1] << 16) |
        (bytes[offset + i * 4 + 2] << 8) |
        bytes[offset + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }

    H[0] = (H[0] + a) | 0;
    H[1] = (H[1] + b) | 0;
    H[2] = (H[2] + c) | 0;
    H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0;
    H[5] = (H[5] + f) | 0;
    H[6] = (H[6] + g) | 0;
    H[7] = (H[7] + h) | 0;
  }

  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

export class SignatureService {
  /** Signale un échec de persistance locale : jamais silencieux. */
  private static notifyStorageFailure(scope: string, error: unknown): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(
      new CustomEvent('truetco:storage-failure', {
        detail: { scope, message: error instanceof Error ? error.message : String(error) },
      })
    );
  }

  /**
   * Empreinte SHA-256 (FIPS 180-4) d'une charge utile.
   *
   * ⚠️ Une empreinte n'est PAS une signature : elle prouve l'intégrité d'un
   * contenu, pas l'identité de son auteur. Voir le préambule du module.
   */
  public static computeSha256(payload: string): string {
    return sha256Hex(payload);
  }

  /**
   * Certificat d'adjudication : construit uniquement à partir des données
   * réellement disponibles. Aucune identité, aucun numéro de série et aucune
   * adresse IP ne sont inventés ; ce qui n'est pas connu reste vide.
   */
  public static getCertificate(
    projectId: string,
    winningOffer?: SupplierOffer,
    project?: Project,
    /** Résultats réellement calculés par le moteur (jamais des valeurs inventées). */
    computed?: { totalComprehensiveTCO?: number; totalLifecycleCO2eTonnes?: number }
  ): AdjudicationCertificate {
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(`${STORAGE_KEY}_${projectId}`);
        if (raw) {
          const parsed = JSON.parse(raw) as AdjudicationCertificate;
          // Migration : les certificats enregistrés par la version précédente
          // contiennent des mentions eIDAS/QES fabriquées, des signataires
          // fictifs et des IP inventées. On les neutralise.
          if ((parsed as any).containsFabricatedIdentity !== false) {
            const sanitized: AdjudicationCertificate = {
              ...parsed,
              signatures: [],
              isFullyExecuted: false,
              sealedHash: '',
              legalStatus: 'non_qualifiee',
              legalDisclaimer: SignatureService.LEGAL_DISCLAIMER,
            } as AdjudicationCertificate;
            (sanitized as any).containsFabricatedIdentity = false;
            this.saveCertificate(sanitized);
            return sanitized;
          }
          return parsed;
        }
      }
    } catch (error) {
      // Certificat existant illisible : on le signale au lieu de le laisser
      // passer pour absent (ce qui en créerait un nouveau silencieusement).
      this.notifyStorageFailure('signature-certificate-read', error);
    }

    const issuedAt = new Date().toISOString();
    const payload = JSON.stringify({
      projectId,
      projectReference: project?.reference ?? null,
      winningOfferId: winningOffer?.id ?? null,
      winningSupplierName: winningOffer?.supplierName ?? null,
      apparentTotal: winningOffer?.apparentTotal ?? null,
    });

    const certificate: AdjudicationCertificate = {
      certificateId: `CERT-${projectId.slice(-6).toUpperCase()}-${issuedAt.slice(0, 10).replace(/-/g, '')}`,
      projectId,
      projectReference: project?.reference ?? 'Référence non renseignée',
      winningOfferId: winningOffer?.id ?? '',
      winningSupplierName: winningOffer?.supplierName ?? 'Offre lauréate non désignée',
      awardedTotalAmount: winningOffer?.apparentTotal ?? 0,
      awardedTcoAmount: computed?.totalComprehensiveTCO ?? 0,
      awardedCarbonAvoidedTonnes: 0,
      awardedCarbonTonnes: computed?.totalLifecycleCO2eTonnes ?? 0,
      generatedAt: issuedAt,
      sealedHash: this.computeSha256(payload),
      signatures: [],
      isFullyExecuted: false,
      legalStatus: 'non_qualifiee',
      legalDisclaimer: SignatureService.LEGAL_DISCLAIMER,
    } as AdjudicationCertificate;

    (certificate as any).containsFabricatedIdentity = false;
    return certificate;
  }

  public static readonly LEGAL_DISCLAIMER =
    "Document interne non signé électroniquement. Ce fichier ne constitue pas une signature électronique qualifiée au sens du règlement (UE) n° 910/2014 (eIDAS) et n'a pas de valeur probante renforcée. Pour une signature opposable, utiliser un prestataire de confiance qualifié et conserver le dossier de preuve associé (identité vérifiée, certificat qualifié, horodatage RFC 3161).";

  public static saveCertificate(cert: AdjudicationCertificate): void {
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem(`${STORAGE_KEY}_${cert.projectId}`, JSON.stringify(cert));
      }
    } catch (error) {
      this.notifyStorageFailure('signature-certificate-write', error);
    }
  }

  /**
   * Enregistre une validation interne (workflow d'approbation) — ce n'est pas
   * une signature électronique. L'identité du valideur doit provenir de la
   * session authentifiée et non d'un champ libre.
   */
  public static signRole(
    projectId: string,
    role: SignatureRole,
    signerName: string,
    signerTitle: string,
    signerEmail: string,
    comment: string,
    signatureDataUrl?: string,
    authenticatedSessionId?: string
  ): AdjudicationCertificate {
    const cert = this.getCertificate(projectId);
    const now = new Date().toISOString();

    if (!authenticatedSessionId) {
      throw new Error(
        "Validation impossible : aucune session authentifiée. Une approbation doit être rattachée à un utilisateur identifié côté serveur."
      );
    }

    const record: DigitalSignatureRecord = {
      id: `val-${role}-${Date.now()}`,
      role,
      signerName,
      signerTitle,
      signerEmail,
      signedAt: now,
      status: 'signe',
      // Empreinte d'intégrité du contenu validé (SHA-256 réel).
      sha256Hash: this.computeSha256(`${cert.certificateId}|${role}|${signerEmail}|${now}|${comment}`),
      // Aucun numéro de certificat n'est généré : nous ne délivrons pas de
      // certificat. Ces champs restent vides tant qu'un prestataire qualifié
      // n'est pas branché.
      certificateSerial: '',
      certificateAuthority: 'Validation applicative interne — aucun certificat émis',
      signatureDataUrl,
      ipAddress: '',
      auditTrailRef: `VAL-${authenticatedSessionId.slice(0, 8).toUpperCase()}`,
      comment: comment || '',
    };

    const idx = cert.signatures.findIndex((s) => s.role === role);
    if (idx !== -1) cert.signatures[idx] = record;
    else cert.signatures.push(record);

    cert.sealedHash = this.computeSha256(
      `${cert.certificateId}|${cert.signatures.map((s) => `${s.role}:${s.sha256Hash}`).join('|')}`
    );
    this.saveCertificate(cert);
    return cert;
  }
}
