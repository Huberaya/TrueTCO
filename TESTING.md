# TrueTCO — Stratégie de tests

## Exécution

```bash
npm run typecheck     # TypeScript strict, zéro erreur exigée
npm run test          # suite complète (Vitest)
npm run test -- tests/isolation.spec.ts   # une suite ciblée
npm run build         # build de production
npm run verify        # typecheck + tests + build
```

## Ce que couvre chaque suite

| Fichier | Objet | Nombre |
|---|---|---|
| `src/engine/tcoEngine.spec.ts` | Non-régression du moteur : invariants (somme des flux nominaux = TCO, somme actualisée = LCC, pureté des entrées), baselines vérifiées | 27 |
| `src/engine/decisionReversal.spec.ts` | Inversion de décision : seuils atteignables, vocabulaire des zones, déterminisme | 9 |
| `src/engine/riskSimulation.spec.ts` | Simulation probabiliste : graine obligatoire, reproductibilité au bit près, quantiles (jamais « intervalle de confiance »), refus des lois mal paramétrées | 15 |
| `tests/isolation.spec.ts` | Cloisonnement multi-tenant sur PostgreSQL réel (RLS) : IDOR, UPDATE/DELETE croisés, jointures, échec fermé, audit immuable, sessions | 15 |
| `tests/api-security.spec.ts` | API complète : session, RBAC, transitions de statut, écriture transactionnelle, journal non forgeable, CSRF, parcours inscription/invitation | 37 |
| `tests/pg-adapter.spec.ts` | **Pilote de production** (`pg`) sur le protocole réseau PostgreSQL, exposé par PGlite en socket | 6 |
| `tests/import.spec.ts` | Import XLSX/CSV : détection, mapping, validation, refus d'inventer, traçabilité | 20 |
| `tests/decision.spec.ts` | Décision serveur : classement, seuil de fermeté, empreinte de fraîcheur, rejeu | 17 |
| `tests/parcours-api.spec.ts` | Parcours PME complet par HTTP (tests de réalité A, C, D, F), simulation et rejeu, configuration d'authentification déclarée | 18 |
| `tests/ui.spec.tsx` | Rendu des écrans (jsdom) : décision, import, journal, approbations, dossier décisionnel | 17 |

Total : **181 tests**. Les contrôles de compilation (`tsc --noEmit`), statiques
(`check:static`, 9 règles) et de taille de paquet (`bundle:check`) s'ajoutent à la suite.

## Moteur de test PostgreSQL

Les tests de base de données s'exécutent sur **PostgreSQL 18 réel** via PGlite
(moteur WASM officiel de PostgreSQL, avec RLS, `SET ROLE`, triggers et
transactions). Aucune imitation de base n'est utilisée : si une policy RLS est mal
écrite, le test échoue.

`tests/pg-adapter.spec.ts` va plus loin : il expose PGlite sur le **protocole
réseau** PostgreSQL et connecte le pilote `pg` de production, ce qui exerce
réellement `SET LOCAL ROLE`, `set_config`, le pool et la traduction d'erreurs.

## Ce que ces tests NE remplacent PAS

1. **Un test contre le PostgreSQL de l'environnement cible** (version serveur,
   extensions disponibles, `pgcrypto`, paramètres `ssl`, latence, comportement
   du pool sous charge). À exécuter une fois par environnement :
   `DATABASE_URL=... npm run db:migrate && DATABASE_URL=... npm run test`.
2. **Un test de navigateur** : les vues React ne sont pas encore couvertes par des
   tests d'interface (Playwright non installé). Les parcours vérifiés sont ceux
   de l'API.
3. **Un test de charge** : aucune mesure de performance n'a été produite à ce
   stade.
4. **Les tests d'IA et d'import** : sans objet, ces fonctionnalités n'existent pas.

## Règle de vérité des tests

Un test doit échouer quand la fonctionnalité manque. Le test `T-PG-00` applique
explicitement cette règle : si le socket PostgreSQL ne peut pas être ouvert, la
suite **échoue** avec un message indiquant que le pilote de production n'a pas
été vérifié, au lieu de « passer » silencieusement.


---

## Contrôles statiques (`npm run check:static`)

ESLint **ne peut pas être utilisé dans ce dépôt** : son moteur TypeScript
(`typescript-eslint` 8.x, dernière version publiée) refuse TypeScript 7 et
interrompt son chargement (`typescript-eslint does not support TS 7.0`). Plutôt
que d'afficher une étape « lint » qui ne vérifierait rien, `scripts/check-static-rules.mjs`
applique neuf règles vérifiables, chacune liée à un défaut réel :

| Règle | Ce qu'elle empêche |
| --- | --- |
| R1 | Bloc `catch` vide : une erreur avalée devient une panne silencieuse |
| R2 | `console.*` dans le serveur : la trace doit passer par la journalisation structurée |
| R3 | Tests neutralisés (`it.only`, `describe.skip`) : suite verte sans vérification |
| R4 | Lecture de fichiers d'utilisateurs par `xlsx` (avis de sécurité sans correctif) |
| R5 | Accès au stockage du navigateur depuis le serveur |
| R6 | Secrets en clair dans le code |
| R7 | Évaluation dynamique (`eval`, `new Function`) |
| R8 | Dépendance du serveur envers les composants d'interface |
| R9 | Revendication de certification ou de conformité dans l'interface (« ISO 27001 », « SOC 2 », « immuable », « certifié »…) sans preuve — négation reconnue, pour que « aucune certification n'est délivrée » reste possible |

Chaque exception doit être inscrite dans le script **avec sa raison** : il n'existe
pas de désactivation silencieuse.

## Journalisation et mesures

`server/observability.ts` remplace les `console.*` dispersés :

- une ligne = un objet JSON (`ts`, `level`, `event`, contexte) exploitable par un collecteur ;
- l'identifiant de corrélation renvoyé à l'utilisateur dans la réponse d'erreur permet de retrouver la trace exacte ;
- les champs sensibles (`password`, `token`, `authorization`, `cookie`, `secret`…) sont **masqués par liste de noms** ;
- `TRUETCO_LOG_LEVEL` (`debug`|`info`|`warn`|`error`) et `TRUETCO_LOG_SILENT` pilotent le volume ;
- `GET /api/metrics` (permission `platform:admin`) expose requêtes, erreurs, durée moyenne et maximale, top des routes. Ce n'est **pas** un exportateur Prometheus, et ce n'est pas présenté comme tel.

## Tests navigateur (Playwright)

`tests/e2e/` contient les parcours réels (PME, import, décision, reconnexion).
**Ils n'ont pas pu être exécutés dans l'environnement de développement initial** :
le téléchargement des navigateurs Playwright y est bloqué par le filtrage réseau
(`cdn.playwright.dev` injoignable). Ils sont donc câblés dans la tâche `e2e` de
l'intégration continue, où le téléchargement fonctionne, et exécutables sur toute
machine disposant d'un navigateur :

```bash
npm run test:e2e:server &      # API + PostgreSQL embarqué
npx playwright install chromium
npm run test:e2e
```

Ce qui **remplace** ces tests dans l'environnement actuel : `tests/ui.spec.tsx`
monte réellement les écrans dans un DOM (jsdom) et vérifie le rendu et les règles
d'honnêteté de l'affichage (import bloqué, recommandation « aucune », intégrité du
journal). Ce n'est pas équivalent à un navigateur complet — c'est dit ici.


---

## Parcours de bout en bout par HTTP (`tests/parcours-api.spec.ts`)

Ces 14 tests pilotent **l'application réelle par HTTP** : même serveur Express, mêmes
routes, mêmes contrôles d'accès, même base PostgreSQL et **mêmes politiques RLS que la
production**. Ils jouent le scénario complet d'une PME :

| Étape | Ce qui est vérifié |
| --- | --- |
| A1–A3 | inscription d'un organisme, connexion (session par **cookie HttpOnly**, aucun jeton dans le corps de la réponse), refus sans session, création du dossier |
| C | un fichier contenant un montant illisible (`dix-neuf mille`) est **refusé** ; la ligne fautive est désignée par son numéro ; une ligne sans montant est `MISSING` et **jamais** complétée par 0 € |
| C2 | correction du fichier, colonne non modélisée (« occurrences par an ») laissée **à trancher**, catégories inconnues **listées** (formation, assurance, frais de raccordement) ; arbitrage humain enregistré ; exclusion explicite d'une ligne ; import |
| D | provenance ligne à ligne : source du montant, numéro de ligne du fichier d'origine, marqueur d'import ; une valeur sans justificatif reste `unsourced` |
| F | décision calculée par le serveur, classée sur la VAN du coût complet, avec versions (moteur, méthode), point mort, sensibilité, inversion de décision et montants non sourcés **affichés** |
| F2 | rejeu de la décision depuis l'instantané : **résultat identique**, empreinte d'entrée SHA-256, information de fraîcheur |
| A4 | reconnexion depuis une **nouvelle session** : tout est retrouvé côté serveur, rien ne dépend du navigateur |
| F3 | journal d'audit : actions tracées, chaîne d'intégrité vérifiée, écriture par le client refusée (403) |
| Cloisonnement | un autre organisme ne voit aucun dossier, aucune offre, aucun lot d'import ; la décision d'autrui est refusée ; les données de la PME sont intactes |
| Sécurité | requête mutante sans origine → 403 `CSRF_ORIGIN_MISSING` ; origine tierce → 403 `CSRF_ORIGIN_DENIED` ; JSON malformé → 400 sans trace technique ; `/api/metrics` réservé à l'administration de la plateforme |

```bash
npx vitest run tests/parcours-api.spec.ts
```

### Défauts réels révélés par ce parcours (corrigés)

1. **Un arbitrage partiel effaçait tout le mapping d'import.** Tramer une seule
   colonne renvoyait un mapping réduit à cette colonne : les correspondances déjà
   proposées disparaissaient, toutes les colonnes redevenaient « non tranchées » et
   les douze lignes basculaient en erreur. Le mapping est désormais **fusionné** ;
   une correspondance ne se retire qu'avec une valeur vide explicite.
2. **Les lignes écartées par l'utilisateur n'apparaissaient pas dans le résultat de
   l'import.** La trace du lot ne disait donc pas qu'une ligne du fichier avait été
   laissée de côté — précisément ce qu'un auditeur cherche. Elles sont maintenant
   nommées dans `skippedRows`.
3. **Les libellés français accentués n'étaient pas reconnus** : « énergie » échouait
   là où « energie » était accepté, et la ligne bloquait l'import. La normalisation
   replie désormais les diacritiques (é→e, ç→c, ù→u) et les tirets, espaces et « & » —
   même mot, autre écriture, aucune correspondance inventée.
4. **Deux sources de vérité pour l'authentification de recette** : l'application
   autorisait la connexion pendant qu'une constante lue au chargement du module la
   refusait (réponse 501). Une seule décision désormais, transmise explicitement.
5. **Un corps JSON malformé renvoyait 500** (donc « panne du service ») au lieu de
   400 : la cause est côté client, la réponse le dit maintenant, sans message
   technique et avec l'identifiant de corrélation du journal.
6. **Le lot d'origine d'une offre n'était pas exposé** dans la liste des offres : la
   provenance existait en base mais restait invisible à l'écran. Elle est renvoyée.


---

## Simulation probabiliste du risque (Phase 3)

`src/engine/riskSimulation.spec.ts` (15 tests) vérifie des propriétés qui rendraient
l'outil dangereux si elles étaient fausses — et non « un chiffre qui a l'air
raisonnable » :

| Propriété | Pourquoi elle est critique |
| --- | --- |
| Même graine + mêmes entrées ⇒ quantiles identiques au bit près | Un résultat qui change à chaque exécution n'est pas auditable |
| Graine différente ⇒ tirage différent, mêmes ordres de grandeur | Une simulation instable serait inexploitable |
| Aucune variabilité déclarée ⇒ P10 = P50 = P90 et le rapport le DIT | Le produit ne fabrique jamais d'incertitude |
| Moyenne et dispersion d'une loi normale retrouvées par les tirages | Une loi mal implémentée fausserait toute probabilité |
| Une hausse de l'énergie renverse effectivement la conclusion | L'intérêt de l'outil : montrer ce que le classement ne voit pas |
| Matrice de corrélations contradictoire ⇒ refus explicite | Une hypothèse incohérente « réparée » en silence produit un faux résultat |
| Troncature respectée, horizon en années entières | Ce qui est affiché est ce qui a été calculé |
| Jamais « intervalle de confiance à X % » | Ce sont des quantiles SIMULÉS, pas une inférence statistique |

Le rejeu par l'API est couvert par les tests F4 et F5 de `tests/parcours-api.spec.ts` :
exécution, trace d'audit contenant la graine, relecture avec contrôle de fraîcheur,
rejeu strictement identique, refus d'une simulation sans graine, sans variable, à
corrélations contradictoires, à loi mal paramétrée, à paramètre inconnu, et
cloisonnement des simulations entre organisations.

## Écrans testés dans un DOM (`tests/ui.spec.tsx`)

Ces tests montent réellement les composants (jsdom) avec une API simulée. Ils portent
sur ce que l'utilisateur VOIT et sur ce qui PART vers le serveur :

- `T-UI-04` un import bloqué affiche les points à corriger et ne propose pas d'importer ;
- `T-UI-05` les lignes non sourcées restent visibles avec leur statut ;
- `T-UI-08` trancher une colonne n'envoie que la correspondance modifiée, et le
  ré-affichage vient de la réponse du serveur (jamais d'un calcul local optimiste) ;
- `T-UI-09` écarter une ligne est un acte explicite, transmis avec son motif, et
  l'import ne s'active qu'après accord du serveur ; le compte rendu nomme la ligne
  laissée de côté ;
- `T-UI-01` à `T-UI-03` côté décision : une recommandation « aucune » n'affiche pas de
  gagnant, un refus de droit est expliqué au lieu d'être contourné, une erreur serveur
  n'est jamais remplacée par un résultat local ;
- `T-UI-10` à `T-UI-14` côté approbations (écran qui a remplacé la « signature
  électronique ») : le cycle de vie et les approbations viennent du serveur ; l'écran
  démentit explicitement toute signature qualifiée ; sans motif écrit de 10 caractères
  rien n'est envoyé ; une approbation valide est enregistrée par l'API puis l'historique
  est relu ; un refus du serveur est affiché tel quel ; un rôle sans `project:write` ne
  peut pas faire avancer le dossier ;
- `T-UI-15` à `T-UI-17` côté dossier décisionnel : aucun signataire inventé ni badge
  « signé », l'absence d'approbation est écrite noir sur blanc, les approbations
  affichées sont celles du journal d'audit, et aucune transition ne part sans motif.

Ces tests ne remplacent pas un navigateur complet (voir la section Playwright
ci-dessus) : ils couvrent le rendu, les appels émis et les règles d'honnêteté de
l'affichage.
