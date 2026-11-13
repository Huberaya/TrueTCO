import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createDisabledIntegrationRouter } from './src/server/safetyRoutes';
import { createFailClosedApiGate } from './src/server/apiGate';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isUuid = (str: any) =>
  typeof str === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Fail closed until real identity, RBAC and tenant isolation are in place.
app.use('/api', createFailClosedApiGate());

// Initialize Neon SQL client
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.warn('⚠️ DATABASE_URL is not set. Neon operations will fail until provided.');
}
const sql = dbUrl ? neon(dbUrl) : null;

async function resolveTenantId(req?: Request): Promise<string> {
  if (!sql) return 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  if (req) {
    // 1. Explicit Tenant Header
    const headerTenant = req.headers['x-tenant-id'] || req.headers['x-organization-id'];
    if (typeof headerTenant === 'string' && isUuid(headerTenant)) {
      return headerTenant;
    }

    const headerSlug = req.headers['x-tenant-slug'];
    if (typeof headerSlug === 'string') {
      try {
        const orgs = await sql`SELECT id FROM organizations WHERE slug = ${headerSlug} OR domain = ${headerSlug} LIMIT 1`;
        if (orgs && orgs.length > 0) return orgs[0].id;
      } catch {}
    }

    // 2. Query param
    const queryTenant = req.query?.tenantId;
    if (typeof queryTenant === 'string' && isUuid(queryTenant)) {
      return queryTenant;
    }

    // 3. Body parameter
    const bodyTenant = req.body?.organizationId || req.body?.tenantId;
    if (typeof bodyTenant === 'string' && isUuid(bodyTenant)) {
      return bodyTenant;
    }

    // 4. Session Bearer Token lookup
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '').trim();
      try {
        const session = await sql`
          SELECT organization_id FROM user_sessions WHERE token = ${token} AND expires_at > CURRENT_TIMESTAMP LIMIT 1
        `;
        if (session && session.length > 0) return session[0].organization_id;
      } catch {}
    }
  }

  // 5. Default fallback to first active organization
  try {
    const orgs = await sql`SELECT id FROM organizations WHERE is_active = true ORDER BY created_at ASC LIMIT 1`;
    if (orgs && orgs.length > 0) return orgs[0].id;
  } catch {}

  return 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
}

const getOrganizationId = resolveTenantId;

// -----------------------------------------------------------------------------
// API Endpoints
// -----------------------------------------------------------------------------

// 0. Multi-Tenant Workspaces & Isolation Endpoints
app.get('/api/tenants', async (_req: Request, res: Response) => {
  if (!sql) return res.json([]);
  try {
    const tenants = await sql`
      SELECT 
        o.id, o.name, o.slug, o.domain, o.subscription_tier as "subscriptionTier",
        o.data_residency as "dataResidency", o.country_code as "countryCode",
        o.default_currency as "defaultCurrency", o.legal_registration_number as "legalRegistrationNumber",
        COUNT(DISTINCT p.id) as "projectCount",
        COUNT(DISTINCT s.id) as "supplierCount",
        COUNT(DISTINCT u.id) as "userCount"
      FROM organizations o
      LEFT JOIN projects p ON p.organization_id = o.id
      LEFT JOIN suppliers s ON s.organization_id = o.id
      LEFT JOIN users u ON u.organization_id = o.id
      WHERE o.is_active = true
      GROUP BY o.id
      ORDER BY o.created_at ASC;
    `;
    return res.json(tenants);
  } catch (err: any) {
    console.error('Error fetching tenants:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/tenants/current', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });
  const tenantId = await resolveTenantId(req);
  try {
    const orgs = await sql`
      SELECT 
        o.id, o.name, o.slug, o.domain, o.subscription_tier as "subscriptionTier",
        o.data_residency as "dataResidency", o.country_code as "countryCode",
        o.default_currency as "defaultCurrency", o.legal_registration_number as "legalRegistrationNumber",
        COUNT(DISTINCT p.id) as "projectCount",
        COUNT(DISTINCT s.id) as "supplierCount",
        COUNT(DISTINCT u.id) as "userCount"
      FROM organizations o
      LEFT JOIN projects p ON p.organization_id = o.id
      LEFT JOIN suppliers s ON s.organization_id = o.id
      LEFT JOIN users u ON u.organization_id = o.id
      WHERE o.id = ${tenantId}
      GROUP BY o.id;
    `;
    if (!orgs || orgs.length === 0) return res.status(404).json({ error: 'Tenant non trouvé' });
    return res.json(orgs[0]);
  } catch (err: any) {
    console.error('Error fetching current tenant:', err);
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/tenants', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });
  const { name, domain, defaultCurrency = 'EUR', countryCode = 'FR', subscriptionTier = 'enterprise', legalRegistrationNumber } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom de l entreprise obligatoire' });

  const id = crypto.randomUUID();
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

  try {
    const rows = await sql`
      INSERT INTO organizations (
        id, name, slug, domain, subscription_tier, data_residency, country_code, default_currency, legal_registration_number, is_active
      ) VALUES (
        ${id}, ${name}, ${slug}, ${domain || slug + '.invalid'}, ${subscriptionTier}, 'Non vérifiée', ${countryCode}, ${defaultCurrency}, ${legalRegistrationNumber || null}, true
      )
      RETURNING *;
    `;
    return res.json({ success: true, tenant: rows[0] });
  } catch (err: any) {
    console.error('Error creating tenant:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Liveness only: do not expose database identity, connectivity or SQL errors.
app.get('/api/health', (_req: Request, res: Response) => {
  return res.json({ status: 'ok' });
});

// 2. Clerk User Synchronization -> Neon `users` table
app.post('/api/users/sync', async (req: Request, res: Response) => {
  if (!sql) {
    return res.status(503).json({ error: 'Neon database not connected' });
  }

  const { clerkId, email, fullName, role } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required for user synchronization' });
  }

  const orgId = await getOrganizationId();
  const userRole = role || 'acheteur';
  const name = fullName || email.split('@')[0];

  try {
    const rows = await sql`
      INSERT INTO users (organization_id, clerk_id, email, full_name, role)
      VALUES (${orgId}, ${clerkId || null}, ${email}, ${name}, ${userRole})
      ON CONFLICT (organization_id, email)
      DO UPDATE SET
        clerk_id = COALESCE(EXCLUDED.clerk_id, users.clerk_id),
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, organization_id, clerk_id, email, full_name, role, is_active, created_at;
    `;

    return res.json({
      success: true,
      user: rows[0],
      message: 'Utilisateur Clerk synchronisé avec succès dans Neon PostgreSQL',
    });
  } catch (err: any) {
    console.error('Error syncing user with Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 2b. Enterprise SSO Authentication Endpoints

// SSO is intentionally unavailable until a real identity provider is integrated.
app.post('/api/auth/sso/login', (_req: Request, res: Response) => {
  return res.status(503).json({
    success: false,
    error: 'Connexion indisponible : aucun fournisseur d’identité réel n’est configuré.',
  });
});

// Get current authenticated user profile
app.get('/api/auth/me', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de session manquant ou invalide' });
  }

  const token = authHeader.replace('Bearer ', '').trim();

  try {
    const sessions = await sql`
      SELECT s.token, s.expires_at, s.sso_provider, s.organization_id as "organizationId",
             u.id, u.email, u.full_name, u.role, u.department, u.is_active, u.last_login_at,
             o.name as "organizationName", o.slug as "organizationSlug", o.data_residency as "dataResidency",
             o.default_currency as "defaultCurrency", o.country_code as "countryCode"
      FROM user_sessions s
      JOIN users u ON s.user_id = u.id
      JOIN organizations o ON s.organization_id = o.id
      WHERE s.token = ${token} AND s.expires_at > CURRENT_TIMESTAMP
      LIMIT 1;
    `;

    if (!sessions || sessions.length === 0) {
      return res.status(401).json({ error: 'Session expirée ou invalide' });
    }

    const s = sessions[0];
    return res.json({
      authenticated: true,
      token: s.token,
      expiresAt: s.expires_at,
      organizationId: s.organizationId,
      organizationName: s.organizationName,
      organizationSlug: s.organizationSlug,
      dataResidency: s.dataResidency,
      user: {
        id: s.id,
        organizationId: s.organizationId,
        email: s.email,
        fullName: s.full_name,
        role: s.role,
        ssoProvider: s.sso_provider,
        department: s.department,
        isActive: s.is_active,
        lastLoginAt: s.last_login_at,
      },
    });
  } catch (err: any) {
    console.error('Error verifying auth/me:', err);
    return res.status(500).json({ error: err.message });
  }
});

// Logout current session
app.post('/api/auth/logout', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.replace('Bearer ', '').trim() : req.body?.token;

  if (token) {
    try {
      await sql`DELETE FROM user_sessions WHERE token = ${token};`;
    } catch (err) {
      console.warn('Error deleting user session:', err);
    }
  }

  return res.json({ success: true, message: 'Déconnexion SSO effectuée' });
});

// List enterprise directory users (Hermetically scoped to current tenant)
app.get('/api/auth/users', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });
  const tenantId = await resolveTenantId(req);

  try {
    const users = await sql`
      SELECT id, email, full_name as "fullName", role, sso_provider as "ssoProvider",
             department, is_active as "isActive", last_login_at as "lastLoginAt"
      FROM users
      WHERE organization_id = ${tenantId}
      ORDER BY full_name ASC;
    `;
    return res.json(users);
  } catch (err: any) {
    console.error('Error fetching enterprise users:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 3. Get projects from Neon (Hermetically scoped to current tenant)
app.get('/api/projects', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });
  const tenantId = await resolveTenantId(req);

  try {
    const projects = await sql`
      SELECT 
        id, reference, name, description, category, company_name as "companyName",
        budget_cap as "budgetCap", currency, planned_volume as "plannedVolume",
        unit_name as "unitName", horizon_years as "horizonYears", status,
        discount_rate as "discountRate", energy_inflation_rate as "energyInflationRate",
        general_inflation_rate as "inflationRate", carbon_price_per_tonne as "carbonPricePerTonne",
        created_at as "createdAt", updated_at as "updatedAt"
      FROM projects 
      WHERE organization_id = ${tenantId}
      ORDER BY created_at DESC;
    `;
    return res.json(projects);
  } catch (err: any) {
    console.error('Error fetching projects from Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 4. Create / Upsert Project in Neon (Hermetically scoped to current tenant)
app.post('/api/projects', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });

  const p = req.body;
  if (!p.reference || !p.name) {
    return res.status(400).json({ error: 'Champs obligatoires manquants (reference, name)' });
  }

  const orgId = await resolveTenantId(req);
  const projectId = isUuid(p.id) ? p.id : crypto.randomUUID();

  try {
    const rows = await sql`
      INSERT INTO projects (
        id, organization_id, reference, name, description, category,
        company_name, budget_cap, currency, planned_volume, unit_name,
        horizon_years, status, discount_rate, energy_inflation_rate,
        general_inflation_rate, carbon_price_per_tonne
      ) VALUES (
        ${projectId}, ${orgId}, ${p.reference}, ${p.name}, ${p.description || ''},
        ${p.category || 'flotte_automobile'}, ${p.companyName || 'Acme Group Europe'},
        ${Number(p.budgetCap) || 1000000}, ${p.currency || 'EUR'}, ${Number(p.plannedVolume) || 50},
        ${p.unitName || 'véhicules'}, ${Number(p.horizonYears) || 5}, ${p.status || 'brouillon'},
        ${Number(p.discountRate) || 0.05}, ${Number(p.energyInflationRate) || 0.04},
        ${Number(p.inflationRate) || 0.025}, ${Number(p.carbonPricePerTonne) || 120}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        budget_cap = EXCLUDED.budget_cap,
        discount_rate = EXCLUDED.discount_rate,
        energy_inflation_rate = EXCLUDED.energy_inflation_rate,
        general_inflation_rate = EXCLUDED.general_inflation_rate,
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;

    return res.json({ success: true, project: rows[0] });
  } catch (err: any) {
    console.error('Error upserting project in Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 5. Create / Upsert Offer in Neon
app.post('/api/offers', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });

  const o = req.body;
  if (!o.id || !o.projectId || !o.supplierId) {
    return res.status(400).json({ error: 'id, projectId and supplierId are required' });
  }

  try {
    const rows = await sql`
      INSERT INTO supplier_offers (
        id, project_id, supplier_id, apparent_total, quantity,
        delivery_lead_time_weeks, warranty_months, technical_suitability_score,
        is_responsible_candidate
      ) VALUES (
        ${o.id}, ${o.projectId}, ${o.supplierId}, ${Number(o.apparentTotal) || 0},
        ${Number(o.quantity) || 50}, ${Number(o.deliveryLeadTimeWeeks) || 12},
        ${Number(o.warrantyMonths) || 24}, ${Number(o.technicalSuitabilityScore) || 75},
        ${o.isResponsibleCandidate ? true : false}
      )
      ON CONFLICT (id) DO UPDATE SET
        apparent_total = EXCLUDED.apparent_total,
        technical_suitability_score = EXCLUDED.technical_suitability_score,
        is_responsible_candidate = EXCLUDED.is_responsible_candidate
      RETURNING *;
    `;

    // Upsert cost items if provided
    if (Array.isArray(o.costItems) && o.costItems.length > 0) {
      for (const item of o.costItems) {
        if (!item.id || !item.category || !item.label) continue;
        await sql`
          INSERT INTO cost_items (
            id, offer_id, category, label, amount, unit,
            source_name, source_type, confidence_level, is_recurring_yearly
          ) VALUES (
            ${item.id}, ${o.id}, ${item.category}, ${item.label},
            ${Number(item.amount?.value) || 0}, ${item.amount?.unit || '€'},
            ${item.amount?.sourceName || 'Devis'}, ${item.amount?.sourceType || 'FOURNISSEUR_DEVIS'},
            ${Number(item.amount?.confidenceLevel) || 85}, ${item.isRecurringYearly ? true : false}
          )
          ON CONFLICT (id) DO UPDATE SET
            amount = EXCLUDED.amount,
            confidence_level = EXCLUDED.confidence_level;
        `;
      }
    }

    return res.json({ success: true, offer: rows[0] });
  } catch (err: any) {
    console.error('Error upserting offer in Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 6. Record Audit Log in Neon (Hermetically scoped to current tenant)
app.post('/api/audit-logs', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });

  const l = req.body;
  const orgId = await resolveTenantId(req);
  const logId = isUuid(l.id) ? l.id : crypto.randomUUID();
  try {
    const rows = await sql`
      INSERT INTO audit_logs (
        id, organization_id, timestamp, user_name, user_role,
        entity_name, field_changed, old_value, new_value, justification
      ) VALUES (
        ${logId}, ${orgId},
        ${l.timestamp ? new Date(l.timestamp) : new Date()},
        ${l.userName || 'Système'}, ${l.userRole || 'acheteur'},
        ${l.entityName || 'Projet'}, ${l.fieldChanged || 'Modification'},
        ${String(l.oldValue ?? '')}, ${String(l.newValue ?? '')},
        ${l.justification || 'Mise à jour via interface TrueTCO'}
      )
      RETURNING *;
    `;
    return res.json({ success: true, log: rows[0] });
  } catch (err: any) {
    console.error('Error recording audit log in Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 6b. Get Audit Logs from Neon (Hermetically scoped to current tenant)
app.get('/api/audit-logs', async (req: Request, res: Response) => {
  if (!sql) return res.json([]);
  const tenantId = await resolveTenantId(req);
  try {
    const rows = await sql`
      SELECT
        id, timestamp, user_name as "userName", user_role as "userRole",
        entity_name as "entityName", field_changed as "fieldChanged",
        old_value as "oldValue", new_value as "newValue", justification
      FROM audit_logs
      WHERE organization_id = ${tenantId}
      ORDER BY timestamp DESC;
    `;
    return res.json(rows);
  } catch (err: any) {
    console.error('Error fetching audit logs from Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 7. Get Suppliers from Neon (Hermetically scoped to current tenant)
app.get('/api/suppliers', async (req: Request, res: Response) => {
  if (!sql) return res.json([]);
  const tenantId = await resolveTenantId(req);
  try {
    const rows = await sql`
      SELECT
        id, name, country_code as country, incoterm as "defaultIncoterm",
        payment_terms_days as "paymentTermsDays", standard_lead_time_days as "leadTimeDays",
        minimum_order_quantity as moq, warranty_months as "warrantyMonths",
        historical_defect_rate as "historicalDefectRate", esg_score as "esgScore",
        data_quality_score as "dataQualityScore", certifications
      FROM suppliers
      WHERE organization_id = ${tenantId}
      ORDER BY name ASC;
    `;
    return res.json(rows);
  } catch (err: any) {
    console.error('Error fetching suppliers from Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 8. Create / Upsert Supplier in Neon (Hermetically scoped to current tenant)
app.post('/api/suppliers', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });
  const s = req.body;
  if (!s.name) return res.status(400).json({ error: 'Nom du fournisseur obligatoire' });

  const orgId = await resolveTenantId(req);
  const supplierId = isUuid(s.id) ? s.id : crypto.randomUUID();

  try {
    const rows = await sql`
      INSERT INTO suppliers (
        id, organization_id, name, country_code, incoterm,
        payment_terms_days, standard_lead_time_days, minimum_order_quantity,
        warranty_months, historical_defect_rate, esg_score, data_quality_score,
        certifications
      ) VALUES (
        ${supplierId}, ${orgId}, ${s.name}, ${s.country ? s.country.slice(0, 2).toUpperCase() : 'FR'},
        ${s.defaultIncoterm || 'DDP'}, ${Number(s.paymentTermsDays) || 30},
        ${Number(s.leadTimeDays) || 30}, ${Number(s.moq) || 1},
        ${Number(s.warrantyMonths) || 24}, ${Number(s.historicalDefectRate) || 0.02},
        ${Number(s.esgScore) || 75}, ${Number(s.dataQualityScore) || 85},
        ${Array.isArray(s.certifications) ? s.certifications : []}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        incoterm = EXCLUDED.incoterm,
        payment_terms_days = EXCLUDED.payment_terms_days,
        standard_lead_time_days = EXCLUDED.standard_lead_time_days,
        warranty_months = EXCLUDED.warranty_months,
        historical_defect_rate = EXCLUDED.historical_defect_rate,
        esg_score = EXCLUDED.esg_score,
        data_quality_score = EXCLUDED.data_quality_score,
        certifications = EXCLUDED.certifications,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    return res.json({ success: true, supplier: rows[0] });
  } catch (err: any) {
    console.error('Error saving supplier in Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 9. Get Reference Benchmarks from Neon
app.get('/api/benchmarks', async (_req: Request, res: Response) => {
  if (!sql) return res.json([]);
  try {
    const rows = await sql`
      SELECT
        id, name, category, source, value::float as value, unit,
        confidence_score as "confidenceLevel",
        legal_reference as "documentRef",
        created_at as "lastUpdated"
      FROM reference_benchmarks
      ORDER BY name ASC;
    `;
    return res.json(rows);
  } catch (err: any) {
    console.error('Error fetching benchmarks from Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 10. Create / Upsert Reference Benchmark in Neon
app.post('/api/benchmarks', async (req: Request, res: Response) => {
  if (!sql) return res.status(503).json({ error: 'Neon database not connected' });
  const b = req.body;
  if (!b.name || b.value === undefined) {
    return res.status(400).json({ error: 'Nom et valeur du benchmark obligatoires' });
  }

  const orgId = await getOrganizationId();
  const benchmarkId = isUuid(b.id) ? b.id : crypto.randomUUID();

  try {
    const rows = await sql`
      INSERT INTO reference_benchmarks (
        id, organization_id, name, category, source, value, unit,
        valid_until, confidence_score, last_audit_date, legal_reference
      ) VALUES (
        ${benchmarkId}, ${orgId}, ${b.name}, ${b.category || 'carbone'},
        ${b.source || 'ADEME / Quinet'}, ${Number(b.value)}, ${b.unit || '€'},
        ${new Date(Date.now() + 365 * 24 * 3600 * 1000)}, ${Number(b.confidenceLevel) || 90},
        ${new Date()}, ${b.documentRef || b.methodology || 'Norme Section 12'}
      )
      ON CONFLICT (organization_id, name) DO UPDATE SET
        value = EXCLUDED.value,
        source = EXCLUDED.source,
        unit = EXCLUDED.unit,
        confidence_score = EXCLUDED.confidence_score,
        last_audit_date = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `;
    return res.json({ success: true, benchmark: rows[0] });
  } catch (err: any) {
    console.error('Error saving benchmark in Neon:', err);
    return res.status(500).json({ error: err.message });
  }
});

// P0: operations remain disabled until real, authenticated integrations exist.
app.use(createDisabledIntegrationRouter());

// -----------------------------------------------------------------------------
// Vite Middleware / Static Serving
// -----------------------------------------------------------------------------
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const server = http.createServer(app);

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`✓ TrueTCO Full-Stack Server running on port ${PORT}`);
    console.log(`Database configuration present: ${Boolean(sql)}; business API routes remain disabled pending verified auth.`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
