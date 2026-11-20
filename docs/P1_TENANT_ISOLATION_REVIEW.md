# P1 — Revue d'isolation tenant, Clerk et RBAC

**État actuel : préparation logicielle câblée; RLS Production qualifiée au niveau PostgreSQL; runtime applicatif et identité Clerk Production non qualifiés. Aucune route métier n'est ouverte.** Ce document décrit l'état de la PR #2; les tests locaux ne sont pas une preuve d'intégration Production.

## État de sécurité et routes

- `server.ts` monte l'application Express avec Clerk, le middleware d'identité tenant puis le gate API fail-closed. L'adaptateur de pool runtime est paresseux et ne lit que `DATABASE_URL_RUNTIME`; il n'existe aucun fallback vers `DATABASE_URL`.
- `DATABASE_URL_RUNTIME` n'existe pas dans Vercel Production. Aucune connexion Vercel → Neon n'a été vérifiée. La qualification directe du rôle `truetco_app` sur Neon ne démontre pas que Vercel utilise ce rôle.
- Les appels API hors liveness échouent fermé. Seul `GET /api/health` est public; aucun handler métier, ERP, import, export ou endpoint tenant n'est monté. Le middleware tenant ne contourne pas le gate.
- Clerk Production n'est pas qualifié : aucune instance Production ni aucun JWT réel n'a été vérifié. Le code et les tests Clerk locaux qualifient uniquement le chemin logiciel. Clerk Production, JWT live, memberships et RBAC restent différés jusqu'au choix et à l'achat du domaine.
- La matrice RBAC est candidate seulement; aucune permission métier n'est activée. Aucun tenant par défaut ou sélection tenant fournie par le client n'est admis.

## Qualification Neon Production

La migration P1 a été appliquée manuellement sur Neon Production après restauration vérifiée et préflight de cohérence. Les contrôles post-commit ont confirmé :

- **11 tables avec RLS + FORCE RLS**, **11 policies**, et **9 FK composites tenant**. Les tables sont les dix relations canoniques (`organizations`, `users`, `projects`, `suppliers`, `supplier_offers`, `cost_items`, `carbon_items`, `risk_items`, `reference_benchmarks`, `audit_logs`) ainsi que `user_sessions`, table historique absente du baseline local.
- Le rôle `truetco_app` a été vérifié directement en Production comme `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS` et non propriétaire des tables. Il dispose des droits DML attendus, sans `TRUNCATE`, `REFERENCES`, `TRIGGER` ni appartenance à un autre rôle.
- Sans contexte tenant, `truetco_app` ne voit aucune ligne protégée; les contrôles tenant A/B et les écritures cross-tenant négatives ont confirmé l'isolation.

Ces preuves qualifient Neon/RLS et le rôle lui-même, **pas la connexion réelle de Vercel**. Aucun réglage Neon ou Vercel n'est changé par la PR. Les détails et limites figurent dans [`NEON_RUNTIME_ROLE_QUALIFICATION.md`](./NEON_RUNTIME_ROLE_QUALIFICATION.md) et [`P1_PRODUCTION_PREFLIGHT_2026-11-20.md`](./P1_PRODUCTION_PREFLIGHT_2026-11-20.md).

## Données historiques et migration

Les deux offres historiques dont `organization_id` est NULL sont conservées et restent invisibles au rôle runtime sous RLS. Aucun backfill ou mapping arbitraire n'a été appliqué. Toute attribution future requiert une source d'autorité et une validation explicite.

Le fichier [`db/migrations/proposed/0003_p1_tenant_scope.sql.draft`](../db/migrations/proposed/0003_p1_tenant_scope.sql.draft) reste un draft hors du journal Drizzle et des scripts exécutables. La migration a été appliquée manuellement en Production; **la réconciliation contrôlée du journal Drizzle est requise avant toute prochaine migration**. Aucun journal de migrations n'est modifié dans cette PR et aucun runner ne doit réexécuter le draft.

## Chemin d'identité et contexte SQL préparé

1. Le SDK Clerk vérifie côté serveur la session et ses claims. Le middleware d'identité lit uniquement le sujet Clerk vérifié, jamais l'organisation ou le rôle envoyés par le client.
2. `findActiveTenantMembership` cherche une adhésion locale unique et active à partir de ce sujet; absence, ambiguïté ou panne échoue fermé.
3. `withTenantSqlTransaction` utilise un client réservé, ouvre une transaction, définit les GUC d'organisation/utilisateur/Clerk en mode transaction-local, revalide l'adhésion, exécute le travail puis commit/rollback et libère le client.
4. Ces composants sont montés/préparés, mais aucun handler métier ne les utilise actuellement : gate après identité toujours fermé, aucune connexion Vercel à Neon vérifiée, aucune session Clerk réelle qualifiée.

## Preuves et limites

- Les tests PGlite/PostgreSQL locaux couvrent le draft, la structure, les policies, les FK composites, les cas tenant A/B, les transactions simulées et les refus fail-closed. Ils ne remplacent pas les preuves Neon Production et ne qualifient pas le transport Vercel.
- Les tests Clerk utilisent une signature RSA locale et un issuer de test; ils ne qualifient pas une instance Clerk Production.
- Les checks CI/Preview sont attachés au SHA exact de la tête PR. Une preview n'est pas un déploiement Production et aucun déploiement Production n'est demandé ici.

**Conclusion :** PostgreSQL Production a RLS/FORCE qualifiée sous le rôle dédié non privilégié. Le serveur possède le chemin middleware/pool préparé, mais Vercel runtime et Clerk Production ne sont pas qualifiés. Les routes métier restent fermées; les offres historiques restent non attribuées; la réconciliation du journal précède toute prochaine migration.
