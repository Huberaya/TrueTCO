-- =============================================================================
-- TRUETCO - JEU D'ESSAIS INITIAL & RÉFÉRENTIELS CERTIFIÉS (SEED SQL)
-- Cas d'école : Renouvellement de 50 Véhicules Utilitaires Légers (VUL)
-- =============================================================================

-- 1. Organisation Racine
INSERT INTO organizations (id, name, slug, domain, legal_registration_number, country_code, default_currency, data_residency, subscription_tier)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Acme Logistics Europe SAS',
    'acme-logistics',        -- utilisé pour la résolution de tenant
    'acme.com',              -- domaine e-mail de l'organisation
    '849 203 910 00024',
    'FR',
    'EUR',
    'EU-FRANCE-PARIS',
    'starter'
)
ON CONFLICT (id) DO UPDATE SET
    slug = COALESCE(organizations.slug, EXCLUDED.slug),
    domain = COALESCE(organizations.domain, EXCLUDED.domain);

-- 2. Utilisateurs
INSERT INTO users (id, organization_id, email, full_name, role)
VALUES
    ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'sophie.valery@acme.com', 'Sophie Valéry', 'directeur_achats'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'lucas.bernard@acme.com', 'Lucas Bernard', 'finance_controleur'),
    ('b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'eleonore.chen@acme.com', 'Éléonore Chen', 'rse_esg')
ON CONFLICT DO NOTHING;

-- 3. Référentiels Institutionnels Externes
-- ⚠️ Les valeurs ci-dessous sont des HYPOTHÈSES DE DÉMONSTRATION. La version
-- précédente attribuait à la « Commission Quinet » une valeur de 120 €/tCO2e
-- (avec un score de confiance de 95) qui ne correspond à aucune publication, et
-- citait des identifiants ADEME non vérifiés. Une donnée d'externalité qui
-- n'est pas traçable à une publication réelle ne doit jamais être présentée
-- comme une référence officielle.
INSERT INTO reference_benchmarks (organization_id, name, category, source, value, unit, valid_until, confidence_score, last_audit_date, legal_reference, methodology)
VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'Prix interne du carbone — hypothèse de démonstration',
     'carbone',
     'Hypothèse de démonstration TrueTCO (non institutionnelle)',
     120.00, '€/tCO2e', '2030-12-31T23:59:59Z', 55, CURRENT_TIMESTAMP,
     'À REMPLACER. Référence publique à consulter : France Stratégie, « La valeur tutélaire du carbone — Rapport de la commission Quinet II » (2019), valeur cible 250 €/tCO2e en 2030 (54 €/tCO2e en 2018).',
     'Méthode de référence à appliquer : valeur tutélaire publiée, ou prix interne validé par la Direction Financière. Hypothèse de calcul interne, non une obligation réglementaire.'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'Facteur d''émission électricité — mix consommation France',
     'carbone',
     'ADEME — Base Empreinte (base publique de facteurs d''émission)',
     0.0520, 'kgCO2e/kWh', '2026-12-31T23:59:59Z', 75, CURRENT_TIMESTAMP,
     'Base Empreinte ADEME — électricité, mix moyen de consommation, France continentale. MILLÉSIME ET IDENTIFIANT DE FICHE À VÉRIFIER sur la base avant tout usage décisionnel.',
     'Facteur annualisé du mix de consommation (ACV) — cadre ISO 14040/44'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'Facteur d''émission gazole routier B7',
     'carbone',
     'ADEME — Base Empreinte (base publique de facteurs d''émission)',
     3.1600, 'kgCO2e/Litre', '2026-12-31T23:59:59Z', 75, CURRENT_TIMESTAMP,
     'Base Empreinte ADEME — gazole routier B7, périmètre « puits au réservoir ». MILLÉSIME ET IDENTIFIANT DE FICHE À VÉRIFIER.',
     'ACV — combustion + amont raffinage'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'Taux d''actualisation (WACC) — hypothèse de démonstration',
     'wacc',
     'Hypothèse de démonstration TrueTCO (non institutionnelle)',
     0.0450, 'taux décimal (4.5%)', '2026-12-31T23:59:59Z', 50, CURRENT_TIMESTAMP,
     'À REMPLACER par le WACC ou le taux de rejet communiqué par la Direction Financière de l''entreprise. Aucune source institutionnelle unique ne publie de « taux de hurdle achats ».',
     'Coût moyen pondéré du capital (WACC) — méthode à appliquer : structure de capital, coût de la dette après impôt, bêta sectoriel.'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
     'Inflation énergétique — hypothèse de démonstration',
     'energie',
     'Hypothèse de démonstration TrueTCO (non institutionnelle)',
     0.0550, 'taux décimal (5.5%)', '2027-12-31T23:59:59Z', 50, CURRENT_TIMESTAMP,
     'À REMPLACER par la trajectoire de prix retenue par l''entreprise (contrat d''énergie, PPA, scénarios CRE/RTE datés).',
     'Hypothèse d''indexation annuelle des coûts énergétiques.')
ON CONFLICT DO NOTHING;

-- 4. Fournisseurs
INSERT INTO suppliers (id, organization_id, name, country_code, incoterm, payment_terms_days, standard_lead_time_days, minimum_order_quantity, warranty_months, historical_defect_rate, esg_score, has_verified_environmental_data, environmental_data_source, certifications, data_quality_score)
VALUES
    ('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'EcoMobility France', 'FR', 'DDP', 45, 60, 5, 60, 0.0080, 94, true, 'ACV certifiée TÜV Rheinland ISO 14040/44', ARRAY['ISO 14001', 'EcoVadis Platinum', 'B-Corp'], 95),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'AutoFleet Solutions', 'FR', 'DDP', 30, 30, 1, 24, 0.0240, 68, false, 'Déclaration unilatérale constructeur', ARRAY['ISO 9001'], 78)
ON CONFLICT DO NOTHING;

-- 5. Projet d'Achat
INSERT INTO projects (id, organization_id, reference, name, description, category, company_name, budget_cap, currency, planned_volume, unit_name, horizon_years, status, discount_rate, energy_inflation_rate, general_inflation_rate, carbon_price_per_tonne, created_by_user_id)
VALUES (
    'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'AO-2026-FLOTTE-01',
    'Renouvellement Flotte 50 Utilitaires Légers (VUL)',
    'Consultation stratégique pour le remplacement de 50 fourgons de livraison urbaine en région parisienne (ZFE).',
    'Flotte Automobile',
    'Acme Logistics IDF',
    500000.00,
    'EUR',
    50,
    'véhicules',
    5,
    'Décision',
    0.0450,
    0.0550,
    0.0200,
    120.00,
    'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
) ON CONFLICT DO NOTHING;

-- 6. Offres Fournisseurs
-- Les colonnes d'agrégats (economic_tco_nominal, lifecycle_cost_lcc, …) sont
-- volontairement NULL : ce sont des RÉSULTATS de calcul, produits par le moteur
-- à partir des postes de coût. Stocker des résultats figés crée une seconde
-- source de vérité qui diverge silencieusement du moteur. Les valeurs
-- recalculées sont exposées avec leur version de moteur (engine_version).
INSERT INTO supplier_offers (id, project_id, supplier_id, offer_reference, apparent_total, quantity, is_responsible_candidate, confidence_score)
VALUES
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'OFFRE-ECO-50E', 360000.00, 50, true, 92),
    ('e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'OFFRE-STD-50D', 280000.00, 50, false, 81)
ON CONFLICT DO NOTHING;

-- 7. Journal d'Audit Initial
INSERT INTO audit_logs (organization_id, user_id, user_name, user_role, project_id, entity_name, field_changed, old_value, new_value, justification)
VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sophie Valéry', 'directeur_achats', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Projet Flotte 50 VUL', 'Création consultation', 'N/A', 'AO-2026-FLOTTE-01', 'Ouverture de consultation pour arbitrage TCO pluriannuel ZFE.'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Lucas Bernard', 'finance_controleur', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Taux WACC & Inflation', 'Actualisation WACC', '0.0400', '0.0450', 'Alignement avec la directive trésorerie groupe et réévaluation des spreads bancaires.')
ON CONFLICT DO NOTHING;
