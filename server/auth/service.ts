/**
 * TrueTCO — Authentification (inscription d'organisation, connexion, sessions)
 * ---------------------------------------------------------------------------
 * Ce qui est réellement implémenté ici :
 *   - création d'organisation + premier administrateur, atomique (fonction SQL) ;
 *   - invitations avec jeton à usage unique, haché en base, expirable ;
 *   - connexion : jeton opaque de 256 bits, stocké haché, cookie HttpOnly ;
 *   - déconnexion : révocation effective en base ;
 *   - liste et révocation des sessions/appareils.
 *
 * Ce qui n'est PAS implémenté (et n'est donc pas annoncé) : mot de passe,
 * MFA, OIDC/SAML, SCIM. En production, la connexion passe par le fournisseur
 * d'identité (variable TRUETCO_AUTH_MODE) ; la structure de session est la même.
 * Un mode « démonstration locale » existe pour les environnements de recette,
 * explicitement activé par TRUETCO_ALLOW_DEMO_AUTH=true et marqué en base
 * (`auth_method = 'demo_local'`, journalisé `is_demo = true`).
 */

import { DataError, Db, Executor } from '../db/types';
import {
  AuthContext,
  USER_ROLES,
  UserRole,
  canAssignRole,
  canManageTeam,
} from './types';
import { generateToken, hashToken, invitationExpiry, markSessionSeen, sessionExpiry } from './session';
import { badRequest, forbidden, notFound, HttpError } from '../http';
import { AuditActor, actorFromContext, recordAudit, recordAuditStandalone } from '../audit';

/**
 * La connexion de recette (`demo_local`) n'est PAS décidée ici.
 *
 * Elle l'était : une constante lue au chargement du module décidait, pendant que
 * la route d'authentification consultait de son côté les options de
 * l'application. Les deux pouvaient se contredire — l'application annonçait la
 * connexion de recette autorisée, et le service répondait 501. Une seule source
 * de vérité désormais : l'appelant DOIT transmettre explicitement l'autorisation.
 */
export function assertDemoAuthAllowed(allowDemoAuth: boolean): void {
  if (!allowDemoAuth) {
    throw new HttpError(
      501,
      'AUTH_PROVIDER_NOT_CONFIGURED',
      "Aucun fournisseur d'identité n'est configuré sur cette instance. " +
        'Renseignez TRUETCO_AUTH_MODE (OIDC/SAML) en production, ou activez explicitement ' +
        'l’authentification de recette (TRUETCO_ALLOW_DEMO_AUTH) sur un environnement non exposé.'
    );
  }
}

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
}

export interface SessionIssue {
  token: string;
  expiresAt: Date;
  organizationId: string;
  userId: string;
  role: UserRole;
}

// -----------------------------------------------------------------------------
// Inscription d'une organisation
// -----------------------------------------------------------------------------
export async function registerOrganization(
  db: Db,
  input: { organizationName: string; slug: string; domain: string; adminEmail: string; adminFullName: string },
  _meta: RequestMeta
): Promise<{ organizationId: string; userId: string }> {
  const rows = await db.tx((tx) =>
    tx.query<{ organization_id: string; user_id: string }>(
      'SELECT * FROM truetco_register_organization($1, $2, $3, $4, $5)',
      [input.organizationName, input.slug, input.domain, input.adminEmail, input.adminFullName]
    )
  );
  const created = rows[0];
  if (!created) throw new HttpError(500, 'REGISTRATION_FAILED', "La création de l'organisation n'a produit aucun enregistrement.");
  return { organizationId: created.organization_id, userId: created.user_id };
}

// -----------------------------------------------------------------------------
// Invitations
// -----------------------------------------------------------------------------
export async function inviteUser(
  db: Db,
  ctx: AuthContext,
  input: { email: string; role: UserRole; fullName?: string | null; department?: string | null },
  meta: RequestMeta
): Promise<{ invitationId: string; token: string; expiresAt: string; emailSent: false; reason: string }> {
  if (!canManageTeam(ctx.user.role)) {
    throw forbidden('PERMISSION_DENIED', 'Seul un administrateur d’organisation peut inviter un utilisateur.');
  }
  if (!canAssignRole(ctx.user.role, input.role)) {
    throw forbidden(
      'ROLE_ESCALATION_BLOCKED',
      `Votre rôle (${ctx.user.role}) ne permet pas d’attribuer le rôle « ${input.role} ».`
    );
  }

  const token = generateToken('inv');
  const expiresAt = invitationExpiry();

  const invitationId = await db.asOrganization(ctx.organization.id, async (tx) => {
    const existing = await tx.query<{ id: string; status: string }>(
      'SELECT id, status FROM users WHERE lower(email) = lower($1)',
      [input.email]
    );
    if (existing.length > 0 && existing[0].status === 'active') {
      throw badRequest('USER_ALREADY_MEMBER', 'Cet utilisateur est déjà membre actif de l’organisation.');
    }

    const [invitation] = await tx.query<{ id: string }>(
      `INSERT INTO invitations (organization_id, email, role, department, full_name, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        ctx.organization.id,
        input.email,
        input.role,
        input.department ?? null,
        input.fullName ?? null,
        hashToken(token),
        ctx.user.id,
        expiresAt.toISOString(),
      ]
    );

    await recordAudit(
      tx,
      actorFromContext(ctx),
      ctx.organization.id,
      {
        action: 'user.invited',
        entityType: 'invitation',
        entityId: invitation.id,
        newValue: JSON.stringify({ email: input.email, role: input.role }),
        ...meta,
      }
    );

    return invitation.id;
  });

  // Le jeton n'est PAS réémis par e-mail : aucun fournisseur d'e-mail n'est
  // configuré. Il est renvoyé à l'appelant authentifié pour transmission par le
  // moyen de son choix (lien d'invitation). Cet état est explicite, pas simulé.
  return {
    invitationId,
    token,
    expiresAt: expiresAt.toISOString(),
    emailSent: false,
    reason: "Aucun fournisseur d'e-mail n'est configuré sur cette instance : le lien d'invitation doit être transmis manuellement.",
  };
}

export async function acceptInvitation(
  db: Db,
  input: { token: string; fullName: string },
  meta: RequestMeta
): Promise<{ organizationId: string; userId: string; email: string }> {
  let accepted: { created_organization_id: string; created_user_id: string; created_user_email: string } | undefined;
  try {
    const rows = await db.tx((tx) =>
      tx.query<{ created_organization_id: string; created_user_id: string; created_user_email: string }>(
        'SELECT * FROM truetco_accept_invitation($1, $2)',
        [hashToken(input.token), input.fullName]
      )
    );
    accepted = rows[0];
  } catch (err) {
    // Les refus de la fonction SQL sont traduits en messages et codes explicites
    // pour l'utilisateur : « invitation déjà utilisée » n'est pas une panne.
    const message = err instanceof DataError ? err.message : String((err as Error)?.message ?? '');
    if (/déjà été utilisée/i.test(message)) {
      throw new HttpError(409, 'INVITATION_ALREADY_USED', 'Cette invitation a déjà été utilisée.');
    }
    if (/a été révoquée/i.test(message)) {
      throw new HttpError(409, 'INVITATION_REVOKED', 'Cette invitation a été révoquée par un administrateur.');
    }
    if (/a expiré/i.test(message)) {
      throw new HttpError(409, 'INVITATION_EXPIRED', 'Cette invitation a expiré : demandez une nouvelle invitation.');
    }
    if (/introuvable|no_data_found/i.test(message)) {
      throw notFound('Cette invitation est introuvable ou le lien est invalide.');
    }
    throw err;
  }
  if (!accepted) throw notFound('Cette invitation est introuvable.');

  // Trace dans le journal de la NOUVELLE organisation. L'acteur est l'utilisateur
  // que le serveur vient d'identifier par le jeton d'invitation : c'est bien lui
  // qui a accepté. L'écriture est une opération d'amorçage (le contexte RLS de la
  // nouvelle organisation n'est pas encore ouvert par une session) : elle passe
  // donc par une entrée autonome, explicitement identifiée dans la justification.
  const organizationId = accepted.created_organization_id;
  const userId = accepted.created_user_id;

  await recordAuditStandalone(
    db,
    organizationId,
    { id: userId, name: input.fullName, role: 'member' },
    {
      action: 'user.joined',
      entityType: 'user',
      entityId: userId,
      newValue: JSON.stringify({ email: accepted.created_user_email, via: 'invitation' }),
      justification: 'Acceptation d’une invitation : identité établie par le jeton d’invitation haché.',
      ...meta,
    }
  );

  return { organizationId, userId, email: accepted.created_user_email };
}

// -----------------------------------------------------------------------------
// Connexion / déconnexion
// -----------------------------------------------------------------------------
export async function loginWithDemoIdentity(
  db: Db,
  input: { email: string; domain?: string | null; allowDemoAuth: boolean },
  meta: RequestMeta
): Promise<SessionIssue> {
  assertDemoAuthAllowed(input.allowDemoAuth);

  const user = await db.systemTx(async (tx) => {
    const rows = await tx.query<{ id: string; organization_id: string; role: UserRole; status: string; email: string }>(
      `SELECT u.id, u.organization_id, u.role, u.status, u.email
         FROM users u
         JOIN organizations o ON o.id = u.organization_id
        WHERE lower(u.email) = lower($1)
          AND ($2::text IS NULL OR lower(o.domain) = lower($2::text))
        LIMIT 1`,
      [input.email, input.domain ?? null]
    );
    return rows[0] ?? null;
  });

  if (!user) throw notFound('Aucun utilisateur ne correspond à ces informations.');
  if (user.status !== 'active') throw forbidden('USER_NOT_ACTIVE', "Ce compte utilisateur n'est pas actif.");

  const token = generateToken('sess');
  const expiresAt = sessionExpiry();
  const session = await issueSession(db, {
    organizationId: user.organization_id,
    userId: user.id,
    token,
    expiresAt,
    authMethod: 'demo_local',
    role: user.role,
  });

  await recordAuditStandalone(
    db,
    user.organization_id,
    { id: user.id, name: user.email, role: user.role },
    {
      action: 'auth.login',
      entityType: 'session',
      entityId: session.id,
      newValue: JSON.stringify({ authMethod: 'demo_local', isDemo: true }),
      isDemo: true,
      ...meta,
    }
  );

  return { token, expiresAt, organizationId: user.organization_id, userId: user.id, role: user.role };
}

export async function issueSession(
  db: Db,
  input: {
    organizationId: string;
    userId: string;
    token?: string;
    expiresAt?: Date;
    authMethod: string;
    role: UserRole;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = input.token ?? generateToken('sess');
  const expiresAt = input.expiresAt ?? sessionExpiry();

  const rows = await db.asOrganization(input.organizationId, (tx) =>
    tx.query<{ id: string }>(
      `INSERT INTO user_sessions (organization_id, user_id, token_hash, auth_method, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.organizationId,
        input.userId,
        hashToken(token),
        input.authMethod,
        expiresAt.toISOString(),
        input.ipAddress ?? null,
        input.userAgent ?? null,
      ]
    )
  );

  return { id: rows[0].id, token, expiresAt };
}

export async function logout(db: Db, ctx: AuthContext, meta: RequestMeta): Promise<void> {
  await db.asOrganization(ctx.organization.id, async (tx) => {
    await tx.query('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1', [ctx.session.id]);
    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'auth.logout',
      entityType: 'session',
      entityId: ctx.session.id,
      ...meta,
    });
  });
}

export async function listSessions(db: Db, ctx: AuthContext): Promise<
  { id: string; authMethod: string; createdAt: string; expiresAt: string; lastSeenAt: string | null; ipAddress: string | null; userAgent: string | null; isCurrent: boolean }[]
> {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const rows = await tx.query<any>(
      `SELECT id, auth_method, created_at, expires_at, last_seen_at, ip_address, user_agent
         FROM user_sessions
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC`,
      [ctx.user.id]
    );
    return rows.map((row) => ({
      id: row.id,
      authMethod: row.auth_method,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      isCurrent: row.id === ctx.session.id,
    }));
  });
}

export async function revokeSession(db: Db, ctx: AuthContext, sessionId: string, meta: RequestMeta): Promise<void> {
  await db.asOrganization(ctx.organization.id, async (tx) => {
    const rows = await tx.query<{ user_id: string }>('SELECT user_id FROM user_sessions WHERE id = $1', [sessionId]);
    if (rows.length === 0) throw notFound('Session introuvable.');
    // Un utilisateur ne peut révoquer que ses propres sessions ; un
    // administrateur peut révoquer celles de son organisation.
    if (rows[0].user_id !== ctx.user.id && !canManageTeam(ctx.user.role)) {
      throw forbidden('PERMISSION_DENIED', 'Vous ne pouvez révoquer que vos propres sessions.');
    }
    await tx.query('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = $1', [sessionId]);
    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'auth.session_revoked',
      entityType: 'session',
      entityId: sessionId,
      ...meta,
    });
  });
}

/** Révocation de toutes les sessions d'un utilisateur (changement de rôle, suspension). */
export async function revokeAllUserSessions(tx: Executor, userId: string, exceptSessionId?: string): Promise<number> {
  const rows = await tx.query<{ id: string }>(
    `UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2::uuid)
      RETURNING id`,
    [userId, exceptSessionId ?? null]
  );
  return rows.length;
}

// -----------------------------------------------------------------------------
// Équipe
// -----------------------------------------------------------------------------
export async function listTeam(db: Db, ctx: AuthContext) {
  return db.asOrganization(ctx.organization.id, async (tx) => {
    const users = await tx.query<any>(
      `SELECT id, email, full_name, role, department, status, created_at, updated_at
         FROM users ORDER BY role, full_name`,
    );
    // Le statut d'une invitation est DÉDUIT de ses horodatages (acceptée,
    // révoquée, expirée) : aucune colonne de statut à maintenir, donc aucun
    // risque d'incohérence entre le statut affiché et les faits datés.
    const invitations = await tx.query<any>(
      `SELECT id, email, role, department, full_name, expires_at, created_at,
              CASE
                WHEN revoked_at IS NOT NULL THEN 'revoked'
                WHEN accepted_at IS NOT NULL THEN 'accepted'
                WHEN expires_at <= CURRENT_TIMESTAMP THEN 'expired'
                ELSE 'pending'
              END AS status
         FROM invitations
        WHERE accepted_at IS NULL AND revoked_at IS NULL
        ORDER BY created_at DESC`,
    );
    return { users, invitations };
  });
}

export async function updateUserRole(
  db: Db,
  ctx: AuthContext,
  userId: string,
  role: UserRole,
  meta: RequestMeta
): Promise<{ id: string; role: UserRole }> {
  if (!canManageTeam(ctx.user.role)) {
    throw forbidden('PERMISSION_DENIED', "Seul un administrateur d'organisation peut modifier les rôles.");
  }
  if (!canAssignRole(ctx.user.role, role)) {
    throw forbidden('ROLE_ESCALATION_BLOCKED', `Votre rôle (${ctx.user.role}) ne permet pas d'attribuer « ${role} ».`);
  }
  if (!USER_ROLES.includes(role)) throw badRequest('INVALID_ROLE', 'Rôle inconnu.');

  return db.asOrganization(ctx.organization.id, async (tx) => {
    const current = await tx.query<{ role: UserRole }>('SELECT role FROM users WHERE id = $1', [userId]);
    if (!current[0]) throw notFound('Utilisateur introuvable.');
    if (current[0].role === role) return { id: userId, role };

    await tx.query('UPDATE users SET role = $2 WHERE id = $1', [userId, role]);

    // Changement de rôle = changement de privilèges : les sessions ouvertes
    // avec l'ancien rôle ne doivent pas continuer à porter l'ancien jeu de
    // droits. On révoque tout sauf la session de l'administrateur lui-même
    // (si c'est lui qui change son propre rôle, sa session est également
    // révoquée, ce qui le force à se reconnecter).
    const revoked = await revokeAllUserSessions(tx, userId, userId === ctx.user.id ? undefined : ctx.session.id);

    await recordAudit(
      tx,
      actorFromContext(ctx),
      ctx.organization.id,
      {
        action: 'user.role_changed',
        entityType: 'user',
        entityId: userId,
        fieldChanged: 'role',
        oldValue: current[0].role,
        newValue: role,
        justification: `${revoked} session(s) révoquée(s) suite au changement de rôle.`,
        ...meta,
      }
    );

    return { id: userId, role };
  });
}

export async function suspendUser(db: Db, ctx: AuthContext, userId: string, meta: RequestMeta): Promise<void> {
  if (!canManageTeam(ctx.user.role)) {
    throw forbidden('PERMISSION_DENIED', "Seul un administrateur d'organisation peut suspendre un utilisateur.");
  }
  if (userId === ctx.user.id) {
    throw badRequest('CANNOT_SUSPEND_SELF', 'Un administrateur ne peut pas suspendre son propre compte.');
  }
  await db.asOrganization(ctx.organization.id, async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `UPDATE users SET status = 'suspended' WHERE id = $1 AND status = 'active' RETURNING id`,
      [userId]
    );
    if (rows.length === 0) throw notFound('Utilisateur introuvable ou déjà inactif.');
    await revokeAllUserSessions(tx, userId);
    await recordAudit(tx, actorFromContext(ctx), ctx.organization.id, {
      action: 'user.suspended',
      entityType: 'user',
      entityId: userId,
      newValue: 'suspended',
      ...meta,
    });
  });
}

export { markSessionSeen };
