# TrueTCO — inventaire API / contrôle P0.3

**État du code :** branche `arena/ea5046f1-truetco`; le serveur Express ne déclare désormais que `GET /api/health`. Aucune sonde de production n’a été effectuée.

## Ordre serveur vérifié

1. `express.json` (limite 10 Mo; pas d’effet métier).
2. `createClerkSessionMiddleware()` sur `/api` : le SDK Clerk officiel vérifie une session seulement si les clés et `CLERK_AUTHORIZED_PARTIES` sont configurées; sinon, refus 503. Le middleware Clerk n’accorde pas d’autorisation.
3. `createFailClosedApiGate()` sur `/api` : seul `GET /health` poursuit; toute autre méthode ou chemin retourne 503.
4. `GET /api/health` renvoie exclusivement `{"status":"ok"}`.
5. Vite/static/SPA fallbacks après la garde; aucun handler métier Express n’est monté.

## Routes historiques neutralisées

Les anciens chemins ne sont plus déclarés dans `server.ts`. Leur tentative reçoit 503 par le gate, avant les fallbacks et sans handler ni mutation :

| Famille de chemins retirée | Comportement actuel |
|---|---|
| `/api/tenants*` | Pas de découverte, sélection, création ou synchronisation d’organisation |
| `/api/users/sync` | Endpoint supprimé; aucun traitement de `clerkId`, email, rôle ou organisation du body |
| `/api/auth/*` | Routes locales de session, bearer, SSO, logout et annuaire supprimées |
| `/api/projects`, `/api/offers`, `/api/suppliers`, `/api/benchmarks`, `/api/audit-logs` | Handlers DB supprimés; aucun CRUD/API métier exposé |
| `/api/erp/*`, `/api/ai/*` | Router historique non monté; aucune intégration/forwarding API |
| tout autre `/api/*` | Refus 503 global; le fallback de l’application ne retourne pas de donnée métier |

## Identité, tenant et session

- Suppression de `resolveTenantId`, `getOrganizationId`, des lectures `x-tenant-id`, `x-organization-id`, `x-tenant-slug`, query/body tenant, du lookup `user_sessions`, et des fallbacks premier tenant/UUID.
- Suppression du client Neon et des queries SQL de `server.ts`; aucune identité ou organisation issue du navigateur n’atteint un handler serveur.
- `AuthService` ne lit ni n’écrit de token/cache local; le login SSO historique rejette avec un message d’indisponibilité. `AuthContext` expose toujours `user: null`, `isAuthenticated: false`; le rôle ne peut pas être commuté via l’UI.
- `TenantService` renvoie liste vide et organisation `null`; aucune sélection, création, valeur localStorage ou ID par défaut. Le sélecteur affiche « Organisation indisponible ».
- La synchronisation Clerk→Neon côté navigateur a été supprimée; `NeonService` n’émet aucune requête.

## Preuves automatisées P0.3

`src/server/apiGate.test.ts` monte le middleware de vérification Clerk (factory de test instrumentée), puis le gate, puis des handlers historiques simulés. Les entrées falsifiées suivantes sont testées : headers tenant/organization/slug, query tenant, body `organizationId`/`tenantId`, rôle `admin`, bearer arbitraire, `clerkId`/email, endpoints de session/SSO. L’ordre est `Clerk → gate`; compteur d’invocation des handlers : **0**.

Le même test vérifie les méthodes `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS`, health GET uniquement, chemins API historiques, chemins encodés/variantes, endpoint inconnu et fallback. `src/server/p0_3.security.test.ts` vérifie absence des anciens résolveurs/sessions/fallbacks serveur et absence de persistance/envoi d’identité côté client. `src/services/safetyP0.test.ts` vérifie l’état frontend déconnecté.

Le test de middleware Clerk utilise une factory instrumentée sans credential afin de tester l’ordre de composition; ce n’est pas un test d’un JWT ou d’un tenant Clerk réel.
