-- =============================================================================
-- TRUETCO — MIGRATION 0002 : ISOLATION MULTI-TENANT PAR ROW LEVEL SECURITY
-- =============================================================================
-- MODÈLE DE SÉCURITÉ (important, à lire avant de modifier)
-- -----------------------------------------------------------------------------
-- Rôles :
--   * PROPRIÉTAIRE (owner) : exécute les migrations. Ne doit JAMAIS être utilisé
--     par le serveur applicatif en production (contrôle au démarrage).
--   * `truetco_app` (NOLOGIN) : rôle utilisé par le serveur pour toutes les
--     requêtes métier. Il n'est PAS propriétaire des tables, il est donc
--     intégralement soumis aux policies RLS.
--
-- Pourquoi certaines tables ne sont-elles pas en FORCE ROW LEVEL SECURITY ?
--   La résolution de session (« qui suis-je ? ») doit lire user_sessions, users
--   et organizations AVANT de connaître l'organisation. Elle passe par une
--   fonction SECURITY DEFINER étroite, qui s'exécute avec les privilèges du
--   propriétaire. Pour que cette fonction puisse lire ces trois tables, elles
--   sont protégées par RLS mais SANS FORCE (le propriétaire n'y est donc pas
--   soumis). TOUTES LES AUTRES tables métier sont en FORCE : même une connexion
--   propriétaire y est filtrée par organisation.
--   → En production, le serveur se connecte avec `truetco_app` : la distinction
--     est sans effet (le rôle applicatif n'est jamais propriétaire).
--
-- Défense en profondeur : le serveur vérifie au démarrage que la connexion n'est
--   pas propriétaire des tables en production, et refuse de démarrer sinon.
--
-- Ce que RLS garantit ici : même si une requête applicative oublie
--   `WHERE organization_id = ...`, la base ne renvoie ni ne modifie aucune ligne
--   appartenant à une autre organisation.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rôle applicatif
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'truetco_app') THEN
        CREATE ROLE truetco_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

-- Le propriétaire des tables doit pouvoir endosser ce rôle (SET ROLE)
DO $$
DECLARE
    owner_role TEXT;
BEGIN
    SELECT tableowner INTO owner_role FROM pg_tables WHERE tablename = 'organizations' LIMIT 1;
    IF owner_role IS NOT NULL THEN
        EXECUTE format('GRANT truetco_app TO %I', owner_role);
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Déjà accordé ou rôle non modifiable : sans conséquence sur les policies.
    NULL;
END
$$;

GRANT USAGE ON SCHEMA public TO truetco_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO truetco_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO truetco_app;
-- Les migrations sont hors périmètre du rôle applicatif
REVOKE ALL ON schema_migrations FROM truetco_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO truetco_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO truetco_app;

-- -----------------------------------------------------------------------------
-- Contexte d'organisation : jamais transmis par le client, toujours positionné
-- par le serveur dans la transaction courante, et lu ici uniquement.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION truetco_current_org()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.current_organization_id', TRUE), '')::uuid;
$$;

COMMENT ON FUNCTION truetco_current_org() IS
    'Organisation active de la transaction. NULL = aucune → toutes les policies refusent l''accès (fail closed).';

-- =============================================================================
-- ACTIVATION DU RLS
-- =============================================================================
-- Tables « identité » : RLS sans FORCE (lues par la fonction de résolution)
ALTER TABLE organizations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations     ENABLE ROW LEVEL SECURITY;

-- Tables métier : RLS FORCÉ (le propriétaire lui-même est filtré)
ALTER TABLE projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects          FORCE  ROW LEVEL SECURITY;
ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers         FORCE  ROW LEVEL SECURITY;
ALTER TABLE supplier_offers   ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_offers   FORCE  ROW LEVEL SECURITY;
ALTER TABLE cost_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_items        FORCE  ROW LEVEL SECURITY;
ALTER TABLE carbon_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE carbon_items      FORCE  ROW LEVEL SECURITY;
ALTER TABLE risk_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_items        FORCE  ROW LEVEL SECURITY;
ALTER TABLE documents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents         FORCE  ROW LEVEL SECURITY;
ALTER TABLE document_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_contents FORCE  ROW LEVEL SECURITY;
ALTER TABLE import_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_batches    FORCE  ROW LEVEL SECURITY;
ALTER TABLE import_rows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_rows       FORCE  ROW LEVEL SECURITY;
ALTER TABLE decision_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_runs     FORCE  ROW LEVEL SECURITY;
ALTER TABLE approvals         ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals         FORCE  ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        FORCE  ROW LEVEL SECURITY;
ALTER TABLE api_usage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_usage         FORCE  ROW LEVEL SECURITY;
ALTER TABLE esg_factors       ENABLE ROW LEVEL SECURITY;
ALTER TABLE esg_factors       FORCE  ROW LEVEL SECURITY;

-- =============================================================================
-- POLICIES — organisations
-- =============================================================================
DROP POLICY IF EXISTS organizations_select ON organizations;
CREATE POLICY organizations_select ON organizations
    FOR SELECT USING (
        id = truetco_current_org()
        -- Cas particulier maîtrisé : pendant l'enregistrement d'une organisation,
        -- le serveur positionne `app.pending_organization_id` (jamais l'org
        -- courante) pour permettre au nouvel admin de lire sa propre organisation.
        OR id = NULLIF(current_setting('app.pending_organization_id', TRUE), '')::uuid
    );

DROP POLICY IF EXISTS organizations_update ON organizations;
CREATE POLICY organizations_update ON organizations
    FOR UPDATE USING (id = truetco_current_org())
    WITH CHECK (id = truetco_current_org());

-- Aucune policy INSERT : la création d'organisation passe par la fonction
-- SECURITY DEFINER `truetco_register_organization` (contrôlée et atomique).

-- =============================================================================
-- POLICIES — users / sessions / invitations
-- =============================================================================
DROP POLICY IF EXISTS users_tenant ON users;
CREATE POLICY users_tenant ON users
    FOR ALL
    USING (organization_id = truetco_current_org())
    WITH CHECK (organization_id = truetco_current_org());

DROP POLICY IF EXISTS user_sessions_tenant ON user_sessions;
CREATE POLICY user_sessions_tenant ON user_sessions
    FOR ALL
    USING (organization_id = truetco_current_org())
    WITH CHECK (organization_id = truetco_current_org());

DROP POLICY IF EXISTS invitations_tenant ON invitations;
CREATE POLICY invitations_tenant ON invitations
    FOR ALL
    USING (organization_id = truetco_current_org())
    WITH CHECK (organization_id = truetco_current_org());

-- =============================================================================
-- POLICIES — tables métier (paires lecture/écriture explicites)
-- =============================================================================
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'projects', 'suppliers', 'supplier_offers', 'cost_items', 'carbon_items',
        'risk_items', 'documents', 'import_batches', 'import_rows',
        'decision_runs', 'approvals', 'api_usage'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
        EXECUTE format(
            'CREATE POLICY %I ON %I FOR ALL USING (organization_id = truetco_current_org()) WITH CHECK (organization_id = truetco_current_org())',
            t || '_tenant', t
        );
    END LOOP;
END
$$;

-- document_contents : rattaché via documents (pas de colonne organization_id)
DROP POLICY IF EXISTS document_contents_tenant ON document_contents;
CREATE POLICY document_contents_tenant ON document_contents
    FOR ALL
    USING (EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_contents.document_id
          AND d.organization_id = truetco_current_org()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id = document_contents.document_id
          AND d.organization_id = truetco_current_org()
    ));

-- =============================================================================
-- POLICIES — journal d'audit : lecture et ajout uniquement
-- =============================================================================
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs
    FOR SELECT USING (organization_id = truetco_current_org());

DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs
    FOR INSERT WITH CHECK (organization_id = truetco_current_org());

-- Aucune policy UPDATE/DELETE : la falsification du journal est impossible, y
-- compris pour le rôle applicatif (et le trigger de la migration 0001 bloque en
-- plus toute tentative, quel que soit le rôle).

-- =============================================================================
-- POLICIES — facteurs ESG
--   Lecture : facteurs de plateforme (organization_id IS NULL) + ceux de l'org
--   Écriture : uniquement les facteurs de l'organisation
-- =============================================================================
DROP POLICY IF EXISTS esg_factors_select ON esg_factors;
CREATE POLICY esg_factors_select ON esg_factors
    FOR SELECT USING (
        organization_id IS NULL OR organization_id = truetco_current_org()
    );

DROP POLICY IF EXISTS esg_factors_insert ON esg_factors;
CREATE POLICY esg_factors_insert ON esg_factors
    FOR INSERT WITH CHECK (organization_id = truetco_current_org());

DROP POLICY IF EXISTS esg_factors_update ON esg_factors;
CREATE POLICY esg_factors_update ON esg_factors
    FOR UPDATE USING (organization_id = truetco_current_org())
    WITH CHECK (organization_id = truetco_current_org());

DROP POLICY IF EXISTS esg_factors_delete ON esg_factors;
CREATE POLICY esg_factors_delete ON esg_factors
    FOR DELETE USING (organization_id = truetco_current_org());

-- currency_rates : référentiel de plateforme, lecture pour tous, écriture par
-- le propriétaire uniquement (migrations / administration des taux).
REVOKE INSERT, UPDATE, DELETE ON currency_rates FROM truetco_app;

-- =============================================================================
-- FONCTIONS DE PLATEFORME (SECURITY DEFINER, périmètre strict)
-- =============================================================================
-- Ces fonctions sont le SEUL chemin d'accès avant qu'une organisation soit
-- connue. Elles sont donc volontairement étroites : chacune fait une seule
-- chose, valide ses entrées, et ne renvoie que le nécessaire.

-- -----------------------------------------------------------------------------
-- Résolution de session à partir du hachage du jeton
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION truetco_resolve_session(p_token_hash TEXT)
RETURNS TABLE (
    session_id        UUID,
    expires_at        TIMESTAMPTZ,
    auth_method       VARCHAR,
    user_id           UUID,
    user_email        VARCHAR,
    user_full_name    VARCHAR,
    user_role         VARCHAR,
    user_department   VARCHAR,
    user_status       VARCHAR,
    organization_id   UUID,
    organization_name VARCHAR,
    organization_slug VARCHAR,
    data_residency    VARCHAR,
    default_currency  VARCHAR,
    country_code      VARCHAR
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT s.id, s.expires_at, s.auth_method,
           u.id, u.email, u.full_name, u.role, u.department, u.status,
           o.id, o.name, o.slug, o.data_residency, o.default_currency, o.country_code
    FROM user_sessions s
    JOIN users u         ON u.id = s.user_id
    JOIN organizations o ON o.id = s.organization_id
    WHERE s.token_hash = p_token_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.is_active = TRUE
      AND u.status = 'active'
      AND o.is_active = TRUE
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION truetco_resolve_session(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truetco_resolve_session(TEXT) TO truetco_app;

-- -----------------------------------------------------------------------------
-- Enregistrement d'une organisation + de son administrateur
-- Opération atomique : une organisation sans administrateur est inutilisable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION truetco_register_organization(
    p_name          TEXT,
    p_slug          TEXT,
    p_domain        TEXT,
    p_admin_email   TEXT,
    p_admin_name    TEXT,
    p_country_code  TEXT DEFAULT 'FR',
    p_currency      TEXT DEFAULT 'EUR'
)
RETURNS TABLE (organization_id UUID, user_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_org_id  UUID;
    v_user_id UUID;
    v_slug    TEXT;
BEGIN
    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'Le nom de l''organisation est obligatoire.' USING ERRCODE = 'check_violation';
    END IF;
    IF p_admin_email IS NULL OR position('@' IN p_admin_email) = 0 THEN
        RAISE EXCEPTION 'Adresse e-mail administrateur invalide.' USING ERRCODE = 'check_violation';
    END IF;

    v_slug := COALESCE(NULLIF(btrim(lower(p_slug)), ''), btrim(lower(p_name)));
    v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
    v_slug := btrim(v_slug, '-');
    IF v_slug = '' THEN
        v_slug := 'org-' || substr(gen_random_uuid()::text, 1, 8);
    END IF;

    -- Un domaine déjà rattaché à une autre organisation ne peut pas être repris :
    -- il déterminerait l'organisation à la connexion pour tous ses utilisateurs.
    IF p_domain IS NOT NULL AND btrim(p_domain) <> '' THEN
        IF EXISTS (SELECT 1 FROM organizations WHERE lower(domain) = lower(btrim(p_domain))) THEN
            -- check_violation (23514) plutôt que unique_violation : le message
            -- métier doit remonter tel quel à l'utilisateur, pas être remplacé par
            -- le message générique de contrainte d'unicité.
            RAISE EXCEPTION 'Ce domaine est déjà rattaché à une organisation.' USING ERRCODE = 'check_violation';
        END IF;
    END IF;

    INSERT INTO organizations (name, slug, domain, country_code, default_currency, subscription_status)
    VALUES (btrim(p_name), v_slug, NULLIF(btrim(lower(p_domain)), ''), upper(p_country_code), upper(p_currency), 'trialing')
    RETURNING id INTO v_org_id;

    INSERT INTO users (organization_id, email, full_name, role, status, is_active)
    VALUES (v_org_id, lower(btrim(p_admin_email)), btrim(p_admin_name), 'org_admin', 'active', TRUE)
    RETURNING id INTO v_user_id;

    RETURN QUERY SELECT v_org_id, v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION truetco_register_organization(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truetco_register_organization(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO truetco_app;

-- -----------------------------------------------------------------------------
-- Acceptation d'invitation : crée (ou réactive) l'utilisateur et consomme
-- l'invitation à usage unique.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION truetco_accept_invitation(
    p_token_hash TEXT,
    p_full_name  TEXT
)
RETURNS TABLE (organization_id UUID, user_id UUID, user_role VARCHAR, user_email VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_inv  invitations%ROWTYPE;
    v_uid  UUID;
BEGIN
    SELECT * INTO v_inv
    FROM invitations
    WHERE token_hash = p_token_hash
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invitation introuvable.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation déjà utilisée.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_inv.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invitation révoquée.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_inv.expires_at <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Invitation expirée.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO users (organization_id, email, full_name, role, status, is_active)
    VALUES (v_inv.organization_id, v_inv.email, COALESCE(NULLIF(btrim(p_full_name), ''), split_part(v_inv.email, '@', 1)),
            v_inv.role, 'active', TRUE)
    ON CONFLICT (organization_id, email) DO UPDATE
        SET status = 'active', is_active = TRUE, role = EXCLUDED.role
    RETURNING id INTO v_uid;

    UPDATE invitations
       SET accepted_at = CURRENT_TIMESTAMP, accepted_user_id = v_uid
     WHERE id = v_inv.id;

    RETURN QUERY SELECT v_inv.organization_id, v_uid, v_inv.role, v_inv.email;
END;
$$;

REVOKE ALL ON FUNCTION truetco_accept_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truetco_accept_invitation(TEXT, TEXT) TO truetco_app;

-- -----------------------------------------------------------------------------
-- Vérification du chaînage du journal d'audit (contrôle d'intégrité, §25)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION truetco_verify_audit_chain(p_organization_id UUID)
RETURNS TABLE (total_entries BIGINT, first_broken_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH ordered AS (
        SELECT id, entry_hash, previous_hash,
               lag(entry_hash) OVER (ORDER BY id) AS expected_previous
        FROM audit_logs
        WHERE organization_id = p_organization_id
    )
    SELECT
        (SELECT count(*) FROM ordered),
        (SELECT min(id) FROM ordered WHERE previous_hash IS DISTINCT FROM expected_previous)
    ;
$$;

REVOKE ALL ON FUNCTION truetco_verify_audit_chain(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truetco_verify_audit_chain(UUID) TO truetco_app;
