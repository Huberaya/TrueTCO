/**
 * TrueTCO — Routes API
 * ---------------------------------------------------------------------------
 * Toutes les routes métier exigent une session valide et déduisent le tenant
 * de la session (jamais du client). Les routes d'écriture exigent en plus une
 * permission RBAC vérifiée côté serveur.
 *
 * Les données de démonstration synthétiques (connecteurs ERP factices, repli
 * heuristique du parser IA) sont explicitement étiquetées `synthetic: true` et
 * désactivées par défaut : elles ne doivent JAMAIS pouvoir être confondues
 * avec des données fournisseurs réelles.
 */

import crypto from 'crypto';
import express, { Request, Response, Router } from 'express';
import { AuthService, generateSessionToken, hashToken, hasPermission, ROLE_PERMISSIONS, UserRole } from './auth';
import { HttpError, clearSessionCookie, errorHandler, rateLimit, serializeSessionCookie } from './security';

export interface RouteDependencies {
  sql: any;
  isProd: boolean;
  allowDemoAuth: boolean;
  enableSyntheticConnectors: boolean;
  geminiApiKey?: string;
}

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const str = (v: unknown, max = 255): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function createApiRouter(deps: RouteDependencies): Router {
  const router = express.Router();
  const auth = new AuthService({ sql: deps.sql, isProd: deps.isProd, allowDemoAuth: deps.allowDemoAuth });
  const requireSession = auth.requireSession();
  const require = (permission: Parameters<typeof auth.requirePermission>[0]) => auth.requirePermission(permission);
  const tenantOf = (req: Request) => auth.tenantIdOf(req);
  const ctxOf = (req: Request) => auth.contextOf(req);

  const notConfigured = (res: Response) => {
    if (!deps.sql) {
      return res.status(503).json({
        error: "Base de données non configurée (DATABASE_URL absente). Aucune donnée n'est disponible.",
        code: 'DB_NOT_CONFIGURED',
      });
    }
    return null;
  };

  // ---------------------------------------------------------------------------
  // Santé & métadonnées publiques (aucune donnée métier exposée)
  // ---------------------------------------------------------------------------
  router.get('/health', async (_req: Request, res: Response) => {
    if (!deps.sql) {
      return res.json({ status: 'ok', database: false, message: 'DATABASE_URL non configurée' });
    }
    try {
      const result = await deps.sql`SELECT NOW() AS now`;
      return res.json({ status: 'ok', database: true, time: result[0]?.now });
    } catch {
      return res.status(503).json({ status: 'degraded', database: false });
    }
  });

  // ---------------------------------------------------------------------------
  // Authentification
  // ---------------------------------------------------------------------------
  /**
   * Ouverture de session.
   *
   * En production, ce point d'entrée est FERMÉ : TrueTCO n'embarque pas
   * d'IdP. Une intégration OIDC/SAML d'entreprise doit être branchée et
   * vérifier l'assertion de l'IdP (signature, audience, nonce, expiration)
   * avant d'appeler `issueSession`.
   *
   * Hors production et si TRUETCO_ALLOW_DEMO_AUTH=true, une session de
   * démonstration est émise et explicitement marquée comme telle.
   */
  router.post(
    '/auth/sso/login',
    rateLimit({ windowMs: 60_000, max: 10, name: 'login' }),
    async (req: Request, res: Response) => {
      const missingDb = notConfigured(res);
      if (missingDb) return missingDb;

      if (deps.isProd || !deps.allowDemoAuth) {
        return res.status(501).json({
          error:
            "Authentification d'entreprise non configurée : aucun fournisseur d'identité (OIDC/SAML) n'est branché. Contactez l'administrateur de la plateforme.",
          code: 'IDP_NOT_CONFIGURED',
        });
      }

      const email = str(req.body?.email, 255).toLowerCase().trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Adresse e-mail professionnelle invalide.', code: 'INVALID_EMAIL' });
      }

      const requestedRole = str(req.body?.role, 50) as UserRole;
      /**
       * SÉCURITÉ : le rôle n'est jamais choisi librement par le client au-delà
       * des rôles de démonstration non privilégiés. La promotion vers admin /
       * super_admin passe obligatoirement par un administrateur authentifié.
       */
      const DEMO_ROLES: UserRole[] = ['acheteur', 'directeur_achats', 'finance_controleur', 'rse_esg', 'direction_generale', 'lecteur'];
      const role: UserRole = DEMO_ROLES.includes(requestedRole) ? requestedRole : 'lecteur';

      // Résolution du tenant : domaine e-mail vérifié côté serveur, jamais un
      // identifiant arbitraire transmis par le client.
      const domain = email.split('@')[1];
      const orgs = await deps.sql`
        SELECT id, name, slug, data_residency AS "dataResidency"
        FROM organizations
        WHERE is_active = true AND (domain = ${domain} OR slug = ${domain.split('.')[0]})
        ORDER BY created_at ASC
        LIMIT 1;
      `;
      if (!orgs || orgs.length === 0) {
        return res.status(403).json({
          error:
            "Aucune organisation active n'est associée à ce domaine e-mail. L'accès doit être provisionné par un administrateur.",
          code: 'ORG_NOT_PROVISIONED',
        });
      }
      const org = orgs[0];

      const fullName = str(req.body?.fullName, 255) || email.split('@')[0];
      const department = str(req.body?.department, 255) || null;

      const users = await deps.sql`
        INSERT INTO users (organization_id, email, full_name, role, department, is_active, last_login_at)
        VALUES (${org.id}, ${email}, ${fullName}, ${role}, ${department}, true, CURRENT_TIMESTAMP)
        ON CONFLICT (organization_id, email)
        DO UPDATE SET last_login_at = CURRENT_TIMESTAMP, full_name = COALESCE(EXCLUDED.full_name, users.full_name)
        RETURNING id, organization_id AS "organizationId", email, full_name AS "fullName", role, department, is_active AS "isActive";
      `;
      const user = users[0];

      const token = generateSessionToken();
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();

      await deps.sql`
        INSERT INTO user_sessions (organization_id, user_id, token_hash, sso_provider, expires_at, ip_address, user_agent)
        VALUES (${org.id}, ${user.id}, ${hashToken(token)}, ${'demo_local'}, ${expiresAt},
                ${req.ip ?? null}, ${str(req.headers['user-agent'], 255) || null});
      `;

      await safeAudit(deps.sql, {
        organizationId: org.id,
        userId: user.id,
        userName: user.fullName,
        userRole: user.role,
        entityName: "Contrôle d'accès & sécurité",
        fieldChanged: 'Ouverture de session (mode démonstration)',
        oldValue: 'Non authentifié',
        newValue: `Session de démonstration — ${org.name}`,
        justification:
          "Session émise en mode démonstration (TRUETCO_ALLOW_DEMO_AUTH). Ce mode est interdit en production et ne constitue pas une authentification d'entreprise.",
      });

      // Le jeton n'est PAS renvoyé dans le corps de la réponse : il est déposé
      // dans un cookie HttpOnly, inaccessible au JavaScript de la page.
      res.setHeader('Set-Cookie', serializeSessionCookie(token, new Date(expiresAt), deps.isProd));

      return res.json({
        success: true,
        expiresAt,
        organizationId: org.id,
        organizationName: org.name,
        organizationSlug: org.slug,
        dataResidency: org.dataResidency,
        // Avertissement explicite : le client DOIT l'afficher.
        authenticationMode: 'demo_local',
        warning:
          "Session de démonstration : identité non vérifiée par un fournisseur d'identité. Ne pas utiliser en production.",
        user: {
          id: user.id,
          organizationId: org.id,
          email: user.email,
          fullName: user.fullName,
          role: user.role,
          ssoProvider: 'demo_local',
          department: user.department,
        },
      });
    }
  );

  router.get('/auth/me', requireSession, (req: Request, res: Response) => {
    const ctx = ctxOf(req);
    return res.json({
      authenticated: true,
      organizationId: ctx.organization.id,
      organizationName: ctx.organization.name,
      organizationSlug: ctx.organization.slug,
      dataResidency: ctx.organization.dataResidency,
      defaultCurrency: ctx.organization.defaultCurrency,
      countryCode: ctx.organization.countryCode,
      expiresAt: ctx.expiresAt,
      authenticationMode: ctx.isDemoSession ? 'demo_local' : 'enterprise_idp',
      // Droits effectifs calculés par le serveur : l'interface ne fait que les refléter.
      permissions: ROLE_PERMISSIONS[ctx.user.role] ?? [],
      user: {
        id: ctx.user.id,
        organizationId: ctx.organization.id,
        email: ctx.user.email,
        fullName: ctx.user.fullName,
        role: ctx.user.role,
        department: ctx.user.department,
        ssoProvider: ctx.user.ssoProvider,
      },
    });
  });

  router.post('/auth/logout', rateLimit({ windowMs: 60_000, max: 30, name: 'logout' }), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    res.setHeader('Set-Cookie', clearSessionCookie(deps.isProd));
    const token = AuthService.extractBearer(req);
    if (!token) return res.json({ success: true });
    await deps.sql`UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ${hashToken(token)};`;
    return res.json({ success: true });
  });

  router.get('/auth/users', requireSession, require('user:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const rows = await deps.sql`
      SELECT id, email, full_name AS "fullName", role, department, is_active AS "isActive", last_login_at AS "lastLoginAt"
      FROM users WHERE organization_id = ${tenantOf(req)} ORDER BY full_name ASC;
    `;
    return res.json(rows);
  });

  router.post(
    '/auth/users/:userId/role',
    requireSession,
    require('user:write'),
    rateLimit({ windowMs: 60_000, max: 30, name: 'role-change' }),
    async (req: Request, res: Response) => {
      const missingDb = notConfigured(res);
      if (missingDb) return missingDb;
      const { userId } = req.params;
      if (!isUuid(userId)) return res.status(400).json({ error: 'Identifiant utilisateur invalide.', code: 'INVALID_ID' });

      const ctx = ctxOf(req);
      const newRole = str(req.body?.role, 50) as UserRole;
      const assignable: UserRole[] = ['admin', 'directeur_achats', 'acheteur', 'finance_controleur', 'rse_esg', 'direction_generale', 'lecteur'];
      if (!assignable.includes(newRole)) {
        return res.status(400).json({
          error: `Rôle non attribuable via cette API. Valeurs autorisées : ${assignable.join(', ')}.`,
          code: 'ROLE_NOT_ASSIGNABLE',
        });
      }
      if (newRole === 'admin' && !hasPermission(ctx.user.role, 'user:write')) {
        return res.status(403).json({ error: 'Seul un administrateur peut nommer un administrateur.', code: 'PERMISSION_DENIED' });
      }

      const updated = await deps.sql`
        UPDATE users SET role = ${newRole}, updated_at = CURRENT_TIMESTAMP
        WHERE id = ${userId} AND organization_id = ${tenantOf(req)}
        RETURNING id, email, role;
      `;
      if (!updated || updated.length === 0) {
        return res.status(404).json({ error: 'Utilisateur introuvable dans votre organisation.', code: 'NOT_FOUND' });
      }

      await safeAudit(deps.sql, {
        organizationId: tenantOf(req),
        userId: ctx.user.id,
        userName: ctx.user.fullName,
        userRole: ctx.user.role,
        entityName: `Utilisateur ${updated[0].email}`,
        fieldChanged: 'Attribution de rôle',
        oldValue: 'n/a',
        newValue: newRole,
        justification: str(req.body?.justification, 500) || 'Changement de rôle via console d’administration.',
      });

      return res.json({ success: true, user: updated[0] });
    }
  );

  // ---------------------------------------------------------------------------
  // Organisations / tenants
  // ---------------------------------------------------------------------------
  router.get('/tenants', requireSession, require('tenant:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const ctx = ctxOf(req);

    // Un utilisateur ne voit QUE son organisation. Un super-admin de plateforme
    // voit la liste des organisations (usage support/commercial restreint).
    const rows =
      ctx.user.role === 'super_admin'
        ? await deps.sql`
            SELECT o.id, o.name, o.slug, o.domain, o.subscription_tier AS "subscriptionTier",
                   o.data_residency AS "dataResidency", o.country_code AS "countryCode",
                   o.default_currency AS "defaultCurrency", o.legal_registration_number AS "legalRegistrationNumber",
                   (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id)::int AS "projectCount",
                   (SELECT COUNT(*) FROM suppliers s WHERE s.organization_id = o.id)::int AS "supplierCount",
                   (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id)::int AS "userCount"
            FROM organizations o WHERE o.is_active = true ORDER BY o.created_at ASC;
          `
        : await deps.sql`
            SELECT o.id, o.name, o.slug, o.domain, o.subscription_tier AS "subscriptionTier",
                   o.data_residency AS "dataResidency", o.country_code AS "countryCode",
                   o.default_currency AS "defaultCurrency", o.legal_registration_number AS "legalRegistrationNumber",
                   (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id)::int AS "projectCount",
                   (SELECT COUNT(*) FROM suppliers s WHERE s.organization_id = o.id)::int AS "supplierCount",
                   (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id)::int AS "userCount"
            FROM organizations o WHERE o.id = ${ctx.organization.id};
          `;
    return res.json(rows);
  });

  router.get('/tenants/current', requireSession, require('tenant:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const rows = await deps.sql`
      SELECT o.id, o.name, o.slug, o.domain, o.subscription_tier AS "subscriptionTier",
             o.data_residency AS "dataResidency", o.country_code AS "countryCode",
             o.default_currency AS "defaultCurrency", o.legal_registration_number AS "legalRegistrationNumber",
             (SELECT COUNT(*) FROM projects p WHERE p.organization_id = o.id)::int AS "projectCount",
             (SELECT COUNT(*) FROM suppliers s WHERE s.organization_id = o.id)::int AS "supplierCount",
             (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id)::int AS "userCount"
      FROM organizations o WHERE o.id = ${tenantOf(req)};
    `;
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Organisation introuvable.', code: 'NOT_FOUND' });
    return res.json(rows[0]);
  });

  router.post(
    '/tenants',
    requireSession,
    require('tenant:write'),
    rateLimit({ windowMs: 60_000, max: 5, name: 'tenant-create' }),
    async (req: Request, res: Response) => {
      const missingDb = notConfigured(res);
      if (missingDb) return missingDb;
      const ctx = ctxOf(req);
      if (ctx.user.role !== 'super_admin') {
        return res.status(403).json({
          error: "La création d'une organisation est réservée à l'administration de la plateforme.",
          code: 'PERMISSION_DENIED',
        });
      }

      const name = str(req.body?.name, 255).trim();
      if (name.length < 2) return res.status(400).json({ error: "Nom d'organisation obligatoire.", code: 'INVALID_NAME' });

      const slug =
        str(req.body?.slug, 60).trim() ||
        name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 50);

      const id = crypto.randomUUID();
      try {
        const rows = await deps.sql`
          INSERT INTO organizations (id, name, slug, domain, subscription_tier, data_residency, country_code, default_currency, legal_registration_number, is_active)
          VALUES (${id}, ${name}, ${slug}, ${str(req.body?.domain, 255) || null},
                  ${str(req.body?.subscriptionTier, 30) || 'starter'},
                  ${str(req.body?.dataResidency, 60) || 'EU-FRANCE-PARIS'},
                  ${str(req.body?.countryCode, 2).toUpperCase() || 'FR'},
                  ${str(req.body?.defaultCurrency, 3).toUpperCase() || 'EUR'},
                  ${str(req.body?.legalRegistrationNumber, 50) || null}, true)
          RETURNING *;
        `;
        return res.status(201).json({ success: true, tenant: rows[0] });
      } catch (err: any) {
        if (String(err?.message ?? '').includes('duplicate key')) {
          return res.status(409).json({ error: 'Une organisation avec ce nom ou ce domaine existe déjà.', code: 'DUPLICATE' });
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Projets
  // ---------------------------------------------------------------------------
  router.get('/projects', requireSession, require('project:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const rows = await deps.sql`
      SELECT p.id, p.reference, p.name, p.description, p.category, p.company_name AS "companyName",
             p.budget_cap::float AS "budgetCap", p.currency, p.planned_volume AS "plannedVolume",
             p.unit_name AS "unitName", p.horizon_years AS "horizonYears", p.status,
             p.discount_rate::float AS "discountRate", p.energy_inflation_rate::float AS "energyInflationRate",
             p.general_inflation_rate::float AS "inflationRate", p.carbon_price_per_tonne::float AS "carbonPricePerTonne",
             p.created_at AS "createdAt", p.updated_at AS "updatedAt"
      FROM projects p WHERE p.organization_id = ${tenantOf(req)} ORDER BY p.created_at DESC;
    `;
    return res.json(rows);
  });

  router.post('/projects', requireSession, require('project:write'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const p = req.body ?? {};
    const reference = str(p.reference, 100).trim();
    const name = str(p.name, 255).trim();
    if (!reference || !name) {
      return res.status(400).json({ error: 'Champs obligatoires manquants : reference, name.', code: 'MISSING_FIELDS' });
    }

    const orgId = tenantOf(req);
    const projectId = isUuid(p.id) ? p.id : crypto.randomUUID();
    const horizon = Math.round(clamp(num(p.horizonYears, 5), 1, 50));
    const discountRate = clamp(num(p.discountRate, 0.05), 0, 0.5);
    const energyInflation = clamp(num(p.energyInflationRate, 0.04), -0.2, 0.5);
    const inflation = clamp(num(p.inflationRate, 0.025), -0.2, 0.5);
    const carbonPrice = clamp(num(p.carbonPricePerTonne, 120), 0, 100000);

    // Un projet ne peut pas être rattaché à une autre organisation : on ignore
    // tout organizationId fourni et on refuse l'écrasement d'un projet tiers.
    const existing = await deps.sql`SELECT organization_id FROM projects WHERE id = ${projectId} LIMIT 1;`;
    if (existing && existing.length > 0 && existing[0].organization_id !== orgId) {
      return res.status(403).json({ error: 'Ce projet appartient à une autre organisation.', code: 'TENANT_MISMATCH' });
    }

    const rows = await deps.sql`
      INSERT INTO projects (
        id, organization_id, reference, name, description, category, company_name, budget_cap,
        currency, planned_volume, unit_name, horizon_years, status, discount_rate,
        energy_inflation_rate, general_inflation_rate, carbon_price_per_tonne, created_by_user_id
      ) VALUES (
        ${projectId}, ${orgId}, ${reference}, ${name}, ${str(p.description, 2000)},
        ${str(p.category, 100) || 'flotte_automobile'}, ${str(p.companyName, 255) || null},
        ${Math.max(0, num(p.budgetCap, 0))}, ${str(p.currency, 3).toUpperCase() || 'EUR'},
        ${Math.round(Math.max(1, num(p.plannedVolume, 1)))}, ${str(p.unitName, 50) || 'unités'},
        ${horizon}, ${str(p.status, 50) || 'brouillon'}, ${discountRate},
        ${energyInflation}, ${inflation}, ${carbonPrice}, ${ctxOf(req).user.id}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, description = EXCLUDED.description, budget_cap = EXCLUDED.budget_cap,
        discount_rate = EXCLUDED.discount_rate, energy_inflation_rate = EXCLUDED.energy_inflation_rate,
        general_inflation_rate = EXCLUDED.general_inflation_rate,
        carbon_price_per_tonne = EXCLUDED.carbon_price_per_tonne, status = EXCLUDED.status,
        horizon_years = EXCLUDED.horizon_years, updated_at = CURRENT_TIMESTAMP
      WHERE projects.organization_id = ${orgId}
      RETURNING *;
    `;
    return res.json({ success: true, project: rows[0] });
  });

  // ---------------------------------------------------------------------------
  // Offres fournisseurs
  // ---------------------------------------------------------------------------
  router.get('/offers', requireSession, require('offer:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const rows = await deps.sql`
      SELECT o.id, o.project_id AS "projectId", o.supplier_id AS "supplierId", o.offer_reference AS "offerReference",
             o.apparent_total::float AS "apparentTotal", o.quantity, o.is_responsible_candidate AS "isResponsibleCandidate",
             o.confidence_score AS "confidenceScore"
      FROM supplier_offers o
      JOIN projects p ON p.id = o.project_id
      WHERE p.organization_id = ${tenantOf(req)};
    `;
    return res.json(rows);
  });

  router.post('/offers', requireSession, require('offer:write'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const o = req.body ?? {};
    if (!isUuid(o.projectId) || !isUuid(o.supplierId)) {
      return res.status(400).json({ error: 'projectId et supplierId doivent être des UUID valides.', code: 'INVALID_ID' });
    }

    const orgId = tenantOf(req);

    // Vérification d'appartenance : le projet ET le fournisseur doivent
    // appartenir à l'organisation de la session. Sans ce contrôle, il était
    // possible de créer une offre dans le projet d'une autre entreprise.
    const ownership = await deps.sql`
      SELECT
        (SELECT organization_id FROM projects WHERE id = ${o.projectId}) AS project_org,
        (SELECT organization_id FROM suppliers WHERE id = ${o.supplierId}) AS supplier_org;
    `;
    const { project_org, supplier_org } = ownership[0] ?? {};
    if (project_org !== orgId || supplier_org !== orgId) {
      return res.status(403).json({
        error: "Le projet ou le fournisseur n'appartient pas à votre organisation.",
        code: 'TENANT_MISMATCH',
      });
    }

    const offerId = isUuid(o.id) ? o.id : crypto.randomUUID();
    const offerReference = str(o.offerReference, 100) || `OFF-${offerId.slice(0, 8)}`;

    const rows = await deps.sql`
      INSERT INTO supplier_offers (
        id, project_id, supplier_id, offer_reference, apparent_total, quantity,
        delivery_lead_time_weeks, warranty_months, technical_suitability_score,
        is_responsible_candidate, confidence_score
      ) VALUES (
        ${offerId}, ${o.projectId}, ${o.supplierId}, ${offerReference}, ${Math.max(0, num(o.apparentTotal, 0))},
        ${Math.round(Math.max(1, num(o.quantity, 1)))}, ${Math.round(Math.max(0, num(o.deliveryLeadTimeWeeks, 0)))},
        ${Math.round(Math.max(0, num(o.warrantyMonths, 0)))}, ${Math.round(clamp(num(o.technicalSuitabilityScore, 0), 0, 100))},
        ${o.isResponsibleCandidate === true}, ${Math.round(clamp(num(o.confidenceScore, 0), 0, 100))}
      )
      ON CONFLICT (id) DO UPDATE SET
        apparent_total = EXCLUDED.apparent_total, quantity = EXCLUDED.quantity,
        technical_suitability_score = EXCLUDED.technical_suitability_score,
        is_responsible_candidate = EXCLUDED.is_responsible_candidate, updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    const costItems = Array.isArray(o.costItems) ? o.costItems.slice(0, 500) : [];
    for (const item of costItems) {
      if (!item || typeof item !== 'object') continue;
      const itemId = isUuid(item.id) ? item.id : crypto.randomUUID();
      const amount = Number(item.amount?.value);
      if (!Number.isFinite(amount)) continue;

      await deps.sql`
        INSERT INTO cost_items (id, offer_id, category, label, amount, unit, source_name, source_type, confidence_level, is_recurring_yearly, yearly_inflation_type, year_occurrences)
        VALUES (
          ${itemId}, ${offerId}, ${str(item.category, 100) || 'non_classe'}, ${str(item.label, 255) || 'Poste de coût'},
          ${amount}, ${str(item.amount?.unit, 50) || '€'}, ${str(item.amount?.sourceName, 255) || 'Non renseigné'},
          ${str(item.amount?.sourceType, 50) || 'manquante'},
          ${Math.round(clamp(num(item.amount?.confidenceLevel, 0), 0, 100))},
          ${item.isRecurringYearly === true},
          ${str(item.yearlyInflationType, 20) || null},
          ${Array.isArray(item.yearOccurrences ?? item.annualOccurrenceYears) ? (item.yearOccurrences ?? item.annualOccurrenceYears) : null}
        )
        ON CONFLICT (id) DO UPDATE SET
          amount = EXCLUDED.amount, category = EXCLUDED.category, label = EXCLUDED.label,
          confidence_level = EXCLUDED.confidence_level, year_occurrences = EXCLUDED.year_occurrences;
      `;
    }

    return res.json({ success: true, offer: rows[0] });
  });

  // ---------------------------------------------------------------------------
  // Fournisseurs
  // ---------------------------------------------------------------------------
  router.get('/suppliers', requireSession, require('supplier:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const rows = await deps.sql`
      SELECT id, name, country_code AS country, incoterm AS "defaultIncoterm",
             payment_terms_days AS "paymentTermsDays", standard_lead_time_days AS "leadTimeDays",
             minimum_order_quantity AS moq, warranty_months AS "warrantyMonths",
             historical_defect_rate::float AS "historicalDefectRate", esg_score AS "esgScore",
             data_quality_score AS "dataQualityScore", certifications
      FROM suppliers WHERE organization_id = ${tenantOf(req)} ORDER BY name ASC;
    `;
    return res.json(rows);
  });

  router.post('/suppliers', requireSession, require('supplier:write'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const s = req.body ?? {};
    const name = str(s.name, 255).trim();
    if (!name) return res.status(400).json({ error: 'Nom du fournisseur obligatoire.', code: 'MISSING_FIELDS' });

    const orgId = tenantOf(req);
    const supplierId = isUuid(s.id) ? s.id : crypto.randomUUID();
    const existing = await deps.sql`SELECT organization_id FROM suppliers WHERE id = ${supplierId} LIMIT 1;`;
    if (existing && existing.length > 0 && existing[0].organization_id !== orgId) {
      return res.status(403).json({ error: 'Ce fournisseur appartient à une autre organisation.', code: 'TENANT_MISMATCH' });
    }

    const rows = await deps.sql`
      INSERT INTO suppliers (
        id, organization_id, name, country_code, incoterm, payment_terms_days,
        standard_lead_time_days, minimum_order_quantity, warranty_months,
        historical_defect_rate, esg_score, data_quality_score, certifications
      ) VALUES (
        ${supplierId}, ${orgId}, ${name}, ${str(s.country, 2).toUpperCase() || 'FR'},
        ${str(s.defaultIncoterm, 10) || 'DDP'}, ${Math.round(Math.max(0, num(s.paymentTermsDays, 30)))},
        ${Math.round(Math.max(0, num(s.leadTimeDays, 0)))}, ${Math.round(Math.max(0, num(s.moq, 1)))},
        ${Math.round(Math.max(0, num(s.warrantyMonths, 0)))}, ${clamp(num(s.historicalDefectRate, 0), 0, 1)},
        ${Math.round(clamp(num(s.esgScore, 0), 0, 100))}, ${Math.round(clamp(num(s.dataQualityScore, 0), 0, 100))},
        ${Array.isArray(s.certifications) ? s.certifications.slice(0, 50).map((c: unknown) => str(c, 100)) : []}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name, incoterm = EXCLUDED.incoterm, payment_terms_days = EXCLUDED.payment_terms_days,
        standard_lead_time_days = EXCLUDED.standard_lead_time_days, warranty_months = EXCLUDED.warranty_months,
        historical_defect_rate = EXCLUDED.historical_defect_rate, esg_score = EXCLUDED.esg_score,
        data_quality_score = EXCLUDED.data_quality_score, certifications = EXCLUDED.certifications,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    return res.json({ success: true, supplier: rows[0] });
  });

  // ---------------------------------------------------------------------------
  // Référentiels d'externalités
  // ---------------------------------------------------------------------------
  router.get('/benchmarks', requireSession, require('benchmark:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const rows = await deps.sql`
      SELECT id, name, category, source, source_url AS "sourceUrl", document_ref AS "documentRef",
             value::float AS value, unit, confidence_score AS "confidenceLevel",
             country_scope AS "countryScope", methodology,
             value_range_min::float AS "valueRangeMin", value_range_max::float AS "valueRangeMax",
             last_audit_date AS "lastUpdated"
      FROM reference_benchmarks WHERE organization_id = ${tenantOf(req)} ORDER BY name ASC;
    `;
    return res.json(rows);
  });

  /**
   * Création/modification d'un facteur de référence.
   * Exige une SOURCE traçable : la donnée « officielle » sans référence
   * documentaire est refusée (règle produit : aucune donnée inventée ne peut
   * être présentée comme institutionnelle).
   */
  router.post('/benchmarks', requireSession, require('benchmark:write'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const b = req.body ?? {};
    const name = str(b.name, 255).trim();
    const value = Number(b.value);
    const source = str(b.source, 255).trim();
    const documentRef = str(b.documentRef ?? b.methodology, 255).trim();

    if (!name || !Number.isFinite(value)) {
      return res.status(400).json({ error: 'Nom et valeur du facteur obligatoires.', code: 'MISSING_FIELDS' });
    }
    if (!source || !documentRef) {
      return res.status(400).json({
        error:
          "Source et référence documentaire obligatoires : un facteur d'externalité doit être traçable (source, identifiant ou référence de publication, date, périmètre géographique).",
        code: 'SOURCE_REQUIRED',
      });
    }

    const orgId = tenantOf(req);
    const benchmarkId = isUuid(b.id) ? b.id : crypto.randomUUID();

    const rows = await deps.sql`
      INSERT INTO reference_benchmarks (
        id, organization_id, name, category, source, source_url, document_ref, value, unit,
        valid_until, confidence_score, last_audit_date, country_scope, methodology,
        value_range_min, value_range_max
      ) VALUES (
        ${benchmarkId}, ${orgId}, ${name}, ${str(b.category, 100) || 'carbone'}, ${source},
        ${str(b.sourceUrl, 500) || null}, ${documentRef}, ${value}, ${str(b.unit, 50) || '€'},
        ${b.validUntil ? new Date(b.validUntil) : new Date(Date.now() + 365 * 24 * 3600 * 1000)},
        ${Math.round(clamp(num(b.confidenceLevel, 0), 0, 100))}, CURRENT_TIMESTAMP,
        ${str(b.countryScope, 100) || null}, ${str(b.methodology, 500) || null},
        ${Number.isFinite(Number(b.valueRange?.[0])) ? Number(b.valueRange[0]) : null},
        ${Number.isFinite(Number(b.valueRange?.[1])) ? Number(b.valueRange[1]) : null}
      )
      ON CONFLICT (organization_id, name) DO UPDATE SET
        value = EXCLUDED.value, source = EXCLUDED.source, source_url = EXCLUDED.source_url,
        document_ref = EXCLUDED.document_ref, unit = EXCLUDED.unit,
        confidence_score = EXCLUDED.confidence_score, last_audit_date = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    return res.json({ success: true, benchmark: rows[0] });
  });

  // ---------------------------------------------------------------------------
  // Journal d'audit
  // ---------------------------------------------------------------------------
  router.get('/audit-logs', requireSession, require('audit:read'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const limit = Math.round(clamp(num(req.query?.limit, 500), 1, 2000));
    const rows = await deps.sql`
      SELECT id, timestamp, user_name AS "userName", user_role AS "userRole", entity_name AS "entityName",
             field_changed AS "fieldChanged", old_value AS "oldValue", new_value AS "newValue", justification
      FROM audit_logs WHERE organization_id = ${tenantOf(req)} ORDER BY timestamp DESC LIMIT ${limit};
    `;
    return res.json(rows);
  });

  /**
   * Écriture d'une entrée d'audit.
   * L'identité de l'auteur (nom, rôle, organisation) est TOUJOURS dérivée de la
   * session : le client ne peut pas signer une modification au nom d'un tiers.
   */
  router.post('/audit-logs', requireSession, require('audit:write'), async (req: Request, res: Response) => {
    const missingDb = notConfigured(res);
    if (missingDb) return missingDb;
    const ctx = ctxOf(req);
    const l = req.body ?? {};

    const rows = await deps.sql`
      INSERT INTO audit_logs (
        organization_id, timestamp, user_id, user_name, user_role, project_id,
        entity_name, field_changed, old_value, new_value, justification
      ) VALUES (
        ${ctx.organization.id}, ${l.timestamp ? new Date(l.timestamp) : new Date()}, ${ctx.user.id},
        ${ctx.user.fullName}, ${ctx.user.role},
        ${isUuid(l.projectId) ? l.projectId : null},
        ${str(l.entityName, 255) || 'Projet'}, ${str(l.fieldChanged, 255) || 'Modification'},
        ${str(l.oldValue, 2000) || 'n/a'}, ${str(l.newValue, 2000) || 'n/a'},
        ${str(l.justification, 2000) || 'Mise à jour via interface TrueTCO'}
      )
      RETURNING id, timestamp;
    `;
    return res.json({ success: true, log: rows[0] });
  });

  // ---------------------------------------------------------------------------
  // Connecteurs ERP
  // ---------------------------------------------------------------------------
  /**
   * Ces routes ne sont PAS des intégrations réelles : aucun connecteur SAP
   * Ariba / Coupa / Ivalua n'est implémenté dans ce dépôt. Par défaut elles
   * répondent 501. Si TRUETCO_ENABLE_SYNTHETIC_CONNECTORS=true (démonstration
   * uniquement), elles renvoient des données SYNTHÉTIQUES explicitement
   * étiquetées `synthetic: true`, jamais persistées comme des offres réelles.
   */
  router.post('/erp/connectors/:id/test', requireSession, require('erp:sync'), (req: Request, res: Response) => {
    if (!deps.enableSyntheticConnectors) {
      return res.status(501).json({
        error:
          "Connecteur ERP non implémenté : aucune passerelle SAP Ariba / Coupa / Ivalua n'est branchée sur cette instance.",
        code: 'CONNECTOR_NOT_IMPLEMENTED',
      });
    }
    return res.json({
      success: true,
      synthetic: true,
      connectorId: str(req.params.id, 64),
      message:
        "Simulation de démonstration : aucune connexion réseau n'a été établie et aucun échange d'authentification n'a eu lieu.",
      handshakeResponse: { status: 'SIMULATED', server_timestamp: new Date().toISOString() },
    });
  });

  router.post('/erp/connectors/:id/sync-inbound', requireSession, require('erp:sync'), (req: Request, res: Response) => {
    if (!deps.enableSyntheticConnectors) {
      return res.status(501).json({
        error: "Import ERP non implémenté : aucune offre n'a été récupérée.",
        code: 'CONNECTOR_NOT_IMPLEMENTED',
      });
    }
    return res.json({
      success: true,
      synthetic: true,
      offersImported: 0,
      offers: [],
      message:
        "Aucune donnée fournisseur réelle n'est disponible. En mode démonstration, l'interface génère un jeu d'exemple local ; il ne doit jamais être confronté à une décision d'achat.",
    });
  });

  router.post('/erp/connectors/:id/push-award', requireSession, require('erp:sync'), (req: Request, res: Response) => {
    if (!deps.enableSyntheticConnectors) {
      return res.status(501).json({
        error: "Émission de bon de commande non implémentée : aucun PO n'a été créé dans un ERP.",
        code: 'CONNECTOR_NOT_IMPLEMENTED',
      });
    }
    return res.status(501).json({
      error: "L'émission d'un bon de commande réel n'est pas implémentée.",
      code: 'NOT_IMPLEMENTED',
    });
  });

  // ---------------------------------------------------------------------------
  // Parser documentaire IA
  // ---------------------------------------------------------------------------
  router.post(
    '/ai/parse-document',
    requireSession,
    require('ai:parse'),
    rateLimit({ windowMs: 60_000, max: 20, name: 'ai-parse' }),
    async (req: Request, res: Response) => {
      const text = str(req.body?.text, 20000);
      const filename = str(req.body?.filename, 255) || 'document.pdf';
      const category = str(req.body?.category, 50) || 'devis_fournisseur';

      if (!text || text.trim().length < 20) {
        return res.status(400).json({
          error: 'Texte du document requis (minimum 20 caractères).',
          code: 'INVALID_DOCUMENT',
        });
      }

      if (!deps.geminiApiKey) {
        /**
         * AUCUN repli heuristique n'est appliqué : l'absence de moteur
         * d'extraction ne doit jamais produire de montants inventés. Une
         * extraction assistée par IA non disponible renvoie un état explicite
         * qui oblige une saisie ou une validation humaine.
         */
        return res.status(503).json({
          error:
            "Extraction assistée par IA non configurée (clé API absente). Aucune donnée n'a été extraite : saisir l'offre manuellement ou configurer le service d'extraction.",
          code: 'AI_NOT_CONFIGURED',
          requiresHumanInput: true,
        });
      }

      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({ apiKey: deps.geminiApiKey });

      const prompt = buildExtractionPrompt(filename, category, text);

      const aiResponse = await ai.models.generateContent({
        model: process.env.TRUETCO_AI_MODEL || 'gemini-2.5-flash',
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0 },
      });

      const responseText = aiResponse.text;
      if (!responseText) {
        return res.status(502).json({
          error: "Le service d'extraction n'a renvoyé aucun contenu exploitable.",
          code: 'AI_EMPTY_RESPONSE',
          requiresHumanInput: true,
        });
      }

      let parsed: any;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        return res.status(502).json({
          error: "Réponse d'extraction illisible (JSON invalide).",
          code: 'AI_INVALID_JSON',
          requiresHumanInput: true,
        });
      }

      /**
       * Traçabilité : la provenance est explicite, les montants restent
       * « proposés » et non « validés ». `requiresHumanValidation` conditionne
       * l'affichage côté client.
       */
      return res.json({
        success: true,
        source: { kind: 'ai_extraction', provider: 'google_genai', model: process.env.TRUETCO_AI_MODEL || 'gemini-2.5-flash' },
        synthetic: false,
        requiresHumanValidation: true,
        extraction: parsed,
      });
    }
  );

  router.use(errorHandler(deps.isProd));
  return router;
}

function buildExtractionPrompt(filename: string, category: string, text: string): string {
  return `Tu es un moteur d'extraction de données achats. Tu extrais UNIQUEMENT ce qui figure dans le document fourni.
RÈGLES ABSOLUES :
- N'invente JAMAIS un fournisseur, un prix, une quantité ou un facteur d'émission.
- Si une information est absente, mets null et ajoute-la à "missingFields".
- Pour chaque montant extrait, indique la phrase source exacte dans "evidence".
- N'utilise des connaissances externes que si tu les cites explicitement dans "assumptions" avec leur source.

Document : "${filename}" (catégorie : "${category}")

Réponds en JSON strict :
{
  "supplier": { "name": string|null, "legalId": string|null, "country": string|null },
  "offerReference": string|null,
  "currency": string|null,
  "quantity": number|null,
  "unitName": string|null,
  "apparentUnitPrice": number|null,
  "apparentTotal": number|null,
  "deliveryLeadTimeWeeks": number|null,
  "warrantyMonths": number|null,
  "expectedLifespanYears": number|null,
  "costItems": [{ "category": string, "label": string, "amount": number, "unit": string, "isRecurringYearly": boolean, "evidence": string }],
  "carbonItems": [{ "scope": string, "lifecyclePhase": string, "emissionsPerUnit": number|null, "emissionsTotal": number|null, "factorSource": string|null, "evidence": string }],
  "riskItems": [{ "label": string, "probability": number|null, "financialImpact": number|null, "evidence": string }],
  "missingFields": string[],
  "assumptions": [{ "statement": string, "source": string }]
}

CONTENU DU DOCUMENT :
"""
${text}
"""`;
}

async function safeAudit(
  sql: any,
  entry: {
    organizationId: string;
    userId?: string | null;
    userName: string;
    userRole: string;
    entityName: string;
    fieldChanged: string;
    oldValue: string;
    newValue: string;
    justification: string;
  }
): Promise<void> {
  if (!sql) return;
  try {
    await sql`
      INSERT INTO audit_logs (
        organization_id, user_id, user_name, user_role, entity_name, field_changed, old_value, new_value, justification
      ) VALUES (
        ${entry.organizationId}, ${entry.userId ?? null}, ${entry.userName}, ${entry.userRole},
        ${entry.entityName}, ${entry.fieldChanged}, ${entry.oldValue}, ${entry.newValue}, ${entry.justification}
      );
    `;
  } catch (err) {
    console.warn('[TrueTCO] Journalisation d’audit impossible :', (err as Error)?.message);
  }
}
