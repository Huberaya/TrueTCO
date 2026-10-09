-- =============================================================================
-- 0006 — Fréquence distincte d'occurrences d'un poste par année
-- =============================================================================
-- `year_occurrences` est une liste d'années et n'a jamais signifié une fréquence.
-- La nouvelle colonne compte des événements identiques dans chaque année retenue.
-- Le montant du poste reste le montant d'UNE occurrence ; l'absence de fréquence
-- conserve la sémantique historique, soit une occurrence par année concernée.
-- La borne 366 est explicite (au plus une occurrence par jour) et est également
-- vérifiée par l'API, l'import et le moteur.

ALTER TABLE cost_items
    ADD COLUMN IF NOT EXISTS occurrences_per_year INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'cost_items_occurrences_per_year_check'
    ) THEN
        ALTER TABLE cost_items
            ADD CONSTRAINT cost_items_occurrences_per_year_check
            CHECK (occurrences_per_year IS NULL OR occurrences_per_year BETWEEN 1 AND 366);
    END IF;
END
$$;

COMMENT ON COLUMN cost_items.occurrences_per_year IS
    'Nombre strict d''occurrences du montant unitaire pendant chaque année d''occurrence (1–366) ; NULL conserve la sémantique historique de 1 occurrence.';
