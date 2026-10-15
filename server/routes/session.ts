import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { AuthVerifier } from '../auth';
import { writeAudit } from '../audit';
import { type Db, setSessionVars, withIdentity, withTenant } from '../db';
import { HttpError, asyncHandler, forbidden, notFound } from '../errors';
import { requirePermission } from '../rbac';
import type { AuthContext, Role } from '../types';
import { InvitationInput, TenantCreateInput, TenantUpdateInput, UUID_RE, UserUpdateInput, parse } from '../validation';

const TENANT_COLUMNS = `
  o.id, o.name, o.slug, o.domain, o.subscription_tier AS "subscriptionTier", o.data_residency AS "dataResidency",
  o.country_code AS "countryCode", o.default_currency AS "defaultCurrency",
  o.legal_registration_number AS "legalRegistrationNumber"`;

const USER_COLUMNS = `
  id, email, full_name AS "fullName", role, 'clerk' AS "ssoProvider", COALESCE(department, '') AS department,
  is_active AS "isActive", last_login_at AS "lastLoginAt"`;

const MAX_ORGS_PER_IDENTITY = 5;

export function sessionRouter(deps: { db: Db; verifier: AuthVerifier }): Router {
  const { db, verifier } = deps;
  const r = Router();

  // Session : jamais de secret ni de rôle choisi par le client, tout vient de la base.
  r.get('/auth/me', asyncHandler(async (req, res) => {
    const ctx = req.ctx!;
    let user: Record<string, unknown> | null = null;
    if (ctx.active) {
      user = await withIdentity(db, { clerkId: ctx.identity.clerkId }, async (q) => {
        await q.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1 AND clerk_id = $2', [ctx.active!.userId, ctx.identity.clerkId]);
        return (await q.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND clerk_id = $2`, [ctx.active!.userId, ctx.identity.clerkId])).rows[0] ?? null;
      });
    }
    res.json({
      authenticated: true,
      user,
      organizationId: ctx.active?.organizationId ?? null,
      memberships: ctx.memberships,
      isPlatformAdmin: ctx.isPlatformAdmin,
      needsOnboarding: ctx.memberships.length === 0,
    });
  }));

  // Organisations dont l'appelant est membre (jamais la liste globale).
  r.get('/tenants', asyncHandler(async (req, res) => {
    const ids = req.ctx!.memberships.map((m) => m.organizationId);
    if (ids.length === 0) return res.json([]);
    const rows = await withIdentity(db, { clerkId: req.ctx!.identity.clerkId }, async (q) =>
      (await q.query(`SELECT ${TENANT_COLUMNS} FROM organizations o WHERE o.id = ANY($1::uuid[]) ORDER BY o.name`, [ids])).rows
    );
    res.json(rows);
  }));

  r.get('/tenants/current', requirePermission('project:read'), asyncHandler(async (req, res) => {
    const row = await withTenant(db, req.ctx!, async (q, org) =>
      (await q.query(
        `SELECT ${TENANT_COLUMNS},
                (SELECT count(*) FROM projects  WHERE organization_id = o.id)::int AS "projectCount",
                (SELECT count(*) FROM suppliers WHERE organization_id = o.id)::int AS "supplierCount",
                (SELECT count(*) FROM users     WHERE organization_id = o.id AND is_active)::int AS "userCount"
           FROM organizations o WHERE o.id = $1`, [org])).rows[0]
    );
    if (!row) throw notFound('Organisation');
    res.json(row);
  }));

  // Création d'organisation : identité authentifiée + email vérifié ; le créateur devient admin.
  // Ni domaine, ni formule tarifaire, ni résidence des données ne sont acceptés du client.
  const createLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => req.ctx?.identity.clerkId ?? 'anonymous',
    message: { error: 'rate_limited', message: 'Trop de créations, réessayez plus tard' },
  });
  r.post('/tenants', createLimiter, asyncHandler(async (req, res) => {
    const ctx = req.ctx!;
    const body = parse(TenantCreateInput, req.body);
    if (ctx.memberships.filter((m) => m.role === 'admin').length >= MAX_ORGS_PER_IDENTITY) {
      throw new HttpError(403, 'org_limit', "Nombre maximal d'organisations atteint");
    }
    let { email, emailVerified, fullName } = ctx.identity;
    if (!email || !emailVerified) {
      const p = await verifier.loadProfile?.(ctx.identity.clerkId);
      if (p) ({ email, emailVerified, fullName } = { email: p.email, emailVerified: p.emailVerified, fullName: fullName ?? p.fullName });
    }
    if (!email || !emailVerified) throw forbidden('Un email vérifié est requis pour créer une organisation');

    const orgId = crypto.randomUUID();
    const slug = `${body.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org'}-${crypto.randomBytes(3).toString('hex')}`;
    const name = fullName || email.split('@')[0];

    const tenant = await db.tx(async (q) => {
      await setSessionVars(q, { orgId, newOrgId: orgId, clerkId: ctx.identity.clerkId });
      const org = (await q.query(
        `INSERT INTO organizations (id, name, slug, country_code, default_currency, legal_registration_number)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, name, slug, domain, subscription_tier AS "subscriptionTier", data_residency AS "dataResidency",
                   country_code AS "countryCode", default_currency AS "defaultCurrency", legal_registration_number AS "legalRegistrationNumber"`,
        [orgId, body.name, slug, body.countryCode, body.defaultCurrency, body.legalRegistrationNumber ?? null]
      )).rows[0];
      const u = (await q.query(
        `INSERT INTO users (organization_id, email, full_name, role, clerk_id, is_active, last_login_at)
         VALUES ($1,$2,$3,'admin',$4,TRUE,CURRENT_TIMESTAMP) RETURNING id`,
        [orgId, email!.toLowerCase(), name, ctx.identity.clerkId]
      )).rows[0];
      const synthetic: AuthContext = {
        ...ctx,
        active: { userId: u.id, organizationId: orgId, organizationName: body.name, organizationSlug: slug, role: 'admin', email: email!, fullName: name },
      };
      await writeAudit(q, synthetic, { entity: `Organisation ${body.name}`, field: 'Création', oldValue: 'N/A', newValue: slug });
      return org;
    });
    res.status(201).json({ success: true, tenant });
  }));

  r.patch('/tenants/current', requirePermission('tenant:update'), asyncHandler(async (req, res) => {
    const b = parse(TenantUpdateInput, req.body);
    const tenant = await withTenant(db, req.ctx!, async (q, org) => {
      const row = (await q.query(
        `UPDATE organizations SET name = COALESCE($2, name), country_code = COALESCE($3, country_code),
                default_currency = COALESCE($4, default_currency),
                legal_registration_number = CASE WHEN $5::boolean THEN $6 ELSE legal_registration_number END
          WHERE id = $1 RETURNING id, name, slug`,
        [org, b.name ?? null, b.countryCode ?? null, b.defaultCurrency ?? null, b.legalRegistrationNumber !== undefined, b.legalRegistrationNumber ?? null]
      )).rows[0];
      if (!row) throw notFound('Organisation');
      await writeAudit(q, req.ctx!, { entity: `Organisation ${row.name}`, field: 'Paramètres', newValue: JSON.stringify(b) });
      return row;
    });
    res.json({ success: true, tenant });
  }));

  // Annuaire : lecture réservée aux profils de gestion.
  r.get('/auth/users', requirePermission('user:read'), asyncHandler(async (req, res) => {
    const rows = await withTenant(db, req.ctx!, async (q, org) =>
      (await q.query(`SELECT ${USER_COLUMNS} FROM users WHERE organization_id = $1 ORDER BY full_name`, [org])).rows
    );
    res.json(rows);
  }));

  // Invitation : crée une ligne SANS identité liée ; elle ne s'active que lorsque la personne
  // se connecte avec cet email VÉRIFIÉ chez le fournisseur d'identité (cf. authenticate).
  r.post('/users/invitations', requirePermission('user:manage'), asyncHandler(async (req, res) => {
    const b = parse(InvitationInput, req.body);
    const user = await withTenant(db, req.ctx!, async (q, org) => {
      const row = (await q.query(
        `INSERT INTO users (organization_id, email, full_name, role, department, is_active)
         VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING ${USER_COLUMNS}`,
        [org, b.email, b.fullName, b.role, b.department ?? null]
      )).rows[0];
      await writeAudit(q, req.ctx!, { entity: `Utilisateur ${b.email}`, field: 'Invitation', oldValue: 'N/A', newValue: b.role });
      return row;
    });
    res.status(201).json({ success: true, user });
  }));

  r.patch('/users/:id', requirePermission('user:manage'), asyncHandler(async (req, res) => {
    if (!UUID_RE.test(req.params.id)) throw notFound('Utilisateur');
    const b = parse(UserUpdateInput, req.body);
    const user = await withTenant(db, req.ctx!, async (q, org) => {
      const before = (await q.query<{ role: Role; is_active: boolean; email: string }>(
        'SELECT role, is_active, email FROM users WHERE id = $1 AND organization_id = $2 FOR UPDATE', [req.params.id, org]
      )).rows[0];
      if (!before) throw notFound('Utilisateur');

      const losesAdmin = before.role === 'admin' && before.is_active && ((b.role && b.role !== 'admin') || b.isActive === false);
      if (losesAdmin) {
        const others = (await q.query(
          `SELECT id FROM users WHERE organization_id = $1 AND role = 'admin' AND is_active AND id <> $2 FOR UPDATE`, [org, req.params.id]
        )).rowCount;
        if (others === 0) throw new HttpError(409, 'last_admin', "Impossible : c'est le dernier administrateur de l'organisation");
      }
      const row = (await q.query(
        `UPDATE users SET role = COALESCE($3, role), is_active = COALESCE($4, is_active),
                full_name = COALESCE($5, full_name),
                department = CASE WHEN $6::boolean THEN $7 ELSE department END
          WHERE id = $1 AND organization_id = $2 RETURNING ${USER_COLUMNS}`,
        [req.params.id, org, b.role ?? null, b.isActive ?? null, b.fullName ?? null, b.department !== undefined, b.department ?? null]
      )).rows[0];
      if (b.role && b.role !== before.role) await writeAudit(q, req.ctx!, { entity: `Utilisateur ${before.email}`, field: 'Rôle', oldValue: before.role, newValue: b.role });
      if (b.isActive !== undefined && b.isActive !== before.is_active) await writeAudit(q, req.ctx!, { entity: `Utilisateur ${before.email}`, field: 'Actif', oldValue: before.is_active, newValue: b.isActive });
      return row;
    });
    res.json({ success: true, user });
  }));

  // Administration de plateforme : MÉTADONNÉES d'organisations uniquement, jamais de données métier clients.
  r.get('/admin/tenants', asyncHandler(async (req, res) => {
    if (!req.ctx!.isPlatformAdmin) throw forbidden();
    const rows = await db.tx(async (q) => {
      await setSessionVars(q, { clerkId: req.ctx!.identity.clerkId, platformAdmin: true });
      return (await q.query(`SELECT id, name, slug, subscription_tier AS "subscriptionTier", is_active AS "isActive", created_at AS "createdAt" FROM organizations ORDER BY created_at DESC LIMIT 1000`)).rows;
    });
    res.json(rows);
  }));

  return r;
}
