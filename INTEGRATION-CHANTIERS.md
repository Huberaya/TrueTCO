# Intégration des chantiers 1-3 sur la branche `arena`

Cette branche (`integration/arena-plus-chantiers`) part de **`arena/4284c433-truetco`** et n'y ajoute que ce qui lui manquait.
**Rien de la branche `arena` n'est remplacé ni supprimé** (hors une phrase de `.env.example`, précisée). Barrière qualité complète
(`npm run quality`) : typage, 10 règles statiques, **546 tests** (198 existants + 348 ajoutés : 12 pont d'identité, 34 extraction IA, 302 contre-vérification du moteur), build, contrôle de taille de bundle.

## Pourquoi pas un `merge` des trois chantiers
Les chantiers 1-3 ont été réalisés à partir de `main`, en parallèle de la branche `arena`, qui traite les **mêmes défauts**
(authentification et isolation multi-tenant, journal d'audit, suppression des modules simulés, moteur de calcul, CI).
Fusionner les deux historiques aurait superposé deux implémentations concurrentes (`server.ts`, schéma, moteur, tests) : conflits massifs
et risque d'écraser l'un des deux. La comparaison a été faite sur pièces :

| Sujet | Verdict | Preuve |
|---|---|---|
| Moteur TCO/LCC | **Redondant, non porté.** Le moteur d'`arena` est correct. | Valeurs d'or calculées en Python + 300 cas aléatoires contre une référence indépendante : identiques (`tests/engine-oracle.spec.ts`). Un sabotage de l'actualisation est détecté (301 échecs). |
| Authentification, RLS, RBAC, audit chaîné | **Redondant, non porté.** Équivalent, et plus complet (audit chaîné, session opaque hachée, CSRF). | Lecture du code et des tests d'`arena`. |
| Suppression des modules simulés / allégations | **Redondant, non porté.** | `REMOVED-FEATURES.md`, règles statiques R1-R10. |
| Centre d'import, approbations, décision persistée, simulation de risque | **Propre à `arena`**, conservé tel quel. | — |
| Export Excel via la bibliothèque `xlsx` | Non porté : `arena` a écarté `xlsx` (faille connue). | Règle statique R4. |

## Ajouté (complémentaire)
1. **Connexion par fournisseur d'identité (Clerk)** — `server/auth/idp.ts`, branché sur `POST /api/auth/sso/login` (qui répondait 501).
   Le schéma d'`arena` était déjà prêt (`users.idp_provider/idp_subject`). Le modèle de session, les rôles et la RLS sont **inchangés** :
   après vérification, la même session que les autres modes est émise. Garanties : jeton vérifié cryptographiquement ; jamais de compte créé à la volée ;
   liaison uniquement par e-mail **vérifié** vers un utilisateur **actif** déjà provisionné ; rôle = celui de TrueTCO ; suspendu refusé ; e-mail partagé entre
   organisations → refus explicite (`organizationSlug`) ; jeton jamais accepté dans le corps. Sans `CLERK_SECRET_KEY` : comportement historique (501). 12 tests, 5 sabotages détectés.
2. **Extraction IA vérifiée** — `server/ai/extraction.ts`, route `POST /api/ai/extract` (qui répondait 501). L'IA *propose* : chaque valeur cite le passage du document qui la porte,
   **vérifié par le serveur** (retrouvé / extrait introuvable / valeur absente de l'extrait) ; aucune valeur par défaut ; pas d'évaluation de risque par l'IA ; contrôle arithmétique ;
   détection d'injection de prompt ; document > 60 000 caractères refusé ; tracé dans la chaîne d'audit sans le contenu ; quota 30/h/utilisateur. Rien n'est persisté.
   La permission `ai:extract` est accordée à `org_admin` et `procurement` (déjà titulaires de `import:write`) ; test de refus pour `viewer`, `finance`, `approver`. 34 tests.
3. **Contre-vérification indépendante du moteur** — `tests/engine-oracle.spec.ts` (302 tests) : référence naïve écrite à partir de la spécification, sans import du moteur.
   Périmètre : postes à convention sans ambiguïté (la maintenance et les remplacements sont exclus : leurs coefficients de vieillissement sont propres à chaque moteur).

## À décider / à faire avant d'activer
- **Clerk côté navigateur** : non branché. Votre CSP de production interdit les ressources tierces « sans décision explicite » ; l'écran de connexion Clerk demande d'autoriser ses domaines
  (script, connexion, frame). Le serveur est prêt et testé ; l'écran reste à faire une fois la CSP tranchée. Variables : `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES` (obligatoire en production).
- **IA côté interface** : la route existe, mais l'écran d'`arena` (`AiDocumentParserView`) appelle encore l'ancienne route `/api/ai/parse-document` (inexistante) et embarque des devis d'exemple
  au nom d'une **entreprise réelle avec un SIREN** (`SAMPLE_DOCUMENTS`). La suite logique est de brancher l'extraction sur l'**étape de validation du centre d'import** plutôt que sur un second pipeline.
- **RGPD** : le texte soumis à l'extraction est transmis à Google. Inscrire le sous-traitant et informer les utilisateurs. `GEMINI_MODEL` est configurable (défaut `gemini-2.5-flash`) : à vérifier chez Google.
- Limite : une identité fédérée ne se lie qu'à **un** utilisateur (index unique `idp_provider, idp_subject`) ; une personne présente dans deux organisations avec le même e-mail choisit l'organisation à la première connexion.

## Constats sur `arena` (non modifiés)
- `npm run lint` échoue : aucun fichier `eslint.config.*` (ESLint 9 l'exige). Antérieur à ces changements.
- `src/services/aiParserService.ts` et le service ERP restent présents côté navigateur (voir ci-dessus).
