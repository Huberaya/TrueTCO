-- Comptes neutralisés par la migration 002 (créés via l'ancien flux sans vérification d'identité).
-- À passer en revue : tout compte au rôle élevé que vous ne reconnaissez pas est potentiellement malveillant.
SELECT u.id, o.name AS organization, u.email, u.role, u.sso_provider, u.created_at, u.quarantined_at
  FROM users u JOIN organizations o ON o.id = u.organization_id
 WHERE u.quarantined_at IS NOT NULL
 ORDER BY (u.role = 'admin') DESC, u.created_at;
