# Qualification du rôle runtime Neon

**État : rôle truetco_app qualifié en Neon Production (lecture seule) ; RLS démontrée sur branche clonée ; runtime Vercel NON raccordé ; RLS Production NON APPLIQUÉE.**

## Environnement testé

- Projet Neon TrueTCO : `frosty-haze-29622521`.
- Branche isolée clonée depuis Production : `truetco-tenant-hardening-20261120` (`br-weathered-tree-b23t34vl`).
- Rôle de test créé sur cette branche : `truetco_app`, accès `read_write`, base `neondb`, schéma `public`.
- Le secret du rôle n'est pas reproduit ici et n'a pas été transmis à Vercel.
- Aucun DDL de cette branche n'a été appliqué à Production.

## Identité et privilèges effectivement observés

Connexion directe sous le rôle `truetco_app` sur la branche de test :

- `current_user = session_user = truetco_app`.
- `rolsuper = false`, `rolbypassrls = false`.
- `CONNECT` base et `USAGE` schéma public : vrais.
- Droits `SELECT/INSERT/UPDATE/DELETE` testés sur les tables applicatives : effectifs.
- Le rôle n'est pas le propriétaire des tables et n'est ni superuser ni BYPASSRLS.

Cette preuve qualifie le rôle dédié sur la branche Neon clonée uniquement. Elle ne prouve pas que Vercel utilise ce rôle : le pool applicatif candidat n'est pas raccordé à `server.ts`, les variables d'environnement Vercel n'ont pas été lues ni modifiées, et aucune connexion runtime Production n'a été observée.

## Isolation RLS observée sur la branche de test

RLS + FORCE RLS et une policy tenant ont été installées sur les dix tables canoniques (`organizations`, `users`, `projects`, `suppliers`, `supplier_offers`, `cost_items`, `carbon_items`, `risk_items`, `reference_benchmarks`, `audit_logs`) et sur la table historique `user_sessions` présente dans Neon (absente du baseline P0 et du schéma applicatif local).

Sous `truetco_app` :

- Sans contexte tenant, les tables tenant ne révèlent aucune ligne.
- Le contexte Clerk de test `user_test_clerk_123` résout une seule adhésion active.
- Le tenant A ne voit pas les projets ni les sessions du tenant B.
- Le tenant A voit 6 sessions; le tenant B n'en voit aucune dans le contexte A.
- Un INSERT utilisateur cross-tenant est refusé par RLS.
- Tests complémentaires exécutés : UPDATE ciblant un utilisateur du tenant B depuis le contexte A affecte 0 ligne; DELETE ciblant les sessions du tenant B affecte 0 ligne.
- Les catalogues confirment `ENABLE ROW LEVEL SECURITY` et `FORCE ROW LEVEL SECURITY` sur les 10 tables canoniques et `user_sessions`.

Les offres historiques ont `organization_id IS NULL` et restent invisibles sous RLS. Elles n'ont pas été backfillées. Les données observées indiquent des associations cohérentes entre projet et fournisseur pour les offres examinées, mais aucun mapping historique n'est appliqué sans décision explicite.

## Limites encore ouvertes

1. **Runtime Vercel/Production : NON QUALIFIÉ.** Aucune preuve que la connexion réellement utilisée par l'application est `truetco_app`. Le chemin pool Neon candidat n'est pas monté.
2. **Rôle de production : QUALIFIÉ, non raccordé.** Le rôle `truetco_app` existait déjà sur la branche Production et sa connexion/droits ont été vérifiés sous le rôle réel. Aucun secret n'a été lu ou affiché et aucune variable Vercel n'a été modifiée; l'application n'utilise donc pas encore ce rôle.
3. **Schéma Production : NON MODIFIÉ.** Aucune migration distante, aucun GRANT/RLS ni backfill appliqué à Production.
4. **RLS Production : NON QUALIFIÉ.** Les preuves Neon concernent la branche clonée, pas la branche Production.
5. **Restauration et sauvegardes :** aucun exercice de restauration n'a été effectué.
6. **Permissions minimales :** le rôle de test a été créé avec `read_write` pour éprouver les opérations; réduire les droits à la matrice de handlers avant tout usage runtime.
7. **Relations composites :** les catalogues montrent les FK composites tenant sur la branche de test; un test négatif dédié des insertions cross-tenant sur chaque relation reste à compléter avant activation.
8. **Données historiques :** les NULL de `supplier_offers.organization_id` restent préservés et cachés. Toute réconciliation/backfill exige une source d'autorité et une validation séparée.

## Séquence obligatoire avant activation

1. Corriger et valider le draft P1 sur le commit candidat; garder le fichier `.draft` hors du journal exécutable.
2. Revoir et tester les FK composites et tous les cas CRUD sous un rôle `LOGIN/NOSUPERUSER/NOBYPASSRLS`.
3. Identifier la connexion DB réelle prévue pour Vercel sans afficher ni déchiffrer de secret.
4. Le rôle Production étant déjà qualifié, faire le raccordement contrôlé de DATABASE_URL_RUNTIME dans Vercel après validation du transfert secret; garder DATABASE_URL pour Drizzle/migrations.
5. Déployer le code compatible en gardant le gate fermé; ne pas ouvrir de route métier tant que Clerk réel, rôle runtime, RLS Production et parcours transactionnel ne sont pas qualifiés ensemble.
6. Préparer backup, test de restauration, plan de retour arrière et procédure de migration approuvée avant toute modification de schéma Production.

**Conclusion :** preuve réelle Neon obtenue sur une branche clonée et isolée; qualification du runtime applicatif et de la Production toujours NON ACQUISE.

## Addendum — qualification Neon Production et préparation runtime (20 novembre 2026)

- Branche Production br-bold-leaf-b2eclysi, base neondb, rôle existant truetco_app.
- Connexion réelle sous current_user = session_user = truetco_app confirmée. rolcanlogin=true, rolsuper=false, rolbypassrls=false, rolcreatedb=false, rolcreaterole=false.
- CONNECT et USAGE schema public confirmés; DML SELECT/INSERT/UPDATE/DELETE sur 11 tables business; TRUNCATE, REFERENCES et TRIGGER refusés; aucune appartenance à un autre rôle. Les 11 tables restent détenues par neondb_owner.
- Aucune RLS Production n'est activée et aucune migration n'a été appliquée.
- L'adaptateur runtime préparé dans le code attend exclusivement DATABASE_URL_RUNTIME et refuse toute fallback vers DATABASE_URL; il valide truetco_app, endpoint Neon, base neondb et TLS. Il n'est pas encore monté dans server.ts.
- La variable Vercel n'a pas été créée : l'écriture du secret depuis Neon vers Vercel a été bloquée par le contrôle de sécurité de l'outil. Aucun contournement ni affichage de secret n'a été effectué.
- L'état correct reste donc : rôle Production qualifié; isolation RLS Production et utilisation Vercel runtime non qualifiées.
