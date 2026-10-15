import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { createClerkClient, verifyToken } from '@clerk/backend';
import type { Config } from './config';
import { type Db, withIdentity } from './db';
import { asyncHandler, forbidden, unauthorized } from './errors';
import type { AuthContext, Membership, VerifiedIdentity } from './types';
import { UUID_RE } from './validation';

export interface VerifiedToken {
  clerkId: string;
  email?: string;
  emailVerified?: boolean;
  fullName?: string;
}

/**
 * Frontière d'authentification : seule implémentation de confiance = signature cryptographique du jeton.
 * Remplaçable par un faux en test (injection de dépendance), jamais par une option de configuration :
 * il n'existe AUCUN mode « auth désactivée » activable en production.
 */
export interface AuthVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
  /** Profil de l'identité (email vérifié), consulté uniquement pour lier une invitation. */
  loadProfile?(clerkId: string): Promise<{ email?: string; emailVerified: boolean; fullName?: string } | null>;
}

export class ClerkVerifier implements AuthVerifier {
  private readonly client?: ReturnType<typeof createClerkClient>;
  constructor(private readonly cfg: Pick<Config, 'clerkSecretKey' | 'clerkJwtKey' | 'clerkAuthorizedParties'>) {
    if (cfg.clerkSecretKey) this.client = createClerkClient({ secretKey: cfg.clerkSecretKey });
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    try {
      const result: any = await verifyToken(token, {
        secretKey: this.cfg.clerkSecretKey,
        jwtKey: this.cfg.clerkJwtKey,
        authorizedParties: this.cfg.clerkAuthorizedParties.length ? this.cfg.clerkAuthorizedParties : undefined,
      });
      // Selon la version du SDK, verifyToken renvoie les claims ou { data, errors }.
      if (result?.errors?.length) return null;
      const claims = result?.data ?? result;
      if (!claims || typeof claims.sub !== 'string' || !claims.sub) return null;
      return {
        clerkId: claims.sub,
        email: typeof claims.email === 'string' ? claims.email : undefined,
        emailVerified: claims.email_verified === true,
        fullName: typeof claims.name === 'string' ? claims.name : undefined,
      };
    } catch {
      return null;
    }
  }

  async loadProfile(clerkId: string) {
    if (!this.client) return null;
    try {
      const u = await this.client.users.getUser(clerkId);
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

function bearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

const MEMBERSHIPS_SQL = `
  SELECT u.id AS "userId", u.organization_id AS "organizationId", o.name AS "organizationName",
         o.slug AS "organizationSlug", u.role AS role, u.email AS email, u.full_name AS "fullName"
    FROM users u JOIN organizations o ON o.id = u.organization_id
   WHERE u.clerk_id = $1 AND u.is_active AND o.is_active
   ORDER BY u.last_login_at DESC NULLS LAST, u.created_at ASC`;

type MembershipRow = Membership & { email: string; fullName: string };

export interface AuthDeps {
  db: Db;
  verifier: AuthVerifier;
  config: Pick<Config, 'platformAdminClerkIds'>;
}

/**
 * Middleware d'authentification : s'applique à TOUT /api (hors liste publique explicite dans app.ts).
 *  1. jeton Bearer vérifié cryptographiquement (sinon 401)
 *  2. appartenances lues EN BASE par identifiant Clerk (jamais fournies par le client)
 *  3. invitation en attente liée uniquement si l'email est VÉRIFIÉ par le fournisseur d'identité
 *  4. organisation active = x-tenant-id SI ET SEULEMENT SI l'utilisateur en est membre
 */
export function authenticate(deps: AuthDeps): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) throw unauthorized();
    const verified = await deps.verifier.verify(token);
    if (!verified) throw unauthorized('Jeton invalide ou expiré');

    let identity: VerifiedIdentity = {
      clerkId: verified.clerkId,
      email: verified.email,
      emailVerified: verified.emailVerified === true,
      fullName: verified.fullName,
    };

    let rows = await withIdentity(deps.db, { clerkId: identity.clerkId }, async (q) =>
      (await q.query<MembershipRow>(MEMBERSHIPS_SQL, [identity.clerkId])).rows
    );

    // Liaison d'invitation : à la première connexion (aucune appartenance) ou à l'ouverture de session (/auth/me).
    const isSessionStart = req.path === '/auth/me';
    if (rows.length === 0 || isSessionStart) {
      if (!identity.email || !identity.emailVerified) {
        const profile = await deps.verifier.loadProfile?.(identity.clerkId);
        if (profile) {
          identity = { ...identity, email: profile.email, emailVerified: profile.emailVerified, fullName: identity.fullName ?? profile.fullName };
        }
      }
      if (identity.email && identity.emailVerified) {
        const email = identity.email.toLowerCase();
        const linked = await withIdentity(deps.db, { clerkId: identity.clerkId, verifiedEmail: email }, async (q) => {
          try {
            const r = await q.query(
              `UPDATE users
                  SET clerk_id = $1, last_login_at = CURRENT_TIMESTAMP,
                      full_name = COALESCE(NULLIF(full_name, ''), $3)
                WHERE clerk_id IS NULL AND is_active AND lower(email) = $2
                RETURNING id`,
              [identity.clerkId, email, identity.fullName ?? email.split('@')[0]]
            );
            return r.rowCount;
          } catch (e) {
            if ((e as { code?: string }).code === '23505') return 0; // déjà lié dans cette organisation
            throw e;
          }
        });
        if (linked > 0) {
          rows = await withIdentity(deps.db, { clerkId: identity.clerkId }, async (q) =>
            (await q.query<MembershipRow>(MEMBERSHIPS_SQL, [identity.clerkId])).rows
          );
        }
      }
    }

    const memberships: Membership[] = rows.map((r) => ({
      userId: r.userId,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      organizationSlug: r.organizationSlug,
      role: r.role,
    }));

    let active: MembershipRow | null = null;
    const requested = req.headers['x-tenant-id'];
    if (requested !== undefined) {
      // Le header n'est qu'un SÉLECTEUR parmi les organisations auxquelles l'utilisateur appartient déjà.
      const wanted = Array.isArray(requested) ? requested[0] : requested;
      if (!UUID_RE.test(wanted)) throw forbidden("Organisation non autorisée");
      active = rows.find((r) => r.organizationId === wanted) ?? null;
      if (!active) throw forbidden("Organisation non autorisée");
    } else {
      active = rows[0] ?? null;
    }

    const ctx: AuthContext = {
      identity,
      active,
      memberships,
      isPlatformAdmin: deps.config.platformAdminClerkIds.includes(identity.clerkId),
    };
    req.ctx = ctx;
    next();
  });
}

/** UUID v5 (RFC 4122) : identifiant déterministe dérivé d'un espace de noms (l'organisation) et d'un nom. */
export function uuidV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const hash = crypto.createHash('sha1').update(ns).update(name, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Les identifiants fournis par le client sont des CLÉS D'IDEMPOTENCE, jamais des clés primaires brutes :
 * un identifiant non-UUID est dérivé (v5) dans l'espace de noms de l'organisation, donc deux tenants
 * ne peuvent jamais entrer en collision. Un UUID valide est conservé tel quel (compatibilité),
 * et toute collision avec une ligne d'un autre tenant se résout en 404 (cf. routes).
 */
export function entityId(clientId: string | undefined, orgId: string): string {
  if (!clientId) return crypto.randomUUID();
  return UUID_RE.test(clientId) ? clientId.toLowerCase() : uuidV5(clientId, orgId);
}
