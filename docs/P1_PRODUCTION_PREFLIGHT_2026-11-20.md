# TrueTCO — Qualification RLS Neon Production (20 novembre 2026)

## Résultat

**Migration P1 RLS appliquée sur Neon Production après restauration vérifiée et qualification sur clone.** Aucun backfill n'a été effectué. La migration a été exécutée manuellement dans une transaction Neon unique de 36 statements, sur la branche Production `br-bold-leaf-b2eclysi`.

Cette opération base de données ne signifie pas que l'application est déjà protégée de bout en bout : `neondb_owner` possède `BYPASSRLS`, `DATABASE_URL_RUNTIME` n'est pas configurée sur Vercel Production et `server.ts` n'assemble pas encore le middleware d'identité tenant ni le pool `truetco_app`. Le gate P0 reste fermé et seule la route `GET /api/health` est exposée.

## Sauvegarde et restauration

- Projet Neon : `frosty-haze-29622521`
- Branche Production : `br-bold-leaf-b2eclysi`
- Snapshot manuel : `snap-late-math-b2jhowxo`
- Nom : `pre-p1-tenant-rls-2026-11-20`
- Création : `2026-11-20T01:09:02Z`
- Taille annoncée : 33 251 328 octets
- Pour libérer le quota, branche archivée `vercel-dev` (`br-aged-meadow-b2af85g3`) supprimée avec autorisation explicite.
- Restauration vérifiée : branche temporaire `br-purple-glitter-b2oxw8di`, état `ready`, `restore_status=restored`, source snapshot identique.
- Les 11 comptages Production/clone étaient identiques avant test : organizations 4, users 12, projects 4, suppliers 7, supplier_offers 2, cost_items 0, carbon_items 0, risk_items 0, reference_benchmarks 5, audit_logs 11, user_sessions 6.

## Préflight cohérence avant DDL

- Doublons de `users.clerk_id` non nuls : 0.
- Offres dont projet et fournisseur sont de tenants différents : 0.
- Projets dont le créateur appartient à un autre tenant : 0.
- Audit logs dont l'utilisateur appartient à un autre tenant : 0.
- Audit logs dont le projet appartient à un autre tenant : 0.
- Sessions dont l'utilisateur appartient à un autre tenant : 0.
- Sessions non expirées : 0 (6 sessions, toutes expirées).

## Migration testée sur le clone restauré

La structure testée correspond au draft P1 `db/migrations/proposed/0003_p1_tenant_scope.sql.draft`, y compris le traitement conditionnel de `user_sessions` (table historique absente du schéma canonique P0 mais présente dans Neon).

Résultats :
- 10 tables canoniques + `user_sessions` : RLS activée et FORCE RLS activée (11/11).
- 11 policies attendues présentes.
- 8 FK composites tenant validées.
- Volumétrie intacte après DDL; aucune donnée supprimée ou backfillée.
- Sous `truetco_app`, sans contexte : 0 organisation, 0 utilisateur, 0 projet, 0 fournisseur, 0 offre, 0 session.
- Sous contexte tenant A : 1 organisation, 7 utilisateurs, 2 projets, 2 fournisseurs, 6 sessions, 0 offre visible.
- UPDATE et DELETE cross-tenant : 0 ligne affectée.
- INSERT d'offre avec projet/fournisseur d'un autre tenant rejeté par FK composite, SQLSTATE 23503; aucune ligne de test résiduelle.
- Le rôle effectif était `current_user=session_user=truetco_app`, sans superuser ni BYPASSRLS.

## Application Production

La même séquence SQL a été exécutée sur Production via une transaction Neon unique (36 statements). Contrôles post-commit :
- 11/11 tables avec `relrowsecurity=true` et `relforcerowsecurity=true`.
- 11/11 policies attendues présentes.
- 8/8 FK composites tenant validées.
- Comptages des 11 tables inchangés.
- Sous `truetco_app`, sans contexte : zéro ligne visible dans les tables contrôlées.
- Sous tenant A : 1 organisation, 7 utilisateurs, 2 projets, 2 fournisseurs, 6 sessions; 0 offre visible.
- Sous tenant B : 1 organisation, 3 utilisateurs, 1 projet, 3 fournisseurs, 0 session; 0 offre visible.
- UPDATE/DELETE cross-tenant : 0 ligne affectée.
- INSERT cross-tenant rejeté par `fk_supplier_offers_project_tenant`, SQLSTATE 23503; zéro ligne de test résiduelle.
- Le propriétaire `neondb_owner` a `rolbypassrls=true` et voit les 4 organisations, 12 utilisateurs et 2 offres. Le rôle runtime `truetco_app` est non-superuser et non-BYPASSRLS.

## Données historiques sans tenant

La colonne `organization_id` a été ajoutée nullable à `supplier_offers`. Les deux offres historiques ont toujours `organization_id IS NULL`. Aucun backfill n'a été effectué. Elles restent visibles au propriétaire BYPASSRLS, mais sont volontairement invisibles sous `truetco_app` jusqu'à décision d'attribution explicite.

Les tables `cost_items`, `carbon_items` et `risk_items` sont vides; leurs nouvelles colonnes tenant sont nullables, sans ligne historique à réconcilier.

## Limites opérationnelles restantes — blocantes avant ouverture métier

1. Vercel Production ne contient toujours pas `DATABASE_URL_RUNTIME`; seuls `DATABASE_URL` et `DATABASE_URL_UNPOOLED` sont configurées. Ne pas remplacer ces variables : Drizzle les utilise pour les tâches existantes.
2. `createRuntimeTenantSqlPool` existe et valide le rôle `truetco_app`, mais n'est pas monté dans `server.ts`.
3. `createApplication` accepte un `tenantIdentityMiddleware` optionnel, mais `server.ts` appelle actuellement `createApplication()` sans ce middleware.
4. `neondb_owner` a `BYPASSRLS`; toute connexion applicative future doit impérativement utiliser `truetco_app`, pas `DATABASE_URL`.
5. Clerk Production reste différé jusqu'au choix/achat du domaine. Aucun JWT Clerk réel, membership Clerk ou RBAC runtime n'est qualifié.
6. Les deux offres historiques nécessitent une attribution tenant validée avant qu'elles soient accessibles sous le rôle runtime.
7. Le draft reste un fichier `.sql.draft`; l'opération Production a été exécutée comme SQL transactionnel manuel et n'a pas été inscrite dans un journal de migrations Drizzle. Une procédure de baseline/reconciliation doit être décidée avant le prochain déploiement de migrations.

**Conclusion :** RLS Production est en place et qualifiée au niveau PostgreSQL sous le rôle non-BYPASSRLS. L'isolation de l'application n'est pas encore activée : gate P0 fermé, runtime pool non câblé, Clerk différé, et données d'offres historiques non attribuées. Aucun changement Vercel, Clerk, aucune route métier activée et aucune fusion PR n'ont été effectués.
