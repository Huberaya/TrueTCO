# Qualification du rôle runtime Neon

**Décision : NON QUALIFIÉ pour l’infrastructure Neon/Vercel réelle.** Aucun rôle PostgreSQL runtime effectif n’est identifié ou attesté dans cette revue. La base réelle n’a pas été interrogée; aucune variable ni valeur secrète n’a été lue, déchiffrée, copiée ou exposée.

## Portée et éléments vérifiés

- Le PR #2 est une préparation logicielle. `src/db/tenantSql.ts` exporte un adaptateur Neon explicite, mais `createNeonTenantSqlPool(connectionString)` n’est appelé par aucun code de production. Il ne lit pas `process.env` et n’est pas raccordé à `server.ts`.
- `src/services/neonService.ts` est un stub; aucune autre instanciation `Pool`, connexion PostgreSQL ou requête applicative runtime n’a été trouvée hors de l’adaptateur candidat et des tests.
- `.env.example` contient une URL de démonstration et des clés Clerk d’exemple uniquement; ce fichier ne prouve aucune configuration Vercel/Neon réelle.
- Les scripts standard ne lancent aucune migration : `db:generate` est le seul script DB déclaré et génère des artefacts Drizzle; le seul fichier exécutable du journal courant est la migration P0 `0000_initial_schema.sql`. Les trois propositions P1 sont `.draft` dans `db/migrations/proposed/`.
- Les checks Vercel déjà attachés à la PR portent sur un preview PR et ne révèlent ni environnement ni rôle DB de production.
- La lecture des métadonnées Vercel a été tentée via l’intégration connectée, mais l’API a répondu **Access denied** (permissions/scope insuffisants). Aucun outil Vercel local ni configuration `.vercel` n’est présent dans le checkout. Aucun nouvel essai de lecture de valeurs d’environnement n’a été fait.

En conséquence, il est impossible de prouver si une éventuelle configuration externe utilise `neondb_owner`, un autre compte, ou aucune connexion. Le nom `DATABASE_URL` ou le contenu du modèle `.env.example` ne sont pas une preuve d’identité. `current_user`, `session_user`, flags de rôle, propriétaires, privilèges effectifs, héritages de rôles et capacité RLS/DDL/DML de l’infrastructure sont **inconnus**.

## Qualification code et politique cible

Le code candidat démarre chaque transaction avec `BEGIN`, configure `true_tco.*` par `set_config(..., true)` (transaction-local), vérifie l’adhésion active pour chaque opération tenant, puis commit/rollback et libère le client. L’adaptateur n’étant pas monté, ceci qualifie seulement le code et ses tests unitaires, pas Neon, son pooler, un rôle, ni les privilèges réels.

| Surface | État runtime actuel | Minimum éventuel après une activation séparément approuvée |
|---|---|---|
| Connexion DB | Aucun chemin DB applicatif n’est raccordé; identité effective non observable | `CONNECT` sur la seule base concernée et `USAGE` sur le seul schéma applicatif. |
| Adhésion Clerk → utilisateur local | Résolution candidate non montée | `SELECT` sur `users` pour le lookup limité par RLS au `clerk_id`; aucune création/modification de membership depuis les routes runtime prévues. Provisionnement réservé à un processus administratif contrôlé. |
| Tables tenant | Aucune route de données runtime montée | Accorder table par table seulement les `SELECT`, `INSERT`, `UPDATE` nécessaires aux handlers et permissions métier approuvés. À ce stade, aucun droit métier n’est requis/accordé par cette PR; ne pas pré-accorder les écritures. |
| Suppression / DDL | Aucun besoin runtime | Pas de `DELETE` direct à moins d’un besoin métier distinctement approuvé; aucun `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `REFERENCES`, `TRIGGER`, création de rôle ou contrôle de schéma. |
| RLS / propriété | Qualifiés seulement dans PGlite | Rôle runtime dédié `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, non propriétaire de tables, sans appartenance héritée/SET ROLE vers propriétaire ou rôle bypass. `FORCE ROW LEVEL SECURITY` reste defense-in-depth; le rôle de migration demeure distinct. |
| Fonctions / séquences | Pas d’accès réel vérifié; clés par défaut UUID | Ne concéder que les exécutions nécessaires aux fonctions utilisées; aucun droit de séquence n’est identifié dans le schéma courant. Vérifier les fonctions/triggers effectivement appelés à l’activation. |

**Aucun runtime privilégié n’est justifié aujourd’hui.** La matrice ci-dessus est une cible de moindre privilège pour une future revue de handlers; elle ne constitue pas une demande de GRANT, une approbation RBAC ou une preuve de compatibilité Neon. La politique RBAC demeure candidate et les routes métier restent fermées.

## Rôle DDL distinct

Les migrations de schéma doivent être exécutées par un rôle de migration dédié, activé uniquement par une procédure de changement approuvée, avec les droits DDL nécessaires et la propriété/élévation limitée aux objets visés. Ce rôle ne doit pas être réutilisé comme secret runtime. Réserver à ce processus : `CREATE/ALTER/DROP`, `CREATE POLICY`, changements `ENABLE/FORCE ROW LEVEL SECURITY`, clés/contraintes/index, et toute modification des grants/owners. Aucun de ces droits n’est requis pour le serveur runtime de la PR.

## Requête de préflight en lecture seule (à exécuter par un opérateur autorisé sur la connexion runtime réelle)

Ces requêtes ne sont pas exécutées par cette mission et ne demandent aucune valeur de secret. Exécuter sous la connexion destinée à l’application, sans changer de rôle ni de session :

```sql
SELECT current_database() AS database_name,
       current_user AS effective_role,
       session_user AS login_role,
       r.rolcanlogin, r.rolsuper, r.rolbypassrls,
       pg_has_role(session_user, current_user, 'MEMBER') AS session_is_member_of_effective
FROM pg_roles r WHERE r.rolname = current_user;

SELECT n.nspname AS schema_name,
       has_schema_privilege(current_user, n.oid, 'USAGE') AS can_use,
       has_schema_privilege(current_user, n.oid, 'CREATE') AS can_create_objects
FROM pg_namespace n WHERE n.nspname = 'public';

SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
       has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
       has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
       has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
       has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
       has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_reference,
       has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_create_trigger
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
  AND c.relname IN ('organizations','users','projects','suppliers','supplier_offers',
                    'cost_items','carbon_items','risk_items','reference_benchmarks','audit_logs')
ORDER BY c.relname;

SELECT member.rolname AS member_role, parent.rolname AS granted_role, m.admin_option
FROM pg_auth_members m
JOIN pg_roles member ON member.oid = m.member
JOIN pg_roles parent ON parent.oid = m.roleid
WHERE member.rolname IN (current_user, session_user)
   OR parent.rolname IN (current_user, session_user)
ORDER BY member_role, granted_role;

SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

L’opérateur doit aussi examiner `has_database_privilege` pour `CONNECT`, `CREATE`, `TEMP`, et vérifier les privilèges effectifs/grants indirects sur fonctions/objets et les rôles pouvant être `SET ROLE`. Comparer le résultat à l’identité déclarée par l’environnement sans afficher la chaîne de connexion. Contrôler `current_user` directement; ne jamais déduire le rôle du nom d’une variable. Si une session runtime ne peut pas être consultée en lecture seule, conserver la conclusion **NON QUALIFIÉ**.

## État de changement

Aucun rôle créé, aucun `GRANT` modifié, aucune variable Vercel lue ou changée, aucun paramètre Neon touché et aucune migration distante lancée. Aucune route métier ouverte et aucun déploiement de production demandé ou exécuté.
