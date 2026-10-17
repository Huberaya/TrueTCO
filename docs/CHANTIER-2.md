# Chantier 2 — Suppression des simulations et des allégations non fondées

Principe : **aucune fonction ne simule un résultat, aucune donnée n'est inventée, aucune conformité n'est affirmée sans fondement.**

## Supprimé (capacités qui n'existaient pas)
| Élément | Pourquoi |
|---|---|
| Connecteurs ERP (`/api/erp/*`, vue, service) | Renvoyaient « mTLS établie, jeton OAuth2 validé » sans aucune connexion, et une offre codée en dur. |
| Signature électronique « eIDAS » | Hachage 32 bits complété par une constante, signataires et autorité de certification fictifs. Aucune valeur juridique. |
| Rapport CSRD / Taxonomie | Montants et « alignement » codés en dur pour une entreprise fictive. |
| Visas « signés » du rapport Comex | 4 personnes nommées pré-signées ; n'importe quel utilisateur pouvait « signer ». |
| Sceau / « chaîne de hachage CAC » du journal | Hachage simulé présenté comme preuve pour commissaire aux comptes. |
| Formulaire de « visa » du journal | Permettait de choisir auteur, rôle (« CAC ») et identifiant : falsification d'identité par conception. |
| « Extraction de devis » de la modale d'import | Ignorait le texte collé ; renvoyait toujours la même offre (`verifiee`, 94 %). |
| Onglet CSV de la modale d'import | N'analysait pas le CSV (appelait la saisie manuelle avec ses valeurs par défaut). |
| Banc de tests « 7/7 » et rapport de clôture dans l'interface | Badge codé en dur. Les tests tournent en CI (`npm test`). |
| `src/db/*` (ancien schéma Drizzle / SQL) | Obsolètes et contradictoires avec `db/migrations/`. |

## Corrigé
- **Parser IA** (`server/ai.ts`) : l'IA *propose*, l'humain *dispose*. Chaque valeur cite un **extrait vérifié dans le document** (statut explicite : retrouvé / extrait introuvable / valeur absente de l'extrait). Plus aucune valeur par défaut (ni 24 mois, ni 90 %, ni « ADEME »), plus d'évaluation de risque ou de score technique par l'IA, contrôle arithmétique déterministe, détection d'injection de prompt, document > 60 000 caractères refusé (pas de troncature silencieuse). Indisponible ⇒ **503/502 explicite**, jamais de repli fictif. L'usage est tracé dans le journal (sans le contenu du document).
- **Revue humaine obligatoire** (`AiDocumentParserView`) : chaque valeur doit être confirmée ; fournisseur *référencé* choisi par l'utilisateur ; l'adéquation technique est saisie par l'utilisateur ; les valeurs validées sont marquées « fournies par l'utilisateur » avec le nom du document et de l'utilisateur.
- **Mode connecté = le serveur seul fait foi** : état initial vide, jamais de données de démonstration ni de `localStorage` métier (purgé à l'ouverture de session), rechargement après chaque écriture, erreurs visibles, vrai état vide.
- **Mode démo** : bandeau permanent « données fictives », aucun appel serveur, extraction IA indisponible.
- **Sauvegarde sans perte** (migration `003`) : l'objet complet est conservé dans `document` (JSONB) ; carbone, risques, durée de vie… survivent au rechargement.
- **Décalages frontend ⇄ base** qui faisaient échouer des enregistrements : statut `adjudique`, catégories `energie_kwh` / `recyclage`. Test de contrat ajouté.
- **Adjudication** : réservée côté serveur à l'admin et au directeur achats.
- **Valeurs inventées retirées** : nouveau fournisseur (`performanceScore: 88`, ESG 75, certifications « ISO 9001, ISO 14001, EcoVadis Gold » préremplies, `org-acme-fr`), provenances codées en dur (« Barème constructeur certifié » 92 %…), offre manuelle (risque inventé, score 85), organisation démo (« SecNumCloud », SIRET).
- **Export CSV du journal** : neutralisation de l'injection de formules.
- **Libellés** : plus de « Chantier N », « Section N », « certifié », « officiel », « ISO… conforme », de pastilles « Validé / Actif ».
- **Limites connues du moteur** affichées dans l'onglet « Formules et hypothèses » (LCC sans carbone, point mort linéaire, coefficients fixes, intervalle indicatif).

## Garde-fous automatiques (`npm test`)
`no-unfounded-claims` (termes interdits, identités fictives, capacités simulées, modules supprimés), `frontend-server-contract`, `ai-extraction` (injection de prompt, hallucination, absence de repli), `offer-import` (CSV réel, aucune donnée fabriquée). Vérifié par sabotage : 8 régressions réintroduites volontairement, 8 détectées.

## Déploiement
1. `npm run db:migrate` applique `003_entity_documents.sql` (colonnes `document`, statut `adjudique`, catégories de référentiel).
2. Variables : `GEMINI_API_KEY` (optionnel) et `GEMINI_MODEL` — **à vérifier chez Google** ; sans clé l'extraction est simplement indisponible.
3. **Confidentialité (RGPD)** : le texte soumis à l'extraction est transmis à Google. Inscrire Google comme sous-traitant, informer les utilisateurs (un avertissement est affiché dans l'interface) et vérifier les conditions de traitement du compte API utilisé.
4. Les offres enregistrées avant la migration `003` n'ont pas de `document` : elles ne sont pas affichées (incomplètes) mais restent en base.

## Limites assumées (chantiers suivants)
- Les **scores fournisseur** (ESG, performance, qualité) restent des nombres obligatoires saisis à la main ; le fournisseur « non évalué » exige un refactor transversal (50 usages, dont le moteur) → chantiers 4-5. L'indicateur « qualité des données » d'un nouveau fournisseur est désormais une **complétude de fiche** (part des champs renseignés), pas une mesure de fiabilité.
- Les **taux du simulateur d'Incoterms** sont des forfaits indicatifs non sourcés (libellé « indicatif »).
- Les **données de démonstration** (`seedData.ts`) contiennent des sources et certifications fictives ; elles ne s'affichent qu'en mode démo, sous bandeau.
- Le moteur TCO/LCC lui-même n'est pas modifié (chantier 4) ; ses tests historiques sont intégrés à la CI mais gardent leurs assertions larges.
- Pas de circuit de validation (visas, signatures) : à construire sérieusement (chantier 6), pas à simuler.
