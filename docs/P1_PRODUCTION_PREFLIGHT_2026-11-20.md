# TrueTCO — Préflight RLS Neon Production (20 novembre 2026)

## Décision d'exécution

**NO-GO pour appliquer la migration RLS sur Production à ce stade.** Le préflight SQL est propre sur les incohérences contrôlées, mais la restauration du snapshot n'a pas pu être testée et la limite de branches Neon est atteinte. Aucun DDL, aucune policy et aucun backfill n'ont été appliqués sur Production.

## Sauvegarde

- Projet Neon : `frosty-haze-29622521`
- Branche Production : `br-bold-leaf-b2eclysi`
- Base : `neondb`
- Snapshot manuel créé et relu dans la liste des snapshots : `snap-late-math-b2jhowxo`
- Nom : `pre-p1-tenant-rls-2026-11-20`
- Création : `2026-11-20T01:09:02Z`
- Taille complète annoncée : 33 251 328 octets
- Planification automatique des snapshots sur Production : aucune entrée.
- **Test de restauration : non réalisé.** `restore_snapshot` a été refusé par Neon avec `branches limit exceeded`. Aucun branchement existant n'a été supprimé ou écrasé pour contourner cette limite.

## État RLS Production

- 10 tables canoniques P1 + la table historique `user_sessions` sont présentes.
- Les 11 tables ont `relrowsecurity=false` et `relforcerowsecurity=false`.
- Aucune policy RLS existante dans `public`.
- Propriétaire des 11 tables : `neondb_owner`.
- Le rôle runtime `truetco_app` a été qualifié séparément : LOGIN, non-superuser, non-BYPASSRLS; CONNECT/USAGE et DML SELECT/INSERT/UPDATE/DELETE; aucun TRUNCATE, REFERENCES ou TRIGGER.

## Volumétrie Production observée

| Table | Lignes |
|---|---:|
| organizations | 4 |
| users | 12 |
| projects | 4 |
| suppliers | 7 |
| supplier_offers | 2 |
| cost_items | 0 |
| carbon_items | 0 |
| risk_items | 0 |
| reference_benchmarks | 5 |
| audit_logs | 11 |
| user_sessions | 6 |

## Cohérence référentielle et héritage

- Doublons de `users.clerk_id` non nuls : 0.
- Offres dont projet et fournisseur sont de tenants différents : 0.
- Projets dont le créateur appartient à un autre tenant : 0.
- Audit logs dont l'utilisateur appartient à un autre tenant : 0.
- Audit logs dont le projet appartient à un autre tenant : 0.
- Sessions dont l'utilisateur appartient à un autre tenant : 0.
- Sessions non expirées : 0 (6 sessions, toutes expirées).
- Les deux offres historiques ont un projet et un fournisseur rattachés au même tenant. La table `supplier_offers` ne possède actuellement pas de colonne `organization_id`; la migration proposée en ajoute une nullable. **Aucun backfill n'a été exécuté** : après activation RLS, ces deux offres seraient invisibles tant qu'une attribution explicite n'aura pas été décidée.
- Les tables `cost_items`, `carbon_items` et `risk_items` sont vides; aucun enregistrement enfant ne serait masqué à ce stade.

## Test d'isolation déjà disponible

La branche isolée existante `br-weathered-tree-b23t34vl` a déjà démontré RLS/FORCE RLS et une policy sur les 10 tables canoniques plus `user_sessions`, ainsi que les scénarios A/B, accès sans contexte et refus cross-tenant. Cette preuve concerne cette branche de test, pas Production. Elle ne remplace pas un test de restauration du snapshot actuel ni l'exécution de la dernière version exacte du draft sur un clone frais.

## Blocages avant exécution Production

1. Libérer une place de branche Neon en supprimant explicitement une branche Preview archivée, ou obtenir une augmentation de quota, afin de restaurer le snapshot dans une branche de vérification.
2. Restaurer le snapshot dans une branche dédiée et comparer les 11 comptages ci-dessus.
3. Tester la version exacte de `0003_p1_tenant_scope.sql.draft` sur un clone frais, y compris le bloc conditionnel `user_sessions`, les FK composites, les policies et les accès sous `truetco_app`.
4. Faire valider le traitement des deux offres historiques. Aucune attribution automatique n'est prévue.
5. Après ces preuves, demander le GO final pour appliquer la migration exacte sur Production.

## Changements Production pendant ce préflight

- Création du snapshot manuel uniquement.
- Aucune modification de schéma, rôle, privilège, donnée, policy, variable Vercel ou configuration Clerk.
