# TrueTCO — Inventaire et vérification des routes API (P0)

**État examiné :** checkout de travail sur `arena/ea5046f1-truetco`, après fetch de la tête PR `d9e5ad45fcd8fca14630eb761203cf06915697d6` et avant livraison des changements locaux de cette session.
**Portée :** routes Express déclarées dans `server.ts`, routes dans `src/server/safetyRoutes.ts`, ordre des middleware et requêtes anonymes vers le serveur local. Aucun accès production ou base Neon n’a été effectué.

## 1. Garde et routes alternatives

`server.ts` installe `express.json({ limit: '10mb' })`, puis immédiatement `app.use('/api', createFailClosedApiGate())`, avant l’initialisation des handlers métier. Aucun autre serveur Express n’est déclaré dans les sources applicatives examinées. Les middleware Vite/static et le fallback SPA sont déclarés après la garde.

La garde compare la méthode et le chemin relatifs au montage Express : **seul `GET /api/health`**, soit `GET` avec `req.path === '/health'`, fait `next()`. Toute autre requête dont le préfixe API est reconnu reçoit HTTP 503 JSON et ne poursuit pas vers les handlers métier. L’intégration router, montée plus tard, retourne elle-même HTTP 503; elle ne crée donc pas de voie de contournement utile.

Les requêtes JSON peuvent être parsées avant la garde, mais aucune mutation ni opération métier n’est appelée avant la réponse 503. La taille maximale du corps JSON est limitée à 10 Mo.

## 2. Inventaire exhaustif des 22 handlers déclarés

| Méthode / route | Classe | Effet du handler si la garde était absente | Garde en place | Conclusion d’accès anonyme |
|---|---|---|---|---|
| `GET /api/tenants` | Métier sensible | Lecture de la liste des organisations et de compteurs liés | Oui, avant route | 503 |
| `GET /api/tenants/current` | Métier sensible | Lecture de l’organisation sélectionnée; résolution tenant existante fondée notamment sur entrée client | Oui | 503 |
| `POST /api/tenants` | Mutation métier | Création d’une organisation depuis le body | Oui | 503 |
| `GET /api/health` | Publique, liveness seulement | Renvoie uniquement `{ "status": "ok" }` | Exception limitée à GET `/health` | 200, sans détails internes |
| `POST /api/users/sync` | Mutation métier sensible | Upsert d’un utilisateur; le handler existant accepte des champs du body | Oui | 503 |
| `POST /api/auth/sso/login` | Métier sensible / indisponible | Handler explicite 503; aucun IdP réel | Oui | 503 par la garde |
| `GET /api/auth/me` | Métier sensible | Lecture du profil par session dans le code existant | Oui | 503 |
| `POST /api/auth/logout` | Métier sensible / mutation | Invalidation/suppression d’une session dans le code existant | Oui | 503 |
| `GET /api/auth/users` | Métier sensible | Lecture des utilisateurs | Oui | 503 |
| `GET /api/projects` | Métier sensible | Lecture de projets | Oui | 503 |
| `POST /api/projects` | Mutation métier | Création de projet | Oui | 503 |
| `POST /api/offers` | Mutation métier | Création d’offre | Oui | 503 |
| `GET /api/audit-logs` | Métier sensible | Lecture du journal d’événements | Oui | 503 |
| `POST /api/audit-logs` | Mutation métier | Ajout d’événement au journal applicatif | Oui | 503 |
| `GET /api/suppliers` | Métier sensible | Lecture de fournisseurs | Oui | 503 |
| `POST /api/suppliers` | Mutation métier | Création de fournisseur | Oui | 503 |
| `GET /api/benchmarks` | Métier sensible | Lecture de facteurs/références | Oui | 503 |
| `POST /api/benchmarks` | Mutation métier | Création de facteur/référence | Oui | 503 |
| `POST /api/erp/connectors/:id/test` | Intégration indisponible | Test ERP; route désactivée dédiée | Oui | 503 |
| `POST /api/erp/connectors/:id/sync-inbound` | Intégration indisponible | Import ERP; route désactivée dédiée | Oui | 503 |
| `POST /api/erp/connectors/:id/push-award` | Intégration indisponible | Transmission ERP; route désactivée dédiée | Oui | 503 |
| `POST /api/ai/parse-document` | Intégration indisponible | Analyse documentaire; route dédiée dit explicitement que le document n’a pas été transmis | Oui | 503 |

Les handlers métier latents de `server.ts` ne doivent pas être considérés sûrs individuellement : plusieurs acceptent des identifiants/valeurs client et ne comportent pas de contrôle d’autorisation suffisant. Leur sécurité actuelle repose sur la garde globale; il ne faut ni la retirer ni la déplacer avant la mise en place et les tests d’une authentification/autorisation réelle.

### Méthodes HTTP

- Routes Express fonctionnelles déclarées : `GET` et `POST` seulement; aucune route métier `PUT`, `PATCH` ou `DELETE` n’est déclarée.
- La garde ne libère que `GET /api/health`. Les méthodes `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` et `OPTIONS` sur la santé sont refusées par la garde. `HEAD` ne bénéficie donc pas du comportement implicite d’une route Express GET.
- Les mêmes sept méthodes ont été essayées sur chacun des **16 chemins métier distincts** : 112 combinaisons, toutes HTTP 503.

## 3. Contournements et routes alternatives examinés

- Ordre de montage statiquement vérifié : garde avant chaque déclaration `app.*('/api/...')`, avant `createDisabledIntegrationRouter()`, avant `vite.middlewares` et avant le service des fichiers statiques.
- Recherche statique de toutes les déclarations API Express et des appels client `fetch('/api/...')`; aucune route métier parallèle ni second serveur n’a été trouvée dans le code applicatif examiné.
- Les services navigateur `authService`, `tenantService`, `neonService`, `erpService` et `aiParserService` appellent les chemins `/api/...`; ils aboutissent à ce même serveur lorsqu’ils sont utilisés en same-origin. Aucune connexion Neon directe depuis les composants n’a été relevée dans cette recherche.
- Variantes essayées contre le serveur local : `/API/projects`, `/api/%70rojects` et `/api//projects` reçoivent 503. `/%61pi/projects` et `/api%2Fprojects` atteignent le fallback SPA et reçoivent du HTML, pas des données API; aucun payload métier n’est exposé.
- Aucune tentative de contournement réseau/infrastructure ou de production n’a été réalisée. L’audit ne prouve pas la configuration de proxy/de déploiement Vercel ni l’état d’un réseau externe.

## 4. Vérification réelle locale de la santé

- `GET /api/health` : HTTP 200, corps exact `{"status":"ok"}`.
- `GET /api/health?probe=1` : HTTP 200, même corps exact.
- Aucun nom de base, statut Neon, utilisateur SQL, erreur, secret, horodatage, détail de connexion ou version n’est renvoyé.
- `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS /api/health` : HTTP 503.
- Le serveur local a démarré sans `DATABASE_URL`; aucune requête DB n’a été faite par le healthcheck.

## 5. Tests pérennisés

`src/server/apiGate.test.ts` vérifie l’ordre global de montage, les routes de l’inventaire, les méthodes HTTP, les variantes de chemin et l’absence d’appel de handler/mutation anonyme dans une application Express de test. `src/server/safetyRoutes.test.ts` vérifie le refus des intégrations simulées. Une sonde locale a aussi testé le serveur applicatif réellement démarré.

Résultat de la sonde réelle avant synchronisation Git : **112 combinaisons route/méthode sans échec**, variantes de chemin sans données métier, et healthcheck minimal conforme. Les tests doivent être rejoués après l’intégration et le commit final.
