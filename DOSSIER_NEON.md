# TrueTCO — Dossier de préparation Neon/PostgreSQL (handoff d’implémentation)

**Statut :** conception et inventaire statique uniquement. Aucune connexion Neon n’a été utilisée, aucun secret lu, aucune base créée/inspectée, aucune migration exécutée et aucune modification de production. Les faits de schéma ci-dessous proviennent des sources suivies dans Git; la base distante réelle est **NON VÉRIFIÉE**.

## 1. État observé

- Le serveur crée un client `@neondatabase/serverless` depuis `DATABASE_URL`; le client est consommé uniquement par `server.ts` dans le code recherché. `.env.example` ne contient qu’une URL factice (`ep-sample...`) et aucun credential réel.
- `src/db/schema.ts` (Drizzle) et `src/db/schema.sql` (DDL) décrivent environ dix tables, mais ne constituent pas une séquence de migrations versionnées testée. `src/db/drizzle.config.ts` cible `./drizzle/migrations`; aucune suite de migration versionnée/canonique n’a été validée dans le présent chantier.
- L’API métier est actuellement bloquée en amont par `createFailClosedApiGate()`. Les handlers restants ne sont pas prêts à être réactivés : la résolution du tenant se base sur des entrées client ou une organisation par défaut, plusieurs routes ne filtrent pas par tenant, le DDL dérive des requêtes, et aucune policy RLS n’apparaît dans les sources examinées.
- Aucune vérification du projet Neon, des rôles, des privilèges, de RLS, de sauvegardes, de restauration ou des données de production n’a été faite.

## 2. Inventaire relationnel des dix tables

| Table | Relation / données | Tenant déclaré dans le schéma suivi | État / remarque |
|---|---|---|---|
| `organizations` | Racine des espaces d’organisation | `id` est la racine; pas de `organization_id` | Drizzle/DDL n’incluent pas plusieurs colonnes attendues par les routes (`slug`, `domain`, `subscription_tier`, `data_residency`, `is_active`). |
| `users` | Utilisateur local, appartenance à une organisation | `organization_id` FK → `organizations.id` | Drizzle a `clerk_id`, mais DDL SQL l’omet; routes utilisent aussi `sso_provider`, `department`, `last_login_at`, non présents dans les schémas examinés. |
| `projects` | Consultation/projet; auteur facultatif | `organization_id`; `created_by_user_id` → `users.id` | Scope org présent, mais les FKs de l’auteur et de l’organisation doivent être cohérentes entre elles. |
| `suppliers` | Référentiel de fournisseurs | `organization_id` → `organizations.id` | Scope org présent. Les scores/certifications sont des données saisies; leur présence n’établit pas leur validation. |
| `supplier_offers` | Offre liée à un projet et un fournisseur | **Aucun** `organization_id`; FKs séparées vers `projects` et `suppliers` | Pas de contrainte composite garantissant que projet et fournisseur appartiennent au même tenant. |
| `cost_items` | Postes de coûts d’une offre | **Aucun** `organization_id`; `offer_id` → `supplier_offers.id` | L’isolation dépend d’un parcours de jointure et d’un contrôle serveur/DB qui n’existe pas encore. |
| `carbon_items` | Postes d’émissions d’une offre | **Aucun** `organization_id`; `offer_id` → `supplier_offers.id` | Même dépendance indirecte; aucune provenance RLS. |
| `risk_items` | Risques financiers déclarés pour une offre | **Aucun** `organization_id`; `offer_id` → `supplier_offers.id` | Même dépendance indirecte. |
| `reference_benchmarks` | Facteurs/références | `organization_id` → `organizations.id` | Scope présent dans les tables; handler GET actuel ne filtre pas par organisation. |
| `audit_logs` | Événements applicatifs liés à une organisation, user et projet facultatifs | `organization_id`; `user_id` et `project_id` FK | Journal applicatif modifiable par conception actuelle; ne pas le qualifier d’immuable ou de preuve certifiée. |

Relations attendues : `organizations 1—N users/projects/suppliers/reference_benchmarks/audit_logs`; `projects 1—N supplier_offers`; `suppliers 1—N supplier_offers`; `supplier_offers 1—N cost_items/carbon_items/risk_items`; `users 1—N projects créés/audit_logs`. Le schéma Drizzle exprime plusieurs relations ORM, mais les relations ORM ne remplacent pas des contraintes DB ni les politiques RLS.

## 3. Écarts concrets à résoudre avant toute connexion applicative

1. **Organisations :** `server.ts` sélectionne/insère `slug`, `domain`, `subscription_tier`, `data_residency`, `is_active`; ils ne figurent pas dans le DDL `organizations` ni dans la définition Drizzle observés.
2. **Utilisateurs :** `users.clerk_id` figure dans Drizzle mais pas le DDL SQL. Les routes interrogent/écrivent également `sso_provider`, `department`, `last_login_at`; ces champs ne sont pas dans les deux définitions actuelles. La synchronisation user accepte aujourd’hui des rôles depuis le body.
3. **Sessions :** des routes historiques interrogent/insèrent `user_sessions`, table absente du schéma Drizzle et du DDL inspectés. Une intégration Clerk n’a pas besoin de recréer ce mécanisme par défaut.
4. **Offres :** la route `POST /api/offers` insère `quantity`, `delivery_lead_time_weeks`, `warranty_months`, `technical_suitability_score`; ces colonnes manquent dans le DDL/Drizzle observés. La route omet aussi `offer_reference`, déclaré `NOT NULL` sans valeur par défaut dans le DDL.
5. **Benchmarks :** le GET actuel ne filtre pas sur `organization_id`; le POST utilise `getOrganizationId()` sans requête et peut tomber sur le premier tenant/fallback. Ces handlers restent bloqués, mais ne doivent pas être réactivés en l’état.
6. **Tenant resolver :** `resolveTenantId(req)` donne priorité aux headers, query/body avant le token et retombe sur une organisation par défaut. `getOrganizationId()` sans requête contourne même la session. La source d’autorité doit devenir une identité Clerk validée puis une appartenance DB active.
7. **Upserts/relations :** `ON CONFLICT (id)` sur certains handlers met à jour par identifiant sans condition organisationnelle; sans contrôle composite, un ID deviné peut viser un autre objet si la garde est retirée.
8. **RLS/roles :** aucune occurrence de `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY` ou de rôle SQL applicatif/migrateur n’a été trouvée dans les fichiers DB/scripts suivis. Cela décrit le dépôt, pas l’état inconnu de Neon production.

## 4. Architecture tenant/roles visée

### Identité tenant

- Vérifier le JWT Clerk dans Express; récupérer le `userId` et `orgId` depuis l’objet Auth validé côté serveur. L’identifiant d’organisation soumis par le navigateur, header, slug, query ou body n’est jamais une autorité.
- Ajouter une correspondance persistante unique `clerk_org_id` → `organizations.id` (ou table de mapping), et `clerk_user_id` → `users.id`. Ne pas supposer que l’ID externe Clerk a le format UUID interne.
- Vérifier l’appartenance active et le rôle/permission pour chaque requête. Un utilisateur membre de plusieurs organisations ne garde pas de cache transversal lors d’un changement d’organisation.

### Stratégie de colonnes

Recommandation de défense en profondeur : ajouter `organization_id NOT NULL` aux tables métier enfants (`supplier_offers`, `cost_items`, `carbon_items`, `risk_items`) et faire un backfill contrôlé depuis leurs parents. Ajouter des contraintes composites pour garantir l’égalité des tenants :

- `supplier_offers (organization_id, project_id)` → `projects (organization_id, id)`;
- `supplier_offers (organization_id, supplier_id)` → `suppliers (organization_id, id)`;
- lignes coût/carbone/risque `(organization_id, offer_id)` → `supplier_offers (organization_id, id)`;
- autres liens d’auteur/projet tenant-bound vérifiés pareillement.

La clé primaire peut rester UUID; ajouter les contraintes uniques composites correspondantes (`UNIQUE (organization_id, id)`) là où PostgreSQL l’exige. Valider et isoler les offres orphelines ou cross-tenant avant de mettre les nouvelles colonnes en `NOT NULL`; ne jamais inventer un tenant pour les lignes ambiguës.

Une alternative à court terme est une policy RLS par `EXISTS`/jointure pour les tables enfants sans colonne tenant, mais elle augmente la complexité, rend la maintenance et l’indexation plus délicates et ne remplace pas les FKs composites. La solution retenue doit être testée en base PostgreSQL réelle de staging.

### Rôles PostgreSQL et RLS

- Séparer le rôle migrateur propriétaire du schéma et le rôle runtime applicatif. L’app ne doit pas se connecter comme owner/superuser; runtime `NOBYPASSRLS`, privilèges minimaux, rôle de lecture distinct si besoin.
- Activer `ENABLE ROW LEVEL SECURITY` puis `FORCE ROW LEVEL SECURITY` sur chaque table tenant-scoped; ajouter policies `USING` **et** `WITH CHECK`. Sans contexte valide, accès refusé.
- Établir le tenant dans un contexte **transaction-local** à partir du `orgId` vérifié par le serveur, puis filtrer explicitement les requêtes sur `organization_id`. Ne pas configurer un GUC tenant global/session qui pourrait survivre au pooling. Vérifier que le driver Neon et son mode d’exécution prennent en charge le scope transactionnel retenu.
- Policies racines : `organizations.id` accessible uniquement si l’utilisateur/membership vérifié correspond; `users`, `projects`, `suppliers`, `reference_benchmarks`, `audit_logs` limités au tenant; tables enfants soit `organization_id` directe, soit policy/jointure avec parent et contraintes composites.
- Pour `audit_logs`, rôle applicatif idéalement `INSERT`/`SELECT` selon besoin et pas de `UPDATE`/`DELETE`; cela améliore la résistance applicative, mais ne fait pas à lui seul un journal légal/immuable.
- Le propriétaire de migration, les rôles Neon préexistants et leurs capacités de bypass doivent être audités dans le tableau de bord avec un accès approprié; ne pas déduire la configuration distante des fichiers SQL.

## 5. Variables et opérations prévues

- Actuel : `DATABASE_URL` (placeholder dans `.env.example`, employé par serveur et Drizzle config).
- Cible : URL runtime à privilèges minimum (ex. `DATABASE_URL_APP`) et URL migrateur séparée, disponible uniquement dans le job de migration approuvé (ex. `DATABASE_URL_MIGRATOR`). Le nom exact doit correspondre à l’outillage retenu; ne pas ajouter des valeurs réelles au dépôt.
- Environnements séparés dev/staging/production et branches Neon isolées; rotation de secrets, TLS requis, accès sortant limité et logs sans chaîne de connexion.
- Avant chaque migration : backup Neon vérifié/restaurable, revue SQL, estimation verrouillage/durée, plan de rollback, approbation. Les migrations production restent explicitement hors de ce chantier.

## 6. Plan de migrations proposé (staging seulement pour la validation)

1. **M0 — photographie/canonisation :** choisir Drizzle ou migrations SQL versionnées comme source unique; comparer DDL, Drizzle et les contrats des routes; publier un manifeste des colonnes/contraintes sans appliquer à une base distante.
2. **M1 — compatibilité additive :** écrire les migrations nécessaires aux colonnes réellement requises (organisation, users, offres) et identifiants Clerk; ne pas créer `user_sessions` par réflexe si Clerk gère les sessions.
3. **M2 — audit des données préexistantes :** compter doublons, orphelins et liens offre/projet/fournisseur de tenants différents; rapporter les lignes sans changement automatique.
4. **M3 — backfill tenant enfants :** dériver org depuis project/offer; vérifier chaque fournisseur associé appartient à ce même org; arrêter si incohérence; indexer les colonnes de tenant et FK composites.
5. **M4 — contraintes :** poser `NOT NULL`, `UNIQUE`, FKs composites et checks seulement après validation des compteurs et tests de staging.
6. **M5 — roles/RLS :** créer rôles runtime/migrateur, grants minimum, policies RLS et `FORCE ROW LEVEL SECURITY`; ne jamais tester sous un rôle owner qui bypasserait les policies.
7. **M6 — tests/activation :** exécuter les API CRUD avec une base de test vide créée uniquement par les migrations; n’envisager l’activation qu’après CI verte, migration précédente→suivante testée, restauration staging réussie et pentest inter-tenant.

Aucun de ces scripts ne doit être exécuté sur Neon production pendant la préparation du dossier.

## 7. Tests inter-organisations requis

Créer les organisations A et B, utilisateurs A/B, projets A/B, fournisseurs A/B, offres et enfants. Utiliser le rôle runtime non-owner et une vraie transaction/context tenant.

- A lit/écrit ses organisations, projets, fournisseurs, offres, lignes, benchmarks et journaux : résultat conforme aux permissions.
- A tente de lire/modifier/supprimer un ID B deviné pour chaque ressource, y compris relations imbriquées : 0 ligne visible ou 403/404; aucune mutation.
- A soumet `organization_id` de B dans body/query/header, `x-tenant-id`, `x-organization-id` ou slug B : ignorer/rejeter, sans accès B.
- Une offre A associée à un projet A et fournisseur B est rejetée par contrainte DB; mêmes vérifications sur enfants coût/carbone/risque avec offerId B.
- Tenant/contexte absent, malformé ou résiduel d’une requête précédente dans le pool : aucune ligne; aucune fuite de contexte entre transactions.
- RLS vérifiée avec rôle `NOBYPASSRLS`, pas seulement owner; un rôle migrateur peut migrer mais n’est jamais employé par le serveur.
- Couvrir `GET` et mutations, pagination, exports, audit, benchmarks, erreurs et cas de concurrence.
- Tests de migration à partir d’une DB vide et d’une version précédente; rollback/restore staging documenté.

## 8. Handoff à l’intervenant Neon

1. Demander au propriétaire de fournir un accès Neon en lecture seule pour l’inventaire; ne pas demander de coller la chaîne `DATABASE_URL` dans ChatGPT.
2. Exporter uniquement métadonnées SQL (tables, colonnes, contraintes, policies, grants, rôles expurgés), jamais données client/secrets.
3. Fermer les écarts schéma/API identifiés ci-dessus avant de brancher une API de production.
4. Implémenter l’identité/tenant en coordination étroite avec le dossier `DOSSIER_CLERK.md`; les deux chantiers doivent partager le même modèle d’appartenance.
5. Faire relire les migrations, backfills, règles de rétention et politiques RLS; exécuter exclusivement sur une branche Neon de développement/staging jusqu’à approbation écrite.
6. Garder le middleware P0 fail-closed jusqu’aux tests de staging; aucune migration ou modification destructive de production n’est autorisée par ce dossier.
