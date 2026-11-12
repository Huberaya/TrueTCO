# Chantier 0 — Réduction des faux résultats et des fausses garanties

**État :** corrections ciblées publiées dans une PR ouverte; tests locaux ciblés passés. Les résultats Vercel ci-dessous sont ceux du SHA `c0c8319e88e8449415049b9a6b5b6640b3b87139`, avant ce suivi documentaire. Aucun workflow CI applicatif n’apparaît sur la PR. Ce chantier n’est pas déclaré terminé.

## Identité de la modification

- Branche de travail Arena : `arena/ea5046f1-truetco` (branche imposée par la session; aucune autre branche n’a été créée).
- Branche de base : `main`.
- SHA de base vérifié avant modifications : `edc44ceb6570f705f4edf591dfd95524838a1160` — identique à `origin/main`.
- Commit de correction fonctionnelle : `19323a519bf626db62b386869039903a31d6d210`. Le commit suivant `c0c8319e88e8449415049b9a6b5b6640b3b87139` met à jour ce compte-rendu avec le résultat de revue hébergé; aucun code fonctionnel n’y est modifié.
- PR : [#1](https://github.com/Huberaya/TrueTCO/pull/1) — ouverte vers `main`, jamais fusionnée.
- L’audit existant `AUDIT_TECHNIQUE_TRUE_TCO_P0_1.md` est conservé non suivi dans le workspace et n’est volontairement pas inclus dans cette PR.

## Changements

### IA et documents

- Supprimé le parseur heuristique client et serveur qui fabriquait fournisseur, prix, quantités, empreintes et scores à partir de mots-clés.
- Le client refuse désormais une réponse autre qu’un résultat explicitement réussi; les erreurs ne produisent aucun objet d’offre.
- La route documentaire retourne HTTP 503 et indique que le document n’a pas été transmis. L’intégration Gemini/traitement externe est désactivée dans le serveur jusqu’à disponibilité de protections d’accès, consentement explicite et contrôles de traitement.
- Les exemples fournis dans l’interface sont explicitement annoncés comme fictifs/non vérifiés. Une extraction future est présentée comme non vérifiée et nécessitant une revue humaine; les valeurs ne sont plus converties en source « vérifiée ».

### CSRD / Taxonomie

- Remplacé les dépenses, activités alignées, émissions, prix carbone et économies codés en dur ainsi que l’attestation fictive par un état « données insuffisantes ».
- L’interface précise qu’elle ne constitue pas un rapport CSRD/ESRS, que les valeurs nulles ne signifient pas zéro émission/dépense et qu’aucune vérification indépendante n’est revendiquée.

### Signature et audit

- Le service ne réutilise plus les signatures en localStorage et ne produit plus de faux SHA-256, certificat, IP, horodatage ou identité préremplie.
- La signature locale est désactivée; l’interface expose seulement un brouillon non probant et explique l’absence de fournisseur de confiance, d’authentification et de registre sécurisé.
- Dans le journal d’événements, suppression de l’empreinte pseudo-cryptographique, du sceau prétendument immuable, du taux de conformité fictif et des libellés CAC/certifiés. L’export et les déclarations sont signalés comme non certifiés/non vérifiés.

### ERP

- Les endpoints de test, import et émission de commande répondent HTTP 503 tant qu’aucune intégration réelle n’est configurée.
- Suppression des imports et bons de commande simulés, des handshakes inventés et des compteurs/logs d’activité initiaux présentés comme réels.
- Les connecteurs d’exemple sont ramenés à l’état non connecté; les anciens statuts/compteurs locaux de succès ne sont plus affichés comme preuve d’activité.
- L’interface ne présente plus de latence fictive, de connectivité certifiée ou de commandes émises.

## Fichiers touchés

`server.ts`; `package.json`; `src/services/{aiParserService,csrdTaxonomyService,erpService,signatureService}.ts`; `src/components/{AiDocumentParserView,AuditLogView,CsrdTaxonomyView,DigitalSignatureView,ErpConnectorsView}.tsx`; `src/types/domain.ts`; tests `src/services/safetyP0.test.ts`.

## Preuves exécutées

- `npx --yes --package=tsx tsx --test src/services/safetyP0.test.ts` — **7 tests passés, 0 échec**. Couverture : refus IA sans fallback, absence de connecteurs/logs fictifs, erreurs ERP sans offre/PO synthétiques, reporting insuffisant sans activités/auditeur, signature sans hash ni signatures, endpoints serveur explicitement désactivés, absence de sceau pseudo-cryptographique de l’audit.
- `npx --yes --package=esbuild esbuild $(find src -type f \( -name '*.ts' -o -name '*.tsx' \) -print) server.ts --outdir=/tmp/true-tco-esbuild-check --format=esm --jsx=automatic` — transpilation syntaxique des sources et du serveur réussie. **Ce n’est ni un typecheck complet ni un build Vite/bundle de production.**
- `git diff --check` — aucun whitespace invalide.
- Une installation complète via npm n’a pas pu être réalisée : `npm install --no-save --ignore-scripts --package-lock=false` échoue sur conflit ERESOLVE entre Vite 8 (peer esbuild `^0.27.0 || ^0.28.0`) et la dépendance racine esbuild `^0.25.0`. En conséquence, `npm run lint` et `npm run build` ne sont pas annoncés comme réussis.
- Les vérifications d’interface, routes serveur et dépendances externes ne sont pas des tests E2E; aucun appel réel Gemini ou ERP n’a été exécuté.

## Services et CI — limites constatées

- Vercel : `list_teams` a répondu avec une liste vide. `list_projects` a échoué **Access denied**; aucun projet, déploiement, domaine ou paramètre non-secret n’a donc pu être inspecté. Aucune variable d’environnement/secrète n’a été lue.
- GitHub : PR [#1](https://github.com/Huberaya/TrueTCO/pull/1) ouverte vers `main`. Sur la tête PR `c0c8319e88e8449415049b9a6b5b6640b3b87139`, `gh pr checks 1 --watch --interval 10` a rendu `Vercel pass` et `Vercel Preview Comments pass`; aucun check `CI` n’était présent sur cette PR. Le dernier run CI observable reste un échec antérieur sur une autre branche/SHA (`integration/arena-plus-chantiers`, `a2663a32d57333dce1b9afa492e4743b9d70ac18`, run `39680635232`), sans valeur de verdict sur cette modification. Les checks Vercel passent via GitHub, mais le connecteur Vercel n’a pas pu lister le projet/déploiement (accès refusé), donc aucun contrôle indépendant de l’aperçu n’a été fait.
- Clerk et Neon n’ont pas été consultés. Aucun secret, aucune migration ni aucune opération de données n’a été exécuté.

## Critères encore bloquants

- Résoudre le conflit de dépendances avant de produire un build Vite et un typecheck complets.
- Publier la branche/PR et obtenir les résultats CI de son SHA exact.
- Faire vérifier dans Vercel les paramètres non secrets du bon projet/environnement avec des permissions valides.
- Une vraie intégration IA nécessite authentification/autorisation, consentement, minimisation/rétention, limites de taille et débit, gestion d’erreur, tests de non-fuite et revue de conformité. Elle reste désactivée.
- Les connecteurs ERP restent des exemples non opérationnels; un succès ne sera revendiqué qu’après une intégration fournisseur autorisée et des tests réels/non destructifs.
- CSRD, Taxonomie, audit probant, eIDAS/signature, Clerk et isolation Neon restent non prouvés. Aucune déclaration légale/réglementaire ou sécurité multi-tenant n’est validée par ces corrections.

## Décision

**GO limité** pour garder les fonctions trompeuses désactivées et soumettre les corrections au CI. **NO-GO** pour usage commercial reposant sur les documents IA, reporting réglementaire, signature/eIDAS, audit probant, connecteurs ERP, données clients ou déploiement production, tant que les critères bloquants ne sont pas vérifiés. Aucun déploiement, migration de production ou fusion sur `main` n’a été effectué.
