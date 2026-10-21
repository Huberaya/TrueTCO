/**
 * TrueTCO — Connexion par fournisseur d'identité (Clerk), pont vers le modèle de session existant
 * ---------------------------------------------------------------------------
 * Ce module AJOUTE une voie de connexion réelle ; il ne modifie ni le modèle de session (jeton opaque haché, cookie
 * HttpOnly, révocation en base), ni les rôles, ni l'isolation par organisation (RLS) : après vérification de l'identité,
 * il émet exactement la même session que les autres modes (`issueSession`).
 *
 * Garanties :
 *  - le jeton du fournisseur est vérifié CRYPTOGRAPHIQUEMENT côté serveur (signature, expiration, origine autorisée) ;
 *  - AUCUN compte n'est créé à la volée : l'identité doit correspondre à un utilisateur déjà provisionné
 *    (inscription d'organisation ou invitation acceptée), sinon 403 ;
 *  - une identité se lie à un utilisateur existant UNIQUEMENT via une adresse e-mail VÉRIFIÉE par le fournisseur ;
 *  - un utilisateur suspendu ne peut pas se connecter ; le rôle reste celui attribué dans TrueTCO (jamais celui du fournisseur) ;
 *  - plusieurs organisations possibles pour le même e-mail : refus explicite, sauf indication de l'organisation (slug).
 *
 * Limite assumée : l'index unique (idp_provider, idp_subject) fait qu'une identité ne se lie qu'à UN utilisateur.
 */
import { createClerkClient, verifyToken } from '@clerk/backend';
import { Db } from '../db/types';
import { HttpError, forbidden } from '../http';
import { recordAuditStandalone } from '../audit';
import { issueSession, RequestMeta } from './service';
import type { UserRole } from './types';

export interface VerifiedIdentity {
  subject: string;
  email?: string;
  emailVerified: boolean;
  fullName?: string;
}

/** Frontière d'authentification : seule implémentation de confiance = signature cryptographique. Remplaçable en test. */
export interface IdentityVerifier {
  readonly provider: string;
  verify(token: string): Promise<VerifiedIdentity | null>;
  /** E-mail vérifié de l'identité, consulté uniquement si le jeton ne le porte pas. */
  loadProfile?(subject: string): Promise<{ email?: string; emailVerified: boolean; fullName?: string } | null>;
}

export class ClerkIdentityVerifier implements IdentityVerifier {
  readonly provider = 'clerk';
  private readonly client?: ReturnType<typeof createClerkClient>;

  constructor(private readonly cfg: { secretKey?: string; jwtKey?: string; authorizedParties?: string[] }) {
    if (!cfg.secretKey && !cfg.jwtKey) throw new Error('CLERK_SECRET_KEY (ou CLERK_JWT_KEY) est requis pour activer Clerk.');
    if (cfg.secretKey) this.client = createClerkClient({ secretKey: cfg.secretKey });
  }

  async verify(token: string): Promise<VerifiedIdentity | null> {
    try {
      const result: any = await verifyToken(token, {
        secretKey: this.cfg.secretKey,
        jwtKey: this.cfg.jwtKey,
        authorizedParties: this.cfg.authorizedParties?.length ? this.cfg.authorizedParties : undefined,
      });
      // Selon la version du SDK, verifyToken renvoie les claims ou { data, errors }.
      if (result?.errors?.length) return null;
      const claims = result?.data ?? result;
      if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;
      return {
        subject: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        emailVerified: claims.email_verified === true,
        fullName: typeof claims.name === 'string' ? claims.name : undefined,
      };
    } catch {
      return null;
    }
  }

  async loadProfile(subject: string) {
    if (!this.client) return null;
    try {
      const u = await this.client.users.getUser(subject);
      const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId) ?? u.emailAddresses[0];
      if (!primary) return null;
      return {
        email: primary.emailAddress,
        emailVerified: primary.verification?.status === 'verified',
        fullName: [u.firstName, u.lastName].filter(Boolean).join(' ') || undefined,
      };
    } catch {
      return null;
    }
  }
}

interface UserRow { id: string; organization_id: string; role: UserRole; status: string; email: string; slug?: string }

export async function loginWithVerifiedIdentity(
  db: Db,
  verifier: IdentityVerifier,
  input: { token: string; organizationSlug?: string | null },
  meta: RequestMeta
): Promise<{ token: string; expiresAt: Date; organizationId: string; userId: string; role: UserRole }> {
  const identity = await verifier.verify(input.token);
  if (!identity) throw new HttpError(401, 'IDP_TOKEN_INVALID', "Jeton d'identité invalide ou expiré.");

  const provider = verifier.provider;
  let user: UserRow | null = await db.systemTx(async (tx) => {
    const rows = await tx.query<UserRow>(
      'SELECT id, organization_id, role, status, email FROM users WHERE idp_provider = $1 AND idp_subject = $2',
      [provider, identity.subject]
    );
    return rows[0] ?? null;
  });

  let linked = false;
  if (!user) {
    // Première connexion : liaison par e-mail VÉRIFIÉ uniquement.
    let { email, emailVerified } = identity;
    if (!email || !emailVerified) {
      const profile = await verifier.loadProfile?.(identity.subject);
      if (profile) ({ email, emailVerified } = profile);
    }
    if (!email || !emailVerified) {
      throw forbidden('IDP_EMAIL_NOT_VERIFIED', "L'adresse e-mail de cette identité n'est pas vérifiée : connexion refusée.");
    }

    const candidates = await db.systemTx((tx) =>
      tx.query<UserRow>(
        `SELECT u.id, u.organization_id, u.role, u.status, u.email, o.slug
           FROM users u JOIN organizations o ON o.id = u.organization_id
          WHERE lower(u.email) = lower($1)
            AND u.idp_subject IS NULL
            AND u.status = 'active'
            AND ($2::text IS NULL OR o.slug = $2::text)`,
        [email, input.organizationSlug ?? null]
      )
    );
    if (candidates.length === 0) {
      throw forbidden('USER_NOT_PROVISIONED', "Aucun compte TrueTCO n'est associé à cette identité : demandez une invitation à votre administrateur.");
    }
    if (candidates.length > 1) {
      throw new HttpError(409, 'ORGANIZATION_SELECTION_REQUIRED',
        `Cette adresse e-mail appartient à plusieurs organisations (${candidates.map((c) => c.slug).join(', ')}) : précisez l'organisation (organizationSlug).`);
    }
    user = candidates[0];
    try {
      await db.systemTx((tx) =>
        tx.query(
          'UPDATE users SET idp_provider = $1, idp_subject = $2 WHERE id = $3 AND idp_subject IS NULL',
          [provider, identity.subject, user!.id]
        )
      );
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw new HttpError(409, 'IDP_ALREADY_LINKED', 'Cette identité est déjà liée à un autre compte.');
      }
      throw err;
    }
    linked = true;
  }

  if (user.status !== 'active') throw forbidden('USER_NOT_ACTIVE', "Ce compte utilisateur n'est pas actif.");

  const session = await issueSession(db, {
    organizationId: user.organization_id,
    userId: user.id,
    authMethod: `idp_${provider}`,
    role: user.role,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  const actor = { id: user.id, name: user.email, role: user.role };
  if (linked) {
    await recordAuditStandalone(db, user.organization_id, actor, {
      action: 'auth.idp_linked', entityType: 'user', entityId: user.id,
      newValue: JSON.stringify({ provider }), ...meta,
    });
  }
  await recordAuditStandalone(db, user.organization_id, actor, {
    action: 'auth.login', entityType: 'session', entityId: session.id,
    newValue: JSON.stringify({ authMethod: `idp_${provider}`, isDemo: false }), isDemo: false, ...meta,
  });

  return { token: session.token, expiresAt: session.expiresAt, organizationId: user.organization_id, userId: user.id, role: user.role };
}
