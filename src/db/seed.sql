-- =============================================================================
-- TRUETCO - JEU D'ESSAIS INITIAL & RÉFÉRENTIELS CERTIFIÉS (SEED SQL)
-- Cas d'école : Renouvellement de 50 Véhicules Utilitaires Légers (VUL)
-- =============================================================================

-- 1. Organisation Racine
INSERT INTO organizations (id, name, legal_registration_number, country_code, default_currency)
VALUES (
    'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    'Acme Logistics Europe SAS',
    '849 203 910 00024',
    'FR',
    'EUR'
) ON CONFLICT DO NOTHING;

-- 2. Utilisateurs
INSERT INTO users (id, organization_id, email, full_name, role)
VALUES
    ('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'sophie.valery@acme.com', 'Sophie Valéry', 'directeur_achats'),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'lucas.bernard@acme.com', 'Lucas Bernard', 'finance_controleur'),
    ('b2eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'eleonore.chen@acme.com', 'Éléonore Chen', 'rse_esg')
ON CONFLICT DO NOTHING;

-- 3. Référentiels Institutionnels Externes
INSERT INTO reference_benchmarks (organization_id, name, category, source, value, unit, valid_until, confidence_score, last_audit_date, legal_reference)
VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Valeur Tutélaire de l''Action Climat (Quinet)', 'carbone', 'Commission Quinet / France Stratégie', 120.00, '€/tCO2e', '2030-12-31T23:59:59Z', 95, CURRENT_TIMESTAMP, 'Rapport Quinet II - Trajectoire Neutralité Carbone 2050'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Facteur Émission Électricité Mix Réseau France', 'carbone', 'Base Empreinte ADEME', 0.0571, 'kgCO2e/kWh', '2026-12-31T23:59:59Z', 98, CURRENT_TIMESTAMP, 'Identifiant ADEME 27584 - Mix moyen consommation BT'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Facteur Émission Gazole Routier B7', 'carbone', 'Base Empreinte ADEME', 3.1600, 'kgCO2e/Litre', '2026-12-31T23:59:59Z', 95, CURRENT_TIMESTAMP, 'Identifiant ADEME 31201 - Combustion + Amont raffinage'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Coût Moyen Pondéré du Capital (WACC)', 'financier', 'Direction Financière Groupe / Banque de France', 0.0450, 'taux décimal (4.5%)', '2026-12-31T23:59:59Z', 92, CURRENT_TIMESTAMP, 'Politique financière interne 2026 & OAT 10 ans + spread corporate'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Index d''Inflation Énergétique Projetée', 'energie', 'Commission de Régulation de l''Énergie (CRE)', 0.0550, 'taux décimal (5.5%)', '2027-12-31T23:59:59Z', 88, CURRENT_TIMESTAMP, 'Perspectives pluriannuelles marché de gros CRE / RTE')
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
INSERT INTO supplier_offers (id, project_id, supplier_id, offer_reference, apparent_total, is_responsible_candidate, economic_tco_nominal, lifecycle_cost_lcc, total_lifecycle_co2e_tonnes, monetized_carbon_total, risk_exposition_total, total_comprehensive_tco, confidence_score)
VALUES
    ('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'OFFRE-ECO-50E', 360000.00, true, 442000.00, 421500.00, 32.500, 3900.00, 7700.00, 453600.00, 92),
    ('e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'OFFRE-STD-50D', 280000.00, false, 672000.00, 628000.00, 245.000, 29400.00, 26600.00, 728000.00, 81)
ON CONFLICT DO NOTHING;

-- 7. Journal d'Audit Initial
INSERT INTO audit_logs (organization_id, user_id, user_name, user_role, project_id, entity_name, field_changed, old_value, new_value, justification)
VALUES
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Sophie Valéry', 'directeur_achats', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Projet Flotte 50 VUL', 'Création consultation', 'N/A', 'AO-2026-FLOTTE-01', 'Ouverture de consultation pour arbitrage TCO pluriannuel ZFE.'),
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Lucas Bernard', 'finance_controleur', 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'Taux WACC & Inflation', 'Actualisation WACC', '0.0400', '0.0450', 'Alignement avec la directive trésorerie groupe et réévaluation des spreads bancaires.')
ON CONFLICT DO NOTHING;
