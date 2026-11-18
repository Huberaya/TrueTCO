# TrueTCO — Rapport complet d’avancement

**Date du point :** 11 novembre 2026 (UTC)
**Dépôt :** `Huberaya/TrueTCO`
**Branche :** `arena/ea5046f1-truetco` — PR ouverte (`pr_open`)
**Base de branche :** `edc44ceb6570f705f4edf591dfd95524838a1160`
**État :** le commit P0 `44e03d09ca300bb05f5c0c58404d3c0917f238e3` a été poussé sur la branche existante et ajouté à la PR #1 ouverte. La PR n’est pas fusionnée et aucun déploiement production n’a été lancé. Ce rapport n’est ni une certification ni une validation de production.

## 1. Résumé

La tranche de réduction du risque immédiat (chantier 0 / P0) a été travaillée : faux succès, fausses preuves de provenance, d’identité, d’approbation, d’intégration ou de persistance ont été supprimés, rendus indicatifs, ou explicitement désactivés. Des routes métier sont maintenant bloquées côté serveur tant qu’une identité et des autorisations vérifiables ne sont pas disponibles.

**Ce travail ne rend pas TrueTCO prêt pour des données client ou un usage commercial.** L’identité/RBAC réelle, l’isolation multi-tenant, les migrations/persistance vérifiées et la validation métier indépendante du moteur TCO/LCC ne sont pas mises en œuvre. L’état opérationnel de Vercel, Neon et de la production n’a pas été vérifié.

## 2. Travail effectué

### 2.1 API, identité et accès

- Ajout d’une garde API serveur fail-closed (`src/server/apiGate.ts`) montée tôt dans `server.ts` : les requêtes métier reçoivent HTTP 503 tant qu’identité, RBAC et isolation tenant ne sont pas configurés. Seule la route de liveness `/api/health` passe.
- Le healthcheck ne révèle plus la connexion, la base, l’utilisateur SQL ni les erreurs DB.
- Retrait du faux parcours SSO qui acceptait l’identité et le rôle depuis le corps de la requête et pouvait créer une session sans IdP réel. La connexion est indisponible explicitement.
- Suppression de l’auto-identité/utilisateur par défaut et du recours à une identité mise en cache comme identité authentifiée dans le client.
- L’interface tenant explique l’absence d’isolation serveur. Le formulaire de création est désactivé et son handler refuse également la soumission sans appeler le service de création.
- Les actions d’approbation, d’adjudication et de signature sont neutralisées; les contrôles restant visibles sont présentés comme démonstratifs ou indisponibles.

**Limite :** ce blocage fail-closed n’est pas un système d’identité/RBAC. Des handlers métier restent présents dans le code, mais sont protégés par la garde commune. Il ne faut pas réactiver la garde avant d’avoir implémenté et testé l’authentification, l’autorisation et l’isolation tenant.

### 2.2 Connecteurs et traitement documentaire

- Routes d’intégration ERP et d’analyse documentaire rendues fail-closed : pas de faux test de connexion, import d’offre, émission de commande, transfert de document ou résultat d’analyse synthétique.
- Les parcours qui affichent une action ERP ou documentaire effacent les anciens résultats positifs lorsque la requête ou les paramètres changent.
- Le parseur démarre avec une entrée vide; les exemples sont indiqués comme fictifs/non vérifiés. L’extraction n’est pas considérée réussie sans réponse serveur explicite.
- L’import CSV/Excel et l’analyse de document dans le formulaire d’offre sont signalés indisponibles plutôt que simulés. Le chemin de saisie manuelle est présenté comme une donnée locale de démonstration, avec champs laissés vides, contrôles de saisie, provenance non vérifiée et confiance à zéro par défaut.

### 2.3 Données, provenance et claims d’interface

- Les claims de connexion Neon, de sauvegarde/persistance distante, de mode hors ligne complet, de conformité, de certification, de validation indépendante et d’intégrité immuable ont été supprimés ou reformulés lorsqu’aucune preuve vérifiable n’existe.
- Les exemples d’organisations, de tenants et les valeurs légales/résidentielles fictives ont été neutralisés; l’interface ne prétend plus créer un environnement isolé.
- Les certifications et scores fournisseurs sont décrits comme déclaratifs/non vérifiés; les critères de pondération ne valent pas approbation ni adjudication.
- Les catégories de source et les scores de confiance sont présentés comme non vérifiés. L’absence de score n’est plus remplacée par une valeur artificielle de 85 % : la valeur par défaut est 0/non établie.
- Les projets, états de workflow, compteurs de validation, tableaux de bord et indicateurs de portefeuille sont étiquetés comme démonstration/indication, sans effet décisionnel. Les transitions d’approbation ou d’avancement sont désactivées.
- Les rapports exécutifs, vues de signature, journal d’événements, vues CSRD, connecteurs, mode PWA/hors ligne et sauvegardes indiquent leurs limites et ne prétendent plus émettre une preuve certifiée.
- Les exports de sauvegarde et modèles SQL indiquent leur portée locale ou indicative et avertissent qu’ils ne sont pas une migration validée ni une piste d’audit légale. La validation Zod est décrite comme vérification de structure uniquement.

### 2.4 Export tableur et dépendances

- Remplacement de la dépendance vulnérable `xlsx` par `exceljs@^4.4.0`; export rendu asynchrone et chargement ExcelJS dynamique.
- L’export est nommé et présenté comme indicatif/non certifié; une source de facteur d’émission absente est indiquée comme non renseignée plutôt que remplacée par une provenance ADEME non établie.
- Ajout d’une surcharge de dépendance `uuid@^11.1.1` après audit des dépendances de production.
- Mise en place du lockfile npm (`package-lock.json`) et des scripts nécessaires à l’installation reproductible par `npm ci`; le lockfile Bun existant est retiré. La CI ajoutée utilise npm.

**Limite :** le remplacement réduit le risque de la dépendance de production auditée, mais ne signifie pas que tout l’arbre de dépendances est exempt de vulnérabilités. Le classeur n’a pas été vérifié par un audit de sécurité indépendant ni contre des cas métier de référence.

### 2.5 Tests et intégration continue

- Ajout d’une suite de tests moteurs et P0, incluant des cas de fail-closed API, de refus d’intégrations simulées, d’absence d’identité par défaut, de limitations tenant, de contenu documentaire fictif et de claims d’export/reporting.
- Ajout d’un workflow GitHub Actions pour installation propre, typecheck, lint, tests, audit des dépendances de production et build.
- Ajout de la configuration Biome et des scripts `typecheck`, `lint`, `test` et `test:p0`.

## 3. Vérifications locales finales

Après installation propre (`npm ci`) :

| Vérification | Résultat |
|---|---|
| `git diff --check` | Réussi |
| `npm run typecheck` | Réussi |
| `npm run lint` | Réussi — 62 fichiers contrôlés |
| `npm test` | Réussi — 23 tests sur 23 |
| Sonde HTTP du serveur local | Réussie — 112 combinaisons route/méthode, variantes et liveness |
| `npm run build` | Réussi |
| `npm audit --omit=dev --audit-level=high` | Réussi — 0 vulnérabilité trouvée dans le périmètre production audité |

La CI GitHub Actions `43342522682` est verte sur le commit P0 `44e03d09ca300bb05f5c0c58404d3c0917f238e3` : installation `npm ci`, typecheck, lint, tests, audit production et build réussis. L’actualisation de ce rapport provoque une nouvelle exécution sur le nouveau SHA de tête; vérifier le dernier statut dans la PR avant toute clôture formelle.

Le check Vercel sur le commit P0 a échoué avec une cible indiquant `build-rate-limit`/limite de build du compte. Il s’agit du preview Vercel, distinct du workflow qualité GitHub; aucune tentative de déploiement production n’a été faite.

Avertissements de build : configuration Vite utilisant `__dirname` avec le chargeur natif; chunks volumineux (application autour de 823 kB et chunk ExcelJS autour de 929 kB minifiés, celui-ci étant chargé dynamiquement).

L’audit de l’arbre complet après `npm ci` a signalé **10 vulnérabilités faibles/modérées** (2 faibles, 8 modérées). Inventaire du lockfile courant :

| Dépendance signalée | Sévérité | Chemin/chaîne observée | Remédiation proposée par npm / décision |
|---|---:|---|---|
| `@esbuild-kit/core-utils` | modérée | `drizzle-kit` → `@esbuild-kit/esm-loader` → core-utils → `esbuild@0.18.20` | Npm propose un downgrade destructif de `drizzle-kit`; ne pas appliquer sans test/choix d’outil. |
| `@esbuild-kit/esm-loader` | modérée | Dépendance de `drizzle-kit@0.31.11` | Même bloc Drizzle; package ancien/déprécié. |
| `drizzle-kit` | modérée | Dépendance directe; embarque la chaîne loader/esbuild ci-dessus | Npm propose `0.18.1`, downgrade majeur; aucune modification automatique. |
| `esbuild` | modérée | Copie imbriquée `@esbuild-kit/core-utils/node_modules/esbuild` (version vulnérable ≤0.24.2) | Ne pas forcer un override sans compatibilité Drizzle. |
| `@rollup/plugin-node-resolve` | faible | `vite-plugin-pwa` → `workbox-build` → plugin → `deepmerge` | Npm propose de downgrader `vite-plugin-pwa` à `1.1.0`; examiner compatibilité Workbox/Vite d’abord. |
| `deepmerge` | faible | Transitif du plugin Rollup utilisé par Workbox; avis prototype poisoning | Même chaîne Vite PWA; pas de mise à jour destructive appliquée. |
| `glob` | modérée | `vite-plugin-pwa` → `workbox-build` → glob 11.x | Npm propose un downgrade du plugin PWA; pas appliqué. |
| `minimatch` | modérée | Transitif de glob dans la chaîne Workbox; plage vulnérable 7–11 | Examiner une résolution compatible via versions/transitives; aucun override risqué. |
| `vite-plugin-pwa` | modérée | Dépendance directe `^1.3.0`, avis via `workbox-build` | Npm suggère `1.1.0` (downgrade); conserver et documenter jusqu’à essai de compatibilité. |
| `workbox-build` | modérée | Dépendance de `vite-plugin-pwa`; chaînes glob/plugin vulnérables | Résoudre en testant une version/plugin compatible; pas de downgrade forcé. |

Les advisories transitifs identifiés incluent `GHSA-gcqx-w48m-w2h4` (deepmerge), `GHSA-67mh-4wv8-2f99` (esbuild), `GHSA-3g3m-2fjr-6pw4` (glob) et `GHSA-g3hv-75wg-m249` (minimatch). Le total de 10 correspond à 2 faibles, 8 modérées, 0 haute et 0 critique au moment du run. Aucun `npm audit fix --force` ni override transitif supplémentaire n’a été appliqué. Le résultat « 0 » ci-dessus ne concerne que l’audit des dépendances de production avec le seuil demandé.

### Vérification des routes API

`P0_API_ROUTE_INVENTORY.md` contient l’inventaire des **22 handlers** : 21 handlers métier/intégration bloqués et la route publique liveness `GET /api/health`. Le serveur local a été sondé directement : 112 combinaisons (16 chemins métier × GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) retournent 503; les variantes encodées/casse/chemins ne révèlent pas de données métier. Le healthcheck renvoie uniquement `{"status":"ok"}`; les méthodes autres que GET sont refusées. Les variantes `/%61pi/projects` et `/api%2Fprojects` tombent sur le fallback HTML SPA, sans réponse API ni données métier.

### Dossiers de transfert

- `DOSSIER_CLERK.md` : architecture cible d’authentification, middleware Express/JWT, sessions, permissions, webhooks, variables (noms seulement) et tests requis.
- `DOSSIER_NEON.md` : inventaire des 10 tables, liens et colonnes tenant, absence de RLS dans les fichiers suivis, écarts DDL/Drizzle/API, plan de migrations non appliqué et tests inter-organisations.

Ces trois documents sont des livrables techniques préparatoires; ils n’attestent aucune configuration ou intervention Clerk/Neon distante.

## 4. État Git et déploiement

- `main` observée : `edc44ceb6570f705f4edf591dfd95524838a1160`; base de la PR inchangée au moment de la vérification.
- La branche locale et `origin/arena/ea5046f1-truetco` ont été synchronisées avec les cinq commits déjà présents dans la PR, puis le commit P0 `44e03d09ca300bb05f5c0c58404d3c0917f238e3` a été créé et poussé sans force-push. Les cinq commits antérieurs sont préservés.
- PR #1 reste ouverte vers `main`; aucune fusion effectuée. La CI #43342522682 est verte sur le SHA P0. Après cette actualisation de rapport, il faut recontrôler la nouvelle tête et son workflow.
- `AUDIT_TECHNIQUE_TRUE_TCO_P0_1.md` a été expressément laissé non suivi et n’a pas été ajouté au commit; il s’agit d’un document d’audit de travail préexistant au commit de livraison, non nécessaire à la PR. Les livrables de transfert demandés sont les fichiers `DOSSIER_CLERK.md`, `DOSSIER_NEON.md` et `P0_API_ROUTE_INVENTORY.md`.
- Aucun déploiement de production, changement de base distante ou migration de production n’a été effectué. Le statut Vercel indique une limite de build sur le preview; l’état effectif Neon et production reste non vérifié.

## 5. Ce qui n’est pas fait — ne pas considérer comme terminé

1. **Identité/RBAC :** choisir/configurer un IdP réel; vérifier signatures, issuer/audience, session, expiration/révocation; implémenter les permissions par route et par action.
2. **Isolation tenant :** établir l’organisation depuis l’identité vérifiée côté serveur, cloisonner chaque objet, ajouter des contrôles DB/RLS et tester les accès croisés négatifs.
3. **Migrations et persistance :** réconcilier schéma Drizzle/SQL et handlers; migrations versionnées; API CRUD cohérente; transactions, erreurs visibles, sauvegarde/restauration et effacement démontrés.
4. **TCO/LCC :** le typecheck/build et les tests existants ne valident pas l’exactitude métier. Formaliser devise, unités, montants récurrents vs totaux, périodes, actualisation, carbone, risques et valeur résiduelle; confronter à des jeux de référence indépendants et faire valider par des spécialistes finance/achats/carbone.
5. **Rapports :** snapshots reproductibles, provenance par champ, versions de calcul et vérification des exports; ne pas déclarer conformité CSRD/ISO/GHG/eIDAS ou force probante sans preuves et revue appropriées.
6. **Production/CI :** exécuter la CI distante sur le SHA final; vérifier Vercel, Neon, secrets sans les exposer, sauvegardes/restaurations, logs, alertes, confidentialité/rétention et plan de retour arrière.

Les intégrations IdP, ERP, IA, signature et données réglementaires doivent rester indisponibles tant que leurs contrôles, prestataires et tests de staging ne sont pas en place.

## 6. Ordre de continuation

Conserver l’ordre convenu : **0 (clôture formelle par revue du diff) → identité/RBAC → isolation tenant → migrations et persistance → validation TCO/LCC → rapports → CI et contrôles de production.** Les résultats de tests locaux attestent uniquement le code local testé; ils ne constituent pas une homologation de sécurité ou une autorisation d’utiliser des données client.
