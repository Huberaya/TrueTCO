-- =============================================================================
-- TRUETCO — SCHÉMA RELATIONNEL POSTGRESQL (DDL DE RÉFÉRENCE)
-- =============================================================================
-- VERSION : 2.1.0
--
-- IMPORTANT — Cette version corrige une divergences critique : le serveur
-- interrogeait des tables et colonnes (user_sessions, organizations.slug,
-- users.sso_provider, supplier_offers.quantity, cost_items.year_occurrences, …)
-- qui n'existaient PAS dans le DDL précédent. L'application ne pouvait donc pas
-- fonctionner sur une base migrée avec ce schéma.
--
-- Ce script est IDEMPOTENT : il peut être exécuté plusieurs fois sans erreur
-- (CREATE TABLE IF NOT EXISTS + ALTER TABLE ... ADD COLUMN IF NOT EXISTS). Il
-- sert à la fois d'installation initiale et de script de convergence pour les
-- bases existantes (voir scripts/migrate-neon.mjs).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Fonction générique de mise à jour de updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. ORGANIZATIONS — racine multi-tenant
-- =============================================================================
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(60),
    domain VARCHAR(255),
    subscription_tier VARCHAR(30) NOT NULL DEFAULT 'starter',
    data_residency VARCHAR(60) NOT NULL DEFAULT 'EU-FRANCE-PARIS',
    legal_registration_number VARCHAR(50),
    country_code VARCHAR(2) NOT NULL DEFAULT 'FR',
    default_currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Convergence pour les bases créées avec la version précédente du DDL
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug VARCHAR(60);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS domain VARCHAR(255);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(30) NOT NULL DEFAULT 'starter';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS data_residency VARCHAR(60) NOT NULL DEFAULT 'EU-FRANCE-PARIS';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug) WHERE slug IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_domain ON organizations(domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations(is_active);

DROP TRIGGER IF EXISTS trigger_update_organizations_updated_at ON organizations;
CREATE TRIGGER trigger_update_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 2. USERS — utilisateurs & rôles (RBAC appliqué côté serveur)
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'lecteur' CHECK (role IN (
        'super_admin', 'admin', 'directeur_achats', 'acheteur',
        'finance_controleur', 'rse_esg', 'direction_generale', 'lecteur'
    )),
    department VARCHAR(255),
    sso_provider VARCHAR(50),
    clerk_id VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_org_email UNIQUE (organization_id, email)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS department VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_provider VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS clerk_id VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Le CHECK précédent n'autorisait que 6 rôles et empêchait l'existence d'un
-- super-admin de plateforme. On le remplace par la liste complète.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
    'super_admin', 'admin', 'directeur_achats', 'acheteur',
    'finance_controleur', 'rse_esg', 'direction_generale', 'lecteur'
));

CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

DROP TRIGGER IF EXISTS trigger_update_users_updated_at ON users;
CREATE TRIGGER trigger_update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 3. USER_SESSIONS — sessions authentifiées (jeton haché, jamais en clair)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- SHA-256 hexadécimal du jeton : une fuite de la base ne permet pas de
    -- rejouer une session.
    token_hash CHAR(64) NOT NULL UNIQUE,
    sso_provider VARCHAR(50),
    ip_address VARCHAR(64),
    user_agent VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- =============================================================================
-- 4. PROJECTS — consultations d'achats
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    reference VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL,
    company_name VARCHAR(255),
    budget_cap NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (budget_cap >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    planned_volume INTEGER NOT NULL DEFAULT 1 CHECK (planned_volume > 0),
    unit_name VARCHAR(50) NOT NULL DEFAULT 'unités',
    horizon_years INTEGER NOT NULL DEFAULT 5 CHECK (horizon_years BETWEEN 1 AND 50),
    status VARCHAR(50) NOT NULL DEFAULT 'brouillon',
    discount_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0500 CHECK (discount_rate >= 0 AND discount_rate <= 0.50),
    energy_inflation_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0400,
    general_inflation_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0200,
    carbon_price_per_tonne NUMERIC(12, 2) NOT NULL DEFAULT 120.00 CHECK (carbon_price_per_tonne >= 0),
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_projects_org_ref UNIQUE (organization_id, reference)
);

ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);
-- Le CHECK de statut précédent énumérait des libellés métier et empêchait
-- toute évolution produit. Le contrôle applicatif prime ; on garde une borne.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (char_length(status) BETWEEN 2 AND 50);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_org_created ON projects(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

DROP TRIGGER IF EXISTS trigger_update_projects_updated_at ON projects;
CREATE TRIGGER trigger_update_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 5. SUPPLIERS — référentiel fournisseurs & qualification
-- =============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    country_code VARCHAR(2) NOT NULL DEFAULT 'FR',
    incoterm VARCHAR(10) NOT NULL DEFAULT 'DDP',
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    standard_lead_time_days INTEGER NOT NULL DEFAULT 30,
    minimum_order_quantity INTEGER NOT NULL DEFAULT 1,
    warranty_months INTEGER NOT NULL DEFAULT 0,
    historical_defect_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0000 CHECK (historical_defect_rate >= 0 AND historical_defect_rate <= 1),
    esg_score INTEGER NOT NULL DEFAULT 0 CHECK (esg_score BETWEEN 0 AND 100),
    has_verified_environmental_data BOOLEAN NOT NULL DEFAULT FALSE,
    environmental_data_source TEXT,
    certifications TEXT[],
    data_quality_score INTEGER NOT NULL DEFAULT 0 CHECK (data_quality_score BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_suppliers_org_name UNIQUE (organization_id, name)
);

ALTER TABLE suppliers ALTER COLUMN esg_score SET DEFAULT 0;
ALTER TABLE suppliers ALTER COLUMN data_quality_score SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(organization_id);

DROP TRIGGER IF EXISTS trigger_update_suppliers_updated_at ON suppliers;
CREATE TRIGGER trigger_update_suppliers_updated_at
BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 6. SUPPLIER_OFFERS — offres candidates
-- =============================================================================
CREATE TABLE IF NOT EXISTS supplier_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    offer_reference VARCHAR(100) NOT NULL,
    apparent_total NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (apparent_total >= 0),
    quantity INTEGER NOT NULL DEFAULT 1,
    delivery_lead_time_weeks INTEGER NOT NULL DEFAULT 0,
    warranty_months INTEGER NOT NULL DEFAULT 0,
    technical_suitability_score INTEGER NOT NULL DEFAULT 0 CHECK (technical_suitability_score BETWEEN 0 AND 100),
    is_responsible_candidate BOOLEAN NOT NULL DEFAULT FALSE,
    economic_tco_nominal NUMERIC(16, 2),
    lifecycle_cost_lcc NUMERIC(16, 2),
    total_lifecycle_co2e_tonnes NUMERIC(14, 3),
    monetized_carbon_total NUMERIC(16, 2),
    risk_exposition_total NUMERIC(16, 2),
    total_comprehensive_tco NUMERIC(16, 2),
    confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
    -- Traçabilité du moteur : quel calcul a produit ces valeurs ?
    engine_version VARCHAR(20),
    computed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_offers_project_ref UNIQUE (project_id, offer_reference)
);

ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS delivery_lead_time_weeks INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS warranty_months INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS technical_suitability_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS engine_version VARCHAR(20);
ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS computed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_offers_project ON supplier_offers(project_id);
CREATE INDEX IF NOT EXISTS idx_offers_supplier ON supplier_offers(supplier_id);

DROP TRIGGER IF EXISTS trigger_update_supplier_offers_updated_at ON supplier_offers;
CREATE TRIGGER trigger_update_supplier_offers_updated_at
BEFORE UPDATE ON supplier_offers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 7. COST_ITEMS — ventilation analytique du TCO
-- =============================================================================
CREATE TABLE IF NOT EXISTS cost_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    -- Catégorie libre : le moteur normalise et signale les catégories non
    -- reconnues. Un CHECK fermé empêchait d'enregistrer les imports et
    -- provoquait des rejets silencieux côté produit.
    category VARCHAR(100) NOT NULL,
    label VARCHAR(255) NOT NULL,
    amount NUMERIC(16, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    unit VARCHAR(50) NOT NULL DEFAULT '€',
    source_name VARCHAR(255) NOT NULL DEFAULT 'Non renseigné',
    source_type VARCHAR(50) NOT NULL DEFAULT 'manquante',
    confidence_level INTEGER NOT NULL DEFAULT 0 CHECK (confidence_level BETWEEN 0 AND 100),
    is_recurring_yearly BOOLEAN NOT NULL DEFAULT FALSE,
    yearly_inflation_type VARCHAR(20),
    year_occurrences INTEGER[],
    occurrences_per_year INTEGER CHECK (occurrences_per_year IS NULL OR occurrences_per_year BETWEEN 1 AND 366),
    calculation_formula TEXT,
    explanation_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Le CHECK historique n'autorisait que ('verifiee','calculee','estimee') alors
-- que le produit écrit notamment 'FOURNISSEUR_DEVIS' et 'devis_fournisseur' :
-- chaque enregistrement échouait.
ALTER TABLE cost_items DROP CONSTRAINT IF EXISTS cost_items_source_type_check;
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS yearly_inflation_type VARCHAR(20);
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS year_occurrences INTEGER[];
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS calculation_formula TEXT;
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS explanation_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_cost_items_offer ON cost_items(offer_id);
CREATE INDEX IF NOT EXISTS idx_cost_items_category ON cost_items(category);

-- =============================================================================
-- 8. CARBON_ITEMS — empreinte ACV (scopes 1, 2, 3)
-- =============================================================================
CREATE TABLE IF NOT EXISTS carbon_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    scope VARCHAR(40) NOT NULL,
    lifecycle_phase VARCHAR(50) NOT NULL,
    emissions_per_unit_tonne_co2e NUMERIC(14, 6),
    total_lifecycle_emissions NUMERIC(16, 6),
    emission_factor_source VARCHAR(255) NOT NULL DEFAULT 'Non renseigné',
    emission_factor_id VARCHAR(100),
    confidence_level INTEGER NOT NULL DEFAULT 0 CHECK (confidence_level BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Les scopes utilisés par le produit ("Scope 3 - Amont") étaient rejetés par
-- l'ancien CHECK ('Scope 3 Amont').
ALTER TABLE carbon_items DROP CONSTRAINT IF EXISTS carbon_items_scope_check;
ALTER TABLE carbon_items ALTER COLUMN emissions_per_unit_tonne_co2e DROP NOT NULL;
ALTER TABLE carbon_items ALTER COLUMN total_lifecycle_emissions DROP NOT NULL;
ALTER TABLE carbon_items ADD COLUMN IF NOT EXISTS emission_factor_id VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_carbon_items_offer ON carbon_items(offer_id);

-- =============================================================================
-- 9. RISK_ITEMS — risques probabilisés (P × I)
-- =============================================================================
CREATE TABLE IF NOT EXISTS risk_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    category VARCHAR(50),
    probability NUMERIC(6, 4) NOT NULL CHECK (probability >= 0 AND probability <= 1),
    financial_impact NUMERIC(16, 2) NOT NULL CHECK (financial_impact >= 0),
    probability_type VARCHAR(30),
    mitigation_notes TEXT,
    source_evidence TEXT,
    confidence_level INTEGER NOT NULL DEFAULT 0 CHECK (confidence_level BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE risk_items ADD COLUMN IF NOT EXISTS category VARCHAR(50);
ALTER TABLE risk_items ADD COLUMN IF NOT EXISTS probability_type VARCHAR(30);
ALTER TABLE risk_items ADD COLUMN IF NOT EXISTS mitigation_notes TEXT;
ALTER TABLE risk_items ADD COLUMN IF NOT EXISTS confidence_level INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_risk_items_offer ON risk_items(offer_id);

-- =============================================================================
-- 10. REFERENCE_BENCHMARKS — référentiel d'externalités traçable
-- =============================================================================
CREATE TABLE IF NOT EXISTS reference_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    source VARCHAR(255) NOT NULL,
    source_url VARCHAR(500),
    document_ref VARCHAR(255),
    methodology TEXT,
    country_scope VARCHAR(100),
    value NUMERIC(18, 6) NOT NULL,
    unit VARCHAR(50) NOT NULL DEFAULT '€',
    value_range_min NUMERIC(18, 6),
    value_range_max NUMERIC(18, 6),
    valid_until TIMESTAMPTZ,
    confidence_score INTEGER NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
    last_audit_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_benchmarks_org_name UNIQUE (organization_id, name)
);

ALTER TABLE reference_benchmarks ADD COLUMN IF NOT EXISTS source_url VARCHAR(500);
ALTER TABLE reference_benchmarks ADD COLUMN IF NOT EXISTS document_ref VARCHAR(255);
ALTER TABLE reference_benchmarks ADD COLUMN IF NOT EXISTS methodology TEXT;
ALTER TABLE reference_benchmarks ADD COLUMN IF NOT EXISTS country_scope VARCHAR(100);
ALTER TABLE reference_benchmarks ADD COLUMN IF NOT EXISTS value_range_min NUMERIC(18, 6);
ALTER TABLE reference_benchmarks ADD COLUMN IF NOT EXISTS value_range_max NUMERIC(18, 6);
ALTER TABLE reference_benchmarks ADD COLUMN IF NOT EXISTS legal_reference TEXT;
ALTER TABLE reference_benchmarks ALTER COLUMN valid_until DROP NOT NULL;
-- Une valeur d'externalité sans source documentaire n'est pas auditable :
-- la contrainte est désormais portée par la base ET par l'API.
ALTER TABLE reference_benchmarks DROP CONSTRAINT IF EXISTS reference_benchmarks_category_check;

CREATE INDEX IF NOT EXISTS idx_benchmarks_org ON reference_benchmarks(organization_id);
CREATE INDEX IF NOT EXISTS idx_benchmarks_category ON reference_benchmarks(category);

DROP TRIGGER IF EXISTS trigger_update_reference_benchmarks_updated_at ON reference_benchmarks;
CREATE TRIGGER trigger_update_reference_benchmarks_updated_at
BEFORE UPDATE ON reference_benchmarks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- 11. AUDIT_LOGS — journal d'audit (immuable par convention applicative)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255) NOT NULL,
    user_role VARCHAR(50) NOT NULL,
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    entity_name VARCHAR(255) NOT NULL,
    field_changed VARCHAR(255) NOT NULL,
    old_value TEXT NOT NULL DEFAULT 'n/a',
    new_value TEXT NOT NULL DEFAULT 'n/a',
    justification TEXT NOT NULL DEFAULT 'n/a',
    correlation_id VARCHAR(64)
);

-- Divergence corrigée : la colonne était déclarée `newValue` (casse CamelCase)
-- dans le schéma Drizzle, ce qui ne correspond pas au nom SQL réel `new_value`.
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS correlation_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_timestamp ON audit_logs(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON audit_logs(project_id);

-- =============================================================================
-- 12. API_USAGE — mesure d'usage & quotas (préparation de la facturation)
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_usage (
    id BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(50) NOT NULL,
    resource VARCHAR(255),
    quantity INTEGER NOT NULL DEFAULT 1,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_api_usage_org_time ON api_usage(organization_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_type ON api_usage(event_type);

-- =============================================================================
-- NOTE D'ARCHITECTURE — ISOLATION MULTI-TENANT
-- =============================================================================
-- L'isolation est aujourd'hui portée par :
--   1. le serveur (server/auth.ts) qui déduit l'organisation de la session et
--      refuse tout accès inter-tenant ;
--   2. les clés étrangères et index composites (organization_id en tête).
--
-- ÉTAPE SUIVANTE RECOMMANDÉE POUR L'ENTERPRISE : activer RLS PostgreSQL sur
-- chaque table et forcer le contexte de tenant au niveau de la connexion
-- (SET LOCAL app.current_organization_id = ...). Cela protège même en cas de
-- requête oubliant le filtre `WHERE organization_id = ...`.
-- Aucune table de ce schéma ne doit être exposée directement à PostgREST /
-- Supabase sans que RLS soit activée.

-- Fin du script DDL
