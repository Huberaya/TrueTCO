-- =============================================================================
-- 0004 — PHASE 2 : CENTRE D'IMPORT (et rattrapage d'ajouts tardifs)
-- =============================================================================
-- RAPPEL D'EXPLOITATION : une migration est un fichier FIGÉ. Modifier un fichier
-- déjà appliqué fait échouer le démarrage (l'exécuteur compare les empreintes
-- SHA-256). C'est pourquoi les colonnes ajoutées après coup à la migration 0003
-- sont reprises ICI, en toute sécurité : chaque instruction est idempotente
-- (`IF NOT EXISTS`), donc une base neuve comme une base déjà migrée arrivent au
-- même schéma. Aucune table n'est supprimée, aucune donnée n'est touchée.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rattrapage : exécutions de décision reproductibles (livré en Phase 1)
-- ---------------------------------------------------------------------------
-- `input_fingerprint` : SHA-256 des entrées réellement utilisées (montants,
-- sources, statuts de qualité, hypothèses, facteurs). Il permet de détecter
-- qu'une décision a été rendue sur d'autres données que celles affichées.
--
-- `inputs_snapshot` : copie complète des entrées au moment du calcul. Un dossier
-- ancien reste ainsi rejouable des années plus tard, même si les offres ont été
-- modifiées ou supprimées depuis — exigence de traçabilité (rejouabilité).

-- ---------------------------------------------------------------------------
-- Exécutions de décision : empreinte et snapshot pour la reproductibilité
-- ---------------------------------------------------------------------------
-- `input_fingerprint` : SHA-256 des entrées réellement utilisées (montants,
-- sources, statuts de qualité, hypothèses, facteurs). Il permet de détecter
-- qu'une décision a été rendue sur d'autres données que celles affichées.
--
-- `inputs_snapshot` : copie complète des entrées au moment du calcul. Un dossier
-- ancien reste ainsi rejouable des années plus tard, même si les offres ont été
-- modifiées ou supprimées depuis — exigence de traçabilité (§ Rejouabilité).
ALTER TABLE decision_runs ADD COLUMN IF NOT EXISTS input_fingerprint CHAR(64);
ALTER TABLE decision_runs ADD COLUMN IF NOT EXISTS inputs_snapshot JSONB;

COMMENT ON COLUMN decision_runs.input_fingerprint IS
    'SHA-256 des entrées du calcul (empreinte canonique). Toute modification de montant, de source, de statut de qualité, d''hypothèse ou de facteur la change.';
COMMENT ON COLUMN decision_runs.inputs_snapshot IS
    'Snapshot des entrées au moment du calcul, utilisé par le rejeu (/api/decision-runs/:id/replay) pour vérifier la reproductibilité.';

CREATE INDEX IF NOT EXISTS idx_decision_runs_project_version ON decision_runs (organization_id, project_id, input_version DESC);
CREATE INDEX IF NOT EXISTS idx_decision_runs_fingerprint ON decision_runs (organization_id, input_fingerprint);

-- ---------------------------------------------------------------------------
-- Catégorie de coût telle que déclarée par l'utilisateur
-- ---------------------------------------------------------------------------
-- La colonne `category` porte la catégorie CANONIQUE du moteur (liste
-- `RECOGNIZED_COST_CATEGORIES`) : c'est elle qui garantit l'allocation du poste
-- dans l'analyse. Le libellé d'origine (« energie », « transport »…) est
-- conservé séparément : l'utilisateur doit pouvoir reconnaître sa saisie, et un
-- contrôle doit pouvoir vérifier qu'aucune catégorie n'a été devinée.
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS declared_category VARCHAR(100);

COMMENT ON COLUMN cost_items.declared_category IS
    'Libellé de catégorie fourni par l''utilisateur ou l''import, conservé pour la traçabilité. `category` porte la forme canonique utilisée par le moteur.';

-- ---------------------------------------------------------------------------
-- 2. Lots d'import : métadonnées de la source et analyse enregistrée
-- ---------------------------------------------------------------------------
-- Un lot d'import doit pouvoir être expliqué des mois plus tard : quel fichier,
-- quelle empreinte, quelle feuille, quel encodage, quel séparateur, quel mapping
-- validé par qui. Sans ces colonnes, l'import serait un trou dans la traçabilité.
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS mode VARCHAR(20);
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_file_name VARCHAR(255);
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_sheet_name VARCHAR(255);
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_encoding VARCHAR(30);
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_delimiter VARCHAR(5);
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_columns JSONB;
-- Analyse telle qu'elle a été présentée à l'utilisateur (mapping proposé, statuts,
-- score de qualité, blocages) : c'est la preuve de ce qui a été validé.
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS analysis_snapshot JSONB;
-- Score de qualité des données du lot (0-100), calculé par des règles affichées.
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS data_quality_score INTEGER;
-- Lignes brutes réellement écartées par l'utilisateur (numéros d'origine).
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS excluded_rows JSONB;
-- Arbitrages de catégories non reconnues et références d'offres fournies par
-- l'utilisateur : la décision humaine est conservée, elle n'est jamais implicite.
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS category_overrides JSONB;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS offer_references JSONB;
-- Empreinte du fichier au moment de l'import (doublon de documents.content_sha256
-- volontairement conservée : le lot doit rester explicable même si le document
-- est supprimé, la clé étrangère étant alors mise à NULL).
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_sha256 CHAR(64);
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'import_batches_mode_check'
    ) THEN
        ALTER TABLE import_batches
            ADD CONSTRAINT import_batches_mode_check
            CHECK (mode IS NULL OR mode IN ('costs', 'carbon', 'risks'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_import_batches_project ON import_batches (organization_id, project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_document ON import_batches (organization_id, document_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch ON import_rows (batch_id, row_number);

COMMENT ON COLUMN import_batches.mode IS
    'Nature de l''import : costs (postes de coût), carbon (émissions), risks (risques).';
COMMENT ON COLUMN import_batches.analysis_snapshot IS
    'Analyse présentée à l''utilisateur avant écriture : mapping, statuts par ligne, blocages, score de qualité. Preuve de ce qui a été validé.';
COMMENT ON COLUMN import_batches.data_quality_score IS
    'Score de qualité des données du lot (0-100), calculé par des règles explicites (complétude, sources, cohérence, identification).';
COMMENT ON COLUMN import_batches.excluded_rows IS
    'Numéros de ligne du fichier source explicitement écartés par l''utilisateur. Toute autre ligne est importée.';

-- ---------------------------------------------------------------------------
-- 3. Postes de coût : traçabilité de l'origine et de la ligne source
-- ---------------------------------------------------------------------------
-- `source_row_number` : la ligne du fichier d'origine. Un auditeur doit pouvoir
-- remonter d'un montant affiché jusqu'à la cellule qui l'a produit.
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS source_row_number INTEGER;
ALTER TABLE cost_items ADD COLUMN IF NOT EXISTS is_imported BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN cost_items.source_row_number IS
    'Numéro de ligne dans le fichier importé (1 = en-tête). NULL pour une saisie manuelle.';

-- ---------------------------------------------------------------------------
-- 4. Permissions d'import
-- ---------------------------------------------------------------------------
-- Aucune table de permissions n'existe : la matrice de rôles est définie dans
-- `server/auth/types.ts` et vérifiée côté serveur (`import:read`, `import:write`).
-- Elle n'est donc PAS dupliquée ici, où elle pourrait diverger silencieusement.
