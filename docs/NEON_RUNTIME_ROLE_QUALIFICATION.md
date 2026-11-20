# Qualification Neon Production et rôle runtime

**État actuel : RLS Production appliquée et vérifiée au niveau PostgreSQL; rôle `truetco_app` qualifié; connexion runtime Vercel NON qualifiée.** Cette qualification Neon ne constitue pas une preuve que l'application Vercel se connecte sous ce rôle.

## Qualification effective en Production

La migration P1 a été appliquée manuellement à Neon Production, après restauration vérifiée et contrôles de cohérence sur clone. Les vérifications post-commit établissent :

- **11 tables avec RLS et FORCE RLS**, et **11 policies** présentes : les dix tables canoniques (`organizations`, `users`, `projects`, `suppliers`, `supplier_offers`, `cost_items`, `carbon_items`, `risk_items`, `reference_benchmarks`, `audit_logs`) ainsi que la table historique `user_sessions`.
- **9 clés étrangères composites** assurant les liens intra-tenant, y compris la relation de `user_sessions` à `users`.
- Comptages des tables inchangés après DDL; aucune donnée n'a été supprimée ou backfillée.
- Vérification sous le rôle `truetco_app` : `current_user = session_user = truetco_app`, `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, non propriétaire des tables. Le rôle a les droits DML nécessaires; il n'a pas les privilèges `TRUNCATE`, `REFERENCES` ou `TRIGGER`, et n'appartient pas à un autre rôle.
- Sans contexte tenant, aucune ligne tenant n'est visible sous `truetco_app`. Les tests A/B et les contrôles d'écritures cross-tenant ont confirmé l'isolation; les insertions incohérentes sont rejetées par les FK composites.

La migration a été exécutée manuellement en transactions Neon. Le fichier candidat reste `db/migrations/proposed/0003_p1_tenant_scope.sql.draft`, hors du journal Drizzle. **Une réconciliation contrôlée du journal de migrations est requise avant toute prochaine migration**; cette PR ne l'effectue pas et aucun script distant ne doit relancer le draft.

## Données historiques

Les deux lignes historiques de `supplier_offers` conservent `organization_id IS NULL`. Elles n'ont pas été attribuées ni backfillées arbitrairement et restent invisibles au rôle `truetco_app` sous RLS. Une attribution nécessitera une source d'autorité et une décision explicite. Il n'y a pas d'ouverture métier en attendant.

## Rôle Neon et connexion applicative : preuves distinctes

La qualification ci-dessus prouve l'identité et les privilèges du rôle directement vérifié en Production. **Elle ne prouve pas que Vercel utilise `truetco_app`.**

- Le pool runtime code (`src/db/runtimeTenantPool.ts`) accepte exclusivement `DATABASE_URL_RUNTIME`; il ne retombe jamais sur `DATABASE_URL`, qui reste réservé aux usages de migration/Drizzle. Le pool vérifie le rôle, l'hôte Neon, la base `neondb` et TLS et s'ouvre paresseusement.
- Le middleware d'identité tenant et l'adaptateur runtime sont maintenant montés dans `server.ts`; l'identité vient du middleware Clerk vérifié et l'accès aux autres API demeure derrière le gate fail-closed.
- `DATABASE_URL_RUNTIME` n'existe pas dans Vercel Production. Aucune connexion Vercel runtime n'a été observée ou qualifiée. Il n'y a donc aucune preuve que la connexion effective utilise `truetco_app`.
- Aucun secret n'a été affiché ou transmis dans cette documentation. Aucun paramètre Vercel/Neon n'est modifié par cette PR.

## Tests et limites

Les tests PGlite/PostgreSQL locaux couvrent le draft, les policies, les FK composites, le rôle non privilégié simulé et l'isolation tenant. Ils ne remplacent pas les vérifications réelles Neon ci-dessus, et ne qualifient pas le transport applicatif Vercel → Neon. Les parcours applicatifs tenantés complets restent bloqués par l'absence de connexion runtime vérifiée et de Clerk Production qualifié.

**Conclusion opérationnelle :** RLS Production et rôle Neon `truetco_app` sont qualifiés au niveau PostgreSQL; connexion runtime Vercel et parcours Clerk → Vercel → Neon NON qualifiés. Les routes métier restent fermées. Ne pas confondre la qualification du rôle avec l'identité réellement utilisée par l'application.
