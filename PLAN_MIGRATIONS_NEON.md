# TrueTCO — plan versionné de migrations Neon / P0.2

**Décision :** préparation uniquement; aucun SQL appliqué. Aucun accès distant, changement de rôle, de branche Neon, de donnée, de secret ou de base n’a été effectué durant ce chantier.

## 1. État de vérité à réconcilier

Le propriétaire du projet a communiqué que production est la branche `br-bold-leaf-b2eclysi`, la preview PR la branche `br-noisy-star-b2g4bwcn`, PostgreSQL 18.7, 11 tables dont `user_sessions`, aucune RLS/policy trouvée, et le rôle de diagnostic `neondb_owner` a `BYPASSRLS`. Aucun rôle applicatif dédié ni historique de migration n’a été identifié lors de cette vérification antérieure. Ces faits sont rapportés par le propriétaire et non revalidés par une connexion Neon dans la présente exécution.

Le schéma local suivi décrit dix tables. Il diffère de la base rapportée sur `users`/`organizations`, omet `user_sessions`, et manque `organization_id` sur `supplier_offers`, `cost_items`, `carbon_items`, `risk_items`. Les clés actuelles n’assurent pas la cohérence tenant entre projet, fournisseur, offre et enfants. Les noms et définitions exactes de toutes les colonnes distantes doivent être photographiés avant de concevoir une migration corrective.

## 2. Fichiers préparés et statut

| Version candidate | Fichier | Intention | Statut |
|---|---|---|---|
| 0001 | `db/migrations/proposed/0001_expand_tenant_scope.sql.draft` | Ajouter nullable `organization_id` sur les quatre tables non-scopées, indexer; pas de backfill | Brouillon interdit d’exécution |
| 0002 | `db/migrations/proposed/0002_enforce_tenant_consistency.sql.draft` | Après mapping revu, arrêter sur NULL/incohérence, puis `NOT NULL`, uniques et FKs composites | Brouillon interdit d’exécution; exige changement de données fait indépendamment et approuvé |

`*.sql.draft` n’est pas reconnu comme migration par Drizzle. Ces fichiers ne sont pas exécutés par `npm run db:migrate` ou `db:push` et ne constituent pas un journal d’application. Ils doivent être re-introspectés, relus, convertis explicitement après approbation et testés en environnement jetable/staging. Aucune migration n’est « appliquée » ou « prête production ».

Le `db:migrate` présent lance `scripts/migrate-neon.mjs`, qui applique directement `src/db/schema.sql` puis le seed; il est déconseillé de l’exécuter sur la base existante. `drizzle.config.ts` pointe vers `./drizzle/migrations`, mais aucun historique de migration canonique n’a été validé ici. Ne pas exécuter ces scripts pendant le chantier.

## 3. Séquence obligatoire de la prochaine étape

### M0 — photographie read-only

- Réinspecter la branche Neon ciblée avec accès limité aux catalogues, sans lire ou exporter de données métier ni de secrets.
- Capturer colonnes, types, nullabilité, defaults, PK/FK/uniques/index, policies, RLS, grants et rôles (secrets expurgés).
- Comparer à la fois Drizzle, `schema.sql`, les requêtes `server.ts` et les scripts. Préserver explicitement les colonnes additionnelles existantes.

### M1 — tests de pré-migration

- Sur une DB de test isolée, vérifier les deux versions de départ: schéma vide depuis migrations canoniques, puis copie anonymisée/structurelle de la version existante.
- Produire compteurs d’orphelins, NULL, doublons, conflits de tenants et relations incohérentes. Les lignes problématiques vont dans un rapport, pas dans un update automatique.
- Simuler durée/locks et restauration avant toute opération staging.

### M2 — expansion additive

- Après revue/approbation, ajouter colonnes nullable et indexes d’abord. Pas de valeur par défaut d’organisation.
- Déployer code capable de tolérer étape expand seulement si routes métier toujours fermées; le code de ce dépôt ne consomme pas encore ces nouvelles colonnes.

### M3 — association manuelle

- Déduire le tenant d’une offre de son projet seulement si le lien projet existe et que le fournisseur appartient au même tenant; sinon isoler et demander une décision humaine.
- Pour chaque coût/carbone/risque, associer l’organisation de l’offre parent uniquement si la relation est prouvée.
- Recompter avant/après et conserver une piste de décision indépendante. Pas de backfill silencieux ni de fallback.

### M4 — contraintes composées

- En staging, exiger zéro NULL et zéro conflit tenant avant `NOT NULL`.
- Ajouter les clés uniques composites `organization_id,id` nécessaires, puis FKs composites offre→projet, offre→fournisseur, enfants→offre; valider et mesurer impact.
- Les contraintes ne remplacent ni le filtre tenant des queries ni l’autorisation applicative.

### M5 — rôle runtime et RLS

- Créer (après autorisation hors de cette PR) rôles migrateur et runtime séparés; runtime non-owner, `NOBYPASSRLS`, grants minimaux.
- Définir et tester le passage de `organization_id` comme variable transaction-locale issue du contexte serveur vérifié. Évaluer explicitement si l’API Neon HTTP et le client courant supportent le modèle transactionnel choisi sans fuite de contexte.
- Activer `ENABLE` et `FORCE ROW LEVEL SECURITY` puis policies `USING`/`WITH CHECK` tenant-scopées. Tester avec le vrai runtime role; `neondb_owner BYPASSRLS` n’est pas une preuve.

### M6 — autorisation et décision d’ouverture

- Implémenter mapping Clerk user/org ↔ records locaux, membership actif et matrice approuvée; corriger tous les queries, IDOR, exports et relations imbriquées.
- Exécuter tests API et PostgreSQL inter-tenant, tests de migration à vide et depuis l’état existant, restore staging et revue externe.
- Seule une allowlist explicitement testée peut remplacer la garde 503. Routes inconnues et erreurs restent refusées.

## 4. Tests PostgreSQL à joindre au changement de migration effectif

1. A et B isolés pour chaque ressource, lecture et mutation directe et imbriquée.
2. A tente IDs B, organisation B en body/query/header, tenant absent/inconnu et bascule d’organisation : zéro exposition/mutation.
3. Offre d’un projet A + fournisseur B refusée; enfant A + offer B refusé; contraintes réelles vérifiées.
4. Orphelins, doublons, tenant NULL et associations ambiguës bloquent la phase enforce sans assignation automatique.
5. Tests des deux chemins de migration depuis zéro et depuis l’état distant; transactions concurrentes, lock time et rollback/restore.
6. RLS vérifiée sur role runtime `NOBYPASSRLS`, y compris absence de contexte, lecture, insertion, update, tenant forgé et pool reuse; comparer séparément le comportement owner/bypass.

Aucun PostgreSQL test n’a été installé ou connecté dans cette session; aucune exécution de ces scénarios n’est revendiquée.
