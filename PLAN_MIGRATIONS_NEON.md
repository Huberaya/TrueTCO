# TrueTCO — stratégie de migrations Neon / P0.4

**Statut : préparation locale versionnée uniquement.** Aucun SQL n’a été appliqué sur Neon, aucune base distante n’a été consultée, et aucun rôle, secret, donnée ou paramètre distant n’a été modifié.

## 1. État de départ connu

Les informations de Neon (branches `br-bold-leaf-b2eclysi` et `br-noisy-star-b2g4bwcn`, PostgreSQL 18.7, 11 tables dont `user_sessions`, absence de RLS/policies observée, rôle diagnostic `neondb_owner` avec `BYPASSRLS`) sont les constats antérieurement rapportés par le propriétaire. Elles ne sont pas revérifiées dans ce travail.

Le dépôt local décrit dix tables. Il ne décrit pas `user_sessions`; les quatre tables offre/enfants n’ont pas `organization_id` localement. Aucune différence locale n’établit à elle seule la structure ou les contraintes actuellement déployées sur Neon.

## 2. Canonisation et changements locaux

- `src/db/schema.ts` est la définition déclarative Drizzle; `drizzle/migrations/0000_initial_schema.sql` est le baseline généré pour une base **neuve**, avec les six triggers custom ajoutés explicitement.
- `src/db/schema.sql` reste un bootstrap DDL idempotent pour création d’un schéma local neuf; `CREATE TABLE IF NOT EXISTS` ne met jamais à niveau une table existante.
- Types, colonnes, nullabilité, defaults, checks, FK/actions, indexes et unique ont été alignés entre Drizzle et le bootstrap. `updated_at` triggers sont la seule extension SQL custom nécessaire au-delà du schéma déclaratif.
- La vérification en base jetable compare réellement les catalogues PostgreSQL 18.6 PGlite du DDL et du baseline; le rapport de test est `src/db/schema.postgres.test.ts`.
- Le script `db:push` a été retiré. `db:generate` sert à produire des fichiers de migration à revoir; aucun exécuteur de migration distant n’est configuré par ce chantier.
- `scripts/migrate-neon.mjs` est conservé comme garde de compatibilité désactivée : aucune lecture d’environnement, connexion, migration ou seed; il échoue avec un message explicite. L’ancien script n’était qu’un bootstrap et seed conditionnel, pas une migration versionnée.

### Procédure reproductible

1. Toute modification de `schema.ts` passe par génération Drizzle, revue de la migration SQL et mise à jour des tests d’intégration; jamais `drizzle-kit push`.
2. Tester du vide vers la baseline sur moteur PostgreSQL jetable; tester aussi la migration version précédente vers la suivante, les contraintes, indexes, triggers, réexécution via journal et l’absence de régression.
3. Pour un environnement existant, introspection read-only d’abord et baseline approuvée correspondant à l’état réel. **Ne pas appliquer `0000_initial_schema.sql` à Neon existant** : il crée un schéma neuf, il ne décrit pas un historique qui a déjà été appliqué.
4. Une étape de déploiement distante ne pourra être ajoutée qu’avec autorisation, identité migrateur dédiée, backup/restore éprouvé, préflight des données, lock budget, rollback et approbation explicite.
5. Les `.sql.draft` ne sont jamais découverts par le générateur, migrateur ou workflow; conversion manuelle après approbation et re-revue uniquement.

## 3. Brouillons multi-tenant P0.2

| Fichier | Ce qu’il propose | Statut |
|---|---|---|
| `db/migrations/proposed/0001_expand_tenant_scope.sql.draft` | Colonnes `organization_id` nullables et indexes sur offres, coûts, carbone, risques | Toujours `.sql.draft`; aucun backfill; testé seulement comme fixture PGlite, avec réexécution |
| `db/migrations/proposed/0002_enforce_tenant_consistency.sql.draft` | Arrêt sur NULL/cross-tenant puis `NOT NULL`, clés uniques/FK composites | Toujours `.sql.draft`; non approuvé; test local exige une association de fixture explicite et confirme les stop conditions |

Le draft 0002 n’est pas idempotent et ne doit pas être exécuté/rejoué hors d’un futur journal versionné et d’une migration approuvée. Aucun résultat de PGlite ne constitue un état ou un test de la base Neon.

## 4. Résultats de tests PostgreSQL jetable

Trois tests intégrés à `npm test` utilisent PGlite 0.5.16, qui embarque PostgreSQL 18.6 sous WebAssembly et crée les bases en mémoire :

- DDL `schema.sql` appliqué depuis zéro puis rejoué; checks, FKs, uniques, `ON DELETE`, triggers `updated_at` et cascade exercés.
- Migration Drizzle appliquée depuis zéro, comparaison de catalogue avec le DDL (colonnes/types/nullabilité/defaults/contraintes/indexes/triggers), puis second run via le journal sans DDL rejoué.
- Drafts exercés sur une fixture : réexécution 0001; refus 0002 sur colonnes NULL, offre cross-tenant et enfants incohérents; après correction de la fixture, les contraintes composites bloquent création inter-tenant.

Limites : moteur WASM, non service natif; aucune mesure de locks, réplication, restore, Neon ou RLS/rôle runtime. Pas de données ni d’identifiants distants utilisés.

## 5. Plan si une migration existante est autorisée plus tard

### M0 — observation read-only

Catalogues de chaque cible, version, tables/colonnes/types/nullabilité/defaults, contraintes/indexes, triggers, RLS/policies/grants/rôles et état de l’historique. N’exporter ni secrets ni lignes métier; conserver les champs distants inconnus jusqu’à décision.

### M1 — préflight sur une copie structurelle autorisée

Comptes de rows orphelines, NULL, doublons, références projet/fournisseur/offre incohérentes; mesurer locks/temps sur version PG proche de la cible et tester restauration. Aucun backfill implicite.

### M2 — migration additive approuvée

Ajouter uniquement ce qui est confirmé absent, colonnes nullables au départ; pas de tenant par défaut, pas de NOT NULL, pas de RLS avant rapport propre et mapping propriétaire approuvé.

### M3 — association manuelle et vérifiable

Attribuer l’offre à un tenant uniquement si projet et fournisseur le prouvent; attribuer les enfants uniquement selon le tenant de l’offre vérifié. Isoler toute ambiguïté et faire valider la décision.

### M4 — contraintes

Après zéro NULL/orphelin/cross-tenant, ajouter uniques et FKs composites offre→projet/fournisseur et enfants→offre; valider checks, stratégie locks et rollback. Les contraintes DB ne remplacent pas les filtres et autorisations applicatives.

### M5 — identité, rôles et RLS

Après approbation distincte, rôle runtime `NOBYPASSRLS`, grants minimaux, policies `USING` + `WITH CHECK` et contexte de tenant transaction-local construit uniquement depuis identité Clerk vérifiée et membership actif. Tester avec le vrai rôle runtime, jamais uniquement `neondb_owner`.

### M6 — ouverture explicite

Tests API allow/deny par route/action, IDOR et inter-tenant; tests ancien→nouveau et vide→baseline; restore/rollback staging; revue sécurité. Maintenir la garde 503 pour toute route non explicitement validée.

**Décision actuelle :** P0.4 côté dépôt et PostgreSQL jetable terminé; NO-GO pour toute opération distante, activation métier, données clients, RBAC, RLS ou isolation multi-tenant.
