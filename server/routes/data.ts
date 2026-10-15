import crypto from 'node:crypto';
import { Router } from 'express';
import { auditDiff, writeAudit } from '../audit';
import { entityId } from '../auth';
import { type Db, withTenant } from '../db';
import { asyncHandler, notFound } from '../errors';
import { requirePermission } from '../rbac';
import {
  AuditNoteInput, BenchmarkInput, OfferInput, ProjectInput, SupplierInput, UUID_RE, parse,
} from '../validation';

/**
 * Règles communes à toutes les routes de ce fichier :
 *  - l'organisation vient UNIQUEMENT de req.ctx (jeton vérifié + appartenance en base), via withTenant ;
 *  - chaque requête filtre explicitement `organization_id` EN PLUS du RLS (défense en profondeur) ;
 *  - un identifiant appartenant à un autre tenant est indiscernable d'un identifiant inexistant (404) ;
 *  - aucune erreur SQL brute n'est renvoyée au client.
 */
export function dataRouter(deps: { db: Db }): Router {
  const { db } = deps;
  const r = Router();

  // ---------------------------------------------------------------- Projets
  const PROJECT_OUT = `
    id, reference, name, description, category, company_name AS "companyName",
    budget_cap::float8 AS "budgetCap", currency, planned_volume AS "plannedVolume", unit_name AS "unitName",
    horizon_years AS "horizonYears", status, discount_rate::float8 AS "discountRate",
    energy_inflation_rate::float8 AS "energyInflationRate", general_inflation_rate::float8 AS "inflationRate",
    carbon_price_per_tonne::float8 AS "carbonPricePerTonne", created_at AS "createdAt", updated_at AS "updatedAt"`;

  r.get('/projects', requirePermission('project:read'), asyncHandler(async (req, res) => {
    const rows = await withTenant(db, req.ctx!, async (q, org) =>
      (await q.query(`SELECT ${PROJECT_OUT} FROM projects WHERE organization_id = $1 ORDER BY created_at DESC`, [org])).rows
    );
    res.json(rows);
  }));

  const PROJECT_AUDITED = ['reference', 'name', 'description', 'category', 'company_name', 'budget_cap', 'currency', 'planned_volume',
    'unit_name', 'horizon_years', 'status', 'discount_rate', 'energy_inflation_rate', 'general_inflation_rate', 'carbon_price_per_tonne'];

  r.post('/projects', requirePermission('project:write'), asyncHandler(async (req, res) => {
    const p = parse(ProjectInput, req.body);
    const project = await withTenant(db, req.ctx!, async (q, org) => {
      const id = entityId(p.id, org);
      const before = (await q.query('SELECT * FROM projects WHERE id = $1 AND organization_id = $2', [id, org])).rows[0] ?? null;
      const saved = (await q.query(
        `INSERT INTO projects (id, organization_id, reference, name, description, category, company_name, budget_cap, currency,
                               planned_volume, unit_name, horizon_years, status, discount_rate, energy_inflation_rate,
                               general_inflation_rate, carbon_price_per_tonne, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (id) DO UPDATE SET
           reference = EXCLUDED.reference, name = EXCLUDED.name, description = EXCLUDED.description,
           category = EXCLUDED.category, company_name = EXCLUDED.company_name, budget_cap = EXCLUDED.budget_cap,
           currency = EXCLUDED.currency, planned_volume = EXCLUDED.planned_volume, unit_name = EXCLUDED.unit_name,
           horizon_years = EXCLUDED.horizon_years, status = EXCLUDED.status, discount_rate = EXCLUDED.discount_rate,
           energy_inflation_rate = EXCLUDED.energy_inflation_rate, general_inflation_rate = EXCLUDED.general_inflation_rate,
           carbon_price_per_tonne = EXCLUDED.carbon_price_per_tonne
         WHERE projects.organization_id = EXCLUDED.organization_id
         RETURNING *`,
        [id, org, p.reference, p.name, p.description, p.category, p.companyName ?? req.ctx!.active!.organizationName, p.budgetCap,
         p.currency, p.plannedVolume, p.unitName, p.horizonYears, p.status, p.discountRate, p.energyInflationRate,
         p.inflationRate, p.carbonPricePerTonne, req.ctx!.active!.userId]
      )).rows[0];
      if (!saved) throw notFound('Projet'); // id appartenant à un autre tenant : indiscernable d'un id inconnu
      await auditDiff(q, req.ctx!, { projectId: saved.id, entity: `Projet ${saved.reference}` }, before, saved, PROJECT_AUDITED);
      return (await q.query(`SELECT ${PROJECT_OUT} FROM projects WHERE id = $1 AND organization_id = $2`, [saved.id, org])).rows[0];
    });
    res.json({ success: true, project });
  }));

  // ---------------------------------------------------------------- Fournisseurs
  const SUPPLIER_OUT = `
    id, name, country_code AS country, incoterm AS "defaultIncoterm", payment_terms_days AS "paymentTermsDays",
    standard_lead_time_days AS "leadTimeDays", minimum_order_quantity AS moq, warranty_months AS "warrantyMonths",
    historical_defect_rate::float8 AS "historicalDefectRate", esg_score AS "esgScore",
    data_quality_score AS "dataQualityScore", COALESCE(certifications, ARRAY[]::text[]) AS certifications`;

  r.get('/suppliers', requirePermission('supplier:read'), asyncHandler(async (req, res) => {
    const rows = await withTenant(db, req.ctx!, async (q, org) =>
      (await q.query(`SELECT ${SUPPLIER_OUT} FROM suppliers WHERE organization_id = $1 ORDER BY name`, [org])).rows
    );
    res.json(rows);
  }));

  r.post('/suppliers', requirePermission('supplier:write'), asyncHandler(async (req, res) => {
    const s = parse(SupplierInput, req.body);
    const supplier = await withTenant(db, req.ctx!, async (q, org) => {
      const id = entityId(s.id, org);
      const before = (await q.query('SELECT * FROM suppliers WHERE id = $1 AND organization_id = $2', [id, org])).rows[0] ?? null;
      const saved = (await q.query(
        `INSERT INTO suppliers (id, organization_id, name, country_code, incoterm, payment_terms_days, standard_lead_time_days,
                                minimum_order_quantity, warranty_months, historical_defect_rate, esg_score, data_quality_score, certifications)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, country_code = EXCLUDED.country_code, incoterm = EXCLUDED.incoterm,
           payment_terms_days = EXCLUDED.payment_terms_days, standard_lead_time_days = EXCLUDED.standard_lead_time_days,
           minimum_order_quantity = EXCLUDED.minimum_order_quantity, warranty_months = EXCLUDED.warranty_months,
           historical_defect_rate = EXCLUDED.historical_defect_rate, esg_score = EXCLUDED.esg_score,
           data_quality_score = EXCLUDED.data_quality_score, certifications = EXCLUDED.certifications
         WHERE suppliers.organization_id = EXCLUDED.organization_id
         RETURNING *`,
        [id, org, s.name, s.country, s.defaultIncoterm, s.paymentTermsDays, s.leadTimeDays, s.moq, s.warrantyMonths,
         s.historicalDefectRate, s.esgScore, s.dataQualityScore, s.certifications]
      )).rows[0];
      if (!saved) throw notFound('Fournisseur');
      await auditDiff(q, req.ctx!, { entity: `Fournisseur ${saved.name}` }, before, saved,
        ['name', 'incoterm', 'payment_terms_days', 'standard_lead_time_days', 'warranty_months', 'historical_defect_rate', 'esg_score', 'data_quality_score']);
      return (await q.query(`SELECT ${SUPPLIER_OUT} FROM suppliers WHERE id = $1 AND organization_id = $2`, [saved.id, org])).rows[0];
    });
    res.json({ success: true, supplier });
  }));

  // ---------------------------------------------------------------- Offres
  const OFFER_OUT = `
    o.id, o.project_id AS "projectId", o.supplier_id AS "supplierId", o.offer_reference AS "offerReference",
    o.apparent_total::float8 AS "apparentTotal", o.quantity, o.delivery_lead_time_weeks AS "deliveryLeadTimeWeeks",
    o.warranty_months AS "warrantyMonths", o.technical_suitability_score AS "technicalSuitabilityScore",
    o.is_responsible_candidate AS "isResponsibleCandidate"`;

  r.get('/offers', requirePermission('offer:read'), asyncHandler(async (req, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (projectId !== undefined && !UUID_RE.test(projectId)) throw notFound('Projet');
    const rows = await withTenant(db, req.ctx!, async (q, org) => {
      const offers = (await q.query(
        `SELECT ${OFFER_OUT} FROM supplier_offers o WHERE o.organization_id = $1 AND ($2::uuid IS NULL OR o.project_id = $2) ORDER BY o.created_at DESC LIMIT 1000`,
        [org, projectId ?? null]
      )).rows;
      if (offers.length === 0) return [];
      const items = (await q.query(
        `SELECT offer_id, category, label, amount::float8 AS value, unit, source_name AS "sourceName", source_type AS "sourceType",
                confidence_level AS "confidenceLevel", is_recurring_yearly AS "isRecurringYearly"
           FROM cost_items WHERE organization_id = $1 AND offer_id = ANY($2::uuid[])`,
        [org, offers.map((o: { id: string }) => o.id)]
      )).rows;
      return offers.map((o: { id: string }) => ({ ...o, costItems: items.filter((i: { offer_id: string }) => i.offer_id === o.id) }));
    });
    res.json(rows);
  }));

  r.post('/offers', requirePermission('offer:write'), asyncHandler(async (req, res) => {
    const o = parse(OfferInput, req.body);
    const offer = await withTenant(db, req.ctx!, async (q, org) => {
      const projectId = entityId(o.projectId, org);
      const supplierId = entityId(o.supplierId, org);
      const offerId = entityId(o.id, org);

      // Le projet ET le fournisseur doivent appartenir au tenant (en plus de la FK composite en base).
      const project = (await q.query('SELECT id, reference FROM projects WHERE id = $1 AND organization_id = $2', [projectId, org])).rows[0];
      if (!project) throw notFound('Projet');
      const supplier = (await q.query('SELECT id, name FROM suppliers WHERE id = $1 AND organization_id = $2', [supplierId, org])).rows[0];
      if (!supplier) throw notFound('Fournisseur');

      const before = (await q.query('SELECT * FROM supplier_offers WHERE id = $1 AND organization_id = $2', [offerId, org])).rows[0] ?? null;
      const saved = (await q.query(
        `INSERT INTO supplier_offers (id, organization_id, project_id, supplier_id, offer_reference, apparent_total, quantity,
                                      delivery_lead_time_weeks, warranty_months, technical_suitability_score, is_responsible_candidate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           supplier_id = EXCLUDED.supplier_id, offer_reference = EXCLUDED.offer_reference, apparent_total = EXCLUDED.apparent_total,
           quantity = EXCLUDED.quantity, delivery_lead_time_weeks = EXCLUDED.delivery_lead_time_weeks,
           warranty_months = EXCLUDED.warranty_months, technical_suitability_score = EXCLUDED.technical_suitability_score,
           is_responsible_candidate = EXCLUDED.is_responsible_candidate
         WHERE supplier_offers.organization_id = EXCLUDED.organization_id AND supplier_offers.project_id = EXCLUDED.project_id
         RETURNING *`,
        [offerId, org, projectId, supplierId, o.offerReference ?? `OFF-${offerId.slice(0, 8)}`, o.apparentTotal, o.quantity,
         o.deliveryLeadTimeWeeks ?? null, o.warrantyMonths ?? null, o.technicalSuitabilityScore ?? null, o.isResponsibleCandidate]
      )).rows[0];
      if (!saved) throw notFound('Offre');

      // Les lignes de coût sont REMPLACÉES en bloc : l'ensemble envoyé fait foi (suppressions incluses).
      await q.query('DELETE FROM cost_items WHERE offer_id = $1 AND organization_id = $2', [offerId, org]);
      for (const c of o.costItems) {
        await q.query(
          `INSERT INTO cost_items (id, organization_id, offer_id, category, label, amount, currency, unit, source_name, source_type,
                                   confidence_level, is_recurring_yearly)
           VALUES ($1,$2,$3,$4,$5,$6,'EUR',$7,$8,$9,$10,$11)`,
          [crypto.randomUUID(), org, offerId, c.category, c.label, c.amount.value, c.amount.unit,
           c.amount.sourceName ?? 'Non renseignée', c.amount.sourceType, Math.round(c.amount.confidenceLevel), c.isRecurringYearly]
        );
      }
      await auditDiff(q, req.ctx!, { projectId, entity: `Offre ${saved.offer_reference} (${supplier.name})` }, before, saved,
        ['offer_reference', 'apparent_total', 'quantity', 'delivery_lead_time_weeks', 'warranty_months', 'technical_suitability_score', 'is_responsible_candidate']);
      await writeAudit(q, req.ctx!, { projectId, entity: `Offre ${saved.offer_reference}`, field: 'Lignes de coût', newValue: `${o.costItems.length} ligne(s)` });
      return (await q.query(`SELECT ${OFFER_OUT} FROM supplier_offers o WHERE o.id = $1 AND o.organization_id = $2`, [offerId, org])).rows[0];
    });
    res.json({ success: true, offer });
  }));

  // ---------------------------------------------------------------- Référentiels (benchmarks)
  r.get('/benchmarks', requirePermission('benchmark:read'), asyncHandler(async (req, res) => {
    const rows = await withTenant(db, req.ctx!, async (q, org) =>
      (await q.query(
        `SELECT id, name, category, source, value::float8 AS value, unit, confidence_score AS "confidenceLevel",
                legal_reference AS "documentRef", updated_at AS "lastUpdated"
           FROM reference_benchmarks WHERE organization_id = $1 ORDER BY name`, [org])).rows
    );
    res.json(rows);
  }));

  r.post('/benchmarks', requirePermission('benchmark:write'), asyncHandler(async (req, res) => {
    const b = parse(BenchmarkInput, req.body);
    const benchmark = await withTenant(db, req.ctx!, async (q, org) => {
      const before = (await q.query('SELECT * FROM reference_benchmarks WHERE organization_id = $1 AND name = $2', [org, b.name])).rows[0] ?? null;
      const saved = (await q.query(
        `INSERT INTO reference_benchmarks (id, organization_id, name, category, source, value, unit, valid_until, confidence_score,
                                           last_audit_date, legal_reference)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,$10)
         ON CONFLICT (organization_id, name) DO UPDATE SET
           category = EXCLUDED.category, value = EXCLUDED.value, source = EXCLUDED.source, unit = EXCLUDED.unit,
           valid_until = EXCLUDED.valid_until, confidence_score = EXCLUDED.confidence_score,
           last_audit_date = CURRENT_TIMESTAMP, legal_reference = EXCLUDED.legal_reference
         RETURNING id, name, category, source, value::float8 AS value, unit, confidence_score AS "confidenceLevel", legal_reference AS "documentRef"`,
        [crypto.randomUUID(), org, b.name, b.category, b.source, b.value, b.unit,
         b.validUntil ?? new Date(Date.now() + 365 * 24 * 3600 * 1000), Math.round(b.confidenceLevel), b.documentRef ?? b.methodology ?? null]
      )).rows[0];
      await writeAudit(q, req.ctx!, {
        entity: `Référentiel ${b.name}`, field: before ? 'Valeur' : 'Création',
        oldValue: before ? `${before.value} ${before.unit}` : 'N/A', newValue: `${b.value} ${b.unit} (source : ${b.source})`,
      });
      return saved;
    });
    res.json({ success: true, benchmark });
  }));

  // ---------------------------------------------------------------- Journal d'audit
  r.get('/audit-logs', requirePermission('audit:read'), asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '500'), 10) || 500, 1), 1000);
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    if (projectId !== undefined && !UUID_RE.test(projectId)) throw notFound('Projet');
    const rows = await withTenant(db, req.ctx!, async (q, org) =>
      (await q.query(
        `SELECT id, timestamp, user_name AS "userName", user_role AS "userRole", entity_name AS "entityName",
                field_changed AS "fieldChanged", old_value AS "oldValue", new_value AS "newValue", justification, origin
           FROM audit_logs WHERE organization_id = $1 AND ($2::uuid IS NULL OR project_id = $2)
          ORDER BY timestamp DESC LIMIT $3`, [org, projectId ?? null, limit])).rows
    );
    res.json(rows);
  }));

  // Le client déclare le CONTENU d'une justification ; l'auteur, le rôle, l'organisation et l'horodatage sont ceux du serveur.
  r.post('/audit-logs', requirePermission('audit:annotate'), asyncHandler(async (req, res) => {
    const n = parse(AuditNoteInput, req.body);
    await withTenant(db, req.ctx!, async (q, org) => {
      let projectId: string | null = null;
      if (n.projectId) {
        projectId = entityId(n.projectId, org);
        const ok = (await q.query('SELECT 1 FROM projects WHERE id = $1 AND organization_id = $2', [projectId, org])).rowCount;
        if (!ok) throw notFound('Projet');
      }
      await writeAudit(q, req.ctx!, {
        projectId, entity: n.entityName, field: n.fieldChanged, oldValue: n.oldValue, newValue: n.newValue,
        justification: n.justification, origin: 'client_declared',
      });
    });
    res.status(201).json({ success: true });
  }));

  return r;
}
