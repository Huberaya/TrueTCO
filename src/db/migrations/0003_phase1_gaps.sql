-- ===========================================================================
-- TrueTCO — 0003 : colonnes manquantes révélées par les tests d'API
-- ---------------------------------------------------------------------------
-- Ces écarts ont été DÉTECTÉS PAR LES TESTS (aucune API ne les avait exercés) :
--   * projects.country_code        : la fiscalité et les facteurs dépendent du pays,
--                                    un dossier doit donc porter son pays de référence ;
--   * invitations.department/full_name : l'invitation doit préparer l'utilisateur ;
--   * suppliers.legal_name/contact_email/esg_rating : identification du fournisseur.
-- Les ajouts sont idempotents et sans perte : aucune colonne existante n'est
-- modifiée ni supprimée.
-- ===========================================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS country_code VARCHAR(2);
COMMENT ON COLUMN projects.country_code IS
    'Pays de référence du dossier (ISO 3166-1 alpha-2). Détermine les règles fiscales et les facteurs applicables ; NULL = non renseigné, aucune règle n''est alors supposée.';

ALTER TABLE invitations ADD COLUMN IF NOT EXISTS department VARCHAR(100);
ALTER TABLE invitations ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legal_name VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS esg_rating VARCHAR(50);

-- Un dossier ne peut pas affirmer un pays sans code ISO crédible.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_projects_country_code') THEN
        ALTER TABLE projects
            ADD CONSTRAINT ck_projects_country_code
            CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_suppliers_contact_email') THEN
        ALTER TABLE suppliers
            ADD CONSTRAINT ck_suppliers_contact_email
            CHECK (contact_email IS NULL OR contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]{2,}$');
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Journal d'audit : le hachage est calculé EN SQL (source unique de vérité)
-- ---------------------------------------------------------------------------
-- Décision de conception : la charge hachée n'est PAS construite en JavaScript.
-- Elle est produite par une fonction SQL versionnée, utilisée à la fois à
-- l'écriture et à la vérification. Trois raisons :
--   1. une seule implémentation = aucun risque de divergence entre ce qui est
--      haché et ce qui est vérifié ;
--   2. le hachage est calculable même par une tâche d'exploitation SQL ;
--   3. toute évolution de format devient une migration explicite.
--
-- LIMITE ASSUMÉE ET DOCUMENTÉE : un attaquant disposant d'un accès complet en
-- écriture à la base peut réécrire le contenu ET recalculer toute la chaîne.
-- Contre cette menace, seule une ancre externe (horodatage qualifié ou dépôt
-- scellé du digest de tête) apporte une garantie. Ce mécanisme n'est pas encore
-- en place : il est déclaré comme tel (voir SECURITY.md).
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS content_hash CHAR(64);

-- Encodage d'un champ dans la charge hachée : « N » pour NULL, sinon « V<longueur>:<valeur> ».
-- Cet encodage préfixé par la longueur empêche toute collision entre champs
-- (un séparateur présent dans une valeur ne peut pas décaler les champs).
CREATE OR REPLACE FUNCTION truetco_audit_field(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE WHEN p_value IS NULL THEN 'N' ELSE 'V' || length(p_value)::TEXT || ':' || p_value END;
$$;

CREATE OR REPLACE FUNCTION truetco_audit_content_hash(
    p_organization_id UUID,
    p_occurred_at     TIMESTAMPTZ,
    p_actor_id        UUID,
    p_actor_name      TEXT,
    p_actor_role      TEXT,
    p_action          TEXT,
    p_entity_type     TEXT,
    p_entity_id       UUID,
    p_project_id      UUID,
    p_field_changed   TEXT,
    p_old_value       TEXT,
    p_new_value       TEXT,
    p_justification   TEXT,
    p_correlation_id  TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT encode(
        sha256(convert_to(
            truetco_audit_field(p_organization_id::TEXT)
         || truetco_audit_field(to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
         || truetco_audit_field(p_actor_id::TEXT)
         || truetco_audit_field(p_actor_name)
         || truetco_audit_field(p_actor_role)
         || truetco_audit_field(p_action)
         || truetco_audit_field(p_entity_type)
         || truetco_audit_field(p_entity_id::TEXT)
         || truetco_audit_field(p_project_id::TEXT)
         || truetco_audit_field(p_field_changed)
         || truetco_audit_field(p_old_value)
         || truetco_audit_field(p_new_value)
         || truetco_audit_field(p_justification)
         || truetco_audit_field(p_correlation_id),
            'UTF8'
        )),
        'hex'
    );
$$;

-- Empreinte d'une entrée : contenu + empreinte précédente (chaînage).
CREATE OR REPLACE FUNCTION truetco_audit_entry_hash(p_content_hash TEXT, p_previous_hash TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT encode(
        sha256(convert_to(
            COALESCE(p_content_hash, '') || '|' || COALESCE(p_previous_hash, 'GENESIS'),
            'UTF8'
        )),
        'hex'
    );
$$;

-- ---------------------------------------------------------------------------
-- Vérification de la chaîne d'audit : recalcul complet du contenu
-- ---------------------------------------------------------------------------
-- L'ancienne version ne contrôlait que le chaînage des empreintes : modifier le
-- CONTENU d'une entrée ancienne passait inaperçu (défaut révélé par le test
-- T-API-30). La vérification recalcule désormais, pour chaque entrée, l'empreinte
-- du contenu à partir des colonnes stockées, puis celle de l'entrée.
--
-- Note : `payload_canonical::bytea` (première tentative) était faux — PostgreSQL
-- interprète alors la chaîne selon le format d'entrée bytea, où l'antislash est un
-- caractère d'échappement ; un JSON contenant des antislashs faisait échouer la
-- comparaison. Le hachage opère donc sur un encodage explicite en UTF-8.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'sha256') THEN
        RAISE EXCEPTION
            'sha256() est indisponible : installez pgcrypto avant d''activer la vérification de la chaîne d''audit.';
    END IF;
END
$$;

DROP FUNCTION IF EXISTS truetco_verify_audit_chain(UUID);

CREATE OR REPLACE FUNCTION truetco_verify_audit_chain(p_organization_id UUID)
RETURNS TABLE (total_entries BIGINT, first_broken_id BIGINT, first_content_mismatch_id BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    WITH ordered AS (
        SELECT
            id,
            content_hash,
            entry_hash,
            previous_hash,
            lag(entry_hash) OVER (ORDER BY id) AS expected_previous,
            truetco_audit_content_hash(
                organization_id, occurred_at, actor_id, actor_name, actor_role, action,
                entity_type, entity_id, project_id, field_changed, old_value, new_value,
                justification, correlation_id
            ) AS recomputed_content_hash
        FROM audit_logs
        WHERE organization_id = p_organization_id
    )
    SELECT
        (SELECT count(*) FROM ordered),
        -- Rupture de chaîne : l'entrée ne référence pas l'empreinte précédente.
        (SELECT min(id) FROM ordered WHERE previous_hash IS DISTINCT FROM expected_previous),
        -- Contenu altéré, ou empreinte d'entrée qui ne correspond plus au contenu.
        (SELECT min(id) FROM ordered
          WHERE content_hash IS DISTINCT FROM recomputed_content_hash
             OR entry_hash IS DISTINCT FROM truetco_audit_entry_hash(recomputed_content_hash, previous_hash))
    ;
$$;

REVOKE ALL ON FUNCTION truetco_verify_audit_chain(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truetco_verify_audit_chain(UUID) TO truetco_app;

-- ---------------------------------------------------------------------------
-- Fournisseurs : ne pas inscrire de valeur commerciale non vérifiée
-- ---------------------------------------------------------------------------
-- `incoterm DEFAULT 'DDP'` inscrivait une condition de livraison jamais
-- confirmée par le fournisseur, et `payment_terms_days DEFAULT 30` un délai de
-- paiement inventé. Ces valeurs doivent être saisies ou rester nulles.
ALTER TABLE suppliers ALTER COLUMN incoterm DROP NOT NULL;
ALTER TABLE suppliers ALTER COLUMN incoterm DROP DEFAULT;
ALTER TABLE suppliers ALTER COLUMN payment_terms_days SET DEFAULT 0;
ALTER TABLE suppliers ALTER COLUMN standard_lead_time_days SET DEFAULT 0;
ALTER TABLE suppliers ALTER COLUMN minimum_order_quantity SET DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Acceptation d'invitation : suppression d'une ambiguïté de colonne
-- ---------------------------------------------------------------------------
-- La fonction déclarait des paramètres de sortie nommés `organization_id` et
-- `user_id`, identiques aux colonnes insérées : PostgreSQL refusait alors
-- l'INSERT (« column reference "organization_id" is ambiguous »). Les tests
-- d'API ont révélé ce défaut, jamais exercé auparavant.
DROP FUNCTION IF EXISTS truetco_accept_invitation(TEXT, TEXT);

CREATE OR REPLACE FUNCTION truetco_accept_invitation(
    p_token_hash TEXT,
    p_full_name  TEXT
)
RETURNS TABLE (
    created_organization_id UUID,
    created_user_id         UUID,
    created_user_role       VARCHAR,
    created_user_email      VARCHAR
)
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
        RAISE EXCEPTION 'Invitation introuvable ou jeton invalide.' USING ERRCODE = 'no_data_found';
    END IF;
    IF v_inv.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cette invitation a déjà été utilisée.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_inv.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cette invitation a été révoquée.' USING ERRCODE = 'check_violation';
    END IF;
    IF v_inv.expires_at <= CURRENT_TIMESTAMP THEN
        RAISE EXCEPTION 'Cette invitation a expiré.' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO users (organization_id, email, full_name, role, status, is_active)
    VALUES (v_inv.organization_id, v_inv.email,
            COALESCE(NULLIF(btrim(p_full_name), ''), split_part(v_inv.email, '@', 1)),
            v_inv.role, 'active', TRUE)
    ON CONFLICT (organization_id, email) DO UPDATE
        SET status = 'active', is_active = TRUE, role = EXCLUDED.role
    RETURNING users.id INTO v_uid;

    UPDATE invitations
       SET accepted_at = CURRENT_TIMESTAMP, accepted_user_id = v_uid
     WHERE invitations.id = v_inv.id;

    RETURN QUERY SELECT v_inv.organization_id, v_uid, v_inv.role, v_inv.email;
END;
$$;

REVOKE ALL ON FUNCTION truetco_accept_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION truetco_accept_invitation(TEXT, TEXT) TO truetco_app;

-- ---------------------------------------------------------------------------
-- Fournisseurs : le pays n'est pas toujours connu au premier contact
-- ---------------------------------------------------------------------------
-- La valeur par défaut 'FR' inscrivait un pays jamais confirmé par le
-- fournisseur : NULL est plus honnête, et la contrainte de format reste
-- appliquée lorsqu'un pays est fourni.
-- ---------------------------------------------------------------------------
ALTER TABLE suppliers ALTER COLUMN country_code DROP NOT NULL;
ALTER TABLE suppliers ALTER COLUMN country_code DROP DEFAULT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_suppliers_country_code') THEN
        ALTER TABLE suppliers
            ADD CONSTRAINT ck_suppliers_country_code
            CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
    END IF;
END
$$;
