# TrueTCO — dossier Neon/PostgreSQL P0.2

**État :** architecture et candidats de migration préparés; aucune connexion Neon effectuée pendant P0.2, aucune migration exécutée, aucune donnée ou configuration distante modifiée. Les observations distantes ci-dessous sont celles préalablement vérifiées et communiquées par le propriétaire du projet; elles n’ont pas été re-mesurées dans ce checkout.

## 1. Faits de départ rapportés par le propriétaire

| Élément | Constat communiqué | Portée |
|---|---|---|
| Branche Neon de production | `br-bold-leaf-b2eclysi` | Identifiant seulement; aucune opération réalisée |
| Branche preview liée à la PR | `br-noisy-star-b2g4bwcn` | Identifiant seulement; aucune opération réalisée |
| Version PostgreSQL | 18.7 | Rapporté, non revalidé ici |
| Tables | 11 tables métier, incluant `user_sessions` | Rapporté, à ré-introspecter avant migration |
| RLS / policies | Aucune trouvée | Observation distante fournie; pas une nouvelle inspection |
| Rôle de diagnostic | `neondb_owner`, `BYPASSRLS` | Ne permet pas de démontrer l’isolation RLS |
| Rôle applicatif | Aucun rôle dédié identifié | Rapporté; ne pas connecter le runtime en owner |
| Historique migrations | Aucun historique retrouvé | Rapporté; le repo configure Drizzle mais n’apporte pas de preuve d’application |
| Colonnes et intégrité | Colonnes supplémentaires sur `users`/`organizations`; pas de `organization_id` sur `supplier_offers`, `cost_items`, `carbon_items`, `risk_items`; clés offre non tenant-cohérentes | Noms exacts des colonnes supplémentaires non établis dans le dossier de session; ré-introspection requise |

Ne pas présenter ces données comme une observation indépendante de cette session. Aucun secret ni URL Neon n’a été utilisé.

## 2. Écart dépôts / modèle connu

Le code suivi déclare dix tables (organisations, utilisateurs, projets, fournisseurs, offres, coûts, carbone, risques, benchmarks, audit). Les faits distants déclarent 11 tables et incluent `user_sessions`, absente de `src/db/schema.ts` et `src/db/schema.sql`. Les définitions Drizzle/SQL ne sont donc pas une représentation canonique prouvée de la base.

| Table | Modèle local suivi | Observation distante communiquée / conséquence |
|---|---|---|
| `organizations` | Schéma local limité à ses champs déclarés | La base a des champs supplémentaires; ne pas les supprimer ni les deviner. Relever les noms/types/defaults réels avant rapprochement. |
| `users` | Drizzle contient `clerk_id`; DDL SQL l’omet; routes historiques utilisent aussi champs absents des définitions locales | La base a des colonnes supplémentaires et `user_sessions` existe; la synchronisation historique ne peut pas servir de contrat d’identité. |
| `projects` | `organization_id` local | Toute relation à auteur/utilisateur doit être vérifiée comme appartenant au même tenant. |
| `suppliers` | `organization_id` local | Une offre reliée à projet/fournisseur de tenants différents doit être impossible. |
| `supplier_offers` | Pas de `organization_id`; FKs séparées project/supplier | Confirmé aussi dans le constat distant; deux FKs simples ne prouvent pas qu’ils appartiennent au même tenant. |
| `cost_items`, `carbon_items`, `risk_items` | Pas de `organization_id`; `offer_id` seul | Confirmé aussi dans le constat distant; RLS tenant ne peut pas être supposée par simple présence d’une relation ORM. |
| `reference_benchmarks`, `audit_logs` | `organization_id` local | Cela ne prouve pas que les handlers filtrent l’organisation ou que des policies distantes existent. |
| `user_sessions` | Absente des schémas locaux | Présente selon les faits fournis; ne pas la recréer ni la migrer par défaut. Clerk peut gérer les sessions sans table opaque maison. |

`server.ts` contient encore des handlers latents qui lisent les tenants depuis headers/query/body, retombent sur un tenant arbitraire, acceptent des rôles de body, ou effectuent des requêtes sans scope d’organisation. Ils demeurent bloqués en amont par `createFailClosedApiGate()`; cette protection doit rester jusqu’à suppression des chemins non sûrs.

## 3. Dossiers de migrations livrés

Deux fichiers SQL versionnés en tant que **brouillons non exécutables** se trouvent dans `db/migrations/proposed/` :

- `0001_expand_tenant_scope.sql.draft` — proposition additive pour colonnes nullable `organization_id` sur offres et tables enfant, index; aucun backfill, aucun `NOT NULL`, aucune policy RLS.
- `0002_enforce_tenant_consistency.sql.draft` — proposition après backfill approuvé; vérifie `NULL` et relations cross-tenant, puis prépare `NOT NULL`, uniques composites et FKs composites.

L’extension `.sql.draft` est intentionnelle : ils ne font pas partie du chemin de migration Drizzle (`./drizzle/migrations`) et ne doivent pas être lancés par `db:migrate`, `db:push` ou `psql`. Ils ne sont pas testés contre une base réelle. Ré-introspecter l’environnement cible, confirmer le schéma réel et le nom des contraintes avant toute conversion en migration effective.

Le script existant `scripts/migrate-neon.mjs` applique directement `src/db/schema.sql` puis seed; il ne constitue pas un historique versionné sûr et **n’a pas été lancé**. Ne pas exécuter `npm run db:migrate` ni `npm run db:push` dans le cadre de ce plan.

## 4. Séquence d’intégration proposée

1. **Photographie read-only** : exporter catalogues de tables/colonnes, contraintes, indexes, grants, rôles (sans données ni secrets) pour chaque environnement; obtenir approbation et confirmer si les constats rapportés ont changé.
2. **Canonisation** : décider explicitement Drizzle migrations ou SQL versionné; établir l’état initial existant sans tenter de réappliquer `schema.sql`. Rapprocher tous les champs présents localement et à distance, y compris `users`/`organizations`/`user_sessions`.
3. **Preflight données** : compter offres orphelines, parents absents, conflits project↔supplier, divergences tenant, enfants orphelins, doublons et valeurs NULL; rapporter uniquement des compteurs/IDs de test protégés.
4. **Expansion additive en staging isolé** : après revue/backup restaurable, ajouter colonnes tenant nullables puis index; aucune affectation par défaut ni backfill automatique.
5. **Résolution contrôlée** : traiter les lignes non ambiguës avec un mapping revu et documenté; isoler chaque anomalie et décider manuellement. Ne jamais assigner silencieusement le premier tenant.
6. **Cohérence relationnelle** : une fois les compteurs à zéro, poser contraintes composites `supplier_offers(organization_id, project_id)`→`projects`, `(organization_id, supplier_id)`→`suppliers` et enfants `(organization_id, offer_id)`→`supplier_offers`; tester contraintes, verrous et rollback.
7. **Rôles & RLS** : créer/réviser un rôle migrateur distinct et un rôle runtime `NOBYPASSRLS`; grants minimaux, `ENABLE`/`FORCE ROW LEVEL SECURITY`, `USING` et `WITH CHECK` pour chaque table. Concevoir avant cela le contexte de tenant transaction-local, paramétré exclusivement depuis le contexte Clerk validé. Ne pas supposer que `@neondatabase/serverless` HTTP transaction exécutée dans un batch permet le flux transactionnel interactif projeté.
8. **Activation seulement après preuves** : intégrer les queries tenant-scopées, membership/RBAC, tests API et tests PostgreSQL multi-tenant; migration précédente→suivante, restauration staging et revue sécurité réussies. Garder le gate jusqu’à la réussite complète.

## 5. Modèle de défense en profondeur cible

- Mapper un `orgId` Clerk externe à une organisation locale via mapping persistant; les formats d’identifiants ne sont pas interchangeables.
- Autorité du tenant : identité Clerk vérifiée → membership actif local → contexte de requête; jamais header, `organization_id` JSON, query, slug ou fallback.
- Filtrer les queries explicitement par tenant, contrôler l’accès à chaque ID imbriqué/IDOR et ajouter des FKs/uniques composites tenant.
- RLS par défaut refusée si contexte absent; `USING` **et** `WITH CHECK`; tests avec rôle `NOBYPASSRLS` réellement utilisé par l’app.
- `neondb_owner` ayant `BYPASSRLS` ne peut pas prouver que RLS protège le rôle runtime. Ne pas prétendre avoir vérifié RLS tant que rôle runtime séparé et tests effectifs ne sont pas passés.
- N’enregistrer ni rôle SQL ni clé de connexion dans le dépôt; séparer accès migrateur et runtime, TLS et rotation dans le gestionnaire de secrets.

## 6. Tests PostgreSQL obligatoires avant activation

À exécuter uniquement sur une base jetable de test migrée depuis zéro et sur une branche Neon staging dédiée, après provisionnement explicite :

- A/B peuvent accéder uniquement à leurs organisations, projets, fournisseurs, offres, coûts, carbone, risques, benchmarks et audits selon la matrice approuvée.
- Les IDs connus de B ne sont ni lisibles ni mutables par A; mêmes tests avec tenant absent, inconnu, modifié, header/body/query frauduleux et relation imbriquée.
- L’offre A liée au projet A mais au fournisseur B est rejetée par contrainte composite; enfants A liés à une offre B également rejetés.
- Les rows sans mapping, `NULL`, orphelines et incohérentes bloquent la migration de contrainte sans backfill implicite.
- Le contexte transaction-local ne fuit pas entre requêtes/pool; lecture et mutation sans contexte refusées par le rôle runtime réel.
- RLS validée avec rôle de runtime `NOBYPASSRLS`, et tests séparés démontrant la différence owner/bypass vs runtime; ne pas utiliser `neondb_owner` comme preuve.
- Exécuter migrations à partir d’une base vide et de l’état existant, mesurer lock time, vérifier restore/rollback sur staging.

**Statut tests PostgreSQL P0.2 : non exécutés et non revendiqués** — aucune base PostgreSQL test/staging n’a été connectée ni préparée durant cette session.
