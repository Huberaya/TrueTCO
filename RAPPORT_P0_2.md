# TrueTCO — rapport P0.2 : architecture Clerk + Neon

**Date :** 11 novembre 2026 (UTC)
**Branche :** `arena/ea5046f1-truetco`
**Base de travail avant P0.2 :** `38edd8504e5d84cef89229a3e0347178a9505067`
**PR :** #1 vers `main`, ouverte et non fusionnée au départ de ce chantier.

## 1. Résumé exécutif

P0.2 livre une **couche de vérification Clerk préparatoire**, des contrôles fail-closed de configuration, une matrice RBAC documentant les rôles/routes sans inventer de grants, et deux migrations SQL versionnées en brouillons explicitement non exécutables. Les dossiers Clerk, Neon, l’inventaire API et le plan d’opération sont actualisés.

**Les routes métier demeurent fermées.** Même avec des clés Clerk configurées, le middleware Clerk ne se substitue pas au mapping utilisateur/membership, aux décisions RBAC, aux requêtes tenant-scopées ou aux protections IDOR. `createFailClosedApiGate()` reste monté après Clerk et continue de renvoyer 503.

**Aucune base Neon n’a été contactée ou modifiée.** Aucun secret Clerk/GitHub/Vercel n’a été lu ou modifié, aucune migration n’a été appliquée, aucune branche/base/rôle Neon créé, aucun déploiement ou fusion réalisé.

## 2. Diagnostic

- Le dépôt avait un gate API P0 global, mais aucun middleware serveur Clerk. Le code métier latent contient des faiblesses de résolution tenant contrôlée par le client, de synchronisation user depuis body, de requêtes sans filtrage homogène et de relations tenant incomplètes.
- Les rôles historiques visibles dans le domaine/UI ne justifient pas une matrice de permissions serveur; des écrans et exemples ne sont pas une décision d’autorisation.
- Le schéma Drizzle/SQL local ne décrit pas complètement les faits Neon communiqués : 11 tables distantes rapportées contre dix locales; `user_sessions`; colonnes `users`/`organizations` supplémentaires; manque de tenant sur offres et tables enfants. RLS absente selon l’inspection distante antérieure du propriétaire, rôle `neondb_owner` avec `BYPASSRLS`; ces observations n’ont pas été re-mesurées pendant cette exécution.
- Pas de séquence de migrations versionnées appliquées n’a été prouvée. Le script historique applique DDL et seed directement; il n’a pas été exécuté.

## 3. Changements réalisés

### Clerk

- Ajout de `@clerk/express@2.1.91`, dont les métadonnées npm et types ont été inspectés : Node `>=20.9.0`, peer Express 4 ou 5.
- Ajout de `src/server/clerkAuth.ts`: exige secret `sk_`, publishable key `pk_` et origines autorisées exactes; rejette placeholders, URLs non conformes et clés publiques données comme secret; n’expose pas les valeurs en erreurs.
- Montage du middleware officiel dans `server.ts` avant le gate. Configuration manquante → 503; `GET /api/health` reste minimal/public; toute route métier reste 503 par la garde globale, même si Clerk est configuré.
- Ajout du nom `CLERK_AUTHORIZED_PARTIES` à `.env.example` avec une origine localhost de développement uniquement; les clés existantes demeurent des placeholders invalides et aucun secret utilisable n’est ajouté.
- Tests dans `src/server/clerkAuth.test.ts` pour config, origines, refus fail-closed, liveness et ordre de montage.

### RBAC

- `MATRICE_RBAC.md` inventorie six rôles déjà présents (`admin`, `directeur_achats`, `acheteur`, `finance_controleur`, `rse_esg`, `direction_generale`) et les routes/décisions manquantes.
- N’accorde aucune permission non validée; documente les contrôles positifs/négatifs exigés et maintient l’état réel fermé.

### Neon / migrations

- `DOSSIER_NEON.md` et `PLAN_MIGRATIONS_NEON.md` distinguent les observations distantes rapportées des vérifications effectuées cette session.
- Deux candidats numérotés sous `db/migrations/proposed/*.sql.draft` : extension nullable sans backfill, puis contraintes après revue/backfill explicite. L’extension `.draft` n’est pas un format de migration Drizzle.
- Aucun backfill automatique, tenant par défaut, contrainte appliquée, policy RLS ou rôle SQL créé.
- `DOSSIER_CLERK.md` et `P0_API_ROUTE_INVENTORY.md` actualisés; le statut fail-closed et les preuves manquantes sont explicités.

## 4. Tests et vérifications

### État de départ avant modifications

- `npm ci` réussi : 613 packages initialement installés; npm a signalé 8 vulnérabilités modérées et des dépendances dépréciées.
- `npm test` réussi avant P0.2 : 23 tests, 0 échec.
- `npm run typecheck` réussi avant P0.2.

### État post-changements

- `npm test` : **26 tests passés, 0 échec** après correction du contrôle des origines wildcard.
- `npm run typecheck` : **réussi** (`tsc --noEmit`).
- `npm run lint` : **réussi** (Biome, 64 fichiers).
- `npm run build` : **réussi**; Vite émet les avertissements existants sur `__dirname` avec `configLoader: native` et chunks minifiés >500 kB.
- `git diff --check` : **réussi**.
- `npm ci` après mise à jour de la lockfile : **réussi** (623 packages; 8 vulnérabilités modérées rapportées par npm, aucune correction forcée appliquée).
- `npm audit --omit=dev --audit-level=high` : **réussi**, 0 vulnérabilité dans les dépendances de production au seuil `high`.
- Tests Clerk avec clés/JWT réels : non réalisés, aucune clé tenant Clerk fournie.
- Tests PostgreSQL/RLS/migrations : non réalisés; aucune base PostgreSQL/Neon de test inspectée ou modifiée, et aucun `psql`/serveur PostgreSQL local n’était disponible dans l’environnement.
- `npm ci` a rapporté 8 vulnérabilités modérées avant mise à jour de lockfile; aucune correction forcée de dépendances n’a été tentée.

### CI / intégration

- Commit de code P0.2 `f10267c230ddb3f42a93a9d962b88dc8f45a41e4` poussé sur la seule branche autorisée `arena/ea5046f1-truetco`; la PR #1 demeure ouverte, non fusionnée.
- CI GitHub sur ce commit : réussite complète (clean install, typecheck, lint, tests, audit production et build), workflow run `44075921597`; un second déclenchement PR a également réussi (`44075930484`).
- Checks PR observés ensuite : `Vercel` SUCCESS et `Vercel Preview Comments` SUCCESS; état de fusion GitHub `CLEAN`. Cela confirme les statuts de checks, pas une inspection indépendante des paramètres ou du contenu applicatif du déploiement Vercel.
- Le commit de code f102... est celui dont les checks sont explicitement consignés. Tout commit ultérieur, même documentaire, doit être revérifié sur son propre SHA.

## 5. Limites et actions bloquantes restantes

1. Approuver les rôles et droits de `MATRICE_RBAC.md` avec Produit/Sécurité; les candidats ne sont pas des permissions.
2. Provisionner et vérifier configuration Clerk dans les gestionnaires de secrets par environnement; tester un token réel et la partie autorisée.
3. Implémenter membership, mapping externe/interne, révocation, queries DB scope tenant et anti-IDOR; supprimer ou remplacer resolver et synchronisation hérités.
4. Faire une photographie Neon read-only actualisée, rapprocher colonnes et contraintes et préserver les différences historiques.
5. Convertir les brouillons SQL en migrations après revue de données, tests PostgreSQL, restore/rollback et rôle runtime `NOBYPASSRLS`.
6. Ne jamais déclarer RLS démontrée avec `neondb_owner` BYPASSRLS. Tester l’utilisateur runtime réel.
7. Garder toutes les routes métier indisponibles jusqu’aux critères ci-dessus; aucune migration ou déploiement production n’est autorisé par ce rapport.

## 6. Décision de livraison

**GO limité** pour intégrer les artefacts préparatoires et la couche Clerk non autorisante, sous réserve de tests et CI du SHA final.
**NO-GO** pour activer API métier, utiliser des données clients, appliquer les brouillons, ou présenter une isolation/RLS, une RBAC approuvée ou un SSO opérationnel comme acquis.
