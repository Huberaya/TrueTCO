# TrueTCO — clôture P0.3 / P0.4 et préparation PR #1

## Identité et références

- Dépôt : `Huberaya/TrueTCO`; branche de travail imposée `arena/ea5046f1-truetco`; PR #1 vers `main`.
- À l’ouverture de cette mission, le checkout local avait `HEAD=edc44ceb6570f705f4edf591dfd95524838a1160` (base `main`) et des fichiers de travail non commités. Vérification par empreintes du worktree contre la branche distante : les fichiers correspondaient au tree PR `4da032dc7f3bbe6ea18a0c8be57b4357fca12cde`, à l’exception de l’audit P0.1 préexistant non suivi. Le pointeur local a été avancé en fast-forward à `4da032d` sans écraser de fichier. `git stash list -n 5` est vide dans le checkout effectif; aucun stash n’a été appliqué ni supprimé.
- `origin/main` vérifié : `edc44ceb6570f705f4edf591dfd95524838a1160`. Le head PR initial était 10 commits devant la base, sans divergence de main.
- Commit de code/tests P0.3/P0.4 : `725caed0a4fe95e772977d0574830ddd268320ca` (`test(p0.4): verify PostgreSQL baseline and close safety gate`), publié sur la branche imposée.
- `origin/main` reste à `edc44ceb6570f705f4edf591dfd95524838a1160`; aucun rebase ou changement de branche effectué.
- PR #1 observée après publication de ce SHA : ouverte vers `main`, head exact `725caed0a4fe95e772977d0574830ddd268320ca`, `mergeStateStatus=CLEAN`; aucun conflit rapporté. Elle n’a pas été fusionnée. Le corps de PR a été actualisé après la publication avec le SHA, les validations et les réserves.

## 1. P0.3 — neutralisation et tests d’exécution

La pile serveur partagée est maintenant construite par `src/server/application.ts` : Clerk → gate fail-closed → unique `GET /api/health` → middleware Vite/static monté ensuite dans `server.ts`. Les routes API encodées/non canoniques sont également envoyées à Clerk puis au gate afin d’éviter un passage au fallback. Health GET ne retourne que `{ "status": "ok" }`; toutes les autres API/méthodes répondent 503.

L’ancienne synchronisation utilisateur, le resolver/fallback tenant, les routes locales de session/Bearer/SSO et les handlers métier demeurent supprimés. Le frontend ne persiste ni session/cache identité ni tenant par défaut; la synchronisation Clerk→Neon est absente.

`src/server/apiGate.test.ts` lance l’app factory de production sur un port éphémère avec le véritable gate et une factory Clerk instrumentée; handlers métier historiques simulés et fallback statique suivent la pile. Headers/query/body falsifiés, Bearer arbitraire, rôle admin, création/synchronisation, changement de rôle, autre tenant, méthodes HTTP, endpoints historiques, chemins encodés/casse alternative sont testés. **Aucun handler métier simulé ni fallback statique n’est atteint par ces requêtes**; seul health GET est public. Le test ne valide pas un JWT Clerk réel.

## 2. P0.4 — divergences locales corrigées

Comparaison PostgreSQL de `src/db/schema.ts`, `src/db/schema.sql`, `src/db/drizzle.config.ts`, script legacy et drafts :

- Types, colonnes, nullabilité, defaults, contraintes `CHECK`, FK/actions `ON DELETE`, indexes/sens de tri et clés uniques ont été alignés dans Drizzle et le DDL.
- Ajout du `clerk_id`/index manquant au DDL, correction du mapping `audit_logs.new_value`, alignement des defaults `Brouillon`, `120.00`, `DDP`, et déclaration Drizzle des contraintes métier présentes dans le SQL.
- Les six triggers `updated_at` sont inclus dans le baseline comme SQL custom; la paire d’extensions inutilisées `uuid-ossp`/`pgcrypto` a été retirée (`gen_random_uuid()` est natif depuis PostgreSQL 13).
- Baseline Drizzle versionné pour **base neuve seulement** : `drizzle/migrations/0000_initial_schema.sql` et `drizzle/migrations/meta/`. L’ancien `db:push` est retiré; `db:generate` est le seul script génération. `scripts/migrate-neon.mjs` est désactivé sans lecture d’environnement, connexion, DDL ou seed.
- Les `.sql.draft` demeurent intacts, non découverts par Drizzle et non approuvés. Ils ne sont pas convertis en migrations de déploiement.

### PostgreSQL jetable

Trois tests dans `src/db/schema.postgres.test.ts` utilisent PGlite 0.5.16, moteur PostgreSQL 18.6 compilé en WebAssembly, en base mémoire temporaire : création/réexécution du DDL; exécution du baseline et seconde invocation via journal; comparaison catalogues; checks/FK/uniques/indexes/triggers/cascade; et scénarios préconditions + FK composites des drafts 0001/0002 sur fixture. Les connexions PGlite sont fermées par les tests.

**Limites :** pas de serveur PostgreSQL natif, pas de Neon, pas de test de version de patch 18.7 rapportée, de délai de lock/restore, ni de rôle/policies RLS. Cette preuve porte sur PostgreSQL 18.6 PGlite et ne prétend pas représenter l’état distant.

## 3. Qualité locale et dépendances

Sur l’état préparé localement :

- `npm ci` : réussi, 624 paquets ajoutés; npm rapporte 17 vulnérabilités totales (6 modérées, 11 élevées, 0 critique).
- `npm run typecheck` : réussi.
- `npm run lint` : réussi, Biome sur 67 fichiers.
- `npm test` : **31 réussis, 0 échoué**, y compris 3 tests PostgreSQL PGlite et le test HTTP de la pile production.
- `npm audit --omit=dev --audit-level=high` : réussi, 0 vulnérabilité de production.
- `npm run build` : réussi; avertissement non bloquant restant sur les chunks minifiés >500 kB (JS app et ExcelJS). L’avertissement Vite sur `__dirname` a été corrigé.
- `git diff --check` : réussi.

L’audit complet courant annonce **17 vulnérabilités dans les dépendances incluant dev** (6 modérées, 11 élevées; aucune critique). Les packages modérés concernés sont `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit`, `esbuild` transitif, `glob` et `minimatch`; les élevées incluent la chaîne Vite/`picomatch`/`tinyglobby`/`fdir` et les plugins Rollup/Workbox de `vite-plugin-pwa`. Les tools Vite/PWA ont été déplacés en `devDependencies`; Vite est chargé dynamiquement uniquement en mode développement, donc ils ne sont pas dans l’audit production. `npm audit fix` a été tenté sans `--force` : aucun correctif semver-compatible disponible; npm recommande des downgrades/versions major incompatibles (notamment Drizzle Kit, vite-plugin-pwa/Vite). Aucun forçage non testé n’a été appliqué. Les vulnérabilités d’outillage restent un risque de build/développement à surveiller, pas un risque de code livré runtime établi par ces avis.

## 4. CI et preview — vérifiés sur le commit de code publié

- SHA testé : `725caed0a4fe95e772977d0574830ddd268320ca`.
- GitHub Actions run `44268729624` : [CI sur ce SHA](https://github.com/Huberaya/TrueTCO/actions/runs/44268729624), conclusion `success`; job `Install, typecheck, lint, test, build` entièrement vert : checkout, Node 22.22.3, npm 10.9.8, `npm ci`, typecheck, lint, suite P0/API/PostgreSQL, audit production, build.
- Un second run `44268736044` sur le même SHA est également `success`.
- `gh pr checks 1` : CI, `Vercel` et `Vercel Preview Comments` en `pass` pour ce SHA. Le statut Vercel pointe vers [l’aperçu de la PR](https://vercel.com/baya-ibraimmayoanouedu-8164s-projects/truetco/9R6gbDHpR4X7aEf9tcJH1DbhEoR5). Le connecteur Vercel a refusé l’accès à `list_deployments`; l’état vert est donc vérifié via le statut de commit GitHub, pas par inspection indépendante des détails du déploiement.
- La PR #1 reste `OPEN`, base `main`, état de fusion `CLEAN`; aucune revue/approbation n’était enregistrée dans la réponse GitHub au moment du contrôle. Aucun merge effectué.
- L’annotation CI non bloquante signale la dépréciation Node 20 de `actions/checkout@v4` et `actions/setup-node@v4` (runner les force actuellement sous Node 24), ainsi que la migration future du label `ubuntu-latest` vers Ubuntu 26.

## 5. Documents, portée opérationnelle et réserves

Documents actualisés : `DOSSIER_NEON.md`, `DOSSIER_CLERK.md`, `PLAN_MIGRATIONS_NEON.md`, `P0_API_ROUTE_INVENTORY.md`, `MATRICE_RBAC.md`, présent rapport et corps de PR #1 (mis à jour via l’API GitHub après publication).

- **Opérationnel et testé localement :** liveness GET; calcul TCO de l’engin par tests unitaires; garde API fail-closed; checks structurels du schéma neuf dans PGlite.
- **Désactivé volontairement :** endpoints métier et intégrations IA/ERP/Clerk→Neon; login/tenant local simulé; sélection de tenant/role; script legacy bootstrap/seed.
- **Préparatoire seulement :** middleware Clerk; mapping Clerk/membership; `0000_initial_schema.sql` pour base neuve; brouillons multi-tenant non actifs.
- **Non testé / non prouvé :** JWT ou tenant Clerk réels, auth production, membership/RBAC, isolation multi-tenant, rôle runtime/RLS, Neon actuel, historique de migration distant, déploiement prod, restauration native et locks.

Aucune migration, seed ou backfill Neon; aucun changement secrets GitHub/Vercel, paramètres Clerk, grants/roles/policies distants; aucune route métier activée; aucun déploiement manuel ou fusion.

## 6. Décision

**Décision : GO SOUS CONDITIONS pour fusionner la PR de neutralisation préparatoire, pas pour ouvrir les routes métier ni appliquer une migration distante.** La CI complète et les statuts Vercel via GitHub sont verts sur le commit de code `725caed0a4fe95e772977d0574830ddd268320ca`, et la PR est ouverte/clean. Conditions restantes : obtenir la revue/approbation humaine requise; accepter explicitement ou planifier le traitement des 17 avis de dépendances de développement (6 modérés, 11 élevés; aucun correctif sans changement incompatible n’a été trouvé, aucun `--force`); et maintenir le NO-GO pour Neon/Clerk, RBAC/RLS, données clients, opérations distantes et activation métier. Le verdict n’autorise pas la fusion automatique; aucune fusion n’a été effectuée.
