-- =============================================================================
-- 003_entity_documents.sql
-- Sauvegarde SANS PERTE : l'objet complet manipulé par l'application est conservé tel quel dans `document`,
-- en complément des colonnes normalisées (utilisées pour les requêtes, contraintes et futures analyses).
--
-- Pourquoi : jusqu'ici seuls quelques champs étaient persistés (ex. une offre perdait ses lignes carbone,
-- ses risques, sa durée de vie au rechargement). Un utilisateur connecté ne doit voir QUE les données du
-- serveur : la relecture doit donc restituer exactement ce qui a été saisi.
-- Normalisation complète et versionnage : chantier 7.
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','suppliers','supplier_offers','reference_benchmarks'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS document JSONB NOT NULL DEFAULT ''{}''::jsonb', t);
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS chk_%s_document_size', t, t);
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT chk_%s_document_size CHECK (pg_column_size(document) <= 262144)', t, t);
  END LOOP;
END $$;

-- Le statut 'adjudique' existe dans l'application mais était refusé par la contrainte d'origine :
-- une adjudication ne pouvait pas être enregistrée.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check CHECK (status IN (
  'brouillon','collecte_offres','analyse','validation_finance','validation_achats','decision','adjudique','termine','archive',
  'Brouillon','Cahier des charges','Consultation','Analyse','Validation Finance','Validation Achats','Décision',
  'Contractualisé','En exploitation','Archivé','Terminé / Arbitré'
));

-- Catégories de référentiel : le frontend utilise aussi 'energie_kwh' et 'recyclage' (refusées par la contrainte d'origine).
ALTER TABLE reference_benchmarks DROP CONSTRAINT IF EXISTS reference_benchmarks_category_check;
ALTER TABLE reference_benchmarks ADD CONSTRAINT reference_benchmarks_category_check CHECK (category IN (
  'energie','carbone','financier','social','dechets','wacc','pollution_locale','main_d_oeuvre','taux_interet','energie_kwh','recyclage'
));
