-- =============================================================================
-- 0005 — Phase 3 : simulations probabilistes du risque (Monte-Carlo)
-- =============================================================================
-- Pourquoi une table dédiée plutôt qu'une colonne dans `decision_runs` :
--
--   1. Une simulation n'est pas une décision. Elle compare une PAIRE d'offres sous
--      des hypothèses d'incertitude ; l'exécution de décision, elle, classe
--      l'ensemble des offres. Les mélanger rendrait l'historique illisible et
--      donnerait à croire qu'une simulation vaut une décision.
--   2. Une simulation est rejouable : sa graine, ses lois et ses corrélations sont
--      enregistrées. Un auditeur doit pouvoir la reproduire à l'identique sans
--      dépendre de ce que l'interface avait affiché.
--   3. Les résultats sont volumineux (quantiles, histogramme, lecture) : un JSONB
--      dédié évite d'alourdir la table des décisions, lue à chaque affichage.
--
-- Ce qui est enregistré ici est une PREUVE DE CALCUL, pas une preuve de vérité :
-- les hypothèses y figurent avec leur source (ou l'absence de source), et le
-- vocabulaire employé est celui de quantiles simulés, jamais d'intervalle de
-- confiance statistique.
-- =============================================================================

CREATE TABLE IF NOT EXISTS risk_simulations (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Offres comparées : celle qui gagne au scénario central, et le challenger.
    winner_offer_id      UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,
    challenger_offer_id  UUID NOT NULL REFERENCES supplier_offers(id) ON DELETE CASCADE,

    engine_version       VARCHAR(30) NOT NULL,
    methodology_version  VARCHAR(60) NOT NULL,

    -- Reproductibilité : la graine EST la preuve que le résultat est rejouable.
    seed                 VARCHAR(200) NOT NULL,
    iterations           INTEGER NOT NULL CHECK (iterations BETWEEN 200 AND 20000),

    -- Entrées de la simulation, telles qu'exécutées (après validation) :
    -- lois de probabilité, corrélations, paramètres centraux du dossier.
    variable_specs       JSONB NOT NULL,
    correlations         JSONB NOT NULL DEFAULT '[]'::jsonb,
    central_parameters   JSONB NOT NULL,

    -- Résultats : quantiles de l'écart et de chaque offre, probabilité d'inversion,
    -- histogramme, lecture explicative, avertissements.
    results              JSONB NOT NULL,

    -- Empreinte des entrées du dossier au moment du calcul : si le dossier change,
    -- la simulation ne doit pas être présentée comme encore valable.
    input_fingerprint    VARCHAR(64) NOT NULL,

    computed_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    is_demo              BOOLEAN NOT NULL DEFAULT FALSE
);

COMMENT ON TABLE risk_simulations IS
    'Simulations probabilistes (Monte-Carlo) du risque d''un dossier : hypothèses, graine, quantiles simulés. Rejouable à l''identique ; ne constitue ni une décision ni un intervalle de confiance statistique.';
COMMENT ON COLUMN risk_simulations.seed IS
    'Graine du générateur : même graine et mêmes entrées ⇒ résultat identique. Sans graine enregistrée, une simulation n''est pas auditable.';
COMMENT ON COLUMN risk_simulations.variable_specs IS
    'Lois de probabilité déclarées par l''utilisateur (fixe, uniforme, triangulaire, normale, log-normale, PERT), avec leur source ou l''absence de source.';
COMMENT ON COLUMN risk_simulations.correlations IS
    'Corrélations déclarées entre paramètres. Une matrice incohérente est refusée au calcul, jamais corrigée en silence.';
COMMENT ON COLUMN risk_simulations.results IS
    'Quantiles P10/P50/P90 de la distribution SIMULÉE et probabilité d''inversion. Ce ne sont pas des bornes d''un intervalle de confiance statistique.';

CREATE INDEX IF NOT EXISTS idx_risk_simulations_project
    ON risk_simulations (organization_id, project_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_simulations_pair
    ON risk_simulations (organization_id, winner_offer_id, challenger_offer_id);

-- -----------------------------------------------------------------------------
-- Isolation multi-tenant (RLS), sur le même modèle que les autres tables métier
-- -----------------------------------------------------------------------------
ALTER TABLE risk_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk_simulations FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
    EXECUTE 'DROP POLICY IF EXISTS risk_simulations_tenant ON risk_simulations';
    EXECUTE 'CREATE POLICY risk_simulations_tenant ON risk_simulations FOR ALL '
         || 'USING (organization_id = truetco_current_org()) '
         || 'WITH CHECK (organization_id = truetco_current_org())';
END
$$;
