# Qualification du rôle runtime Neon

**État : PARTIELLEMENT QUALIFIÉ — rôle et RLS démontrés sur une branche Neon clonée, runtime Vercel/Production NON QUALIFIÉ.**

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
2. **Rôle de production : NON PROVISIONNÉ.** Le rôle `truetco_app` décrit ci-dessus existe uniquement sur la branche de test. Son secret n'est pas configuré dans Vercel.
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
4. Faire approuver séparément le provisionnement du rôle minimal sur Production et la mise à jour de la variable runtime Vercel correspondante.
5. Déployer le code compatible en gardant le gate fermé; ne pas ouvrir de route métier tant que Clerk réel, rôle runtime, RLS Production et parcours transactionnel ne sont pas qualifiés ensemble.
6. Préparer backup, test de restauration, plan de retour arrière et procédure de migration approuvée avant toute modification de schéma Production.

**Conclusion :** preuve réelle Neon obtenue sur une branche clonée et isolée; qualification du runtime applicatif et de la Production toujours NON ACQUISE.