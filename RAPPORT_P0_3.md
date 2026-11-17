# TrueTCO — rapport P0.3 / préparation P0.4

**Branche imposée :** `arena/ea5046f1-truetco`
**PR :** #1 vers `main`, laissée ouverte/non fusionnée
**SHA initial observé :** local `edc44ceb6570f705f4edf591dfd95524838a1160`; tête réelle distante de la PR `3f7324a705cb16619ccf2348846217aa635eb41b`. Le checkout local a été fast-forwardé à cette tête avant le travail. Les commits existants de la PR n’ont pas été réécrits.

## 1. Corrections P0.3

### Serveur et routes

- Réécriture de `server.ts` : retrait du client Neon serveur, du resolver tenant (`resolveTenantId`, `getOrganizationId`), des reads header/query/body, du fallback premier tenant/UUID, des requêtes `user_sessions`, des upserts `POST /api/users/sync`, des sessions `/api/auth/*` et de tous les handlers métier.
- Le serveur déclare seulement `GET /api/health`, après `createClerkSessionMiddleware()` puis `createFailClosedApiGate()`. Liveness renvoie uniquement `{ "status": "ok" }`. Le gate reste avant Vite/static et refuse toute autre route ou méthode; le router intégration n’est plus monté.
- Le middleware Clerk reste une vérification préparatoire distincte de l’autorisation. Il n’ouvre aucune route et ne prouve pas une session réelle dans cette livraison.

### Frontend et services

- `AuthService` ne lit ni n’écrit token, cache utilisateur ou `localStorage`; l’API locale SSO/session historique et ses types ont été supprimés. `AuthContext` est constamment `user: null`, `isAuthenticated: false`; suppression du switch de rôle.
- Suppression des identités préconfigurées dans l’écran de connexion; message clair « Connexion indisponible ».
- `TenantService` ne mémorise ni ne fournit de tenant par défaut; liste vide, organisation courante `null`, sélection/création refusées. Le sélecteur affiche « Organisation indisponible ».
- Suppression du hook de synchronisation Clerk→Neon et de l’API client `syncClerkUser`. `NeonService` ne produit aucune requête réseau et aucune entête tenant/Bearer.
- L’interface indique « DÉMO — NON CONNECTÉ »; le rôle local fixe est uniquement un profil de démonstration et n’est envoyé à aucun serveur.

## 2. Tests adversariaux et preuves locales

`src/server/apiGate.test.ts` compose un middleware Clerk instrumenté (test), puis le gate, puis des handlers historiques simulés. Il exerce tenant falsifié en headers (`x-tenant-id`, `x-organization-id`, slug), query et body; rôle `admin`; bearer arbitraire; `clerkId`/email falsifiés; endpoints historiques de session/SSO; chemins métier et variantes; toutes les méthodes usuelles; fallback statique.

**Le compteur des handlers simulés reste à 0** pour toutes ces requêtes. Le middleware est observé dans l’ordre `Clerk → gate`. Seul `GET /api/health` passe et sa réponse reste minimale. Les chemins encodés/variantes ne retournent aucune donnée métier. Tests complémentaires dans `src/server/p0_3.security.test.ts`, `src/server/clerkAuth.test.ts` et `src/services/safetyP0.test.ts` vérifient absence des anciens fallbacks, cache/token local et état connecté fictif.

- `npm ci` : réussi, 623 packages installés; 8 vulnérabilités modérées signalées par npm.
- `npm run typecheck` : réussi.
- `npm run lint` : réussi, Biome sur 65 fichiers.
- `npm test` : **28 réussis, 0 échoué**.
- `npm audit --omit=dev --audit-level=high` : réussi, 0 vulnérabilité au seuil `high` dans les dépendances de production.
- `npm run build` : réussi. Avertissements Vite non bloquants sur `__dirname` avec `configLoader: native` et chunks minifiés supérieurs à 500 kB.
- `git diff --check` : réussi.

Le test de pipeline utilise une factory Clerk instrumentée sans clé/token réel afin de vérifier l’ordre et le refus ultérieur par la garde. **Aucun JWT Clerk réel, PostgreSQL ou Neon n’a été testé.**

## 3. P0.4 effectivement traité

- Comparaison locale de `src/db/schema.ts`, `src/db/schema.sql`, `src/db/drizzle.config.ts`, `scripts/migrate-neon.mjs` et des deux brouillons `db/migrations/proposed/*.sql.draft`.
- Constaté : aucun dossier `drizzle/` ni historique généré; Drizzle ne fait que configurer une sortie `./drizzle/migrations`. Les deux schémas locaux déclarent dix tables; `user_sessions` est absent localement et présent seulement selon les constats Neon antérieurs rapportés par le propriétaire.
- Divergences locales documentées : `users.clerk_id`/index Drizzle absent du DDL; contraintes `CHECK`, defaults, noms d’indexes/uniques non homogènes; `projects.status` `Brouillon` vs `brouillon`. L’état distant reste non vérifié.
- Retrait d’un `DROP TRIGGER` organizations dupliqué dans `src/db/schema.sql`.
- Correction du message dans `scripts/migrate-neon.mjs` : le script exécute un bootstrap `CREATE TABLE IF NOT EXISTS`, ne réconcilie pas les tables existantes et n’est pas une migration versionnée. Le script n’a pas été exécuté.
- Les brouillons `.sql.draft` restent tels quels : pas de conversion en migration, aucune migration/seed/backfill exécuté.

Aucun test PostgreSQL jetable n’a été exécuté : aucun exécutable `psql`/serveur local n’était disponible; l’accès Neon est interdit pour cette mission. Les décisions nécessitant approbation ou introspection distante sont détaillées dans `DOSSIER_NEON.md` et `PLAN_MIGRATIONS_NEON.md`.

## 4. Fichiers modifiés P0.3/P0.4

`server.ts`, `src/server/apiGate.test.ts`, `src/server/clerkAuth.ts`, nouveau `src/server/p0_3.security.test.ts`; `src/services/{authService,neonService,tenantService,safetyP0.test}.ts`; `src/context/{AuthContext,TenantContext}.tsx`; `src/hooks/useClerkNeonSync.ts`; `src/components/{EnterpriseLoginModal,Header,NewTenantModal,TenantSwitcher}.tsx`; `src/App.tsx`; `package.json`; `src/db/schema.sql`; `scripts/migrate-neon.mjs`; `DOSSIER_CLERK.md`, `DOSSIER_NEON.md`, `P0_API_ROUTE_INVENTORY.md`, `PLAN_MIGRATIONS_NEON.md`.

## 5. Intégration distante

**À compléter après push du commit P0.3 :** SHA final, URL/run CI correspondant à ce SHA, statuts Vercel et état final PR. La PR #1 ne doit pas être fusionnée.

## 6. Décision

**P0.3 : GO limité à la neutralisation et à la vérification locale des chemins; NO-GO pour authentification Clerk de production, API métier, données clients, RBAC/RLS ou isolation multi-tenant opérationnelle.** Le serveur reste fermé par conception. Aucune opération interdite sur Neon, Clerk ou Vercel n’a été effectuée.
