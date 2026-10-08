-- =============================================================================
-- TRUETCO — MIGRATION 0001 : SOCLE DE DONNÉES (SOURCE DE VÉRITÉ UNIQUE)
-- =============================================================================
-- PRINCIPES STRUCTURANTS
--  1. PostgreSQL est la SEULE source de vérité. Le navigateur n'est qu'un cache.
--  2. TOUTE table métier porte `organization_id` — y compris les tables filles
--     (postes de coût, carbone, risques). Cette dénormalisation volontaire
--     permet d'appliquer le Row Level Security sans jointure et rend les index
--     composites directement exploitables (organization_id en tête).
--  3. Aucune donnée de démonstration n'est insérée ici : le jeu de démonstration
--     est chargé explicitement par `scripts/seed-demo.mjs` et TOUTES ses lignes
--     portent `is_demo = true`.
--  4. Les colonnes de RÉSULTAT (TCO, LCC…) ne sont jamais la source de vérité :
--     elles sont recalculées par le moteur et stockées avec la version du moteur
--     qui les a produites, uniquement pour l'historique et la comparaison.
-- =============================================================================

-- `gen_random_uuid()` est natif depuis PostgreSQL 13. L'extension pgcrypto n'est
-- plus nécessaire ; elle est tentée sans échec bloquant pour les bases plus
-- anciennes (et pour les moteurs PostgreSQL embarqués qui ne l'exposent pas).
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
EXCEPTION WHEN OTHERS THEN
    NULL;
END
$$;

-- -----------------------------------------------------------------------------
-- Journal des migrations appliquées (le runner l'utilise et le complète)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    version      VARCHAR(20) PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    checksum     CHAR(64) NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    duration_ms  INTEGER
);

-- -----------------------------------------------------------------------------
-- Fonction générique de mise à jour de updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION truetco_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 1. ORGANIZATIONS
-- =============================================================================
CREATE TABLE IF NOT EXISTS organizations (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                      VARCHAR(255) NOT NULL,
    slug                      VARCHAR(60)  NOT NULL,
    domain                    VARCHAR(255),
    subscription_tier         VARCHAR(30)  NOT NULL DEFAULT 'starter'
                              CHECK (subscription_tier IN ('starter', 'professional', 'enterprise')),
    subscription_status       VARCHAR(20)  NOT NULL DEFAULT 'trialing'
                              CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'canceled')),
    data_residency            VARCHAR(60)  NOT NULL DEFAULT 'EU-FRANCE-PARIS',
    legal_registration_number VARCHAR(50),
    country_code              VARCHAR(2)   NOT NULL DEFAULT 'FR',
    default_currency          VARCHAR(3)   NOT NULL DEFAULT 'EUR',
    fiscal_year_start_month   SMALLINT     NOT NULL DEFAULT 1
                              CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    -- RGPD : horodatage de la demande de suppression (purge différée contrôlée)
    deletion_requested_at     TIMESTAMPTZ,
    is_demo                   BOOLEAN      NOT NULL DEFAULT FALSE,
    is_active                 BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at                TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_slug ON organizations (lower(slug));
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_domain ON organizations (lower(domain)) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations (is_active);

DROP TRIGGER IF EXISTS trg_organizations_touch ON organizations;
CREATE TRIGGER trg_organizations_touch BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION truetco_touch_updated_at();

-- =============================================================================
-- 2. USERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    -- Rôles alignés sur le modèle RBAC de server/auth.ts (§9 du cahier des charges)
    role            VARCHAR(50)  NOT NULL DEFAULT 'viewer'
                    CHECK (role IN ('platform_admin', 'org_admin', 'procurement',
                                    'finance', 'esg', 'approver', 'viewer')),
    department      VARCHAR(255),
    -- Provisionnement : un utilisateur créé par invitation doit accepter avant d'être actif
    status          VARCHAR(20)  NOT NULL DEFAULT 'invited'
                    CHECK (status IN ('invited', 'active', 'suspended')),
    idp_provider    VARCHAR(50),
    idp_subject     VARCHAR(255),
    mfa_enrolled    BOOLEAN NOT NULL DEFAULT FALSE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_org_email UNIQUE (organization_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users (organization_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (lower(email));
-- Un même sujet IdP ne peut correspondre qu'à un utilisateur (anti-collision de provisioning)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_idp_subject
    ON users (idp_provider, idp_subject) WHERE idp_subject IS NOT NULL;

DROP TRIGGER IF EXISTS trg_users_touch ON users;
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION truetco_touch_updated_at();

-- =============================================================================
-- 3. INVITATIONS (provisionnement d'équipe, sans dépendre d'un IdP)
-- =============================================================================
CREATE TABLE IF NOT EXISTS invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    role            VARCHAR(50)  NOT NULL CHECK (role IN ('org_admin', 'procurement', 'finance', 'esg', 'approver', 'viewer')),
    -- Jeton d'invitation stocké HACHÉ (jamais en clair), à usage unique
    token_hash      CHAR(64) NOT NULL,
    invited_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at      TIMESTAMPTZ NOT NULL,
    accepted_at     TIMESTAMPTZ,
    accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invitations_token ON invitations (token_hash);
CREATE INDEX IF NOT EXISTS idx_invitations_org ON invitations (organization_id);

-- =============================================================================
-- 4. USER_SESSIONS (jeton haché SHA-256, jamais en clair)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      CHAR(64) NOT NULL,
    auth_method     VARCHAR(50) NOT NULL DEFAULT 'local_password',
    ip_address      VARCHAR(64),
    user_agent      VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_token ON user_sessions (token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions (expires_at);

-- =============================================================================
-- 5. PROJECTS (dossier d'achat / « décision »)
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    reference              VARCHAR(100) NOT NULL,
    name                   VARCHAR(255) NOT NULL,
    description            TEXT,
    category               VARCHAR(100) NOT NULL,
    company_name           VARCHAR(255),
    budget_cap             NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (budget_cap >= 0),
    currency                VARCHAR(3) NOT NULL DEFAULT 'EUR',
    planned_volume         INTEGER NOT NULL DEFAULT 1 CHECK (planned_volume > 0),
    unit_name              VARCHAR(50) NOT NULL DEFAULT 'unités',
    horizon_years          INTEGER NOT NULL DEFAULT 5 CHECK (horizon_years BETWEEN 1 AND 50),
    -- Workflow d'approbation (§26) : brouillon → revues → approbation → décision → verrouillé
    workflow_status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                           CHECK (workflow_status IN ('draft', 'data_review', 'finance_review',
                                                      'esg_review', 'approval', 'decision', 'locked')),
    version                INTEGER NOT NULL DEFAULT 1,
    locked_at              TIMESTAMPTZ,
    locked_by              UUID REFERENCES users(id) ON DELETE SET NULL,
    discount_rate          NUMERIC(6, 4) NOT NULL DEFAULT 0.0500 CHECK (discount_rate >= 0 AND discount_rate <= 0.50),
    energy_inflation_rate  NUMERIC(6, 4) NOT NULL DEFAULT 0.0400,
    general_inflation_rate NUMERIC(6, 4) NOT NULL DEFAULT 0.0200,
    carbon_price_per_tonne NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (carbon_price_per_tonne >= 0),
    created_by             UUID REFERENCES users(id) ON DELETE SET NULL,
    is_demo                BOOLEAN NOT NULL DEFAULT FALSE,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_projects_org_ref UNIQUE (organization_id, reference)
);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_workflow ON projects (organization_id, workflow_status);

DROP TRIGGER IF EXISTS trg_projects_touch ON projects;
CREATE TRIGGER trg_projects_touch BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION truetco_touch_updated_at();

-- =============================================================================
-- 6. SUPPLIERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS suppliers (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name                           VARCHAR(255) NOT NULL,
    country_code                   VARCHAR(2) NOT NULL DEFAULT 'FR',
    incoterm                       VARCHAR(10) NOT NULL DEFAULT 'DDP',
    payment_terms_days             INTEGER NOT NULL DEFAULT 30,
    standard_lead_time_days        INTEGER NOT NULL DEFAULT 30,
    minimum_order_quantity         INTEGER NOT NULL DEFAULT 1,
    warranty_months                INTEGER NOT NULL DEFAULT 0,
    historical_defect_rate         NUMERIC(6, 4) NOT NULL DEFAULT 0 CHECK (historical_defect_rate BETWEEN 0 AND 1),
    esg_score                      INTEGER CHECK (esg_score BETWEEN 0 AND 100),
    has_verified_environmental_data BOOLEAN NOT NULL DEFAULT FALSE,
    environmental_data_source      TEXT,
    certifications                 TEXT[],
    data_quality_score             INTEGER CHECK (data_quality_score BETWEEN 0 AND 100),
    is_demo                        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_suppliers_org_name UNIQUE (organization_id, name)
);
CREATE INDEX IF NOT EXISTS idx_suppliers_org ON suppliers (organization_id);

DROP TRIGGER IF EXISTS trg_suppliers_touch ON suppliers;
CREATE TRIGGER trg_suppliers_touch BEFORE UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION truetco_touch_updated_at();

-- =============================================================================
-- 7. SUPPLIER_OFFERS
-- =============================================================================
CREATE TABLE IF NOT EXISTS supplier_offers (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id               UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    supplier_id              UUID REFERENCES suppliers(id) ON DELETE RESTRICT,
    supplier_name            VARCHAR(255) NOT NULL,
    offer_reference          VARCHAR(100) NOT NULL,
    apparent_total           NUMERIC(16, 2) NOT NULL DEFAULT 0 CHECK (apparent_total >= 0),
    quantity                 INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    currency                 VARCHAR(3) NOT NULL DEFAULT 'EUR',
    delivery_lead_time_weeks INTEGER NOT NULL DEFAULT 0,
    warranty_months          INTEGER NOT NULL DEFAULT 0,
    expected_lifespan_years  INTEGER NOT NULL DEFAULT 0,
    technical_suitability_score INTEGER CHECK (technical_suitability_score BETWEEN 0 AND 100),
    is_responsible_candidate BOOLEAN NOT NULL DEFAULT FALSE,
    -- Provenance : toute offre doit indiquer d'où viennent ses données
    data_source              VARCHAR(30) NOT NULL DEFAULT 'manual'
                             CHECK (data_source IN ('manual', 'import_xlsx', 'import_csv', 'erp', 'api')),
    import_batch_id          UUID,
    -- Résultats : recalculés par le moteur, jamais édités à la main
    computed_tco_nominal     NUMERIC(18, 2),
    computed_lcc             NUMERIC(18, 2),
    computed_carbon_tonnes   NUMERIC(18, 3),
    computed_confidence      INTEGER CHECK (computed_confidence BETWEEN 0 AND 100),
    engine_version           VARCHAR(20),
    computed_at              TIMESTAMPTZ,
    is_demo                  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_offers_project_ref UNIQUE (project_id, offer_reference)
);
CREATE INDEX IF NOT EXISTS idx_offers_project ON supplier_offers (organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_offers_supplier ON supplier_offers (organization_id, supplier_id);

DROP TRIGGER IF EXISTS trg_offers_touch ON supplier_offers;
CREATE TRIGGER trg_offers_touch BEFORE UPDATE ON supplier_offers
FOR EACH ROW EXECUTE FUNCTION truetco_touch_updated_at();

-- =============================================================================
-- 8. COST_ITEMS (postes de coût — ventilation analytique)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cost_items (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    offer_id             UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    category             VARCHAR(100) NOT NULL,
    label                VARCHAR(255) NOT NULL,
    amount               NUMERIC(18, 2) NOT NULL,
    currency             VARCHAR(3) NOT NULL DEFAULT 'EUR',
    unit                 VARCHAR(50) NOT NULL DEFAULT '€',
    quantity             NUMERIC(18, 4),
    unit_price           NUMERIC(18, 4),
    -- Statut de qualité de la donnée (§11) : VALID | WARNING | ESTIMATED | UNSOURCED | MISSING | ERROR
    quality_status       VARCHAR(20) NOT NULL DEFAULT 'unsourced'
                         CHECK (quality_status IN ('valid', 'warning', 'estimated', 'unsourced', 'missing', 'error', 'demo')),
    source_name          VARCHAR(255),
    source_type          VARCHAR(50) NOT NULL DEFAULT 'manquante',
    source_document_id   UUID,
    confidence_level     INTEGER NOT NULL DEFAULT 0 CHECK (confidence_level BETWEEN 0 AND 100),
    is_recurring_yearly  BOOLEAN NOT NULL DEFAULT FALSE,
    yearly_inflation_type VARCHAR(20)
                         CHECK (yearly_inflation_type IN ('energy', 'general', 'none')),
    year_occurrences     INTEGER[],
    calculation_formula  TEXT,
    explanation_notes    TEXT,
    is_demo              BOOLEAN NOT NULL DEFAULT FALSE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cost_items_offer ON cost_items (organization_id, offer_id);
CREATE INDEX IF NOT EXISTS idx_cost_items_quality ON cost_items (organization_id, quality_status);

-- =============================================================================
-- 9. CARBON_ITEMS
-- =============================================================================
CREATE TABLE IF NOT EXISTS carbon_items (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    offer_id                       UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    scope                          VARCHAR(40) NOT NULL,
    lifecycle_phase                VARCHAR(50) NOT NULL,
    emissions_per_unit_tonne_co2e  NUMERIC(16, 8),
    total_lifecycle_emissions      NUMERIC(18, 6),
    emission_factor_source         VARCHAR(255),
    -- Lien vers la bibliothèque de facteurs : la source est une RÉFÉRENCE, pas un texte libre
    emission_factor_id             UUID,
    emission_factor_version        VARCHAR(30),
    factor_verified                BOOLEAN NOT NULL DEFAULT FALSE,
    quality_status                 VARCHAR(20) NOT NULL DEFAULT 'unsourced'
                                   CHECK (quality_status IN ('valid', 'warning', 'estimated', 'unsourced', 'missing', 'error', 'demo')),
    confidence_level               INTEGER NOT NULL DEFAULT 0 CHECK (confidence_level BETWEEN 0 AND 100),
    is_demo                        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_carbon_items_offer ON carbon_items (organization_id, offer_id);

-- =============================================================================
-- 10. RISK_ITEMS
-- =============================================================================
CREATE TABLE IF NOT EXISTS risk_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    offer_id          UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    description       TEXT NOT NULL,
    category          VARCHAR(50),
    probability       NUMERIC(6, 4) NOT NULL CHECK (probability BETWEEN 0 AND 1),
    financial_impact  NUMERIC(18, 2) NOT NULL CHECK (financial_impact >= 0),
    probability_type  VARCHAR(30) NOT NULL DEFAULT 'expert_judgement'
                      CHECK (probability_type IN ('expert_judgement', 'historical', 'supplier_data', 'monte_carlo')),
    mitigation_notes  TEXT,
    confidence_level  INTEGER NOT NULL DEFAULT 0 CHECK (confidence_level BETWEEN 0 AND 100),
    is_demo           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_risk_items_offer ON risk_items (organization_id, offer_id);

-- =============================================================================
-- 11. ESG_FACTORS — bibliothèque d'externalités sourcée et versionnée (§16)
-- =============================================================================
CREATE TABLE IF NOT EXISTS esg_factors (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- NULL = facteur de plateforme (partagé, lecture seule pour les organisations)
    organization_id  UUID REFERENCES organizations(id) ON DELETE CASCADE,
    code             VARCHAR(80) NOT NULL,
    name             VARCHAR(255) NOT NULL,
    category         VARCHAR(40) NOT NULL
                     CHECK (category IN ('carbon', 'energy', 'water', 'waste', 'transport', 'wacc', 'other')),
    unit             VARCHAR(50) NOT NULL,
    value            NUMERIC(20, 8) NOT NULL,
    currency         VARCHAR(3),
    country_code     VARCHAR(2),
    region           VARCHAR(100),
    scope            VARCHAR(60),
    -- Provenance : la source est OBLIGATOIRE. Un facteur sans source ne peut pas
    -- être marqué vérifié (contrainte ci-dessous).
    source_publisher VARCHAR(255) NOT NULL,
    source_publication VARCHAR(255),
    source_url       VARCHAR(500),
    source_document_ref VARCHAR(255),
    publication_date DATE,
    valid_from       DATE,
    valid_to         DATE,
    methodology      TEXT,
    -- Vérification : 'unverified' tant qu'un humain n'a pas contrôlé la source
    verification_status VARCHAR(20) NOT NULL DEFAULT 'unverified'
                        CHECK (verification_status IN ('unverified', 'source_to_verify', 'verified')),
    verified_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at      TIMESTAMPTZ,
    confidence_level INTEGER CHECK (confidence_level BETWEEN 0 AND 100),
    version          INTEGER NOT NULL DEFAULT 1,
    is_demo          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_esg_factors_code_version UNIQUE (organization_id, code, version),
    -- Une donnée « vérifiée » doit porter un vérificateur, une date et une URL ou référence
    CONSTRAINT ck_esg_factor_verified_complete CHECK (
        verification_status <> 'verified'
        OR (verified_by IS NOT NULL AND verified_at IS NOT NULL
            AND (source_url IS NOT NULL OR source_document_ref IS NOT NULL))
    )
);
CREATE INDEX IF NOT EXISTS idx_esg_factors_org ON esg_factors (organization_id, category);
CREATE INDEX IF NOT EXISTS idx_esg_factors_code ON esg_factors (code);

DROP TRIGGER IF EXISTS trg_esg_factors_touch ON esg_factors;
CREATE TRIGGER trg_esg_factors_touch BEFORE UPDATE ON esg_factors
FOR EACH ROW EXECUTE FUNCTION truetco_touch_updated_at();

-- =============================================================================
-- 12. CURRENCY_RATES (multi-devises — jamais de taux arbitraire, §15)
-- =============================================================================
CREATE TABLE IF NOT EXISTS currency_rates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_currency  VARCHAR(3) NOT NULL,
    quote_currency VARCHAR(3) NOT NULL,
    rate           NUMERIC(20, 10) NOT NULL CHECK (rate > 0),
    rate_date      DATE NOT NULL,
    source         VARCHAR(255) NOT NULL,
    source_url     VARCHAR(500),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_currency_rates UNIQUE (base_currency, quote_currency, rate_date, source)
);
CREATE INDEX IF NOT EXISTS idx_currency_rates_lookup ON currency_rates (base_currency, quote_currency, rate_date DESC);

-- =============================================================================
-- 13. DOCUMENTS (stockage documentaire, §24)
-- =============================================================================
CREATE TABLE IF NOT EXISTS documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id        UUID REFERENCES projects(id) ON DELETE CASCADE,
    offer_id          UUID REFERENCES supplier_offers(id) ON DELETE SET NULL,
    original_filename VARCHAR(255) NOT NULL,
    mime_type         VARCHAR(127) NOT NULL,
    size_bytes        BIGINT NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 52428800),
    -- Empreinte d'intégrité du contenu (SHA-256 réel, calculé côté serveur)
    content_sha256    CHAR(64) NOT NULL,
    storage_key       VARCHAR(500) NOT NULL,
    storage_backend   VARCHAR(30) NOT NULL DEFAULT 'database'
                      CHECK (storage_backend IN ('database', 'filesystem', 's3')),
    -- Résultat de l'analyse de sécurité du fichier (§24)
    scan_status       VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (scan_status IN ('pending', 'clean', 'infected', 'rejected', 'skipped_no_scanner')),
    scan_details      TEXT,
    uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    is_demo           BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_documents_sha UNIQUE (organization_id, content_sha256)
);
CREATE INDEX IF NOT EXISTS idx_documents_org ON documents (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents (organization_id, project_id);

CREATE TABLE IF NOT EXISTS document_contents (
    document_id UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
    content     BYTEA NOT NULL
);

-- =============================================================================
-- 14. IMPORT_BATCHES + IMPORT_ROWS (Import Center, §10)
-- =============================================================================
CREATE TABLE IF NOT EXISTS import_batches (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id       UUID REFERENCES projects(id) ON DELETE SET NULL,
    document_id      UUID REFERENCES documents(id) ON DELETE SET NULL,
    format           VARCHAR(20) NOT NULL CHECK (format IN ('xlsx', 'csv')),
    status           VARCHAR(20) NOT NULL DEFAULT 'uploaded'
                     CHECK (status IN ('uploaded', 'mapped', 'validated', 'committed', 'failed', 'abandoned')),
    -- Mapping de colonnes VALIDÉ par un humain : { "colonne_source": "champ_cible" }
    column_mapping   JSONB,
    row_count        INTEGER NOT NULL DEFAULT 0,
    imported_offers  INTEGER NOT NULL DEFAULT 0,
    error_count      INTEGER NOT NULL DEFAULT 0,
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    committed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_import_batches_org ON import_batches (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS import_rows (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    batch_id       UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
    row_number     INTEGER NOT NULL,
    raw_data       JSONB NOT NULL,
    normalized     JSONB,
    -- Statut par ligne : le produit affiche exactement ce qui bloque
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'valid', 'warning', 'error', 'skipped', 'committed')),
    messages       JSONB,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON import_rows (organization_id, batch_id, row_number);

-- =============================================================================
-- 15. DECISION_RUNS / DECISION_RESULTS (calculs versionnés et rejouables, §41)
-- =============================================================================
CREATE TABLE IF NOT EXISTS decision_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    run_by              UUID REFERENCES users(id) ON DELETE SET NULL,
    engine_version      VARCHAR(20) NOT NULL,
    methodology_version VARCHAR(20) NOT NULL,
    input_version       INTEGER NOT NULL,
    -- Hypothèses réellement utilisées (snapshot complet → rejouabilité)
    assumptions         JSONB NOT NULL,
    -- Facteurs ESG utilisés, avec leur identifiant et leur version
    factor_versions     JSONB,
    results             JSONB NOT NULL,
    recommended_offer_id UUID,
    is_demo             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_decision_runs_project ON decision_runs (organization_id, project_id, created_at DESC);

-- =============================================================================
-- 16. APPROVALS (workflow, §26)
-- =============================================================================
CREATE TABLE IF NOT EXISTS approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    stage           VARCHAR(30) NOT NULL
                    CHECK (stage IN ('data_review', 'finance_review', 'esg_review', 'approval')),
    decision        VARCHAR(20) NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name      VARCHAR(255) NOT NULL,
    actor_role      VARCHAR(50) NOT NULL,
    comment         TEXT,
    -- Engagement de la décision : empreinte du run évalué (anti-modification silencieuse)
    decision_run_id UUID REFERENCES decision_runs(id) ON DELETE SET NULL,
    content_hash    CHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_approvals_project ON approvals (organization_id, project_id, created_at DESC);

-- =============================================================================
-- 17. AUDIT_LOGS (journal append-only, chaîné — §25)
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_name      VARCHAR(255) NOT NULL,
    actor_role      VARCHAR(50) NOT NULL,
    action          VARCHAR(60) NOT NULL,
    entity_type     VARCHAR(60) NOT NULL,
    entity_id       UUID,
    project_id      UUID,
    field_changed   VARCHAR(255),
    old_value       TEXT,
    new_value       TEXT,
    justification   TEXT,
    ip_address      VARCHAR(64),
    user_agent      VARCHAR(255),
    correlation_id  VARCHAR(64),
    -- Chaînage d'intégrité : hash(précédent_hash || contenu de l'entrée)
    previous_hash   CHAR(64),
    entry_hash      CHAR(64) NOT NULL,
    is_demo         BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_time ON audit_logs (organization_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (organization_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_project ON audit_logs (organization_id, project_id);

-- Le journal d'audit est WRITE-ONLY : aucune mise à jour ni suppression n'est
-- autorisée, y compris pour l'application elle-même.
CREATE OR REPLACE FUNCTION truetco_audit_logs_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Le journal d''audit est en append-only : % interdit (aucune modification ni suppression n''est autorisée).', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
CREATE TRIGGER trg_audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION truetco_audit_logs_immutable();

-- =============================================================================
-- 18. API_USAGE (quotas et facturation, §38)
-- =============================================================================
CREATE TABLE IF NOT EXISTS api_usage (
    id              BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    period_month    CHAR(7) NOT NULL,
    event_type      VARCHAR(50) NOT NULL,
    quantity        INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    metadata        JSONB
);
CREATE INDEX IF NOT EXISTS idx_api_usage_org_period ON api_usage (organization_id, period_month, event_type);

-- =============================================================================
-- 19. DÉCISION D'ARCHITECTURE — ISOLATION PAR RLS
-- =============================================================================
-- Le Row Level Security est activé par la migration 0002. Il s'applique à TOUS
-- les rôles, y compris au propriétaire des tables (FORCE ROW LEVEL SECURITY),
-- ce qui le rend effectif dans Neon comme en test local.
--
-- C'est pourquoi la résolution de session (qui doit lire avant de connaître
-- l'organisation) passe par une fonction SECURITY DEFINER étroite, et non par
-- une exception de policy.
