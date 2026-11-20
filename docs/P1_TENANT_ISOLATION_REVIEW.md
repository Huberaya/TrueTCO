# P1 — Dossier de revue : identité Clerk, isolation multi-tenant et RBAC

**État : préparation pour revue uniquement — aucune activation opérationnelle.**
**Branche :** `arena/22658028-truetco` · **base :** `2ec57388047ca33acd8c8d7f90fdb9c77b498bc3` (`origin/main` était à ce SHA après fetch).
**Portée :** modèle, middleware candidat, RBAC candidat, RLS, migration draft et preuves locales. Ce dossier ne vaut ni approbation métier/sécurité, ni autorisation de migration.

## Décision de sûreté

- Le gate P0 fail-closed reste actif. `server.ts` ne configure pas le middleware P1 d’identité tenant et aucune route métier n’est montée.
- Seul `GET /api/health` est servi publiquement. Les appels API métier restent refusés par le gate global.
- Les changements DDL P1 sont dans `db/migrations/proposed/0003_p1_tenant_scope.sql.draft`, hors du répertoire/journal Drizzle exécutable. Ils sont testés localement par PGlite. Une qualification complémentaire a depuis été exécutée sur une branche Neon clonée isolée (voir `docs/NEON_RUNTIME_ROLE_QUALIFICATION.md`) : rôle `truetco_app` non superuser/non-BYPASSRLS, RLS/FORCE sur les onze tables, isolation tenant et tests d’écriture cross-tenant négatifs. Aucun changement n’a été appliqué à Neon Production et aucune connexion Vercel runtime n’a été prouvée.
- La migration ajoute des colonnes tenant nullable aux offres/lignes enfants pour permettre une phase préparatoire sans inventer de backfill. Les lignes héritées sans tenant restent invisibles sous RLS; cela ne constitue pas une activation ni un schéma prêt à servir les routes métier.
- La matrice de rôles ci-dessous est une proposition testée, non une politique approuvée par les propriétaires métier.

## Inventaire des routes et points de montage

L’inventaire a été réalisé par recherche des déclarations Express dans `src` et `server.ts`.

| Surface | Présence dans le dépôt | Montage de production | Résultat/contrôle actuel |
|---|---|---|---|
| `GET /api/health` | `src/server/application.ts` | Oui, après middleware Clerk puis gate | Liveness sans détails internes; dérogation explicite du gate. |
| Toutes les autres requêtes `/api/*` | Capturées par `src/server/application.ts` | Oui, couche globale | Clerk, puis middleware tenant **optionnel non configuré**, puis gate P0; réponse 503 fail-closed. Aucun handler métier ne peut être atteint. |
| Préfixes API encodés/non canoniques | Détectés par `isNonCanonicalApiPath` dans `application.ts` | Oui | Même chaîne Clerk → gate; pas de contournement par le fallback SPA. |
| `POST /api/erp/connectors/:id/test` | `src/server/safetyRoutes.ts` | **Non monté** | Route d’intégration désactivée (503); pas d’appel ERP. |
| `POST /api/erp/connectors/:id/sync-inbound` | Idem | **Non monté** | Route d’intégration désactivée (503); aucun import. |
| `POST /api/erp/connectors/:id/push-award` | Idem | **Non monté** | Route d’intégration désactivée (503); aucune transmission. |
| `POST /api/ai/parse-document` | Idem | **Non monté** | 503; document non transmis. |
| Auth/tenants, utilisateurs, projets, fournisseurs et offres évoqués par les anciens clients/tests | Appels et chemins de compatibilité couverts notamment dans `src/server/apiGate.test.ts` | Aucun handler métier monté | Le gate bloque, y compris identité/tenant forgés dans header, query ou body. Aucun endpoint de création/sélection d’organisation n’est activé. |
| SPA et fichiers statiques | `server.ts` | Oui, après l’application API | Fallback UI uniquement; routes API échouées restent bloquées avant ce fallback. |

Aucun résultat de recherche ne révèle de route métier supplémentaire montée par l’application de production. Les déclarations de `safetyRoutes.ts` sont des routes de test/compatibilité désactivées, pas des routes exposées.

## Accès aux données : état observé et propositions

### Accès effectifs aujourd’hui

- `src/services/neonService.ts` est un stub sans requête réseau pour les données applicatives.
- Les services navigateur Auth/Tenant ne détiennent pas d’identité ni de tenant faisant autorité; pas de token en stockage web ni d’en-tête d’autorité tenant.
- `src/services/storageService.ts` génère un export SQL téléchargeable dans le navigateur; ce n’est pas une connexion DB. **P1.1 corrige le défaut historique** : aucun tenant fixe n’est émis; un contexte d’organisation explicite est requis, les enregistrements sont filtrés et liés sous le même tenant, les colonnes `organization_id` des offres et lignes sont écrites, et les données incohérentes sont refusées avant la création du fichier. L’interface navigateur n’a pas de contexte vérifié et échoue donc volontairement fermé; l’export ne constitue pas une migration de schéma ni une preuve d’exactitude métier.
- `src/db/tenantSql.ts` est un adaptateur candidat : le pool Neon n’est construit qu’après appel explicite à `createNeonTenantSqlPool(connectionString)`; le module ne lit pas les variables d’environnement et rien ne le câble dans `server.ts`.

### Chemin candidat d’identité et contexte SQL

1. `@clerk/express` vérifie la session côté serveur avec `CLERK_SECRET_KEY`, clé publishable, `CLERK_AUTHORIZED_PARTIES` exactes et `CLERK_JWT_AUDIENCE` explicite. L’audience est une allowlist; les parties autorisées n’acceptent pas de wildcard.
2. `createTenantIdentityMiddleware` lit `getAuth(request)` fourni par Clerk. Il ne dérive aucun sujet d’un header/query/body. Une authentification Clerk seule ne donne aucun accès applicatif.
3. `findActiveTenantMembership` ouvre une transaction, définit uniquement le GUC transaction-local Clerk pour la politique étroite de lecture `users`, cherche `clerk_id` avec `LIMIT 2`, puis n’accepte qu’exactement une ligne active avec UUID et rôle connus. Zéro, doublon, inactivité ou erreur DB échoue fermé; aucune organisation par défaut n’est choisie.
4. Le tenant et le rôle proviennent de cette ligne PostgreSQL, pas des claims d’organisation/role du client. L’index unique partiel candidat rend un sujet Clerk globalement unique dans `users`.
5. `withTenantSqlTransaction` commence une transaction sur le client réservé, pose les GUC transaction-local `organization_id`, `user_id`, `clerk_user_id`, revérifie l’adhésion active en base, exécute le travail, puis commit/rollback et libère le client.
6. `requireTenantPermission` exige un principal de `response.locals` validé et évalue la permission explicite; absence → 401, permission absente → 403.

**Hypothèse de conception à approuver :** une identité Clerk ne correspond qu’à une adhésion TrueTCO active/unique. Le modèle ne prend pas en charge un utilisateur membre de plusieurs organisations avec sélection Clerk d’organisation. Si le besoin existe, ne pas ajouter de choix client non vérifié : concevoir et revoir un modèle de memberships et une règle serveur de sélection explicite avant activation.

## Modèle relationnel préparé

Le schéma porte onze tables protégées par RLS :

| Table | Portée organisation | Liens/contrôles tenant préparés |
|---|---|---|
| `organizations` | Racine, `id` | Politique RLS sur `id`. |
| `users` | `organization_id` non nul | Unicité tenant/email, unicité composite `(organization_id,id)`, index unique partiel sur `clerk_id`, CHECK de rôle; politique RLS tenant et lecture contrôlée du sujet Clerk pour le lookup d’adhésion. |
| `projects` | `organization_id` non nul | Unicité tenant/référence et `(organization_id,id)`; FK composite du créateur `(organization_id,created_by_user_id)`. |
| `suppliers` | `organization_id` non nul | Unicité tenant/nom et `(organization_id,id)`. |
| `supplier_offers` | Colonne ajoutée, nullable en phase préparatoire | FK composites vers projet et fournisseur; unicité parent/id et index tenant. |
| `cost_items` | Colonne ajoutée, nullable en phase préparatoire | FK composite vers offre et index tenant. |
| `carbon_items` | Colonne ajoutée, nullable en phase préparatoire | FK composite vers offre et index tenant. |
| `risk_items` | Colonne ajoutée, nullable en phase préparatoire | FK composite vers offre et index tenant. |
| `reference_benchmarks` | `organization_id` non nul | FK et unicité tenant/nom existantes; politique RLS tenant. |
| `audit_logs` | `organization_id` non nul | FK composites vers utilisateur et projet de même tenant; politique RLS tenant. |\n| `user_sessions` | `organization_id` non nul | FK vers organisation/utilisateur; policy RLS tenant dédiée. |

Toutes les dix tables ont une politique RLS préparée avec `ENABLE` et `FORCE ROW LEVEL SECURITY`. Les politiques évaluent `current_setting('true_tco.organization_id', true)`; les écritures exigent `WITH CHECK`. L’application DB devra être un rôle `NOBYPASSRLS`, avec des droits minimaux, et les tests d’accès ne doivent pas être faits sous un rôle propriétaire ou `BYPASSRLS`.

Les colonnes `organization_id` des offres/lignes restent nullable tant qu’aucun mapping et backfill approuvés n’existent. Les clés étrangères composites ne remplacent pas `NOT NULL` : le contrôle des valeurs NULL et la phase ultérieure de contraintes/enforcement restent un travail à planifier et valider séparément.

## Matrice RBAC candidate

Permissions actuellement définies dans `src/server/rbac.ts` (codes stables; les actions ne sont pas encore exposées par des routes) :

| Rôle DB | Permissions proposées |
|---|---|
| `admin` | Toutes les permissions opérationnelles listées ci-dessous + `users:read`; pas d’assignation de rôle, suppression générique ou bypass audit. |
| `directeur_achats` | `projects:read/create/update/archive`, `suppliers:read`, `offers:read`, `cost_items:read`, `carbon_items:read`, `risk_items:read`, `benchmarks:read`, `audit_logs:read`. |
| `acheteur` | `projects:read/create/update`, `suppliers:read/create/update`, `offers:read/create/update`, `cost_items:read/create/update`, `carbon_items:read`, `risk_items:read`, `benchmarks:read`. |
| `finance_controleur` | `projects:read`, `offers:read`, `cost_items:read/update`, `benchmarks:read`, `audit_logs:read`. |
| `rse_esg` | `projects:read`, `suppliers:read`, `offers:read`, `carbon_items:read/create/update`, `risk_items:read/create/update`, `benchmarks:read`, `audit_logs:read`. |
| `direction_generale` | Lecture seule : tous les `*:read` de la matrice, dont `users:read` et `audit_logs:read`. |

Référentiel complet : `projects:{read,create,update,archive}`, `suppliers:{read,create,update}`, `offers:{read,create,update}`, `cost_items:{read,create,update}`, `carbon_items:{read,create,update}`, `risk_items:{read,create,update}`, `benchmarks:{read,create,update}`, `audit_logs:read`, `users:read`.

Cette matrice est exécutée par test et n’est pas montée dans `server.ts`. La portée tenant reste obligatoire en plus d’une permission : une autorisation RBAC seule ne permet jamais de lire un autre `organization_id`. À faire approuver : droits d’archivage, capacité d’écriture ESG/risques, accès aux utilisateurs/audit, besoins de séparation de tâches et politique d’administration par tenant.

## Migration draft et plan Neon (lecture seule avant décision)

`db/migrations/proposed/0003_p1_tenant_scope.sql.draft` est délibérément suffixé `.draft`, exclu du journal Drizzle et non appelé par un script de déploiement. Il est appliqué par le test uniquement à une base PGlite jetable. Le candidat s’arrête sur doublons Clerk, offres dont projet/fournisseur relèvent de tenants distincts et discordances historiques créateur/audit; il n’invente aucun mapping ni backfill. **Ne pas le copier dans un répertoire exécutable sans revue et approbation distinctes.**

Plan de préflight destiné à un futur opérateur (les contrôles Neon réalisés sur la branche de test ne remplacent pas la qualification Production) :

1. Identifier explicitement l’environnement/branche DB et le commit de schéma approuvé; confirmer les noms, versions, propriétaires et migrations réellement appliquées par introspection en lecture seule.
2. Backup et essai de restauration; relever les rôles DB et confirmer que le futur rôle applicatif n’est ni superuser, ni propriétaire avec bypass effectif, ni `BYPASSRLS`.
3. Produire un rapport chiffré de doublons `users.clerk_id`, utilisateurs inactifs/orphelins, rôles inconnus, créateurs/audit hors tenant, projets/fournisseurs orphelins, offres dont projet et fournisseur ont des organisations différentes; après expansion, compter toutes les lignes enfants sans tenant et vérifier leurs scopes contre l’offre.
4. Faire approuver la source d’autorité des mappings historiques. Ne jamais attribuer les lignes ambiguës au premier tenant, au tenant le plus ancien ou à une valeur par défaut.
5. Répéter en base de staging isolée sur une restauration représentative; mesurer verrouillage, durée, taille d’index, plans et éventuels retries. Vérifier toutes les politiques sous le vrai rôle applicatif `NOBYPASSRLS`.
6. Après décision humaine séparée : séparer expansion, backfill explicitement approuvé, validation zéro-NULL/zéro-orphan/zéro-cross-tenant, puis contraintes `NOT NULL`/FK et activation applicative. Prévoir arrêt/rollback et surveillance. Cette PR ne fait aucune de ces opérations.

Exemples de rapports **SELECT seulement**, à adapter après introspection et revue; ils ne sont pas destinés à être lancés depuis cet agent :

```sql
SELECT clerk_id, count(*) FROM users
WHERE clerk_id IS NOT NULL GROUP BY clerk_id HAVING count(*) > 1;

SELECT p.id AS project_id, p.organization_id AS project_org, u.organization_id AS creator_org
FROM projects p JOIN users u ON u.id = p.created_by_user_id
WHERE p.organization_id IS DISTINCT FROM u.organization_id;

SELECT o.id AS offer_id, p.organization_id AS project_org, s.organization_id AS supplier_org
FROM supplier_offers o
JOIN projects p ON p.id = o.project_id
JOIN suppliers s ON s.id = o.supplier_id
WHERE p.organization_id IS DISTINCT FROM s.organization_id;

SELECT a.id AS audit_id, a.organization_id AS audit_org, u.organization_id AS user_org
FROM audit_logs a JOIN users u ON u.id = a.user_id
WHERE a.organization_id IS DISTINCT FROM u.organization_id;

SELECT a.id AS audit_id, a.organization_id AS audit_org, p.organization_id AS project_org
FROM audit_logs a JOIN projects p ON p.id = a.project_id
WHERE a.organization_id IS DISTINCT FROM p.organization_id;

SELECT 'supplier_offers' AS relation, count(*) FILTER (WHERE o.organization_id IS NULL) AS null_tenant_count,
       count(*) FILTER (WHERE o.organization_id IS DISTINCT FROM p.organization_id
                         OR o.organization_id IS DISTINCT FROM s.organization_id) AS mismatch_count
FROM supplier_offers o
JOIN projects p ON p.id = o.project_id
JOIN suppliers s ON s.id = o.supplier_id
UNION ALL
SELECT 'cost_items', count(*) FILTER (WHERE c.organization_id IS NULL),
       count(*) FILTER (WHERE c.organization_id IS DISTINCT FROM o.organization_id)
FROM cost_items c JOIN supplier_offers o ON o.id = c.offer_id
UNION ALL
SELECT 'carbon_items', count(*) FILTER (WHERE c.organization_id IS NULL),
       count(*) FILTER (WHERE c.organization_id IS DISTINCT FROM o.organization_id)
FROM carbon_items c JOIN supplier_offers o ON o.id = c.offer_id
UNION ALL
SELECT 'risk_items', count(*) FILTER (WHERE r.organization_id IS NULL),
       count(*) FILTER (WHERE r.organization_id IS DISTINCT FROM o.organization_id)
FROM risk_items r JOIN supplier_offers o ON o.id = r.offer_id;
```

## Preuves locales et limites

La suite utilise PGlite/PostgreSQL 18 embarqué et des identités factices; aucun serveur PostgreSQL/Neon distant ni compte Clerk n’a été utilisé.

- Équivalence structurelle : migration P0 Drizzle existante + application du draft P1 sur PGlite comparées au `schema.sql` canonique (colonnes, contraintes, index, politiques); relecture du ledger; contraintes et stop conditions des drafts historiques vérifiées.
- Isolation A/B : rôle de test local `NOSUPERUSER NOBYPASSRLS`, accès aux lignes A seulement sous GUC A, écritures forgées B refusées, visibilité B sous GUC B, aucun contexte après COMMIT. Le test de DB est séquentiel dans PGlite (pas une preuve de charge concurrente d’un serveur PostgreSQL partagé).
- Concurrence adaptateur : test unitaire simulé avec deux clients réservés et entrelacés; vérifie que les paramètres org restent attachés au client/transaction. Ce test ne remplace pas une campagne de concurrence PostgreSQL/Neon réelle.
- Middleware/RBAC/lookup : tests 401/403/503, absence/ambiguïté/inactivité, sujet Clerk différent, rôle invalide, absence de fallback, rollback/libération, rôle et matrice.
- Clerk : `verifyToken` officiel de `@clerk/express` vérifie un JWT de session signé par une paire RSA générée localement, avec cas expiration/audience/partie autorisée invalides. C’est une simulation cryptographique locale, **pas** une preuve d’intégration avec une instance Clerk réelle, ses clés, cookies, domaines, configuration Dashboard, rotation JWKS ou cycle de vie utilisateur.

## Validation locale historique (révision antérieure — remplacée par les addenda ci-dessous)

Après `npm ci` :

| Commande | Résultat |
|---|---|
| `npm run typecheck` | Réussite. |
| `npm run lint` | Réussite, 74 fichiers contrôlés. |
| `npm test` | Réussite : 45 tests, 0 échec. Inclut PGlite/PostgreSQL 18 et tests d’identité/RBAC/transactions. |
| `npm run build` | Réussite; avertissement existant de bundles minifiés >500 kB (789,54 kB et 929,37 kB). |
| `npm audit --omit=dev --audit-level=high` | Réussite : 0 vulnérabilité de production au niveau demandé. |
| `npm audit --audit-level=high` | 8 vulnérabilités modérées, 0 haute/critique; les corrections proposées par npm impliquent des changements forcés/majeurs et n’ont pas été appliquées. |
| `git diff --check` | Réussite. |

Le workflow GitHub `Install, typecheck, lint, test, build` a ensuite réussi sur le commit de code `4aae18cc332bce42fb54781bdecb04dd97acbc8e` (PR #2, `arena/22658028-truetco`). Le check Vercel de preview PR a aussi retourné `pass`; aucun déploiement de production ni changement de configuration n’a été demandé depuis cette branche. Ces checks techniques ne signifient ni approbation humaine, ni merge, ni activation opérationnelle.

## Conditions préalables à une activation future (hors de cette PR)

- Revue/approbation métier de la matrice et du modèle « un sujet Clerk → une adhésion ».
- Revue sécurité des policies sous le vrai rôle applicatif, y compris contrôle de GUC (valeurs exclusivement définies par le serveur) et connexion/transaction pooling Neon.
- Préflight et mapping/backfill approuvés; aucune ligne historique ambiguë; contraintes de non-nullité finales décidées.
- Fournir un contexte tenant vérifié côté serveur avant toute disponibilité UI de l’export SQL tenant-scope; auditer les chemins de sauvegarde/import avant activation.
- Vrai test Clerk de bout en bout autorisé et séparé, puis campagne concurrence/rollback, observabilité, procédure de restauration/rollback.
- Revue humaine, puis activation progressive contrôlée. Cette préparation ne change aucune configuration Clerk, Neon ou Vercel et ne déploie rien.


## Addendum P1.1 — preuves finales avant revue de fusion (11 novembre 2026)

Cet addendum remplace les anciens résultats de validation ci-dessus pour l’état P1.1 courant; les sections d’architecture et de portée restent applicables.

- **RLS PGlite, rôle non privilégié :** le test `tenant RLS isolates A/B CRUD and relations as a LOGIN NOBYPASSRLS non-owner` passe. Il crée/assume un rôle `LOGIN NOSUPERUSER NOBYPASSRLS` distinct du propriétaire, lui accorde uniquement les `SELECT/INSERT/UPDATE/DELETE` requis sur les tables testées, puis vérifie `current_user`, `session_user`, `rolcanlogin`, `rolsuper`, `rolbypassrls` et l’absence de propriété. Lecture tenant A/B, INSERT, UPDATE, DELETE, lignes enfants/offres et liens inter-tenant, rejet d’écriture sans contexte, aucun résultat sans contexte et erreur SQL sur GUC tenant malformé sont couverts. Le test de schéma vérifie directement `ENABLE` et `FORCE` RLS sur les dix tables et la nullabilité attendue des neuf colonnes tenant. Aucun rôle propriétaire ou `BYPASSRLS` n’est compté comme preuve.
- **Historique NULL et migration :** le test dédié confirme que `0003_p1_tenant_scope.sql.draft` reste hors du répertoire exécutable et du journal Drizzle; application locale isolée laisse les tenants historiques à `NULL`, n’effectue aucun backfill, et le rôle non privilégié ne voit pas ces lignes sous RLS. Les tests de contraintes composites et d’échec sur incohérences restent réussis.
- **Export SQL :** la génération exige maintenant un contexte d’organisation explicite, n’invente aucun UUID/tenant et refuse les références incohérentes. Les scénarios de deux organisations vérifient que chaque sortie contient seulement les parents, offres et enfants de son tenant et les colonnes tenant/relations. Les deux scripts générés sont rejoués contre `src/db/schema.sql` par PGlite. Le contexte n’étant pas disponible à l’interface actuelle, le bouton échoue volontairement fermé sans créer de Blob.
- `npm ci` s’est terminé avec succès. Validation locale finale : `npm run typecheck`, `npm run lint`, `npm test` (48 tests, 0 échec), `npm audit --omit=dev --audit-level=high` (0 vulnérabilité de production), `npm run build` et `git diff --check` réussissent. Le build avertit de deux chunks minifiés >500 kB (`index` 795,65 kB; `exceljs` 929,37 kB), non modifiés pour éviter un changement de découpage hors périmètre. L’audit complet indique 8 modérées, 0 high/critical : chaîne `drizzle-kit` → `@esbuild-kit`/esbuild, et chaîne `vite-plugin-pwa` → Workbox/glob/minimatch. `npm audit` propose respectivement `drizzle-kit@0.18.1` au lieu de la version 0.31.x et `vite-plugin-pwa@1.1.0` au lieu de 1.3.x (downgrades majeurs); ces changements potentiellement cassants n’ont pas été appliqués. Aucun contournement d’audit.
- Aucune migration distante ni connexion Neon ou Clerk n’a été utilisée; aucune route métier n’a été ouverte. Les checks Vercel de PR sont des previews. Toute conclusion CI doit être associée au SHA exact de la tête PR; aucun résultat d’un ancien SHA ne vaut validation du suivant.


## Qualification finale de la portée multi-tenant (11 novembre 2026)

**État : qualifié par inspection du schéma et tests locaux seulement; base Neon réelle NON QUALIFIÉE.** Voir [`NEON_RUNTIME_ROLE_QUALIFICATION.md`](./NEON_RUNTIME_ROLE_QUALIFICATION.md) et [`CLERK_PRODUCTION_READINESS.md`](./CLERK_PRODUCTION_READINESS.md) pour les limites opérationnelles.

- Les dix tables métier sont `organizations`, `users`, `projects`, `suppliers`, `supplier_offers`, `cost_items`, `carbon_items`, `risk_items`, `reference_benchmarks` et `audit_logs`. PGlite/PostgreSQL vérifie désormais les flags `relrowsecurity` et `relforcerowsecurity` à `true` sur chacune; le catalogue compare colonnes, contraintes, index, policies et triggers entre le schéma canonique, le P0 + draft et le snapshot de test. `users`, `projects`, `suppliers`, `reference_benchmarks` et `audit_logs` ont un `organization_id NOT NULL`. Les colonnes de `supplier_offers` et des trois tables enfants coût/carbone/risque restent nullable uniquement pour les données historiques; cette exception n’est pas un backfill ni une permission de nouvelles insertions sans tenant.
- Les relations tenant sont composites : offre → projet/fournisseur, enfant → offre, projet/audit → utilisateur/projet de même organisation. Le test valide l’échec sur liens inter-tenant et la migration d’enforcement reste un draft. Les lignes tenant NULL restent invisibles via RLS pour le rôle de test NOBYPASSRLS et sont conservées sans attribution arbitraire.
- Les politiques des tables ordinaires utilisent le contexte tenant transaction-local; l’exception `users` autorise avant résolution seulement la lecture de la ligne qui correspond au GUC `clerk_user_id`, puis exige l’organisation pour l’accès normal et les écritures. Sous le rôle LOGIN non-owner NOBYPASSRLS, contexte absent ne rend aucune ligne; GUC UUID malformé provoque une erreur SQL (échec fermé); sujet Clerk discordant n’expose pas l’utilisateur du tenant B. Aucun contexte d’identité fourni par le client n’est accepté par le code candidat.
- Les chemins SQL prévus dans le code candidat sont `findActiveTenantMembership` et `withTenantSqlTransaction`, tous deux enveloppés par `BEGIN`/`COMMIT` ou `ROLLBACK`, avec `set_config(..., true)`, validation/revalidation membership et libération du client. Tests unitaires simulés couvrent isolation de deux clients concurrents, rollback et release. **Aucun chemin n’est câblé au serveur de production** : `createNeonTenantSqlPool` n’a pas d’appelant runtime; le stub `neonService` ne fait pas de requête DB. Les services de stockage/export sont locaux navigateur. Ainsi, aucune connexion Neon réelle, aucun rôle runtime, pooler Neon ou privilège effectif n’est qualifié; la preuve PGlite ne vaut pas preuve Neon.
- Chemins qui ne passent pas par le mécanisme à ce stade : aucune route métier ne lit/écrit SQL; `server.ts` monte Clerk puis le gate fail-closed, et n’injecte ni middleware d’identité tenant ni pool. Le lookup/export UI ne peut pas inventer le contexte; l’export SQL refuse sans un contexte fourni par un appelant vérifié. RBAC reste une matrice candidate non approuvée.
- Vérification complémentaire de migration : les `.draft` sont absents du journal Drizzle et du répertoire de migrations exécutables; aucun script standard ne les exécute. `db:generate` ne fait que générer une migration et aucun script `db:migrate`/runner distant n’est défini. Aucun backfill ou accès distant n’a été effectué.

## Statut de qualification Clerk et Vercel

Le code/tests locaux couvrent vérification via SDK Clerk, signature RSA locale, issuer/audience/authorized parties, membership unique active, refus des identités ambiguës et gate P0.3. Ils ne qualifient ni une instance Clerk Production, ni les variables Vercel, ni un JWT live. L’intégration Vercel autorisée a refusé l’accès aux métadonnées projet/environnements; aucun secret n’a été consulté. L’état réel Clerk/Vercel est donc NON QUALIFIÉ.

## Garde-fou de fusion sans déploiement production

La PR dispose de checks Vercel de preview; ils ne prouvent pas le comportement de déploiement de `main`. L’API GitHub en lecture seule signale un déploiement `Production` sur le SHA de base/main `2ec57388047ca33acd8c8d7f90fdb9c77b498bc3`, ce qui rend plausible un déploiement automatique sur fusion. L’accès Vercel nécessaire pour consulter la branche de production/les paramètres de déploiement a été refusé et aucun CLI/configuration locale n’est disponible. Comme le mandat interdit tout déploiement de production, la fusion vers `main` est suspendue tant qu’il est impossible d’établir, en lecture seule, que cette fusion ne déclenchera pas un déploiement de production. Aucun réglage Vercel n’a été changé pour contourner ce blocage.
