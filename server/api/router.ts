/**
 * TrueTCO — API sécurisée (Phase 1 : fondation)
 * ---------------------------------------------------------------------------
 * Principes non négociables appliqués à CHAQUE route :
 *  1. L'organisation et le rôle viennent de la session serveur (jamais d'un
 *     en-tête, d'un paramètre ou du corps de la requête).
 *  2. Chaque route métier déclare la permission RBAC requise.
 *  3. Chaque écriture passe par une transaction : la donnée ET sa trace
 *     d'audit, ou rien.
 *  4. Toute erreur renvoyée porte un `code` stable ; aucune trace technique
 *     n'est exposée hors développement.
 *  5. Les routes non implémentées répondent 501 avec la raison exacte : jamais
 *     une réponse vide qui laisserait croire à un résultat.
 */

import express, { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { Db } from '../db/types';
import { AuthContext, ROLE_PERMISSIONS, USER_ROLES, UserRole, canManageTeam } from '../auth/types';
import {
  ctxOf,
  generateToken,
  requirePermission,
  requireSameOrigin,
  requireSession,
  resolveSession,
  serializeSessionCookie,
  clearSessionCookie,
  extractSessionToken,
  hashToken,
  sessionExpiry,
} from '../auth/session';
import {
  acceptInvitation,
  inviteUser,
  issueSession,
  listSessions,
  listTeam,
  loginWithDemoIdentity,
  logout,
  registerOrganization,
  revokeSession,
  suspendUser,
  updateUserRole,
} from '../auth/service';
import {
  PROJECT_STATUSES,
  changeProjectStatus,
  createProject,
  getProject,
  listProjects,
  updateProject,
} from '../repositories/projects';
import { createSupplier, listSuppliers } from '../repositories/suppliers';
import { COST_CATEGORIES, createOffer, deleteOffer, getOffer, listOffers, normalizeCostCategoryInput } from '../repositories/offers';
import { listAuditLogs } from '../repositories/auditLogs';
import { verifyAuditChain } from '../audit';
import { checkRunFreshness, listDecisionRuns, replayDecisionRun, runDecision } from '../services/decision';
import {
  commitImportBatch,
  getImportBatch,
  listImportBatches,
  maxImportBytes,
  updateImportMapping,
  uploadImport,
} from '../services/imports';
import { isPlainObject } from '../http';
import { asyncHandler, badRequest, forbidden, notFound, parsePagination, requireCurrency, requireEmail, requireEnum, requireNumber, requireString, requireUuid, optionalString, optionalNumber, HttpError } from '../http';

export interface ApiDependencies {
  db: Db;
  isProd: boolean;
  /** Mode démonstration locale (jamais actif si isProd). */
  allowDemoAuth: boolean;
  /** Origines autorisées pour les requêtes authentifiées par cookie. */
  allowedOrigins: string[];
  /** Identifiant des versions de calcul, exposé en lecture seule. */
  engineVersion: string;
  methodologyVersion: string;
}

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip ?? null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? (req.headers['user-agent'] as string).slice(0, 400) : null,
    correlationId: req.correlationId ?? null,
  };
}

/** Bloc `auth` exposé au front : identité + permissions effectives serveur. */
function publicAuthContext(ctx: AuthContext) {
  return {
    authenticated: true,
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      fullName: ctx.user.fullName,
      role: ctx.user.role,
      department: ctx.user.department,
    },
    organization: {
      id: ctx.organization.id,
      name: ctx.organization.name,
      slug: ctx.organization.slug,
      defaultCurrency: ctx.organization.defaultCurrency,
      countryCode: ctx.organization.countryCode,
      dataResidency: ctx.organization.dataResidency,
    },
    session: {
      id: ctx.session.id,
      expiresAt: ctx.session.expiresAt,
      isDemo: ctx.session.isDemo,
    },
    permissions: ctx.permissions,
  };
}

export function createApiRouter(deps: ApiDependencies): Router {
  const router = express.Router();
  const { db, isProd } = deps;
  const allowedOrigins = () => deps.allowedOrigins;

  router.use(requireSameOrigin(allowedOrigins));

  // ---------------------------------------------------------------------------
  // Santé
  // ---------------------------------------------------------------------------
  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const status = await db.status();
      res.json({
        status: status.connected ? 'ok' : 'degraded',
        database: {
          connected: status.connected,
          driver: status.driver,
          version: status.databaseVersion,
          appRoleAssumed: status.appRoleAssumed,
        },
        versions: { engine: deps.engineVersion, methodology: deps.methodologyVersion },
      });
    })
  );

  // ---------------------------------------------------------------------------
  // Authentification
  // ---------------------------------------------------------------------------
  router.post(
    '/auth/register',
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const organizationName = requireString(body.organizationName, 'organizationName', { min: 2, max: 255 });
      const slug = requireString(body.slug, 'slug', { min: 2, max: 60 }).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
        throw badRequest('INVALID_SLUG', 'Le slug doit contenir uniquement des lettres minuscules, chiffres et tirets.');
      }
      const domain = requireString(body.domain, 'domain', { min: 4, max: 255 }).toLowerCase();
      const adminEmail = requireEmail(body.adminEmail, 'adminEmail');
      const adminFullName = requireString(body.adminFullName, 'adminFullName', { min: 2, max: 255 });
      if (!adminEmail.endsWith(`@${domain}`) && !adminEmail.endsWith(`.${domain}`)) {
        throw badRequest(
          'EMAIL_DOMAIN_MISMATCH',
          "L'adresse de l'administrateur doit appartenir au domaine déclaré pour l'organisation."
        );
      }

      const created = await registerOrganization(
        db,
        { organizationName, slug, domain, adminEmail, adminFullName },
        requestMeta(req)
      );
      res.status(201).json({
        organizationId: created.organizationId,
        userId: created.userId,
        next: "La connexion s'effectue ensuite via le fournisseur d'identité configuré (TRUETCO_AUTH_MODE).",
      });
    })
  );

  /**
   * Connexion. En production, l'authentification est déléguée au fournisseur
   * d'identité (OIDC/SAML) : cette route est alors désactivée et le front est
   * redirigé. Le mode `demo_local` n'existe que si l'exploitant l'a activé
   * explicitement sur un environnement de recette.
   */
  router.post(
    '/auth/sso/login',
    asyncHandler(async (req, res) => {
      if (!deps.allowDemoAuth) {
        throw new HttpError(
          501,
          'AUTH_PROVIDER_NOT_CONFIGURED',
          "Aucun fournisseur d'identité (OIDC/SAML) n'est configuré sur cette instance : " +
            "la connexion est indisponible. Cette route ne délivre jamais de session sans fournisseur d'identité réel."
        );
      }
      const body = req.body ?? {};
      const email = requireEmail(body.email, 'email');
      const domain = optionalString(body.domain, 'domain', 255);
      const session = await loginWithDemoIdentity(db, { email, domain: domain ? domain.toLowerCase() : null }, requestMeta(req));

      res.setHeader('Set-Cookie', serializeSessionCookie(session.token, session.expiresAt, isProd));
      res.json({
        ok: true,
        authMethod: 'demo_local',
        isDemo: true,
        warning:
          "Session de démonstration : aucun mot de passe, aucun second facteur et aucune fédération d'identité. " +
          'Ne jamais exposer cet environnement à des données clients réelles.',
        expiresAt: session.expiresAt.toISOString(),
      });
    })
  );

  router.post(
    '/auth/logout',
    asyncHandler(async (req, res) => {
      // La déconnexion ne dépend d'aucun middleware : le jeton est lu
      // directement, sinon une session révoquée ne le serait jamais.
      const token = req.sessionToken ?? extractSessionToken(req);
      if (token) {
        const ctx = await resolveSession(db, token);
        if (ctx) await logout(db, ctx, requestMeta(req));
      }
      res.setHeader('Set-Cookie', clearSessionCookie(isProd));
      res.status(204).end();
    })
  );

  router.get(
    '/auth/me',
    requireSession({ db }),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      res.json(publicAuthContext(ctx));
    })
  );

  /** Alias attendu par le front existant : renvoie l'identité SERVEUR, sans écriture. */
  router.post(
    '/users/sync',
    requireSession({ db }),
    asyncHandler(async (req, res) => {
      res.json({
        ...publicAuthContext(ctxOf(req)),
        note: "L'utilisateur est celui de la session serveur : aucune donnée d'identité envoyée par le client n'est enregistrée.",
      });
    })
  );

  router.get(
    '/auth/users',
    requireSession({ db }),
    requirePermission('user:read'),
    asyncHandler(async (req, res) => {
      const team = await listTeam(db, ctxOf(req));
      res.json({ users: team.users, invitations: team.invitations, roles: USER_ROLES, rolePermissions: ROLE_PERMISSIONS });
    })
  );

  router.patch(
    '/auth/users/:userId/role',
    requireSession({ db }),
    requirePermission('user:write'),
    asyncHandler(async (req, res) => {
      const role = requireEnum<UserRole>(req.body?.role, 'role', USER_ROLES);
      const result = await updateUserRole(db, ctxOf(req), requireUuid(req.params.userId, 'userId'), role, requestMeta(req));
      res.json(result);
    })
  );

  router.post(
    '/auth/users/:userId/suspend',
    requireSession({ db }),
    requirePermission('user:write'),
    asyncHandler(async (req, res) => {
      await suspendUser(db, ctxOf(req), requireUuid(req.params.userId, 'userId'), requestMeta(req));
      res.status(204).end();
    })
  );

  router.post(
    '/auth/invitations',
    requireSession({ db }),
    requirePermission('user:write'),
    asyncHandler(async (req, res) => {
      const result = await inviteUser(
        db,
        ctxOf(req),
        {
          email: requireEmail(req.body?.email, 'email'),
          role: requireEnum<UserRole>(req.body?.role, 'role', USER_ROLES),
          fullName: optionalString(req.body?.fullName, 'fullName', 255),
          department: optionalString(req.body?.department, 'department', 100),
        },
        requestMeta(req)
      );
      res.status(201).json({
        invitationId: result.invitationId,
        expiresAt: result.expiresAt,
        invitationLink: `/invitation?token=${encodeURIComponent(result.token)}`,
        emailSent: false,
        note: result.reason,
      });
    })
  );

  router.post(
    '/auth/invitations/accept',
    asyncHandler(async (req, res) => {
      const token = requireString(req.body?.token, 'token', { min: 20, max: 512 });
      const fullName = requireString(req.body?.fullName, 'fullName', { min: 2, max: 255 });
      const accepted = await acceptInvitation(db, { token, fullName }, requestMeta(req));
      res.status(201).json({ organizationId: accepted.organizationId, userId: accepted.userId, email: accepted.email });
    })
  );

  router.get(
    '/auth/sessions',
    requireSession({ db }),
    asyncHandler(async (req, res) => {
      res.json({ items: await listSessions(db, ctxOf(req)) });
    })
  );

  router.delete(
    '/auth/sessions/:sessionId',
    requireSession({ db }),
    asyncHandler(async (req, res) => {
      await revokeSession(db, ctxOf(req), requireUuid(req.params.sessionId, 'sessionId'), requestMeta(req));
      res.status(204).end();
    })
  );

  // ---------------------------------------------------------------------------
  // Organisation
  // ---------------------------------------------------------------------------
  router.get(
    '/organization',
    requireSession({ db }),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const rows = await db.asOrganization(ctx.organization.id, (tx) =>
        tx.query<any>(
          `SELECT id, name, slug, domain, country_code, default_currency, data_residency,
                  subscription_plan, subscription_status, created_at, updated_at
             FROM organizations WHERE id = $1`,
          [ctx.organization.id]
        )
      );
      if (rows.length === 0) throw notFound('Organisation introuvable.');
      res.json({ organization: rows[0], permissions: ctx.permissions });
    })
  );

  // ---------------------------------------------------------------------------
  // Dossiers (projets)
  // ---------------------------------------------------------------------------
  router.get(
    '/projects',
    requireSession({ db }),
    requirePermission('project:read'),
    asyncHandler(async (req, res) => {
      const page = parsePagination(req.query);
      const result = await listProjects(db, ctxOf(req), page);
      res.json({ items: result.items, total: result.total, limit: page.limit, offset: page.offset });
    })
  );

  router.post(
    '/projects',
    requireSession({ db }),
    requirePermission('project:write'),
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const project = await createProject(
        db,
        ctxOf(req),
        {
          reference: requireString(body.reference, 'reference', { min: 2, max: 100 }),
          name: requireString(body.name, 'name', { min: 2, max: 255 }),
          description: optionalString(body.description, 'description', 4000),
          category: requireString(body.category, 'category', { min: 2, max: 100 }),
          currency: requireCurrency(body.currency ?? 'EUR'),
          countryCode: optionalString(body.countryCode, 'countryCode', 2),
        },
        requestMeta(req)
      );
      res.status(201).json(project);
    })
  );

  router.get(
    '/projects/:projectId',
    requireSession({ db }),
    requirePermission('project:read'),
    asyncHandler(async (req, res) => {
      const project = await getProject(db, ctxOf(req), requireUuid(req.params.projectId, 'projectId'));
      if (!project) throw notFound("Ce dossier est introuvable dans votre organisation.");
      res.json(project);
    })
  );

  router.patch(
    '/projects/:projectId',
    requireSession({ db }),
    requirePermission('project:write'),
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const project = await updateProject(
        db,
        ctxOf(req),
        requireUuid(req.params.projectId, 'projectId'),
        {
          name: optionalString(body.name, 'name', 255) ?? undefined,
          description: optionalString(body.description, 'description', 4000) ?? undefined,
          category: optionalString(body.category, 'category', 100) ?? undefined,
          currency: body.currency ? requireCurrency(body.currency) : undefined,
          country_code: optionalString(body.countryCode, 'countryCode', 2) ?? undefined,
        },
        requestMeta(req)
      );
      if (!project) throw notFound("Ce dossier est introuvable dans votre organisation.");
      res.json(project);
    })
  );

  router.post(
    '/projects/:projectId/status',
    requireSession({ db }),
    // Deux permissions distinctes selon la cible : faire avancer un dossier
    // relève de la saisie (project:write), le verrouiller relève de
    // l'approbation (project:lock). Un approbateur n'a pas à pouvoir modifier
    // les données pour autant.
    (req, res, next) => {
      const target = (req.body ?? {}).status;
      if (target === 'locked') return requirePermission('project:lock')(req, res, next);
      return requirePermission('project:write')(req, res, next);
    },
    asyncHandler(async (req, res) => {
      const target = requireEnum(req.body?.status, 'status', PROJECT_STATUSES);
      const justification = requireString(req.body?.justification, 'justification', { min: 10, max: 2000 });
      const project = await changeProjectStatus(
        db,
        ctxOf(req),
        requireUuid(req.params.projectId, 'projectId'),
        target,
        justification,
        requestMeta(req)
      );
      if (!project) throw notFound("Ce dossier est introuvable dans votre organisation.");
      res.json(project);
    })
  );

  // ---------------------------------------------------------------------------
  // Fournisseurs
  // ---------------------------------------------------------------------------
  router.get(
    '/suppliers',
    requireSession({ db }),
    requirePermission('supplier:read'),
    asyncHandler(async (req, res) => {
      const page = parsePagination(req.query);
      const result = await listSuppliers(db, ctxOf(req), page);
      res.json({ items: result.items, total: result.total, limit: page.limit, offset: page.offset });
    })
  );

  router.post(
    '/suppliers',
    requireSession({ db }),
    requirePermission('supplier:write'),
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      const supplier = await createSupplier(
        db,
        ctxOf(req),
        {
          name: requireString(body.name, 'name', { min: 2, max: 255 }),
          legalName: optionalString(body.legalName, 'legalName', 255),
          countryCode: optionalString(body.countryCode, 'countryCode', 2),
          contactEmail: body.contactEmail ? requireEmail(body.contactEmail, 'contactEmail') : null,
          incoterm: optionalString(body.incoterm, 'incoterm', 20),
          paymentTermsDays: optionalNumber(body.paymentTermsDays, 'paymentTermsDays', { min: 0, max: 365, integer: true }),
          warrantyMonths: optionalNumber(body.warrantyMonths, 'warrantyMonths', { min: 0, max: 600, integer: true }),
          esgRating: optionalString(body.esgRating, 'esgRating', 50),
        },
        requestMeta(req)
      );
      res.status(201).json(supplier);
    })
  );

  // ---------------------------------------------------------------------------
  // Offres et postes de coût
  // ---------------------------------------------------------------------------
  router.get(
    '/offers',
    requireSession({ db }),
    requirePermission('offer:read'),
    asyncHandler(async (req, res) => {
      const page = parsePagination(req.query);
      const projectId = req.query.projectId ? requireUuid(req.query.projectId, 'projectId') : null;
      const result = await listOffers(db, ctxOf(req), page, { projectId });
      res.json({ items: result.items, total: result.total, limit: page.limit, offset: page.offset });
    })
  );

  router.get(
    '/offers/:offerId',
    requireSession({ db }),
    requirePermission('offer:read'),
    asyncHandler(async (req, res) => {
      const offer = await getOffer(db, ctxOf(req), requireUuid(req.params.offerId, 'offerId'));
      if (!offer) throw notFound('Offre introuvable.');
      res.json(offer);
    })
  );

  router.post(
    '/offers',
    requireSession({ db }),
    requirePermission('offer:write'),
    asyncHandler(async (req, res) => {
      const body = req.body ?? {};
      if (!Array.isArray(body.costItems) || body.costItems.length === 0) {
        throw badRequest(
          'COST_ITEMS_REQUIRED',
          "Une offre doit être créée avec au moins un poste de coût : sans poste de coût, aucun TCO ne peut être calculé."
        );
      }
      if (body.costItems.length > 2000) {
        throw badRequest('TOO_MANY_COST_ITEMS', 'Une offre ne peut pas dépasser 2 000 postes de coût en une seule requête.');
      }

      const costItems = body.costItems.map((raw: any, index: number) => {
        const item = raw ?? {};
        const label = requireString(item.label, `costItems[${index}].label`, { min: 2, max: 255 });
        const declared = requireString(item.category, `costItems[${index}].category`, { min: 2, max: 100 });
        const normalized = normalizeCostCategoryInput(declared);
        if (!normalized) {
          throw badRequest(
            'INVALID_COST_CATEGORY',
            `Catégorie de coût inconnue « ${declared} » (poste « ${label} »). Catégories autorisées : ${COST_CATEGORIES.join(', ')}. ` +
              'Les libellés usuels sont acceptés ; toute autre valeur doit être rapprochée explicitement.'
          );
        }
        return {
          category: normalized.category,
          label,
          amount: requireNumber(item.amount, `costItems[${index}].amount`, { min: -1_000_000_000, max: 1_000_000_000 }),
          currency: item.currency ? requireCurrency(item.currency, `costItems[${index}].currency`) : undefined,
          unit: optionalString(item.unit, `costItems[${index}].unit`, 50) ?? undefined,
          quantity: optionalNumber(item.quantity, `costItems[${index}].quantity`),
          unitPrice: optionalNumber(item.unitPrice, `costItems[${index}].unitPrice`),
          qualityStatus: item.qualityStatus,
          sourceName: optionalString(item.sourceName, `costItems[${index}].sourceName`, 255),
          sourceType: optionalString(item.sourceType, `costItems[${index}].sourceType`, 50) ?? undefined,
          confidenceLevel: optionalNumber(item.confidenceLevel, `costItems[${index}].confidenceLevel`, { min: 0, max: 100, integer: true }) ?? undefined,
          isRecurringYearly: Boolean(item.isRecurringYearly),
          yearlyInflationType: item.yearlyInflationType ?? null,
          yearOccurrences: Array.isArray(item.yearOccurrences) ? item.yearOccurrences : null,
          declaredCategory: declared,
          calculationFormula: optionalString(item.calculationFormula, `costItems[${index}].calculationFormula`, 1000),
          explanationNotes: optionalString(item.explanationNotes, `costItems[${index}].explanationNotes`, 2000),
          isDemo: Boolean(item.isDemo),
        };
      });

      const offer = await createOffer(
        db,
        ctxOf(req),
        {
          projectId: requireUuid(body.projectId, 'projectId'),
          supplierId: body.supplierId ? requireUuid(body.supplierId, 'supplierId') : null,
          supplierName: requireString(body.supplierName, 'supplierName', { min: 2, max: 255 }),
          offerReference: requireString(body.offerReference, 'offerReference', { min: 1, max: 100 }),
          apparentTotal: requireNumber(body.apparentTotal, 'apparentTotal', { min: 0, max: 1_000_000_000 }),
          quantity: optionalNumber(body.quantity, 'quantity', { min: 1, max: 1_000_000, integer: true }) ?? undefined,
          currency: body.currency ? requireCurrency(body.currency) : undefined,
          deliveryLeadTimeWeeks: optionalNumber(body.deliveryLeadTimeWeeks, 'deliveryLeadTimeWeeks', { min: 0, max: 520, integer: true }) ?? undefined,
          warrantyMonths: optionalNumber(body.warrantyMonths, 'warrantyMonths', { min: 0, max: 600, integer: true }) ?? undefined,
          expectedLifespanYears: optionalNumber(body.expectedLifespanYears, 'expectedLifespanYears', { min: 0, max: 100, integer: true }) ?? undefined,
          technicalSuitabilityScore: optionalNumber(body.technicalSuitabilityScore, 'technicalSuitabilityScore', { min: 0, max: 100, integer: true }),
          isResponsibleCandidate: Boolean(body.isResponsibleCandidate),
          dataSource: body.dataSource ?? 'manual',
          isDemo: Boolean(body.isDemo),
          costItems,
        },
        requestMeta(req)
      );
      res.status(201).json(offer);
    })
  );

  router.delete(
    '/offers/:offerId',
    requireSession({ db }),
    requirePermission('offer:write'),
    asyncHandler(async (req, res) => {
      await deleteOffer(db, ctxOf(req), requireUuid(req.params.offerId, 'offerId'), requestMeta(req));
      res.status(204).end();
    })
  );

  // ---------------------------------------------------------------------------
  // Décision : exécution du moteur côté serveur (Phase 1, clôture)
  // ---------------------------------------------------------------------------
  /**
   * Lance l'analyse décisionnelle du dossier : TCO/LCC de chaque offre,
   * classement, recommandation, point mort, sensibilité et inversion de décision.
   * Le calcul est exécuté par le serveur et enregistré (reproductibilité).
   */
  router.post(
    '/projects/:projectId/decision-runs',
    requireSession({ db }),
    requirePermission('decision:run'),
    asyncHandler(async (req, res) => {
      const result = await runDecision(db, requireUuid(req.params.projectId, 'projectId'), {
        ctx: ctxOf(req),
        meta: requestMeta(req),
        trigger: 'manuel',
      });
      res.status(201).json(result);
    })
  );

  router.get(
    '/projects/:projectId/decision-runs',
    requireSession({ db }),
    requirePermission('decision:read'),
    asyncHandler(async (req, res) => {
      const page = parsePagination(req.query);
      const result = await listDecisionRuns(db, ctxOf(req), requireUuid(req.params.projectId, 'projectId'), page);
      res.json({ items: result.items, total: result.total, limit: page.limit, offset: page.offset });
    })
  );

  /**
   * Rejeu d'une exécution passée à partir du snapshot d'entrées enregistré :
   * vérifie que le résultat est exactement reproductible. Un écart est signalé.
   */
  router.post(
    '/decision-runs/:runId/replay',
    requireSession({ db }),
    requirePermission('decision:run'),
    asyncHandler(async (req, res) => {
      const result = await replayDecisionRun(db, ctxOf(req), requireUuid(req.params.runId, 'runId'));
      res.json(result);
    })
  );

  router.get(
    '/decision-runs/:runId',
    requireSession({ db }),
    requirePermission('decision:read'),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const rows = await db.asOrganization(ctx.organization.id, (tx) =>
        tx.query<any>(
          `SELECT id, project_id, engine_version, methodology_version, input_version, assumptions,
                  factor_versions, results, recommended_offer_id, input_fingerprint, created_at
             FROM decision_runs WHERE id = $1`,
          [requireUuid(req.params.runId, 'runId')]
        )
      );
      if (rows.length === 0) throw notFound('Exécution de décision introuvable.');
      // Le client doit savoir si le dossier a évolué depuis cette décision :
      // sans cette information, une décision ancienne paraîtrait à jour.
      const freshness = await checkRunFreshness(db, ctx, rows[0].id);
      res.json({ ...rows[0], freshness });
    })
  );

  // ---------------------------------------------------------------------------
  // Journal d'audit (lecture seule côté client)
  // ---------------------------------------------------------------------------
  router.get(
    '/audit-logs',
    requireSession({ db }),
    requirePermission('audit:read'),
    asyncHandler(async (req, res) => {
      const page = parsePagination(req.query, 100, 500);
      const result = await listAuditLogs(db, ctxOf(req), page, {
        projectId: req.query.projectId ? requireUuid(req.query.projectId, 'projectId') : null,
        action: optionalString(req.query.action, 'action', 100),
        entityType: optionalString(req.query.entityType, 'entityType', 100),
      });
      res.json({ items: result.items, total: result.total, limit: page.limit, offset: page.offset });
    })
  );

  /**
   * Écriture d'une entrée d'audit par le client : REFUSÉE par conception.
   * Un journal que le client peut écrire ne prouve rien. Toute entrée est
   * produite par le serveur, à partir de la session authentifiée.
   */
  router.post(
    '/audit-logs',
    requireSession({ db }),
    (_req, res) => {
      res.status(403).json({
        error:
          "Le journal d'audit est en écriture serveur uniquement : une entrée fournie par le client serait dépourvue de valeur probante. " +
          "Les actions sont journalisées automatiquement par le serveur avec l'identité de la session.",
        code: 'AUDIT_SERVER_WRITTEN_ONLY',
      });
    }
  );

  router.get(
    '/audit-logs/integrity',
    requireSession({ db }),
    requirePermission('audit:read'),
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const status = await db.asOrganization(ctx.organization.id, (tx) => verifyAuditChain(tx, ctx.organization.id));
      res.json({
        ...status,
        method:
          'Chaîne de hachage SHA-256 : chaque entrée contient le hachage de la précédente. Une entrée modifiée ou supprimée casse la chaîne.',
      });
    })
  );

  // ---------------------------------------------------------------------------
  // Versions de calcul (reproductibilité)
  // ---------------------------------------------------------------------------
  router.get('/versions', (_req, res) => {
    res.json({
      engineVersion: deps.engineVersion,
      methodologyVersion: deps.methodologyVersion,
      note: "Ces versions sont enregistrées avec chaque exécution de décision (table decision_runs) : un dossier ancien reste rejouable avec les mêmes hypothèses.",
    });
  });

  // ---------------------------------------------------------------------------
  // Fonctionnalités non implémentées : réponse explicite, jamais simulée
  // ---------------------------------------------------------------------------
  const notImplemented = (feature: string, reason: string, code: string) => (_req: Request, res: Response) => {
    res.status(501).json({
      error: `${feature} n'est pas encore implémenté. ${reason}`,
      code,
      implemented: false,
    });
  };

  router.post(
    '/erp/connectors/:id/test',
    requireSession({ db }),
    requirePermission('erp:sync'),
    notImplemented(
      'Le test de connecteur ERP',
      "L'architecture Connector/Adapter/Queue/Idempotency est décrite mais aucun connecteur réel (SAP, Odoo, Sage…) n'est développé. Aucune réponse simulée ne sera renvoyée.",
      'ERP_CONNECTOR_NOT_IMPLEMENTED'
    )
  );
  router.post(
    '/erp/connectors/:id/sync-inbound',
    requireSession({ db }),
    requirePermission('erp:sync'),
    notImplemented('La synchronisation ERP entrante', "Aucun connecteur réel n'est développé.", 'ERP_SYNC_NOT_IMPLEMENTED')
  );
  router.post(
    '/erp/connectors/:id/push-award',
    requireSession({ db }),
    requirePermission('erp:sync'),
    notImplemented("L'attribution vers l'ERP", "Aucun connecteur réel n'est développé.", 'ERP_PUSH_NOT_IMPLEMENTED')
  );
  router.get(
    '/erp/connectors',
    requireSession({ db }),
    requirePermission('erp:sync'),
    notImplemented(
      "La liste des connecteurs ERP",
      "Aucun connecteur n'existe : afficher une liste donnerait l'illusion d'une intégration.",
      'ERP_CONNECTOR_NOT_IMPLEMENTED'
    )
  );

  router.post(
    '/ai/extract',
    requireSession({ db }),
    requirePermission('ai:extract'),
    notImplemented(
      "L'extraction IA de documents",
      "Aucun fournisseur de modèle n'est configuré et l'architecture de provenance (documentId/passage/modèle/confiance/validation humaine) n'est pas encore en place.",
      'AI_EXTRACTION_NOT_IMPLEMENTED'
    )
  );

  router.get(
    '/benchmarks',
    requireSession({ db }),
    requirePermission('decision:read'),
    notImplemented(
      'Le référentiel de benchmark TrueTCO',
      "Aucune donnée de marché n'a été collectée, anonymisée et consentie : un référentiel affiché sans données réelles serait une invention.",
      'BENCHMARK_NOT_IMPLEMENTED'
    )
  );

  // ---------------------------------------------------------------------------
  // Centre d'import (Phase 2) — XLSX / CSV
  // ---------------------------------------------------------------------------
  // Le fichier est reçu en mémoire, borné en taille, et son FORMAT RÉEL est
  // vérifié sur son contenu (signature ZIP + entrées OOXML pour XLSX) : le nom du
  // fichier et le type MIME annoncé par le navigateur ne sont jamais crus.
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxImportBytes(), files: 1, fields: 10 },
  });

  const uploadSingle = (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        next(
          new HttpError(
            413,
            'FILE_TOO_LARGE',
            `Le fichier dépasse la taille maximale acceptée (${Math.round(maxImportBytes() / 1024 / 1024)} Mo). Scindez-le en plusieurs fichiers.`
          )
        );
        return;
      }
      next(
        badRequest(
          'UPLOAD_FAILED',
          `Le fichier n'a pas pu être reçu : ${error instanceof Error ? error.message : 'erreur inconnue'}.`
        )
      );
    });
  };

  const parseImportMode = (value: unknown): 'costs' | 'carbon' | 'risks' => {
    const mode = typeof value === 'string' ? value.toLowerCase() : 'costs';
    if (mode === 'costs' || mode === 'carbon' || mode === 'risks') return mode;
    throw badRequest(
      'INVALID_IMPORT_MODE',
      `Mode d'import inconnu « ${String(value)} ». Valeurs acceptées : costs (postes de coût), carbon (émissions), risks (risques).`
    );
  };

  router.post(
    '/projects/:projectId/imports',
    requireSession({ db }),
    requirePermission('import:write'),
    uploadSingle,
    asyncHandler(async (req, res) => {
      const ctx = ctxOf(req);
      const file = (req as Request & { file?: { originalname: string; mimetype: string; buffer: Buffer } }).file;
      if (!file) {
        throw badRequest('FILE_REQUIRED', "Aucun fichier reçu : joignez un fichier XLSX ou CSV dans le champ « file ».");
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const allowDuplicateContent =
        body.allowDuplicateContent === true || body.allowDuplicateContent === 'true' || body.allowDuplicateContent === '1';

      const result = await uploadImport(
        db,
        ctx,
        {
          projectId: requireUuid(req.params.projectId, 'projectId'),
          fileName: file.originalname || 'fichier',
          mimeType: file.mimetype,
          content: file.buffer,
          mode: parseImportMode(body.mode),
          sheetName: optionalString(body.sheetName, 'sheetName', 255),
          allowDuplicateContent,
        },
        requestMeta(req)
      );
      res.status(201).json(result);
    })
  );

  router.get(
    '/projects/:projectId/imports',
    requireSession({ db }),
    requirePermission('import:read'),
    asyncHandler(async (req, res) => {
      const page = parsePagination(req.query);
      const result = await listImportBatches(db, ctxOf(req), requireUuid(req.params.projectId, 'projectId'), page);
      res.json({ items: result.items, total: result.total, limit: page.limit, offset: page.offset });
    })
  );

  router.get(
    '/imports/:batchId',
    requireSession({ db }),
    requirePermission('import:read'),
    asyncHandler(async (req, res) => {
      const page = parsePagination(req.query);
      const view = await getImportBatch(db, ctxOf(req), req.params.batchId);
      // Pagination des lignes : un fichier de 20 000 lignes ne doit pas être
      // renvoyé en entier à chaque affichage.
      const rows = view.rows.slice(page.offset, page.offset + page.limit);
      res.json({ ...view, rows, rowsTotal: view.rows.length, limit: page.limit, offset: page.offset });
    })
  );

  router.patch(
    '/imports/:batchId',
    requireSession({ db }),
    requirePermission('import:write'),
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const view = await updateImportMapping(
        db,
        ctxOf(req),
        req.params.batchId,
        {
          mapping: isPlainObject(body.mapping) ? (body.mapping as Record<string, string>) : undefined,
          excludedRows: Array.isArray(body.excludedRows) ? body.excludedRows.map((value) => Number(value)).filter((value) => Number.isInteger(value)) : undefined,
          categoryOverrides: isPlainObject(body.categoryOverrides) ? (body.categoryOverrides as Record<string, string>) : undefined,
          offerReferences: isPlainObject(body.offerReferences) ? (body.offerReferences as Record<string, string>) : undefined,
          sheetName: optionalString(body.sheetName, 'sheetName', 255),
          mode: body.mode === undefined ? undefined : parseImportMode(body.mode),
        },
        requestMeta(req)
      );
      res.json(view);
    })
  );

  router.post(
    '/imports/:batchId/commit',
    requireSession({ db }),
    requirePermission('import:write'),
    asyncHandler(async (req, res) => {
      const result = await commitImportBatch(db, ctxOf(req), req.params.batchId, requestMeta(req));
      res.status(201).json(result);
    })
  );

  return router;
}
