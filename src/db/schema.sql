-- =============================================================================
-- TRUETCO - SCHEMA RELATIONNEL POSTGRESQL & DDL OFFICIEL
-- Application SaaS B2B d'Aide à la Décision & Arbitrage Coût Complet (TCO / LCC)
-- =============================================================================

-- Activation de l'extension pour les identifiants uniques
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Fonction générique pour la mise à jour automatique de updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 1. ORGANIZATIONS (Multi-Tenant Root)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    legal_registration_number VARCHAR(50), -- SIRET / Numéro TVA
    country_code VARCHAR(2) NOT NULL DEFAULT 'FR',
    default_currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);

DROP TRIGGER IF EXISTS trigger_update_organizations_updated_at ON organizations;
DROP TRIGGER IF EXISTS trigger_update_organizations_updated_at ON organizations;
CREATE TRIGGER trigger_update_organizations_updated_at
BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 2. USERS (Utilisateurs & Droits RBAC)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN (
        'directeur_achats',
        'acheteur',
        'finance_controleur',
        'rse_esg',
        'direction_generale',
        'admin'
    )),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_org_email UNIQUE (organization_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

DROP TRIGGER IF EXISTS trigger_update_users_updated_at ON users;
CREATE TRIGGER trigger_update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 3. PROJECTS (Consultations d'Achats & Marchés)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    reference VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    budget_cap NUMERIC(14, 2) NOT NULL CHECK (budget_cap > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    planned_volume INTEGER NOT NULL CHECK (planned_volume > 0),
    unit_name VARCHAR(50) NOT NULL,
    horizon_years INTEGER NOT NULL CHECK (horizon_years BETWEEN 1 AND 15),
    status VARCHAR(50) NOT NULL DEFAULT 'brouillon' CHECK (status IN (
        'brouillon',
        'collecte_offres',
        'analyse',
        'validation_finance',
        'validation_achats',
        'decision',
        'termine',
        'archive',
        'Brouillon',
        'Cahier des charges',
        'Consultation',
        'Analyse',
        'Validation Finance',
        'Validation Achats',
        'Décision',
        'Contractualisé',
        'En exploitation',
        'Archivé',
        'Terminé / Arbitré'
    )),
    discount_rate NUMERIC(6, 4) NOT NULL CHECK (discount_rate >= 0), -- Taux WACC
    energy_inflation_rate NUMERIC(6, 4) NOT NULL,
    general_inflation_rate NUMERIC(6, 4) NOT NULL,
    carbon_price_per_tonne NUMERIC(10, 2) NOT NULL DEFAULT 120.00, -- Quinet €/tCO2e
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_projects_org_ref UNIQUE (organization_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_category ON projects(category);

DROP TRIGGER IF EXISTS trigger_update_projects_updated_at ON projects;
CREATE TRIGGER trigger_update_projects_updated_at
BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 4. SUPPLIERS (Référentiel Fournisseurs & Qualification Métier)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    incoterm VARCHAR(10) NOT NULL DEFAULT 'DDP',
    payment_terms_days INTEGER NOT NULL DEFAULT 30,
    standard_lead_time_days INTEGER NOT NULL,
    minimum_order_quantity INTEGER NOT NULL DEFAULT 1,
    warranty_months INTEGER NOT NULL DEFAULT 24,
    historical_defect_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0200,
    esg_score INTEGER NOT NULL DEFAULT 70 CHECK (esg_score BETWEEN 0 AND 100),
    has_verified_environmental_data BOOLEAN NOT NULL DEFAULT FALSE,
    environmental_data_source TEXT,
    certifications TEXT[],
    data_quality_score INTEGER NOT NULL DEFAULT 85 CHECK (data_quality_score BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_suppliers_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers(organization_id);

DROP TRIGGER IF EXISTS trigger_update_suppliers_updated_at ON suppliers;
CREATE TRIGGER trigger_update_suppliers_updated_at
BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 5. SUPPLIER OFFERS (Propositions Fournisseurs par Consultation)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    offer_reference VARCHAR(100) NOT NULL,
    apparent_total NUMERIC(14, 2) NOT NULL CHECK (apparent_total >= 0),
    is_responsible_candidate BOOLEAN NOT NULL DEFAULT FALSE,
    economic_tco_nominal NUMERIC(14, 2),
    lifecycle_cost_lcc NUMERIC(14, 2),
    total_lifecycle_co2e_tonnes NUMERIC(10, 3),
    monetized_carbon_total NUMERIC(14, 2),
    risk_exposition_total NUMERIC(14, 2),
    total_comprehensive_tco NUMERIC(14, 2),
    confidence_score INTEGER NOT NULL DEFAULT 85 CHECK (confidence_score BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_offers_project_ref UNIQUE (project_id, offer_reference)
);

CREATE INDEX IF NOT EXISTS idx_offers_project ON supplier_offers(project_id);
CREATE INDEX IF NOT EXISTS idx_offers_supplier ON supplier_offers(supplier_id);

DROP TRIGGER IF EXISTS trigger_update_supplier_offers_updated_at ON supplier_offers;
CREATE TRIGGER trigger_update_supplier_offers_updated_at
BEFORE UPDATE ON supplier_offers
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 6. COST ITEMS (Ventilation Analytique du TCO / CBS)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    category VARCHAR(100) NOT NULL,
    label VARCHAR(255) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    unit VARCHAR(50) NOT NULL,
    source_name VARCHAR(255) NOT NULL,
    source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('verifiee', 'calculee', 'estimee')),
    confidence_level INTEGER NOT NULL CHECK (confidence_level BETWEEN 0 AND 100),
    is_recurring_yearly BOOLEAN NOT NULL DEFAULT FALSE,
    calculation_formula TEXT,
    explanation_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cost_items_offer ON cost_items(offer_id);
CREATE INDEX IF NOT EXISTS idx_cost_items_category ON cost_items(category);

-- -----------------------------------------------------------------------------
-- 7. CARBON ITEMS (Bilan Émissions ACV Scopes 1, 2, 3)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carbon_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    scope VARCHAR(20) NOT NULL CHECK (scope IN ('Scope 1', 'Scope 2', 'Scope 3 Amont', 'Scope 3 Aval')),
    lifecycle_phase VARCHAR(100) NOT NULL,
    emissions_per_unit_tonne_co2e NUMERIC(10, 4) NOT NULL,
    total_lifecycle_emissions NUMERIC(12, 3) NOT NULL,
    emission_factor_source VARCHAR(255) NOT NULL,
    confidence_level INTEGER NOT NULL CHECK (confidence_level BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_carbon_items_offer ON carbon_items(offer_id);

-- -----------------------------------------------------------------------------
-- 8. RISK ITEMS (Événements Risques Probabilisés P x I)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS risk_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    probability NUMERIC(5, 4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
    financial_impact NUMERIC(14, 2) NOT NULL CHECK (financial_impact >= 0),
    source_evidence TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_risk_items_offer ON risk_items(offer_id);

-- -----------------------------------------------------------------------------
-- 9. REFERENCE BENCHMARKS (Référentiel Institutionnel des Facteurs Externes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reference_benchmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL CHECK (category IN ('energie', 'carbone', 'financier', 'social', 'dechets', 'wacc', 'pollution_locale', 'main_d_oeuvre', 'taux_interet')),
    source VARCHAR(255) NOT NULL,
    value NUMERIC(14, 4) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL,
    confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
    last_audit_date TIMESTAMPTZ NOT NULL,
    legal_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_benchmarks_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_org ON reference_benchmarks(organization_id);
CREATE INDEX IF NOT EXISTS idx_benchmarks_category ON reference_benchmarks(category);

DROP TRIGGER IF EXISTS trigger_update_reference_benchmarks_updated_at ON reference_benchmarks;
CREATE TRIGGER trigger_update_reference_benchmarks_updated_at
BEFORE UPDATE ON reference_benchmarks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- 10. AUDIT LOGS (Journal d'Audit Immuable Légal / CAC)
-- -----------------------------------------------------------------------------
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
    old_value TEXT NOT NULL,
    new_value TEXT NOT NULL,
    justification TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_timestamp ON audit_logs(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON audit_logs(project_id);

-- Fin du Script DDL
