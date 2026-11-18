# TrueTCO — dossier Clerk / architecture P0.2

**État de livraison :** couche officielle Clerk Express ajoutée et couverte par tests de configuration; **aucune connexion Clerk ni clé réelle vérifiée**. L’API métier demeure globalement HTTP 503, y compris si la configuration Clerk est ensuite renseignée, jusqu’à mise en œuvre et validation du mapping membership, RBAC et isolation DB.

## 1. Changements livrés dans le dépôt

- Dépendance serveur ajoutée : `@clerk/express@2.1.91`. Métadonnées npm consultées le 11 novembre 2026 : Node `>=20.9.0`, peer Express `^4.17.0 || ^5.0.0`; compatible sur les plages déclarées par ce dépôt. Le middleware et `getAuth` sont les APIs documentées du SDK. Seul `clerkMiddleware` est utilisé ici; aucune route ne consomme encore `getAuth` pour donner accès aux données.
- `src/server/clerkAuth.ts` exige une clé secrète serveur `CLERK_SECRET_KEY` commençant par `sk_`, une clé publishable `CLERK_PUBLISHABLE_KEY` (ou la variable publique existante `VITE_CLERK_PUBLISHABLE_KEY`) commençant par `pk_`, et `CLERK_AUTHORIZED_PARTIES` sous forme de liste d’origines exactes séparées par virgules. Les valeurs placeholder, origines HTTP non-locales, wildcards, chemins et URL invalides sont refusés.
- `src/server/application.ts` monte le middleware Clerk avant le gate global. `GET /api/health` est explicitement exempté de vérification d’identité et renvoie seulement `{ "status": "ok" }`; toutes les autres API passent à la garde, quel que soit le résultat Clerk. Les variantes encodées/non canoniques de `/api` suivent également Clerk puis la garde. Aucun handler métier n’est accessible.
- Si la configuration attendue manque, la couche Clerk renvoie 503 générique sans divulguer noms de variables, clé, claims ou détails sensibles. La santé minimale demeure disponible.
- `src/server/clerkAuth.test.ts` teste la configuration et le refus fail-closed. `src/server/apiGate.test.ts` exécute l’application Express partagée avec factory Clerk instrumentée et le vrai gate : seules les requêtes health GET sont publiques; les handlers/fallbacks simulés après la pile ne sont jamais atteints par des requêtes API.

## 2. Configuration attendue — noms seulement

- `CLERK_SECRET_KEY` — secret privé serveur (`sk_test_…`/`sk_live_…`); ne jamais exposer au bundle.
- `CLERK_PUBLISHABLE_KEY` — clé explicitement dédiée au serveur Clerk; à défaut, `VITE_CLERK_PUBLISHABLE_KEY` déjà présent dans `.env.example` est accepté comme publishable key uniquement.
- `CLERK_AUTHORIZED_PARTIES` — origines exactes de l’application, séparées par virgules. `https://…` requis hors `localhost`/`127.0.0.1` en développement.
- `VITE_CLERK_PUBLISHABLE_KEY` — publique, uniquement pour le frontend; n’est pas une preuve d’identité.

Les valeurs `.env.example` restent des exemples factices; elles ne sont pas des credentials utilisables. Aucun secret n’a été consulté, créé, modifié ou transmis. Ne pas ajouter une URL d’aperçu à une liste d’origines sans validation/provisioning explicites du propriétaire.

## 3. Limites de sécurité importantes

La vérification Clerk n’implique pas :

1. mapping d’un `userId` externe vers un utilisateur local actif;
2. appartenance active d’un utilisateur à une organisation interne;
3. mapping `orgId` Clerk vers `organizations.id`;
4. attribution de rôle ou permission métier;
5. accès DB limité au tenant ni prévention IDOR;
6. webhook signé, synchronisation, révocation ou idempotence.

Aucune de ces fonctions n’est déclarée implémentée. N’ajoutez pas un fallback sur le premier tenant, un ID body/header, une session locale héritée ou un `admin` implicite. Depuis P0.3, `POST /api/users/sync` et les handlers `/api/auth/*` ont été supprimés de `server.ts`; les routes restantes ne sont pas enregistrées et la garde renvoie 503.

## 4. Étapes avant l’ouverture future de la moindre route

1. Provisionner Clerk hors dépôt et gérer les secrets par environnement via les gestionnaires autorisés. Vérifier les origines exactes et le comportement de session/token adapté au frontend.
2. Construire un mapping persisté Clerk user/org vers IDs locaux, avec statut actif et appartenance révoquable. Ne pas supposer que les identifiants Clerk sont des UUID locaux.
3. Approuver `MATRICE_RBAC.md` avec Produit/Sécurité; convertir les décisions en permissions serveur testables, distinctes des rôles UI.
4. Réécrire chaque handler métier pour prendre identité, membership et tenant du contexte serveur seulement; supprimer resolver et fallbacks historiques, valider les IDs imbriqués.
5. Réconcilier migration/schema et contraintes multi-tenant du dossier Neon; les routes ne doivent pas être ouvertes avant contrôles DB et tests d’isolation.
6. Tester JWT absent/invalide/expiré, partie non autorisée, compte/membership suspendu, rôle inconnu, tenant falsifié, IDOR et erreurs Clerk. Tester avec une vraie instance de test dédiée, jamais les credentials de production.
7. Remplacer la garde globale uniquement par une allowlist explicite de routes validées; les routes inconnues et les erreurs de configuration restent refusées.

## 5. Webhooks — non implémentés

Aucun endpoint webhook n’est exposé. Si les événements Clerk sont requis, définir une route séparée avec corps brut conforme au SDK, vérification officielle Svix/Clerk, secret distinct, protection replay, journalisation non sensible et idempotence par event ID. Vérifier l’appartenance au moment de chaque requête : un webhook ne remplace pas le contrôle d’accès en ligne.

## 6. Preuves / limites

- API SDK officiel et compatibilité package/runtimes inspectés via paquet npm installé et ses types/metadata; les tokens et les clés n’ont pas été vérifiés contre un tenant Clerk.
- Tests locaux de configuration et fail-closed : inclus dans `npm test`.
- Aucun JWT réel, tenant Clerk, webhook, révocation, identité persistée ni session PostgreSQL n’a été testé. Les tests PostgreSQL PGlite ajoutés en P0.4 portent uniquement sur schéma/migrations locales et ne prouvent ni l’authentification ni les memberships. L’ajout du SDK et du middleware ne constitue pas un SSO configuré ni une certification de sécurité.
