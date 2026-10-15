-- =============================================================================
-- 002_tenant_isolation.sql
-- Isolation multi-tenant en profondeur :
--   1. neutralisation des comptes issus de l'ancien flux d'authentification factice
--   2. organization_id sur toutes les tables enfants + clés étrangères COMPOSITES
--      (une offre ne peut plus référencer le projet/fournisseur d'un autre tenant,
--       même en cas de bug applicatif)
--   3. Row Level Security (fail-closed : sans contexte tenant => 0 ligne)
--   4. journal d'audit en écriture seule
--   5. rôle applicatif truetco_app sans BYPASSRLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quarantaine des comptes hérités
-- L'ancien POST /api/auth/sso/login et POST /api/users/sync créaient des comptes
-- (rôle, email, organisation choisis par l'appelant, sans aucune vérification).
-- Aucun compte existant ne peut donc être considéré comme légitime : tous sont
-- désactivés et déliés de Clerk. Un administrateur doit être ré-amorcé avec
-- `npm run admin:bootstrap`, puis réinviter ses collègues.
-- -----------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS quarantined_at TIMESTAMPTZ;
UPDATE users
   SET is_active = FALSE, clerk_id = NULL, quarantined_at = CURRENT_TIMESTAMP
 WHERE quarantined_at IS NULL;

-- Sessions émises par l'ancien endpoint : invalidées par suppression de la table.
DROP TABLE IF EXISTS user_sessions;

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_org_clerk ON users(organization_id, clerk_id) WHERE clerk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_clerk ON users(clerk_id) WHERE clerk_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users(lower(email));

-- -----------------------------------------------------------------------------
-- 2. Détection de données déjà corrompues entre tenants (ancienne faille IDOR)
-- -----------------------------------------------------------------------------
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM supplier_offers o
    JOIN projects  p ON p.id = o.project_id
    JOIN suppliers s ON s.id = o.supplier_id
   WHERE p.organization_id <> s.organization_id;
  IF n > 0 THEN
    RAISE EXCEPTION 'Migration 002 interrompue : % offre(s) relient un projet et un fournisseur d''organisations différentes. Exécuter db/ops/cross-tenant-repair.sql, corriger puis relancer.', n;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. organization_id sur les tables enfants
-- -----------------------------------------------------------------------------
ALTER TABLE supplier_offers ADD COLUMN IF NOT EXISTS organization_id UUID;
UPDATE supplier_offers o SET organization_id = p.organization_id
  FROM projects p WHERE p.id = o.project_id AND o.organization_id IS NULL;
ALTER TABLE supplier_offers ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS organization_id UUID;
UPDATE cost_items c SET organization_id = o.organization_id
  FROM supplier_offers o WHERE o.id = c.offer_id AND c.organization_id IS NULL;
ALTER TABLE cost_items ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE carbon_items ADD COLUMN IF NOT EXISTS organization_id UUID;
UPDATE carbon_items c SET organization_id = o.organization_id
  FROM supplier_offers o WHERE o.id = c.offer_id AND c.organization_id IS NULL;
ALTER TABLE carbon_items ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE risk_items ADD COLUMN IF NOT EXISTS organization_id UUID;
UPDATE risk_items c SET organization_id = o.organization_id
  FROM supplier_offers o WHERE o.id = c.offer_id AND c.organization_id IS NULL;
ALTER TABLE risk_items ALTER COLUMN organization_id SET NOT NULL;

-- Clés d'unicité (organization_id, id) servant de cible aux FK composites
ALTER TABLE projects        DROP CONSTRAINT IF EXISTS uq_projects_org_id;
ALTER TABLE projects        ADD  CONSTRAINT uq_projects_org_id        UNIQUE (organization_id, id);
ALTER TABLE suppliers       DROP CONSTRAINT IF EXISTS uq_suppliers_org_id;
ALTER TABLE suppliers       ADD  CONSTRAINT uq_suppliers_org_id       UNIQUE (organization_id, id);
ALTER TABLE supplier_offers DROP CONSTRAINT IF EXISTS uq_offers_org_id;
ALTER TABLE supplier_offers ADD  CONSTRAINT uq_offers_org_id          UNIQUE (organization_id, id);

-- FK composites : l'enfant DOIT appartenir à la même organisation que son parent
ALTER TABLE supplier_offers DROP CONSTRAINT IF EXISTS supplier_offers_project_id_fkey;
ALTER TABLE supplier_offers DROP CONSTRAINT IF EXISTS supplier_offers_supplier_id_fkey;
ALTER TABLE supplier_offers DROP CONSTRAINT IF EXISTS fk_offers_org;
ALTER TABLE supplier_offers DROP CONSTRAINT IF EXISTS fk_offers_project_same_org;
ALTER TABLE supplier_offers DROP CONSTRAINT IF EXISTS fk_offers_supplier_same_org;
ALTER TABLE supplier_offers ADD CONSTRAINT fk_offers_org
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE supplier_offers ADD CONSTRAINT fk_offers_project_same_org
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, id) ON DELETE CASCADE;
ALTER TABLE supplier_offers ADD CONSTRAINT fk_offers_supplier_same_org
  FOREIGN KEY (organization_id, supplier_id) REFERENCES suppliers(organization_id, id) ON DELETE RESTRICT;

ALTER TABLE cost_items   DROP CONSTRAINT IF EXISTS cost_items_offer_id_fkey;
ALTER TABLE cost_items   DROP CONSTRAINT IF EXISTS fk_cost_items_offer_same_org;
ALTER TABLE cost_items   ADD CONSTRAINT fk_cost_items_offer_same_org
  FOREIGN KEY (organization_id, offer_id) REFERENCES supplier_offers(organization_id, id) ON DELETE CASCADE;

ALTER TABLE carbon_items DROP CONSTRAINT IF EXISTS carbon_items_offer_id_fkey;
ALTER TABLE carbon_items DROP CONSTRAINT IF EXISTS fk_carbon_items_offer_same_org;
ALTER TABLE carbon_items ADD CONSTRAINT fk_carbon_items_offer_same_org
  FOREIGN KEY (organization_id, offer_id) REFERENCES supplier_offers(organization_id, id) ON DELETE CASCADE;

ALTER TABLE risk_items   DROP CONSTRAINT IF EXISTS risk_items_offer_id_fkey;
ALTER TABLE risk_items   DROP CONSTRAINT IF EXISTS fk_risk_items_offer_same_org;
ALTER TABLE risk_items   ADD CONSTRAINT fk_risk_items_offer_same_org
  FOREIGN KEY (organization_id, offer_id) REFERENCES supplier_offers(organization_id, id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_offers_org_project  ON supplier_offers(organization_id, project_id);
CREATE INDEX IF NOT EXISTS idx_cost_items_org      ON cost_items(organization_id, offer_id);
CREATE INDEX IF NOT EXISTS idx_carbon_items_org    ON carbon_items(organization_id, offer_id);
CREATE INDEX IF NOT EXISTS idx_risk_items_org      ON risk_items(organization_id, offer_id);

-- -----------------------------------------------------------------------------
-- 4. Contexte de session (posé par le serveur, dans chaque transaction)
--    NULL / absent => aucune ligne visible (fail-closed)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_org_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_new_org_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.new_org_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_clerk_id() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.clerk_id', true), '') $$;

CREATE OR REPLACE FUNCTION app_verified_email() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT lower(NULLIF(current_setting('app.verified_email', true), '')) $$;

CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT COALESCE(current_setting('app.platform_admin', true), '') = 'true' $$;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','suppliers','supplier_offers','cost_items','carbon_items','risk_items','reference_benchmarks'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (organization_id = app_org_id()) WITH CHECK (organization_id = app_org_id())', t);
  END LOOP;
END $$;

-- users : visibles dans l'organisation active, OU sa propre ligne (résolution d'identité),
-- OU une invitation en attente correspondant à l'email VÉRIFIÉ de l'appelant.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;
DROP POLICY IF EXISTS users_delete ON users;
CREATE POLICY users_select ON users FOR SELECT USING (
     organization_id = app_org_id()
  OR (clerk_id IS NOT NULL AND clerk_id = app_clerk_id())
  OR (clerk_id IS NULL AND is_active AND lower(email) = app_verified_email())
);
CREATE POLICY users_insert ON users FOR INSERT WITH CHECK (organization_id = app_org_id());
CREATE POLICY users_update ON users FOR UPDATE
  USING (
       organization_id = app_org_id()
    OR (clerk_id IS NOT NULL AND clerk_id = app_clerk_id())
    OR (clerk_id IS NULL AND is_active AND lower(email) = app_verified_email())
  )
  WITH CHECK (organization_id = app_org_id() OR clerk_id = app_clerk_id());
CREATE POLICY users_delete ON users FOR DELETE USING (organization_id = app_org_id());

-- organizations : celles dont l'appelant est membre ; création uniquement via app.new_org_id
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orgs_select ON organizations;
DROP POLICY IF EXISTS orgs_insert ON organizations;
DROP POLICY IF EXISTS orgs_update ON organizations;
CREATE POLICY orgs_select ON organizations FOR SELECT USING (
     id = app_org_id()
  OR id = app_new_org_id()
  OR id IN (SELECT organization_id FROM users WHERE clerk_id IS NOT NULL AND clerk_id = app_clerk_id() AND is_active)
  OR app_is_platform_admin()
);
CREATE POLICY orgs_insert ON organizations FOR INSERT WITH CHECK (id = app_new_org_id());
CREATE POLICY orgs_update ON organizations FOR UPDATE USING (id = app_org_id()) WITH CHECK (id = app_org_id());

-- audit_logs : lecture + insertion uniquement, dans l'organisation active
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_select ON audit_logs;
DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_select ON audit_logs FOR SELECT USING (organization_id = app_org_id());
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (organization_id = app_org_id());

-- -----------------------------------------------------------------------------
-- 6. Journal d'audit en écriture seule (protège aussi contre le propriétaire de la base)
--    La purge (offboarding d'un tenant, effacement RGPD) exige app.audit_purge = 'on'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs est en écriture seule (UPDATE interdit)' USING ERRCODE = '42501';
  ELSIF TG_OP = 'DELETE' THEN
    IF COALESCE(current_setting('app.audit_purge', true), '') <> 'on' THEN
      RAISE EXCEPTION 'audit_logs est en écriture seule (DELETE interdit)' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  ELSE
    RAISE EXCEPTION 'audit_logs est en écriture seule (TRUNCATE interdit)' USING ERRCODE = '42501';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_audit_logs_row_guard ON audit_logs;
CREATE TRIGGER trg_audit_logs_row_guard BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();
DROP TRIGGER IF EXISTS trg_audit_logs_truncate_guard ON audit_logs;
CREATE TRIGGER trg_audit_logs_truncate_guard BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_guard();

-- -----------------------------------------------------------------------------
-- 7. Rôle applicatif : jamais propriétaire, jamais BYPASSRLS
--    L'exploitant fait `ALTER ROLE truetco_app LOGIN PASSWORD '...'` hors migration.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'truetco_app') THEN
    CREATE ROLE truetco_app NOLOGIN NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO truetco_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organizations, users, projects, suppliers, supplier_offers, cost_items, carbon_items, risk_items, reference_benchmarks
  TO truetco_app;
GRANT SELECT, INSERT ON audit_logs TO truetco_app;
