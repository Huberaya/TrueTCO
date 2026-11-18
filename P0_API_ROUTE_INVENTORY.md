# TrueTCO — inventaire API et contrôle P0.3

**État du code :** pile Express partagée dans `src/server/application.ts`; seul `GET /api/health` est public. Aucun probe de production ou appel Neon/Clerk n’a été réalisé.

## Pile serveur vérifiée

1. `express.json` (limite 10 Mo; aucune action métier).
2. Précontrôle des chemins encodés/non canoniques du préfixe API, qui les envoie eux aussi dans Clerk → gate au lieu de les laisser atteindre le fallback.
3. Middleware Clerk officiel sur `/api`. Une session n’est vérifiée que si configuration complète; sinon refus 503. Liveness GET est exclu.
4. `createFailClosedApiGate()` sur `/api`; seul `GET /health` poursuit. Toute autre méthode/route répond 503.
5. `GET /api/health` retourne exclusivement `{ "status": "ok" }`.
6. Vite/static/SPA après la pile API. Aucun routeur métier n’est monté.

`src/server/apiGate.test.ts` exécute le véritable app factory production, la vraie garde et un middleware Clerk de test instrumenté. Des handlers historiques/fallback statiques sont montés après la pile dans le test pour compter l’accès : compteur métier **0** sur toutes les tentatives API; Clerk puis gate sont observés pour chaque API non-health. Le fallback sert uniquement une page ordinaire non-API.

## Routes historiques neutralisées

| Famille | Comportement |
|---|---|
| `/api/tenants*` | Pas de découverte, sélection, création ou synchronisation d’organisation |
| `/api/users/sync` | Route supprimée; aucun body `clerkId`, email, rôle ou organisation n’est traité |
| `/api/auth/*` | Sessions locales, Bearer, SSO, logout et annuaire supprimés |
| `/api/projects`, `/api/offers`, `/api/suppliers`, `/api/benchmarks`, `/api/audit-logs` | Aucun CRUD/handler DB exposé |
| `/api/erp/*`, `/api/ai/*` | Router historique absent; aucune intégration ni forwarding |
| Tout autre chemin API | 503 global avant handler et fallback |

## Propriétés adversariales exercées

- Header `x-tenant-id`, `x-organization-id`, `x-tenant-slug`, `x-role` et Bearer arbitraire.
- Query tenant; payload tenant, `clerkId`, email et rôle falsifiés; création/synchronisation utilisateur; login/logout/session; tentative de changement de rôle; tentative d’accès à un autre tenant.
- Méthodes `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS`; endpoints historiques et route inconnue.
- Préfixes/cas/encodages alternatifs (`/API`, `/%61pi`, `/api%2F`, double encodage, caractères encodés, health encodé); aucune réponse 2xx métier/fallback.
- Seul `GET /api/health` réussit, même avec des headers/query falsifiés; le contenu reste minimal. Les autres méthodes health sont refusées.
- Tests services/frontend : pas de token/session/cache local, pas de default tenant, pas de synchronisation Clerk→Neon, pas de requête `NeonService`.

Le middleware de test est instrumenté; ce n’est pas un test de JWT Clerk réel. La présence d’un header `Authorization` arbitraire n’accorde aucun accès. Aucun rôle métier, RBAC, membership, RLS ou isolation active n’est revendiqué.
