# TrueTCO — inventaire API et garde P0.2

**Référence code :** branche `arena/ea5046f1-truetco`, HEAD de base P0.2 `38edd8504e5d84cef89229a3e0347178a9505067`. Cet inventaire sera actualisé au SHA final après livraison. Il décrit le code local; aucun endpoint de production n’a été sondé.

## 1. Garde et ordre des middlewares

Pour `/api`, l’ordre dans `server.ts` est :

1. `createClerkSessionMiddleware()` — si les trois éléments serveur sont correctement configurés (`CLERK_SECRET_KEY`, clé publishable, `CLERK_AUTHORIZED_PARTIES`), délègue la vérification de session au SDK officiel `@clerk/express`. Si configuration manquante, répond 503 générique. Seul `GET /api/health` est exclu.
2. `createFailClosedApiGate()` — répond 503 à toute route métier et méthode sauf `GET /api/health`, même quand Clerk est configuré. Cette garde reste obligatoire : aucun mapping membership, RBAC, tenant DB et contrôle IDOR complet n’autorise encore l’ouverture de route.
3. Handlers historiques, router intégrations, middleware Vite/static — jamais atteints pour une route métier API tant que la garde est en place.

Liveness public : `GET /api/health` renvoie uniquement `{"status":"ok"}`. Le middleware Clerk et la garde ne rendent pas publiques les autres méthodes sur la route santé.

## 2. Routes métier déclarées par le serveur

Aucune autorisation rôle/route n’est attribuée par cette liste; voir `MATRICE_RBAC.md`. Tous les chemins suivants demeurent inaccessibles, HTTP 503 avant handler.

| Méthode | Route | Effet latent / risque notable |
|---|---|---|
| GET | `/api/tenants` | Liste d’organisations/compteurs |
| GET | `/api/tenants/current` | Contexte tenant; ancien resolver client-controlled |
| POST | `/api/tenants` | Création organisation depuis body |
| GET | `/api/health` | Liveness public minimal |
| POST | `/api/users/sync` | Upsert user historique; identity/rôle pris du body |
| POST | `/api/auth/sso/login` | Refus 503 explicite; pas de vrai SSO |
| GET | `/api/auth/me` | Session locale historique |
| POST | `/api/auth/logout` | Session locale historique |
| GET | `/api/auth/users` | Liste utilisateurs, dépend ancien tenant resolver |
| GET | `/api/projects` | Lecture projets |
| POST | `/api/projects` | Création projet; tenant resolver historique |
| POST | `/api/offers` | Création offre; schéma/relations multi-tenant non alignés |
| POST | `/api/audit-logs` | Écriture événements applicatifs; pas une preuve immuable |
| GET | `/api/audit-logs` | Lecture événements, ancien scope tenant |
| GET | `/api/suppliers` | Lecture fournisseurs |
| POST | `/api/suppliers` | Création fournisseur |
| GET | `/api/benchmarks` | Lecture; handler historique sans filtre tenant |
| POST | `/api/benchmarks` | Création; ancien fallback tenant |
| POST | `/api/erp/connectors/:id/test` | Intégration désactivée |
| POST | `/api/erp/connectors/:id/sync-inbound` | Import désactivé |
| POST | `/api/erp/connectors/:id/push-award` | Envoi désactivé |
| POST | `/api/ai/parse-document` | Traitement documentaire désactivé |

Les handlers listés sont du code latent, non des autorisations accordées. L’ancien resolver `resolveTenantId` accepte des données client et possède un fallback; `users/sync` accepte notamment l’identité/rôle du body. Aucun changement P0.2 ne rend ces voies acceptables : elles restent derrière la garde.

## 3. Vérifications pérennes

- `src/server/apiGate.test.ts` vérifie ordre API/gate/handlers et accès anonyme bloqué sur méthodes et chemins inventoriés.
- `src/server/clerkAuth.test.ts` vérifie la configuration fail-closed Clerk et l’ordre middleware officiel avant la garde sans libérer la route.
- Le résultat réel des tests doit être lu dans la session CI locale de livraison; les anciennes observations de 112 combinaisons de l’étape P0 ne valent pas comme preuve d’un JWT Clerk ni de l’isolement Neon.
- Aucun test de production, de base Neon, de JWT réel, de rôle/membership, d’IDOR ni de RLS n’a été réalisé pour ce dossier.
