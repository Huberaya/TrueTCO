# TrueTCO — Dossier de préparation Clerk (handoff d’implémentation)

**Statut :** conception préparatoire seulement. Aucun IdP Clerk n’a été configuré, aucune clé/secrète n’a été lue, aucun package Clerk ajouté, aucun endpoint réactivé. Ce document est destiné à l’ingénieur/ChatGPT qui réalisera le chantier identité après livraison P0.

## 1. État observé dans le dépôt

- Client React : `@clerk/clerk-react` déclaré en `^5.61.3`; l’installation observée résout `5.61.12`, qui émet un avertissement de dépréciation et indique `@clerk/react` comme successeur. Ne pas migrer le client dans le cadre P0 sans plan de compatibilité.
- Serveur : Express 4.21.x, Node exigé `>=22.12.0`; `@clerk/express` n’est pas une dépendance directe actuellement.
- `.env.example` contient des **placeholders uniquement** pour `VITE_CLERK_PUBLISHABLE_KEY` et `CLERK_SECRET_KEY`. Il ne contient pas de secrets de production.
- `AuthContext.tsx`/`authService.ts` ont été rendus non authentifiants par défaut. Le parcours SSO serveur n’est pas un vrai SSO et est désormais indisponible.
- `POST /api/users/sync` demeure un handler latent ancien qui accepte `clerkId`, e-mail, nom et rôle depuis le body et appelle un resolver tenant non sûr. Il doit rester protégé par la garde P0 et être remplacé, pas simplement réactivé.
- `users.clerk_id` existe dans Drizzle mais pas dans le DDL SQL actuel. L’identité n’est donc pas encore raccordée à un modèle DB canonique.
- L’API métier est bloquée globalement par `createFailClosedApiGate()`; toute intégration Clerk devra conserver un refus par défaut pour les routes inconnues et les erreurs de vérification.

Au moment de la préparation, les métadonnées npm observées pour `@clerk/express@2.1.89` indiquaient Node `>=20.9` et peer dependency Express `^4.17 || ^5`, compatibles avec les versions de runtime déclarées. Son README recommande `clerkMiddleware()` puis `getAuth(req)` pour contrôler l’état d’authentification; `requireAuth()` y est marqué déprécié. Le paquet exporte `verifyWebhook` via `@clerk/express/webhooks`. Ces versions sont des renseignements de préparation, pas une instruction d’installation automatique.

## 2. Architecture cible proposée

### Frontend

1. Configurer `ClerkProvider` avec la seule publishable key (`VITE_CLERK_PUBLISHABLE_KEY`). La clé publique peut être exposée dans le bundle; aucune `CLERK_SECRET_KEY` ne doit être préfixée `VITE_`.
2. Utiliser les parcours Clerk Sign In/Sign Up et l’état de session Clerk. Pour les appels same-origin `/api`, obtenir un token par le SDK Clerk et l’envoyer en `Authorization: Bearer ...`; ne pas accepter une identité, un rôle ou un `organizationId` issu d’un état React comme preuve serveur.
3. Ne pas enregistrer de jeton de session dans `localStorage` ou les seeds. Garder une séparation claire entre l’état d’interface et l’identité vérifiée par le serveur.
4. Utiliser la sélection d’organisation Clerk seulement comme sélection de contexte; chaque appel est revalidé côté serveur et l’identifiant doit correspondre à une appartenance active.

### Express

1. Configurer `clerkMiddleware()` avant les handlers API protégés. Le middleware valide la session/token via le SDK Clerk et attache l’état auth à la requête. Ne pas décoder un JWT avec `JSON.parse`/base64 ni se fier à un header utilisateur maison.
2. Garder la route liveness minimaliste et publique (`GET /api/health`). Placer avant la garde seulement les endpoints publics explicitement listés. Une route API non répertoriée retourne 404/503, jamais un fallback permissif.
3. Remplacer le blocage temporaire par un middleware local explicite `requireAuthenticatedUser` qui obtient `getAuth(req)`, retourne 401 si `userId` absent et attache un contexte utilisateur validé. Chaque handler applique en plus une permission serveur; l’authentification seule ne donne pas accès aux données d’organisation.
4. Restreindre `authorizedParties` aux origines réellement déployées, selon l’environnement. Vérifier la configuration d’émetteur/application attendue par Clerk. Préférer les helpers Clerk maintenus à une implémentation JWKS artisanale; si validation manuelle devient nécessaire, préciser issuer, audience, algorithmes autorisés, `exp`, `nbf`, rotation JWKS et tests de clés tournantes.
5. Les requêtes métier prennent le tenant du contexte vérifié (`orgId` Clerk + mapping DB), jamais de `x-tenant-id`, `x-organization-id`, query/body ou fallback sur « premier tenant ». Refuser un `organizationId` body incohérent.
6. Les endpoints REST renvoient 401 à l’absence/invalidité de session et 403 aux permissions insuffisantes; les routes de navigateur ne doivent pas rediriger vers une page HTML pour une requête JSON.

### Webhooks Clerk

- Exposer un endpoint dédié, par exemple `POST /api/webhooks/clerk`, distinct des routes utilisateur.
- Vérifier la signature Svix/Clerk avec `verifyWebhook` du SDK serveur (et la configuration officielle du signing secret). Conserver le corps brut selon les exigences du SDK; ne pas laisser un JSON parser le transformer avant vérification.
- Rejeter signature invalide, événement horodaté/rejoué selon les garanties du vérificateur, type d’événement inconnu non géré. Journaliser l’identifiant d’événement et rendre le traitement idempotent avec une table d’événements reçus.
- Synchroniser seulement les champs minimaux utiles depuis les événements utilisateurs, organisations et adhésions (`user.*`, `organization.*`, `organizationMembership.*` selon le catalogue d’événements de l’instance). Les webhooks ne remplacent pas la vérification du JWT et de l’appartenance lors de chaque requête.
- Ne jamais accepter un rôle applicatif libre envoyé par le navigateur. Contrôler la correspondance Clerk role/permissions avec une configuration administrée et versionnée.

## 3. Sessions, organisation et autorisations

### Sessions

- S’appuyer sur la durée, le renouvellement et la révocation gérés par Clerk; utiliser des tokens/session courts adaptés aux capacités Clerk. Ne pas créer de session opaque maison sur la base du handler SSO actuel.
- Les routes à impact fort (export sensible, mutation/approbation future) peuvent nécessiter une vérification plus stricte de session/membership via le backend Clerk ou une vérification d’état applicatif; définir explicitement la fenêtre d’effet d’une révocation.
- HTTPS obligatoire; cookies si utilisés : `Secure`, `HttpOnly`, `SameSite` approprié, protection CSRF sur mutations et politique d’origine stricte. Avec token Bearer, limiter l’exposition XSS et ne pas persister le token.
- Les connexions et déconnexions doivent invalider l’état UI, nettoyer les caches locaux liés au tenant et ne jamais signaler une session authentifiée après échec réseau.

### Mapping de rôles proposé (à valider par produit/sécurité)

Les rôles historiques observés sont `admin`, `directeur_achats`, `acheteur`, `finance_controleur`, `rse_esg`, `direction_generale`. Cette matrice est un point de départ, pas une règle métier approuvée.

| Rôle applicatif | Permissions candidates minimales |
|---|---|
| `admin` | Administration des utilisateurs/configurations de **son organisation seulement**; aucun accès plateforme inter-tenant implicite. |
| `directeur_achats` | Lecture/gestion du portefeuille achats et des projets de son organisation; gestion des fournisseurs/offres selon politique interne. |
| `acheteur` | CRUD de projets/offres autorisés et lecture des fournisseurs; aucune attribution de rôle ni administration d’organisation. |
| `finance_controleur` | Lecture financière et saisie de contrôles finance lorsqu’un workflow probant existe; pas d’approbation automatique dans l’état actuel. |
| `rse_esg` | Lecture et maintenance de données environnementales autorisées, avec provenance; pas de signature/adjudication. |
| `direction_generale` | Lecture de synthèses et rapports; pas de mutation des données sources par défaut. |

Pour chaque route/action, maintenir une permission nommée (par ex. `projects:read`, `projects:write`, `offers:write`, `suppliers:write`, `benchmarks:write`, `users:manage`) et une matrice testée. Les administrateurs plateforme, s’ils existent, doivent être un principal/permission distincts, avec procédures break-glass auditées.

## 4. Variables et configuration attendues

À définir par environnement dans le gestionnaire de secrets, avec valeurs distinctes dev/staging/prod. Ce sont des **noms attendus**, jamais des valeurs à envoyer à ChatGPT ou à inscrire dans Git.

- `VITE_CLERK_PUBLISHABLE_KEY` — publique, frontend.
- `CLERK_SECRET_KEY` — serveur uniquement.
- `CLERK_WEBHOOK_SIGNING_SECRET` — serveur uniquement, si les webhooks sont activés.
- `CLERK_AUTHORIZED_PARTIES` — origines autorisées séparées/validées selon SDK et environnements.
- `CLERK_PUBLISHABLE_KEY` — éventuellement requis côté SDK serveur selon le mode d’initialisation/documentation versionnée.
- `CLERK_JWT_KEY` — optionnel uniquement si la stratégie de vérification Clerk retenue le demande; ne pas inventer sa valeur.
- `CLERK_SIGN_IN_URL` — si un parcours de redirection serveur est utilisé; sinon préférer des réponses JSON 401.
- `APP_URL` / liste CORS/origins — URL d’application réellement déployée, pas une valeur client comme autorité.

Valider au démarrage que les variables privées requises sont présentes dans les environnements où l’auth est activée; échouer fermé si elles manquent. Ne jamais journaliser les clés, JWT, cookies ou corps de webhook sensibles.

## 5. Tests d’intégration à exiger avant réactivation API

- Sans session : 401 sur chaque route métier; liveness seulement reste public.
- JWT expiré, signature invalide, mauvais issuer/audience/partie autorisée, mauvais environnement/clé : 401.
- Token valide mais utilisateur supprimé/désactivé, membership absent/révoqué ou organisation inactive : refus.
- Matrice 401/403 par route et par rôle; vérifier chaque mutation et route de lecture sensible.
- Tenant fourni dans query, body, headers, `x-tenant-slug`, route params : ignoré/rejeté s’il ne correspond pas au `orgId` vérifié.
- IDs d’objet d’un autre tenant (project, supplier, offer, audit log) : 404 ou 403 sans fuite de données.
- Changement d’organisation, expiration et logout : aucun cache de tenant ou ancien résultat réutilisé.
- Webhook : signature valide/invalide, payload altéré, duplication/idempotence, ordre retardé, type inconnu, panne DB puis retry.
- Tests de bout en bout en instance Clerk dev/staging isolée; jamais utiliser secrets ou données de production dans les tests.

## 6. Informations de handoff à l’intervenant Clerk

1. Commencer par choisir les environnements Clerk dev/staging/prod, le domaine et la stratégie d’organisation; demander au propriétaire d’installer/configurer l’instance via l’interface Clerk.
2. Ne demander ni recevoir les clés en conversation. Demander qu’elles soient ajoutées aux secrets Arena/Vercel par leur propriétaire.
3. Le dépôt actuel est Express 4 + React/Vite, Node 22; le client Clerk existant est ancien/déprécié. Faire d’abord une PR de compatibilité du SDK client/serveur et verrouiller des versions testées.
4. Ne pas supprimer le fail-closed global tant que tests 401/403, tests croisés tenant et integration tests Clerk ne passent pas.
5. Ne pas réactiver le handler `/api/users/sync` actuel ni `/api/tenants` POST en l’état.
