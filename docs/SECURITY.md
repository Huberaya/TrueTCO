# Sécurité & exploitation — Chantier 1

Ce document décrit le modèle de sécurité implémenté, la **procédure de déploiement dans l'ordre**, et ce qui n'est **pas** couvert.

## 1. Modèle

| Couche | Mécanisme | Fichier |
|---|---|---|
| Identité | Jeton Clerk vérifié cryptographiquement à chaque requête (`azp` contrôlé). Aucune route, variable ni mode ne désactive l'authentification. | `server/auth.ts` |
| Privé par défaut | Tout `/api/*` passe par `authenticate`. Seule exception déclarée : `GET /api/health` (renvoie `{status:"ok"}`). | `server/app.ts` |
| Organisation | Dérivée de la **base** (appartenances de l'identité). `x-tenant-id` n'est qu'un *sélecteur* parmi ses organisations, sinon 403. Jamais lue depuis body/query. | `server/auth.ts`, `server/db.ts` |
| Rôles | Matrice `rôle → permissions` appliquée **côté serveur** sur chaque route (`requirePermission`). | `server/rbac.ts` |
| Applicatif | Chaque requête filtre `organization_id` ; un id d'un autre tenant est indiscernable d'un id inconnu (404). | `server/routes/*` |
| Base — RLS | Politiques `organization_id = app_org_id()`, `FORCE ROW LEVEL SECURITY`, fail-closed (sans contexte : 0 ligne). | `db/migrations/002` |
| Base — intégrité | Clés étrangères **composites** `(organization_id, …)` : une offre ne peut référencer le projet/fournisseur d'un autre tenant, même RLS contourné. | `db/migrations/002` |
| Audit | Écrit par le serveur dans la transaction de la modification ; table en écriture seule (trigger + privilèges). | `server/audit.ts` |
| Entrées | Validation `zod` ; aucune valeur par défaut silencieuse sur les hypothèses financières. | `server/validation.ts` |
| HTTP | `helmet`, `no-store` sur l'API, rate limiting (global + échecs), 1 Mo max, erreurs génériques + `requestId`. | `server/app.ts` |

**CSRF** : non applicable à l'API — l'authentification passe par l'en-tête `Authorization` (aucun cookie d'authentification), et aucun CORS n'est ouvert.

**Identifiants fournis par le client** : traités comme des *clés d'idempotence*. Un identifiant non-UUID est dérivé en UUID v5 dans l'espace de noms de l'organisation (pas de collision inter-tenants).

## 2. Déploiement — dans cet ordre

> ⚠️ La migration 002 **neutralise tous les comptes existants** : aucun n'avait été authentifié de façon fiable (l'ancien `/api/auth/sso/login` créait n'importe quel compte, rôle et organisation, sans vérification). Prévoir une courte interruption d'accès.

1. **Sauvegarder** la base (snapshot/branche Neon).
2. **Configurer Clerk** : application de production, noter `CLERK_SECRET_KEY` et la clé publique. Vérifier que les emails sont **vérifiés** à l'inscription (sinon l'invitation ne pourra pas se lier — c'est voulu).
3. **Migrer** avec le rôle propriétaire : `MIGRATION_DATABASE_URL=... npm run db:migrate`.
   - Si la migration s'arrête sur « offres reliant des organisations différentes » : exécuter `db/ops/cross-tenant-repair.sql`, traiter chaque ligne (c'est la trace d'une exploitation de l'ancienne faille IDOR), puis relancer.
4. **Réviser les comptes neutralisés** : `db/ops/review-quarantined-users.sql`. Tout administrateur inconnu est suspect.
5. **Amorcer le premier administrateur** :
   `npm run admin:bootstrap -- --org <slug|uuid> --email admin@societe.com --name "Prénom Nom"`
   (il s'active à sa première connexion Clerk avec **cet email vérifié** ; il invite ensuite les autres via l'API `POST /api/users/invitations`).
6. **Créer le rôle applicatif** (hors migration, pour ne pas versionner de mot de passe) :
   ```sql
   ALTER ROLE truetco_app LOGIN PASSWORD '<mot de passe long et aléatoire>';
   ```
   puis `DATABASE_URL` = connexion avec ce rôle (endpoint *pooled* Neon recommandé).
   ⚠️ Un rôle créé via la console Neon hérite de `BYPASSRLS` : utiliser le rôle SQL ci-dessus.
7. **Variables d'environnement** : voir `.env.example`. Obligatoires en production : `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES`, `VITE_CLERK_PUBLISHABLE_KEY` (au build). Positionner `TRUST_PROXY=1` derrière Vercel/Cloud Run.
8. **Déployer**, vérifier le log de démarrage `RLS enforced`, puis passer `REQUIRE_RLS=true`.
9. **Par précaution** : régénérer `GEMINI_API_KEY` (la route d'analyse IA était publique et consommait votre quota) et passer en revue les `audit_logs` des périodes passées.

> **Hébergement** : `server.ts` est un serveur Node persistant (Express + `pg`). Je n'ai pas pu vérifier comment l'instance actuelle (`truetco.vercel.app`) exécute l'API : s'il s'agit d'un hébergement purement statique/serverless, l'adaptation du point d'entrée est à prévoir.

## 3. Ce que le chantier 1 ne couvre PAS (volontairement)

- **ERP simulé et parser IA à repli fictif** : désormais authentifiés/limités, mais leur contenu fictif demeure → **chantier 2**.
- **Prompt injection** : simple consigne de défiance ajoutée ; durcissement complet (extraction structurée validée, validation humaine obligatoire) → **chantier 8**.
- **Persistance carbone / risque** des offres, schéma Drizzle, **source de vérité de l'état client** (`localStorage` encore dominant) → **chantier 7**.
- **Hash chaîné** du journal d'audit, signature, export probatoire → **chantier 6**.
- **CSP** : livrée en mode *rapport seul* (`Content-Security-Policy-Report-Only`) ; à passer en blocage après validation avec l'intégration Clerk réelle.
- **SSO SAML/SCIM, MFA imposée, journal de connexion, résidence des données, SOC 2** → palier Enterprise.
- `xlsx` (CVE haute, sans correctif npm) : remplacement prévu au chantier 3 ; l'audit CI est non bloquant d'ici là.
- Les valeurs par défaut du **schéma** pour `suppliers` (`esg_score 70`, `data_quality_score 85`) restent des données non sourcées → chantier 5.

## 4. Tests

`npm test` exécute près de 400 tests sur un vrai Postgres (PGlite) avec les vraies migrations, en deux modes (*rls* : rôle applicatif soumis au RLS ; *app-only* : RLS contourné — la couche applicative doit isoler seule). Ajouter une route sans `requirePermission` ou lisant le tenant depuis la requête fait échouer les gardes statiques.
