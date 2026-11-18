# TrueTCO — Neon/PostgreSQL : état P0.4 du dépôt

**Opérations distantes : aucune.** Ni Neon/PostgreSQL, ni Clerk, ni une branche de base de données n’ont été contactés. Les faits distants plus bas restent les constats antérieurement rapportés par le propriétaire; ils ne sont ni revalidés ni présentés comme preuve de l’état actuel.

## 1. Faits distants communiqués antérieurement (non revalidés)

| Élément | Constat rapporté | Limite |
|---|---|---|
| Branches Neon | production `br-bold-leaf-b2eclysi`; preview PR `br-noisy-star-b2g4bwcn` | Noms rapportés uniquement; aucune opération |
| PostgreSQL | 18.7 | Non re-mesuré; les tests locaux utilisent PGlite/PostgreSQL 18.6 |
| Tables | 11, dont `user_sessions` | `user_sessions` n’existe pas dans les modèles locaux livrés |
| RLS / policies | Aucune trouvée | Observation du propriétaire, non revérifiée |
| Rôle de diagnostic | `neondb_owner`, `BYPASSRLS` | Ne prouve pas la protection du rôle runtime |
| Rôle applicatif / historique | Aucun rôle dédié ni historique retrouvé | Rapporté; ne prouve pas que l’état distant soit inchangé |
| Écarts rapportés | colonnes supplémentaires sur `users`/`organizations`; pas de `organization_id` sur offres et enfants; relations non tenant-cohérentes | Noms/types exacts et contenu actuels nécessitent une photographie read-only autorisée |

Aucun secret, URL de connexion, donnée métier ni catalogue distant n’a été lu dans cette mission.

## 2. Modèle local : divergences corrigées et limites

Le modèle local reste dix tables : `organizations`, `users`, `projects`, `suppliers`, `supplier_offers`, `cost_items`, `carbon_items`, `risk_items`, `reference_benchmarks`, `audit_logs`. Il ne décrit pas `user_sessions`.

La comparaison a été exécutée sur deux bases PostgreSQL jetables PGlite : DDL `src/db/schema.sql` et migration Drizzle `drizzle/migrations/0000_initial_schema.sql`. Les divergences structurelles locales identifiées puis alignées sont :

- `users.clerk_id` et son index Drizzle étaient absents du DDL; désormais présents dans les deux.
- `audit_logs.newValue` pointait vers la colonne SQL `new_value` sous le nom camelCase; le mapping Drizzle utilise maintenant `new_value`.
- Les valeurs par défaut de `projects.status`, `projects.carbon_price_per_tonne` et `suppliers.incoterm` divergeaient; elles sont alignées respectivement sur `Brouillon`, `120.00`, et `DDP`.
- Les contraintes `CHECK` présentes dans SQL mais absentes de Drizzle (rôles, statuts, plages, scopes, source type, catégories, montants/volumes) sont maintenant représentées aussi dans Drizzle.
- Les définitions d’index et les noms de contraintes uniques/FK étaient partiellement différents. Le modèle Drizzle et le DDL alignent les noms, colonnes, sens de tri et actions `ON DELETE`; notamment la FK auteur projet `SET NULL`.
- `uuid-ossp`/`pgcrypto` étaient déclarées sans usage d’API propre à ces extensions. Les DDL n’en dépendent plus; `gen_random_uuid()` est une fonction PostgreSQL core depuis PostgreSQL 13.
- Les six triggers `updated_at` ne sont pas une primitive du schéma Drizzle. Ils sont consignés explicitement comme SQL custom dans le baseline versionné et dans le bootstrap SQL.

Les écarts distants potentiels ne sont pas corrigés par ces changements. Une comparaison locale identique ne démontre pas que Neon contient ces définitions, ni que RLS, grants, isolation ou historique y correspondent.

## 3. Migrations et statut des fichiers

- `drizzle/migrations/0000_initial_schema.sql` est le baseline initial généré depuis `src/db/schema.ts`, complété du SQL custom pour la fonction et les triggers. Il décrit une **base neuve isolée**; il ne doit pas être rejoué sur une base Neon existante ou considéré comme une baseline déjà appliquée.
- `drizzle/migrations/meta/` contient le journal Drizzle. `npm run db:generate` génère des migrations; aucun `db:push` n’est exposé. Aucun déploiement de migration n’a été lancé.
- `scripts/migrate-neon.mjs` est désactivé : il ne lit aucune variable d’environnement, n’ouvre aucune connexion, n’exécute ni DDL ni seed et termine avec un message explicite. Son ancien rôle était un bootstrap `CREATE TABLE IF NOT EXISTS` suivi d’un seed conditionnel, pas un système de migrations versionnées.
- Les deux brouillons `db/migrations/proposed/*.sql.draft` restent inchangés et non actifs. Ils ont été exercés **uniquement en mémoire dans PGlite** pour vérifier syntaxe, préconditions, réexécution du draft 0001, arrêt sur `NULL`/mauvais tenant, et FKs composites après backfill de fixture. Le draft 0002 n’est pas conçu pour être relancé et reste non approuvé.

### Stratégie reproductible pour la suite

1. Pour les environnements neufs : prendre le journal/migrations Drizzle versionnés comme séquence traçable et tester chaque version dans PGlite et dans une vraie version PostgreSQL jetable/staging adaptée.
2. Pour Neon existant : commencer par une photographie read-only des catalogues et l’approbation du propriétaire; établir une baseline correspondant à l’état réellement appliqué. **Ne pas jouer le baseline initial `0000` sur une base préexistante.**
3. Convertir explicitement toute migration de données après revue, préconditions, plan de rollback/restauration et tests; les fichiers `.sql.draft` ne sont pas exécutés ou auto-importés.
4. N’ajouter un mécanisme d’application de migrations ciblant un environnement que lorsqu’un opérateur autorisé a approuvé la baseline et le runbook. L’absence de commande de push direct est intentionnelle.

## 4. Vérification PostgreSQL jetable

`npm test` contient trois tests d’intégration avec **PGlite 0.5.16, moteur PostgreSQL 18.6 compilé en WebAssembly, base temporaire en mémoire**. Ce n’est pas un test Neon ni un serveur PostgreSQL natif réseau, et les résultats ne sont pas extrapolés à Neon.

Résultats observés :

- `schema.sql` crée les dix tables depuis zéro et se réexécute sans erreur sur son propre schéma.
- La migration Drizzle s’applique à une base vide; la seconde invocation du migrateur consulte le journal et ne rejoue pas les DDL.
- Les catalogues des deux bases locales sont égaux pour colonnes, types, nullabilité, defaults, PK/uniques/FK/CHECK, indexes/directions et triggers.
- Des insertions invalides sont refusées par les checks et relations; l’unicité, le `RESTRICT`, le trigger `updated_at` et la cascade d’organisation sont exercés.
- Les drafts sont testés sur une fixture jetable : 0001 réexécutable; 0002 bloque les NULL et associations tenant incohérentes; après correction explicite, les contraintes composites rejettent offres/enfants cross-tenant.

Ces tests vérifient la structure et les contraintes sur PostgreSQL 18.6 PGlite; ils ne vérifient pas le temps de lock d’un service natif, un restore physique, le comportement Neon, des policies RLS ou le rôle runtime.

## 5. Conditions préalables avant tout chantier distant ultérieur

- Ré-introspecter les colonnes/types/defaults/contraintes/indexes, `user_sessions`, policies/RLS/grants/rôles de la cible sans exporter de secrets ni de données métier.
- Confirmer le mapping organisations/users et vérifier orphelins, NULL, doublons, relations projet-fournisseur-offre et enfants. Toute association est une décision explicite, jamais un fallback.
- Définir un rôle migrateur et un rôle runtime `NOBYPASSRLS` à privilèges minimaux, après autorisation; valider RLS et les requêtes via ce rôle réel.
- Concevoir le contexte tenant dérivé d’une identité et membership validés côté serveur; ne pas présumer que l’API Neon serverless supporte le modèle transactionnel projeté.
- Garder le gate 503 tant que membership, RBAC, requêtes tenant-scopées, contraintes, RLS, tests inter-tenant, restauration et revue ne sont pas prouvés.

**État décisionnel :** préparation locale P0.4 testée sur PGlite; NO-GO pour migration, backfill, RLS, données clients ou activation sur Neon.
