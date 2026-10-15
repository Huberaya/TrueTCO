-- Diagnostic (lecture seule) : offres reliant un projet et un fournisseur d'organisations différentes.
-- Ces lignes proviennent de l'ancienne faille IDOR (POST /api/offers sans contrôle d'appartenance).
-- À examiner manuellement, puis supprimer ou ré-affecter, avant de relancer la migration 002.
SELECT o.id AS offer_id, o.offer_reference,
       p.id AS project_id, p.organization_id AS project_org,
       s.id AS supplier_id, s.organization_id AS supplier_org
  FROM supplier_offers o
  JOIN projects  p ON p.id = o.project_id
  JOIN suppliers s ON s.id = o.supplier_id
 WHERE p.organization_id <> s.organization_id;
