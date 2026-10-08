# AUDIT INTÉGRAL TRUETCO — RAPPORT DÉCISIONNEL

**Dépôt audité :** `github.com/Huberaya/TrueTCO` — branche `main`, commit `edc44ce` (« feat(chantiers-9-10): Signature Electronique eIDAS certifiee et Reporting CSRD ESRS E1 & Taxonomie Verte UE »)
**Application déployée :** `https://truetco.vercel.app/`
**Date d'audit :** 8 octobre 2026
**Méthode :** lecture intégrale du code source (23 119 lignes TS/TSX), exécution réelle du moteur de calcul, exécution réelle du serveur, tests d'intrusion fonctionnels sur les API, reconstitution des données du jeu de démonstration, vérification externe des sources citées.
**Posture :** CTO SaaS B2B, Principal Engineer, PM senior, auditeur de logiciels financiers. Aucune complaisance : ce document recense ce qui ne fonctionne pas au moins aussi précisément que ce qui fonctionne.

---

## SYNTHÈSE DES VERDICTS

| Indicateur | Valeur |
|---|---|
| **WORLD-CLASS SCORE** | **38 / 100** — détail et méthode en section 17 *(22/100 avant les correctifs de cette passe)* |
| **Maturité produit** | **2 / 7** — prototype avancé, moteur de calcul solide, plateforme non industrialisée |
| **Verdict — Commercialisation** | **NON** |
| **Verdict — Enterprise Ready** | **NON** |
| **Verdict — World-Class** | **NON** |

### État retenu

# 🟠 MVP À TERMINER

**Justification en trois phrases.** TrueTCO contient un actif réel et rare — un moteur de TCO/LCC auditable (carbone monétarisé, risque P×I, point mort actualisé, sensibilité comparable, traçabilité ligne à ligne) qui, après les correctifs de cette passe, calcule correctement et de façon reproductible, et qui constitue la seule partie du produit qu'un DAF pourrait qualifier de défendable. Tout le reste de la promesse commerciale (SSO d'entreprise, connecteurs ERP, extraction IA de devis, signature eIDAS, reporting CSRD certifié, multi-tenant « hermetically scoped ») était, au moment de l'audit, soit absent, soit simulé, soit fabriqué — et une partie de ces fabrications produisait des montants et des attestations fausses présentées comme des données vérifiées. Après correction des fautes les plus graves (authentification serveur, isolation multi-tenant, suppression des fabrications), le produit n'est plus dangereux mais il reste très incomplet : il n'existe ni persistance serveur de confiance, ni import de données réel, ni gestion des utilisateurs, ni observabilité, ni facturation, ni documentation.

---

## 1. EXECUTIVE SUMMARY

### 1.1 Ce que TrueTCO est réellement

TrueTCO est une application web React 19 + TypeScript (Vite) avec un backend Express monofichier, un schéma PostgreSQL (Neon/Drizzle) et 16 écrans métier organisés en « chantiers ». Son cœur fonctionnel est un moteur de calcul de coût total de possession, instrumenté pour comparer une offre conventionnelle et une offre responsable en intégrant le carbone monétarisé, le risque probabilisé et l'actualisation financière. Le reste de l'application est une enveloppe produit : référentiel d'externalités, scénarios, sensibilité, point mort, comparaison multicritère, rapports imprimables, connecteurs ERP, analyse documentaire par IA, signature électronique, reporting CSRD.

### 1.2 Ce que l'audit a trouvé (avant correctifs)

**Trois défauts de niveau « incident majeur », chacun suffisant pour disqualifier commercialement le produit :**

1. **Aucune authentification, aucun cloisonnement multi-tenant.** Le serveur ne disposait d'aucun middleware d'authentification. L'organisation cible était déduite d'un en-tête HTTP (`x-tenant-id`), d'un paramètre de requête (`?tenantId=`) ou du corps de la requête, avant même de consulter une éventuelle session. N'importe quel appelant — sans compte, sans mot de passe, sans jeton — pouvait lire et écrire les projets, fournisseurs, offres, référentiels et journaux d'audit de n'importe quelle organisation. Le front, de son côté, ouvrait automatiquement une session « Sophie Valéry, Directrice des Achats @ acme.com » à chaque chargement de page, et proposait un sélecteur de rôle permettant d'endosser n'importe quel rôle, administrateur compris.

2. **Des données financières et des attestations fabriquées.** Trois sous-systèmes produisaient, sur la base de simples expressions régulières ou de constantes codées en dur, des données présentées comme issues d'une source officielle : l'extracteur documentaire (tout document contenant le mot « 50 » ou « véhicule » renvoyait un faux devis Renault Trucks de 3 850 000 € marqué « source vérifiée, confiance 98 % »), le module de signature (un « SHA-256 » qui n'en était pas un — un condensé 32 bits complété par une constante —, des certificats « ANSSI / CertEurope eIDAS QES » jamais délivrés, quatre signataires fictifs avec IP et numéros de série inventés), et le module CSRD (un rapport constant attribué à « PwC Audit & Sustainability » avec le statut « certifié sans réserve » et un visa « OTI-FR-2026-COFRAC-881 », alors qu'aucun tiers n'avait rien examiné). Les connecteurs ERP renvoyaient des latences aléatoires et des « TLS 1.3 / mTLS validé » sans qu'aucun appel réseau n'ait lieu.

3. **Des défauts de calcul qui peuvent inverser une décision d'achat.** Le coût complet affiché n'était pas actualisé tandis que le LCC l'était (bases non comparables) ; le carbone monétarisé était absent du coût nominal ; le point mort était calculé sur une épargne mensuelle non actualisée ignorant le WACC et la vraie dépense initiale ; l'analyse de sensibilité comparait des écarts calculés sur des indicateurs différents. Un arbitrage « électrique vs diesel » pouvait être présenté comme rentable alors qu'il ne l'était pas.

### 1.3 Ce que cette passe a corrigé (et vérifié)

Cette passe n'a pas produit de rapport sur étagère : les défauts les plus graves ont été corrigés dans le code, testés et vérifiés.

| Correctif | Preuve d'exécution |
|---|---|
| Authentification obligatoire sur toutes les API, session lue depuis un cookie HttpOnly, hachage SHA-256 des jetons en base | `401` sur `/api/projects`, `/api/suppliers`, `/api/audit-logs`, `/api/benchmarks`, `/api/tenants/current`, `/api/auth/me`, `/api/offers` (serveur réellement démarré) |
| Isolation multi-tenant : le tenant vient **exclusivement** de la session ; toute valeur contradictoire est rejetée en `403 TENANT_MISMATCH` ; `x-tenant-id` n'est plus une source de vérité | Vérifié à l'exécution, plus tests unitaires |
| Matrice RBAC de 8 rôles / 18 permissions appliquée côté serveur, y compris la règle « un rôle non privilégié ne peut pas s'attribuer un rôle d'admin » ; SSO de démonstration fermé par défaut (`501 IDP_NOT_CONFIGURED`) et interdit en production | `server/auth.ts`, contrôles par route |
| Suppression de toutes les fabrications : extracteur IA sans repli heuristique inventé, ERP en `501`, signature recalée sur un vrai SHA-256 conforme FIPS 180-4, module CSRD recalculé sur les données réelles et privé de toute mention d'audit | Recherche exhaustive : plus aucune identité, série, IP, visa ou auditeur fabriqués dans le code |
| Moteur de calcul : périmètre unique pour le nominal et l'actualisé, carbone et risque intégrés aux deux, point mort par croisement des flux actualisés, sensibilité sur une métrique unique, aucune perte silencieuse de poste de coût | 13/13 tests du moteur, 27/27 tests Vitest, invariants `Σ flux nominaux = TCO complet`, `Σ flux actualisés = LCC`, `Σ économique actualisé = economicLCC`, pureté des entrées |
| Schéma de base devenue cohérent avec le code (table `user_sessions`, colonnes `organizations.slug/domain`, `new_value`, occurrences pluriannuelles) | `schema.sql` idempotent + `schema.ts` Drizzle alignés |

### 1.4 Réponse à la question posée

> *Un Directeur Achats ou un DAF d'un grand groupe accepterait-il de payer plusieurs dizaines de milliers d'euros par an ?*

**Non — pas aujourd'hui, ni dans l'état où le produit était au début de l'audit, ni tout à fait dans son état actuel.** Le moteur de calcul justifie un pilote payant (de l'ordre de 5 000 à 15 000 € pour un audit d'arbitrage sur un dossier réel) parce qu'il produit une analyse d'arbitrage argumentée qu'un acheteur ne sait pas produire seul dans un tableur. Le produit en l'état ne justifie pas 800 à 2 500 € par mois en abonnement, pour quatre raisons vérifiables :

- **Il ne sait pas recevoir vos données.** Aucun import CSV/Excel/PDF exploitable, aucun connecteur ERP fonctionnel, aucune API d'ingestion. Les 9 offres de démonstration sont saisies à la main par le code. Un grand groupe ne saisira pas ses appels d'offres écran par écran.
- **Il ne sait pas garder vos données.** La persistance de référence est le `localStorage` du navigateur. La synchronisation PostgreSQL est une écriture en arrière-plan, silencieuse et sans contrôle d'accès (avant correction), sans file d'attente, sans idempotence, sans gestion d'erreur visible. Un DAF ne peut pas signer un arbitrage dont la trace vit dans le cache d'un navigateur.
- **Il ne sait pas qui a fait quoi.** Aucun fournisseur d'identité n'est branché (Clerk est une dépendance jamais montée, aucun OIDC/SAML), le rôle était choisi par le client, et le journal d'audit acceptait le nom et le rôle de l'utilisateur depuis le navigateur. Une piste d'audit non infalsifiable est inutilisable en comité des engagements.
- **Il affiche des choses fausses.** Des attestations d'audit ISAE 3000 attribuées à un tiers qui n'a jamais été mandaté, des certificats eIDAS qualifiés qui n'existent pas, des références réglementaires inventées (une « Commission Quinet » à 120 €/tCO2e avec 95 % de confiance). Dans une salle de comité d'investissement, un chiffre faux coûte plus cher que pas de chiffre.

### 1.5 Ce qui reste à faire pour devenir « The Economic Decision Engine »

Le chemin existe et il est chiffrable. Le produit possède trois atouts qu'aucun tableur ne réplique : (a) une méthodologie écrite et versionnée, exportable dans l'analyse de sensibilité et la traçabilité ; (b) un moteur déterministe testé qui refuse de perdre un poste de coût silencieusement ; (c) une architecture d'évaluation qui intègre les externalités et le risque dans le même flux actualisé que les coûts classiques. Ce sont les fondations d'un standard. Ce qui manque n'est pas une idée : c'est l'industrialisation — identité, persistance, ingestion, auditabilité, observabilité, facturation, documentation. Le plan des sections 25 et 26 décrit précisément comment y parvenir en 90 jours puis en 18 mois.

---

## 2. ÉTAT ACTUEL

### 2.1 Cartographie technique

| Élément | Réalité vérifiée |
|---|---|
| Frontend | React 19.0.1, TypeScript 7.0.2, Vite 8.3.4, Tailwind 4 via `@tailwindcss/vite`, PWA Workbox (autoUpdate), 31 composants, 16 écrans |
| Backend | Express 4.21.2, **un seul fichier** (1 090 lignes à l'origine), API REST `/api/*`, Vite en middleware en développement, fichiers statiques en production |
| Base de données | Neon PostgreSQL serverless (`@neondatabase/serverless`), Drizzle ORM 0.45.3, `drizzle-kit` pour `db:push`, script de migration maison `scripts/migrate-neon.mjs` (schéma + seed) |
| Persistance effective | `localStorage` (`truetco_projects_v1`, `truetco_offers_v1`, `truetco_suppliers_v1`, `truetco_benchmarks_v1`, `truetco_audit_logs_v1`, `truetco_signatures_v1`, `truetco_erp_connectors_v1`, `truetco_erp_logs_v1`) |
| Authentification | Aucune au moment de l'audit. Clerk présent dans `package.json` (`@clerk/clerk-react` 5.61.3) mais **jamais monté** : `main.tsx` instancie `AuthProvider` et `TenantProvider` maison, pas de `ClerkProvider`; le hook `useClerkNeonSync` existe et n'est utilisé nulle part |
| Tests | `src/engine/tcoEngine.test.ts` : 13 contrôles, exécutés côté navigateur uniquement, **aucun runner configuré** au moment de l'audit (`package.json` sans script `test`). Aujourd'hui : `vitest` 3.2.7 + 27 tests |
| CI/CD | **Aucun** (pas de répertoire `.github`, pas de pipeline déclaré) |
| Documentation | **Aucune** (pas de README, pas de documentation d'API, pas de manuel utilisateur) |
| Observabilité | **Aucune** (pas de Sentry, OpenTelemetry, pino, winston, ni même de log structuré côté client) |
| Internationalisation | **Aucune** (pas d'i18next/intl, chaînes françaises en dur, symboles € en dur) |
| Multi-devises | Champ `currency: string` dans les types, **aucune conversion de change** dans le code |
| Bibliothèques notables | `motion` (animations), `xlsx` (export Excel — 1 vulnérabilité haute sans correctif amont), `lucide-react`, `zod` |

### 2.2 État du dépôt

- **1 seul commit** (`edc44ce`), 60 fichiers suivis, 21 493 lignes au départ, provenance Google AI Studio (`metadata.json`), `package.json` initialement nommé `react-example` sans script de test ni de typecheck.
- **Vulnérabilités npm :** 5 (`xlsx` haute sans correctif, `esbuild`/`drizzle-kit` modérées, outils de développement uniquement). Correctif volontairement écarté : `npm audit fix --force` rétrograderait `drizzle-kit` de plusieurs versions majeures.
- **Divergences de schéma corrigées pendant l'audit :** `schema.sql` (appliqué réellement) et `schema.ts` (Drizzle) ne décrivaient pas la même base ; ni l'un ni l'autre ne définissait `user_sessions` (table nécessaire à toute authentification), `organizations.slug/domain`, ni `new_value` (le code écrivait `new_value`, Drizzle déclarait `newValue` — une synchronisation `drizzle-kit` aurait supprimé des données).
- **Contraintes `CHECK` incompatibles avec le produit :** `users.role` n'autorisait que 6 valeurs, sans `super_admin` ni `lecteur` ; `cost_items.source_type` n'autorisait que `('verifiee','calculee','estimee')` alors que le produit écrit `FOURNISSEUR_DEVIS`, `devis_fournisseur`, `source_externe`, `utilisateur`, `manquante` ; `carbon_items.scope` refusait `'Scope 3 - Amont'` (le format utilisé par l'application). **Conséquence : sur une base migrée normalement, chaque enregistrement d'offre, de poste de coût ou de donnée carbone échouait.** Le produit ne pouvait pas fonctionner sur sa propre base.

### 2.3 Taxonomie fonctionnelle (synthèse ; détail aux sections 4 à 10)

| Domaine | Implémenté | Partiel | Mock | UI only | Absent | Cassé |
|---|---|---|---|---|---|---|
| Moteur TCO/LCC/carbone/risque | ● | | | | | |
| Scénarios / sensibilité / point mort | ● | | | | | |
| Traçabilité & explicabilité ligne à ligne | ● | | | | | |
| Authentification / RBAC | ● *(corrigé lors de l'audit)* | | | | | |
| Isolation multi-tenant | ● *(corrigé lors de l'audit)* | | | | | |
| Persistance serveur de confiance | | ● | | | | |
| Import de données (CSV/Excel/PDF) | | | | | ● | |
| Connecteurs ERP | | | ● | ● | | |
| Extraction IA de devis | | | ● *(corrigé : plus de données fabriquées)* | | | |
| Signature électronique | | | ● *(recalé sur un SHA-256 réel, statut « non qualifiée »)* | | | |
| Reporting CSRD / Taxonomie | | ● *(recalculé sur données réelles)* | | | | |
| Journal d'audit | | ● | | | | |
| Notifications / e-mail / workflow | | | | | ● | |
| Facturation / quotas | | | | | ● | |
| Observabilité | | | | | ● | |
| Internationalisation / devises | | | | | ● | |

---

## 3. ARCHITECTURE

### 3.1 Architecture réelle vs architecture annoncée

L'architecture effective est celle d'un **monolithe front-first** : toute la logique métier vit dans le navigateur (`src/`, 20 000+ lignes), le serveur n'étant qu'un passe-plat PostgreSQL. Ce choix a une conséquence structurelle : l'application est fonctionnelle hors ligne et instantanée, mais **aucune règle de gestion n'est garantie côté serveur** — donc aucune ne peut être opposée à un auditeur, à un contrôleur interne ou à un client. Le serveur ne validait rien, ne contrôlait rien, ne journalisait rien.

### 3.2 Points forts

1. **Séparation moteur / présentation respectée.** `src/engine/tcoEngine.ts` est un module pur, sans dépendance React ni I/O. C'est la meilleure décision d'architecture du dépôt : elle rend le calcul testable, portable (Node, Edge, workser), et réutilisable en bibliothèque ou en API.
2. **Typage de domaine complet.** `src/types/domain.ts` (522 lignes) modélise coûts, carbone, risques, scénarios, traçabilité, avec des commentaires méthodologiques utiles.
3. **Méthodologie auto-documentée.** Le moteur expose `TCO_ENGINE_VERSION`, `TCO_METHODOLOGY`, `engineVersion` et `methodology` dans chaque résultat — condition indispensable pour rendre un calcul opposable.
4. **Rendu imprimable et export Excel existants**, ce qui évite de repartir de zéro pour le livrable DAF.

### 3.3 Points faibles structurels

1. **Pas de couche de service serveur.** Les routes API font des requêtes SQL inline, sans validation de schéma d'entrée, sans service métier partagé, sans transaction. Le même calcul TCO existe en double : dans le moteur TypeScript (front) et dans des agrégats stockés en base qui ne sont pas recalculés.
2. **Pas de séparation des privilèges.** Une seule identité de connexion à la base, un seul rôle PostgreSQL, aucune RLS (Row Level Security), aucun `SET LOCAL app.current_organization_id`. L'isolation repose entièrement sur le code applicatif : un `WHERE organization_id` oublié devient une fuite inter-clients.
3. **Aucune validation d'entrée côté serveur.** `zod` est présent mais utilisé uniquement côté client (validation du fichier de sauvegarde). Les charges utiles API arrivent brutes dans les requêtes SQL (paramétrées, donc pas d'injection, mais sans contrôle de type, de taille, de cohérence ni de plage de valeurs).
4. **Aucune transaction.** L'écriture d'une offre et de ses postes de coût, puis de l'entrée d'audit, s'effectue en appels séparés : une panne au milieu laisse une offre sans postes de coût, donc un TCO à zéro, sans trace d'erreur.

### 3.4 Architecture cible recommandée

```
[Client React]  ──HTTPS──>  [API Gateway / Edge: CORS, rate-limit, WAF]
                                  │
                    [API applicative Node/TS]  ← IdP OIDC (SSO), RBAC serveur
                       │            │
                       │            └──> [Moteur TCO en bibliothèque partagée]
                       │                 (une seule implémentation, versionnée)
                       │
                       ├──> [PostgreSQL + RLS, migrations versionnées, PITR]
                       ├──> [File d'attente (ingestion ERP/CSV, idempotente)]
                       ├──> [Coffre de secrets (KMS/Vault) pour les connecteurs]
                       ├──> [Stockage objet chiffré (PDF devis, pièces jointes)]
                       └──> [Observabilité: traces, métriques, journaux d'audit WORM]
```

Les règles non négociables de la cible :
- **Le calcul vit côté serveur** (ou dans une bibliothèque commune aux deux côtés), et tout résultat affiché porte sa version de moteur.
- **Toute écriture passe par une transaction** et une entrée d'audit dans la même unité de travail.
- **RLS activée** sur les 12 tables, avec le tenant imposé au niveau de la connexion.
- **Un seul moteur** : le front ne recalcule jamais un montant avec une formule parallèle.

---

## 4. FONCTIONNEL

### 4.1 Inventaire exhaustif des écrans (16 vues, 31 composants)

| Écran | Ce qu'il fait réellement | Classification |
|---|---|---|
| Tableau de bord (`DashboardView`) | KPI de portefeuille, synthèse par projet | IMPLEMENTED (données du jeu de démonstration) |
| Comparateur (`ComparatorView`) | Comparaison multi-offres, prix facial vs TCO complet, mise en avant de l'offre responsable | IMPLEMENTED |
| Analyse multicritère (`MulticriteriaView`) | Notation pondérée technique/ESG/économique | PARTIELLEMENT IMPLÉMENTÉ (pondérations figées, non paramétrables par l'utilisateur) |
| Point mort (`BreakEvenView`) | Courbes de croisement actualisées, mois d'atteinte | IMPLEMENTED *(corrigé durant l'audit)* |
| Scénarios (`ScenarioView`) | Pessimiste / central / optimiste relatifs aux hypothèses du projet | IMPLEMENTED |
| Sensibilité (`SensitivityView`) | Tornado sur Δ de VAN complète | IMPLEMENTED *(corrigé : métrique unique)* |
| Projets (`ProjectsView`, `NewProjectModal`) | Portefeuille de consultations | IMPLEMENTED (stockage navigateur) |
| Fournisseurs (`SuppliersView`, `AddSupplierModal`, `SupplierDetailModal`) | Référentiel, qualification ESG, taux de défaut | IMPLEMENTED (saisie manuelle) |
| Référentiel d'externalités (`ExternalitiesAdminView`) | Facteurs carbone/WACC/énergie, révisions justifiées | PARTIELLEMENT IMPLÉMENTÉ *(sources fabriquées supprimées ; traçabilité applicative uniquement)* |
| Journal d'audit (`AuditLogView`) | Consultation des modifications | PARTIELLEMENT IMPLÉMENTÉ (falsifiable côté navigateur à l'origine) |
| Rapport exécutif (`ExecutiveReportView`) | Sortie imprimable/PDF navigateur + export Excel | PARTIELLEMENT IMPLÉMENTÉ (aucun générateur de rapport côté serveur) |
| Connecteurs ERP (`ErpConnectorsView`) | Liste de connecteurs, tests, synchronisation | **MOCK + UI ONLY** (aucun adaptateur, aucune connexion) |
| Analyse documentaire (`AiDocumentParserView`) | Collage de texte → extraction structurée | **MOCK** (Gemini non configuré, modèle inexistant, repli heuristique fabriquant) |
| Signature / attestation (`DigitalSignatureView`) | Circuit de validation, empreinte, attestation imprimable | **MOCK** (aucune signature cryptographique, aucun certificat) |
| Reporting CSRD / Taxonomie (`CsrdTaxonomyView`) | Rapport de durabilité ESRS E1 + ratios taxonomie | **MOCK → PARTIELLEMENT IMPLÉMENTÉ** (recodé sur les données réelles, qualification réglementaire explicitement non réalisée) |
| Espace « Chantier 1 » (`Chantier1View`) | Vitrine méthodologique, banc de tests, formules, spécifications | PARTIELLEMENT IMPLÉMENTÉ (contenu de présentation) |

### 4.2 Parcours utilisateur réel (chronométré sur le code)

- **Créer un projet puis comparer deux offres :** l'utilisateur doit saisir manuellement le projet (12 champs), puis chaque offre, puis **chaque poste de coût un par un** dans un formulaire. Le jeu de démonstration contient 9 offres et un nombre équivalent de postes par offre ; un dossier réel de 6 offres à 15 postes représente **90 saisies de lignes** avant le premier calcul d'arbitrage.
- **« < 15 minutes pour une décision argumentée » : atteignable uniquement sur des données déjà présentes** (démonstration). Sur des données réelles, le temps est dominé par la saisie, faute d'import.
- **« < 60 secondes de compréhension pour une Direction » : non atteint.** Le rapport exécutif existe mais s'appuie sur `window.print()` ; il n'existe ni page de synthèse « une décision / trois chiffres / une recommandation », ni export PDF serveur, ni lien de partage en lecture seule.

### 4.3 Ce qui manque pour être vendable

1. Import de fichiers (CSV, XLSX, PDF de devis) avec prévisualisation et validation humaine des lignes proposées.
2. Duplication/dérivation d'offre (aujourd'hui on ressaisit tout).
3. Bibliothèque de modèles de coûts par catégorie d'achat (véhicule léger, poste de travail, groupe froid, flotte, IT).
4. Workflow d'approbation avec notifications (aucun e-mail dans le produit).
5. Verrouillage d'un dossier arbitré (aucun état « gelé » ; les 9 offres de démonstration restent modifiables indéfiniment).
6. Commentaires et pièces jointes par offre (aucun stockage de fichier).

---

## 5. TCO

### 5.1 Ce que le moteur fait correctement (vérifié par exécution)

- **Aucun poste de coût perdu silencieusement.** Une catégorie inconnue est comptée prudemment comme coût, remontée dans `warnings[]` en gravité critique, et `isComplete` passe à `false`. Test exécuté : 500 000 € comptés + avertissement émis.
- **Occurrences pluriannuelles honorées.** `isRecurringYearly`, `yearOccurrences` et l'alias `annualOccurrenceYears` sont traités ; une ligne récurrente n'est plus réduite à une seule année. Test exécuté : 39 000 €/an × 5 ans avec indexation = 216 263 €.
- **Périmètre unique nominal/actualisé.** `totalComprehensiveTCO` (nominal) et `lifecycleCostLCC` (actualisé) couvrent désormais le **même** périmètre : économique + risque + carbone monétarisé. Invariant vérifié sur le jeu de démonstration : `Σ flux nominaux = TCO complet`, `Σ flux actualisés = LCC`.
- **Valeur résiduelle non indexée.** Une valeur de reprise en euros courants n'est pas gonflée par l'inflation ; test exécuté : 100 000 € restent 100 000 €.
- **Traçabilité ligne à ligne.** Chaque poste produit une trace (`costLineTrace`) avec montant nominal cumulé, drapeau crédit/débit, catégorie, source et niveau de confiance. Identité vérifiée : `Σ coûts − Σ crédits = TCO économique nominal`.
- **Conventions explicitées.** La valeur résiduelle, produit encaissé en dernière année, ne réduit pas la dépense initiale du point mort — convention documentée et testée (dépense initiale réelle 360 000 € sur un cas de démonstration, contre 240 000 € en lecture naïve du seul prix facial).

### 5.2 Faiblesses restantes du moteur TCO

| Faiblesse | Impact | Classification |
|---|---|---|
| Heuristiques d'usure codées en dur (`+3 %/an` sur la maintenance après la 1ʳᵉ année, `+8 %/an` de pannes à partir de la 4ᵉ année) | Non paramétrables par le client ; non justifiées par une source | PARTIELLEMENT IMPLÉMENTÉ |
| Bornes de stress-test figées (énergie ×0,5/×2, carbone ×0,5/×2, pannes ×0,5/×1,8, WACC 2 %–8 %) | Utiles mais arbitraires ; doivent devenir des paramètres de politique de risque | PARTIELLEMENT IMPLÉMENTÉ |
| Enveloppe d'incertitude non statistique | Correctement étiquetée (`isStatisticalConfidenceInterval: false`), mais un utilisateur peut la lire comme un intervalle de confiance | PARTIELLEMENT IMPLÉMENTÉ |
| Aucune prise en compte de la fiscalité (amortissement, crédit d'impôt, TVA récupérable) | Un DAF compare un TCO hors fiscalité à un business case fiscalisé | ABSENT |
| Aucun coût du financement (loyers, location longue durée, leasing) modélisé comme flux de dette | Le comparatif CAPEX/OPEX le plus fréquent en flotte est incomplet | ABSENT |
| Aucune consolidation multi-devises | Un groupe européen ne peut pas agréger un dossier en GBP et un en EUR | ABSENT |
| Aucun test de non-régression sur les données d'entrée malformées au-delà des cas couverts | 27 tests seulement, aucun test de charge, aucun test E2E | PARTIELLEMENT IMPLÉMENTÉ |

### 5.3 Valeur pour le client

Un acheteur qui maîtrise déjà Excel peut reproduire un TCO simple. Ce qu'il ne peut pas reproduire, c'est : la traçabilité ligne à ligne versionnée, la séparation coût facial / coût complet / VAN, le point mort actualisé et le tornado de sensibilité **sur la même base**. C'est la valeur du moteur — et c'est réel.

---

## 6. LCC

### 6.1 État

Le LCC est implémenté comme Valeur Actuelle Nette au taux du projet (`discountRate`), avec facteur d'actualisation par année, flux ventilés (`capexNominalCost`, `opexNominalCost`, `riskNominalCost`, `carbonNominalCost`, `salvageNominalCost`) et cumul actualisé. `economicLCC` isole le périmètre économique hors risque et carbone, pour permettre une lecture « financière pure » sans casser la comparabilité.

### 6.2 Correctifs de cette passe

- **Incohérence de périmètre supprimée** : l'ancien `lifecycleCostLCC` actualisait un périmètre qui excluait le carbone alors que le TCO nominal l'incluait — les deux chiffres affichés côte à côte étaient incomparables.
- **Carbone intégré au nominal** : le coût carbone monétarisé apparaît désormais dans le flux de chaque année, avec indexation de la valeur du carbone.
- **Point mort recalculé** par recherche du croisement des courbes de coût cumulé actualisé (`method: 'discounted_cumulative_crossover'`), au lieu d'un rapport « surcoût initial / épargne mensuelle non actualisée ». Test exécuté : méthode actualisée retenue ; dépense initiale réelle 360 000 € prise en compte ; absence de rentabilité correctement annoncée (`finalDiscountedDelta −72 919 €`) ; sensibilité au taux vérifiée (0 % → 41 mois, 15 % → 60 mois). L'ancienne méthode ne subsiste qu'en repli documenté (`linear_undiscounted_legacy`) pour des résultats d'ancienne génération.
- **Sensibilité sur métrique unique** : tous les drivers sont désormais mesurés en Δ de VAN complète, avec un classement **relatif à l'échelle du dossier** (5 % de l'assiette = critique) au lieu de seuils absolus en euros qui classaient tout en « critique » sur un contrat de 100 M€ et tout en « faible » sur un contrat de 100 k€.

### 6.3 Ce qu'un Directeur Financier exigera et qui manque

1. **Le taux d'actualisation doit venir de la finance, pas d'un champ libre.** Il est aujourd'hui saisi dans le projet et versionné dans le résultat (bien), mais aucun référentiel de taux par entité/pays n'existe.
2. **Le coût du capital doit être auditable** : aucune trace du calcul (coût de la dette, bêta, prime de risque, structure cible).
3. **Les flux doivent être exportables** au format attendu par un contrôle de gestion (CSV annuel, échéancier, ventilation par nature comptable). L'export Excel existe mais il est mono-onglet et non documenté.
4. **L'inflation par nature de coût** n'est modélisée que pour l'énergie et le généraliste ; un DAF raisonne en indices différenciés (énergie, salaires, matières, transport).
5. **Aucun rapprochement budgétaire** (budget CAPEX/OPEX voté vs TCO calculé) : fonctionnalité attendue par tout contrôleur de gestion.

---

## 7. CARBONE & ESG

### 7.1 État vérifié

- **Modèle de données correct** : `carbonItems` avec périmètre (scope), phase de cycle de vie, émissions totales, facteur d'émission et source, niveau de confiance.
- **Monétarisation intégrée au flux économique** : émissions × prix du carbone du projet, indexées dans le temps, présentes dans le TCO nominal et le LCC.
- **Double comptage détecté et signalé** : un test vérifie qu'une ligne carbone déjà comptée en poste de coût économique ne l'est pas deux fois (avertissement).
- **Référentiel d'externalités** avec 10 attributs normatifs (nom, valeur, unité, source, URL, date, pays, méthode, intervalle, confiance) — c'est le bon gabarit.

### 7.2 Les fabrications trouvées (le point le plus grave du produit)

| Donnée présentée | Réalité vérifiée |
|---|---|
| « Valeur Tutélaire de l'Action Climat (Quinet) » = 120 €/tCO2e, source « Commission Quinet / France Stratégie », référence « Trajectoire 2026-2030 Actualisée », confiance **95 %** | La commission Quinet II (France Stratégie, 2019) recommande une trajectoire allant de 54 €/tCO2e (2018) à environ **250 €/tCO2e en 2030**. La publication « Trajectoire 2026-2030 Actualisée » n'existe pas. La valeur 120 €/t ne correspond à aucune publication, et était pourtant labellisée « Trajectoire officielle France » dans l'interface. |
| « WACC — Banque de France, Enquête taux de hurdle B2B 2026 » | Aucune enquête de ce type n'est publiée par la Banque de France. Le taux de rejet est une donnée interne par nature. |
| « Identifiant ADEME 27584 », « Identifiant ADEME 31201 » | Identifiants non vérifiables en l'état ; les ordres de grandeur (0,052–0,057 kgCO2e/kWh pour l'électricité, ~3,1 kgCO2e/L pour le gazole B7) sont en revanche plausibles. |
| Deux valeurs contradictoires pour le même facteur : 0,052 (`seedData.ts`) et 0,0571 (`seed.sql`) | Deux sources de vérité pour une même constante physique. |
| « 255 kgCO2e évités par machine reconditionnée » (référentiel) vs « Évitement carbone net audité : 352 kgCO2e par unité » (document d'exemple) | Contradiction interne, les deux présentées comme issues de l'ADEME. |

**Correctifs appliqués :** les cinq entrées du référentiel sont désormais marquées `isDemoHypothesis: true` avec un avertissement affiché dans l'interface, les identifiants non vérifiables sont remplacés par une mention explicite « millésime et identifiant à vérifier », la référence Quinet renvoie à la publication réelle avec sa valeur cible, la valeur WACC est présentée comme une hypothèse interne, les deux jeux de données SQL et TypeScript sont alignés à 0,052, et une migration neutralise les anciennes entrées déjà persistées dans le navigateur des utilisateurs. Une valeur d'externalité créée par l'utilisateur ne peut plus recevoir de référence documentaire générée automatiquement (`REF-2026-XXX` aléatoire supprimé).

### 7.3 Ce qui reste à construire

1. **Bibliothèque de facteurs livrée avec le produit** : électricité par pays et par millésime, carburants, matériaux, transport, avec identifiant de fiche et date de validité — et une procédure de mise à jour trimestrielle versionnée.
2. **ACV produit réelles** : import de FDES/EPD ou de déclarations PCF fournisseur, plutôt qu'un facteur générique par catégorie.
3. **Scope 3 catégorie par catégorie** (le produit ne distingue pas les 15 catégories du GHG Protocol).
4. **Trajectoire carbone alignée sur une norme** : l'indexation annuelle du prix du carbone doit suivre une trajectoire choisie et tracée (SBTi, AIE, Quinet), pas un pourcentage saisi.
5. **Restrictions d'usage** : le produit ne sait pas exprimer « ce chiffre est une estimation, pas une déclaration réglementaire publiable ». Un encart de qualification existe désormais dans le module CSRD ; il doit devenir un principe général de l'interface.
6. **Conformité CSRD réelle** : mapping ESRS E1, ESRS G1, EU Taxonomy (critères d'examen technique, DNSH, garanties minimales), export XBRL/ESEF, périmètre de consolidation groupe. Seule l'agrégation est aujourd'hui possible — et elle l'est désormais sur des données réelles.

---

## 8. RISQUE

### 8.1 État vérifié

Le risque est modélisé en probabilité × impact financier (`riskItems`), avec type de probabilité, note d'atténuation, source et niveau de confiance. L'exposition totale est annualisée uniformément sur l'horizon, intégrée au flux nominal et au flux actualisé de chaque année, donc comparable entre offres.

Tests exécutés : exposition de 10 000 € correctement intégrée sur un cas de démonstration ; le driver « fréquence de panne » produit un écart de VAN nul quand aucun poste de risque n'existe (comportement correct, pas un bug) et un écart significatif dans le cas inverse.

### 8.2 Limites

| Limite | Impact |
|---|---|
| Probabilités et impacts saisis à la main, sans historique ni distribution | Aucune défendabilité statistique ; c'est une évaluation experte, ce qui est acceptable **si c'est étiqueté comme telle** |
| Aucune corrélation entre risques | Un scénario de crise (grève, change, pénurie) ne peut pas être modélisé |
| Aucune simulation Monte-Carlo ni analyse probabiliste | Un DAF exige souvent une distribution, pas un point unique |
| Aucun registre de risques fournisseur (défaillance, sanction, litige) alimenté automatiquement | Le produit ne peut pas détecter qu'un fournisseur est en procédure collective |
| Aucun lien avec les pénalités contractuelles (retard, non-conformité) | Le risque opérationnel le plus fréquent dans un contrat d'achat n'est pas modélisé |
| L'exposition annuelle est étalée uniformément | Une panne concentrée en fin de vie est sous-estimée en VAN |

### 8.3 Points forts

- Le risque est **dans le même flux** que les coûts, donc non manipulable par un changement de base de comparaison.
- La traçabilité (`CostLineTrace`, `explanationNotes`, `confidenceLevel`) permet de contester un poste ligne à ligne — c'est exactement ce qu'un achèter opposera à un fournisseur.

---

## 9. DATA

### 9.1 Chaîne de données réelle

1. **Saisie navigateur** → état React (`App.tsx`) → `localStorage` (clés `truetco_*_v1`).
2. **Écriture PostgreSQL « en arrière-plan »** : chaque mutation déclenche un appel `fetch` non attendu (`NeonService.saveProject`, `saveOffer`, `saveAuditLog`, `saveSupplier`, `saveBenchmark`). Aucune gestion d'erreur visible : les échecs sont avalés par un `console.warn`.
3. **Lecture** : jamais depuis PostgreSQL. Toutes les vues lisent `localStorage` ou le seed. **La base est donc une copie morte** : écrire dans la base ne change rien à ce que voit l'utilisateur, et lire la base ne sert à rien.
4. **Clé de rapprochement fragile** : un identifiant de projet client (`proj-vul-50`) est mappé en dur sur l'UUID de la base de démonstration (`d0eebc99-…`), avec un cas particulier codé en dur.

### 9.2 Défauts de données identifiés

| Constat | Preuve | Gravité |
|---|---|---|
| Deux sources de vérité divergentes (démonstration Drizzle vs SQL appliqué) | `schema.ts` (380 l.) vs `schema.sql` (291 l. avant correction) | Critique |
| Contraintes `CHECK` incompatibles avec les données écrites par le produit | `cost_items.source_type`, `carbon_items.scope`, `users.role` | Critique |
| Colonne `new_value` déclarée `newValue` côté Drizzle | Tout `db:push` aurait proposé de supprimer la colonne | Critique |
| Table `user_sessions` absente des deux schémas | Authentification impossible | Critique |
| Colonnes `organizations.slug/domain/subscription_tier/data_residency` absentes | Les endpoints de tenant échouaient en production | Majeur |
| Agrégats TCO stockés en base (`economic_tco_nominal`, `lifecycle_cost_lcc`, `total_comprehensive_tco`) sans version de moteur | Un résultat figé sans numéro de version est inauditable | Majeur |
| Sauvegarde/restauration : seul mécanisme complet (`DataBackupModal` + `StorageService.parseBackupFile`) | Fonctionne, avec validation `zod` | Correct |
| Restauration d'une sauvegarde d'une autre organisation : aucune vérification | Le fichier porte un nom d'organisation mais la restauration ne le contrôle pas | Majeur |
| Export SQL de migration figé sur l'organisation `00000000-…-0001` / « Acme Group Europe » | Vestige de gabarit, présenté à l'utilisateur | Majeur |
| Aucune purge, aucune rétention, aucun droit à l'effacement | AUCUN registre de traitement RGPD, aucune politique de conservation | Majeur |

### 9.3 Éléments positifs à préserver

- **Modèle de domaine riche et documenté**, avec niveaux de confiance par valeur (`AuditedValue<T>`) — c'est la brique d'une qualité de données défendable.
- **Score de confiance pondéré par la matérialité** : une offre non sourcée obtient 2–4/100 et un avertissement critique « donnée manquante », au lieu du 75/100 par défaut flatteur de la version d'origine. Test exécuté : score 2/100 avec 98 % de données manquantes.
- **Validation de sauvegarde par schéma `zod`** : la seule barrière d'entrée correcte du produit.

### 9.4 Feuille de route data

1. **Faire de PostgreSQL la source de vérité** : lecture serveur, écriture serveur, `localStorage` réduit à un cache de session avec TTL.
2. **Migrations versionnées** (Drizzle `migrate`, pas `push`), rejouables, avec tests de schéma en CI.
3. **RLS PostgreSQL** activée avec `SET LOCAL app.current_organization_id`, et double contrôle applicatif.
4. **Horodatage et versionnage** : `created_at`, `updated_at`, `created_by`, `engine_version`, `computed_at`, et historique complet des révisions de valeurs (table `value_revisions`).
5. **Qualité de données outillée** : rapport de complétude par dossier, liste des valeurs non sourcées, plafond bloquant (par ex. interdiction de publier un rapport au-delà de 20 % de données non sourcées).
6. **RGPD** : registre de traitement, base légale, durées de conservation, droits d'accès/effacement, sous-traitants (Neon, hébergeur d'IA), analyse d'impact si données fournisseurs sensibles.

---

## 10. IA

### 10.1 Ce que l'IA faisait réellement (avant correctifs)

- **Modèle invoqué : `'gemini-3.8-flash'`** — nom qui ne correspond à aucun modèle publié. La configuration côté client était absente (pas de clé), donc l'appel échouait systématiquement en pratique.
- **Repli heuristique fabricant** : `parseLocalHeuristic` appliquait des expressions régulières au texte collé. Un texte contenant « 50 », « véhicule », « master » ou « renault » produisait un devis complet : fournisseur « Renault Trucks France SAS », SIREN « 954 506 077 », prix unitaire 77 000 €, total 3 850 000 €, ACV 640 tCO2e, **score de confiance 96/100**, et des postes marqués `sourceType: 'verifiee'` avec `confidenceLevel: 98` — c'est-à-dire présentés comme des données vérifiées.
- **Aucune validation humaine obligatoire** : le résultat était injectable dans le projet en un clic (`convertToSupplierOffer` → `onAddOffer`), sans écran de confirmation des montants.
- **Identifiants aléatoires** : références d'offre `DEV-AUTO-${Math.random()}` et identifiants de postes `c-${Math.random()}`.

### 10.2 Correctifs appliqués

- **Le repli fabricant est supprimé.** En l'absence de moteur d'extraction, le résultat porte `extractionStatus: 'unavailable'`, `requiresHumanInput: true`, `confidenceScore: 0`, des postes de coût vides et un message explicite ; le bouton d'injection est neutralisé.
- **Référence d'offre déterministe et traçable**, dérivée du nom de fichier et de la date, sans aléatoire.
- **Message d'erreur serveur remonté tel quel** (au lieu d'un chiffre inventé présenté comme un résultat).

### 10.3 Ce qu'il faudra construire pour une IA défendable

1. **Extraction avec provenance obligatoire** : chaque montant extrait doit pointer vers la page, la ligne et le libellé du document source (« pourquoi ce chiffre ? »).
2. **Double lecture et détection de contradiction** : deux passes indépendantes, signalement des écarts, note de confiance **calculée** (accord entre passes, qualité OCR, présence de mentions légales) et non déclarée par le modèle.
3. **Validation humaine bloquante** : aucune donnée financière extraite n'entre dans un calcul sans confirmation explicite d'un utilisateur identifié, avec enregistrement de la confirmation.
4. **Journal des versions de modèle** et de prompt, avec possibilité de rejouer une extraction passée.
5. **Non-régression** : jeu d'évaluation versionné (devis réels anonymisés) et seuils d'acceptation en CI.
6. **Coût et confidentialité** : politique explicite (aucun envoi de document client à un tiers sans accord contractuel), région d'hébergement, rétention nulle côté fournisseur.

### 10.4 Règle produit à inscrire au marbre

> **L'IA ne modifie jamais silencieusement une donnée financière.** Toute valeur produite par un modèle est une *proposition* : elle doit afficher sa provenance, sa confiance calculée, et exiger une validation humaine tracée avant d'entrer dans un calcul. Cette règle est désormais respectée par le code ; elle doit devenir un test automatisé permanent.

---

## 11. UX/UI

### 11.1 Ce qui fonctionne

- Interface dense mais lisible, cohérente visuellement (thème sombre, code couleur par chantier), typographie compacte adaptée à un usage analytique.
- Un écran d'explicabilité existe et est bien placé (`WhyThisAmountModal`) : c'est le bon réflexe produit, il doit devenir systématique (chaque chiffre cliquable).
- Sortie imprimable (`window.print()`) et export Excel présents.
- Indicateur hors-ligne et PWA installable.

### 11.2 Ce qui bloque un utilisateur professionnel

| Problème | Impact |
|---|---|
| Aucun import de fichier dans le parcours principal (un seul vrai lecteur de fichier : la restauration de sauvegarde) | Saisie manuelle intégrale |
| Aucun état vide guidé, aucun assistant de premier dossier | Un nouvel utilisateur arrive sur un jeu de démonstration et ne sait pas quoi en faire |
| Vocabulaire « Chantier 1 … Chantier 10 » exposé dans l'interface | Vocabulaire de projet interne présenté au client final |
| Mentions de certification et d'autorité dans l'interface (« eIDAS Qualifié QES », « certifié sans réserve », « Conforme aux standards d'audit financier ») | Détruit la confiance dès qu'un client vérifie *(corrigé durant l'audit)* |
| Aucune gestion du clavier au-delà du natif, quasiment aucun attribut ARIA (1 fichier sur 31) | Accessibilité non conforme (RGAA/WCAG AA) — bloquant pour un appel d'offres public |
| Aucun partage de lecture (lien, export PDF serveur) | Un rapport se transmet par impression papier ou capture d'écran |
| Aucun historique de navigation, aucun fil d'Ariane | Perte de contexte entre 16 écrans |
| Pas de recherche globale | Impossible de retrouver un dossier par référence |

### 11.3 Parcours cible « décision en moins de 15 minutes »

1. **Dépôt du dossier** : glisser-déposer des devis (PDF/XLSX) → extraction proposée, lignes à valider d'un coup d'œil, écarts signalés.
2. **Cadrage** : horizon, WACC (importé de la politique financière), trajectoire carbone, prix interne — 4 champs, pré-remplis et modifiables.
3. **Lecture** : un écran unique « Décision » — offre la moins chère, offre recommandée, écart en VAN, point mort, 3 risques principaux, 2 hypothèses critiques.
4. **Contestation** : chaque chiffre ouvre sa composition (poste, source, formule, version du moteur).
5. **Validation** : circuit d'approbation avec rôle, commentaire, horodatage serveur, et export du dossier de preuve.

### 11.4 Métriques UX à instrumenter

Temps de premier dossier créé, temps jusqu'au premier arbitrage, taux de valeurs validées sans correction, nombre de clics par poste de coût, taux d'abandon sur l'écran de saisie d'offre, temps d'ouverture d'un rapport par un membre de la Direction.

---

## 12. SÉCURITÉ

### 12.1 État initial (audit) — détail des vulnérabilités

| # | Vulnérabilité | Vérification |
|---|---|---|
| 1 | **IDOR / rupture d'isolation multi-tenant** : `resolveTenantId` acceptait `x-tenant-id`, `x-tenant-slug`, `?tenantId=`, `body.organizationId`, puis un Bearer, puis la première organisation active, puis un UUID codé en dur | Lecture du code + appels HTTP directs |
| 2 | **Aucune authentification** sur les 26 endpoints `/api/*` | Appels HTTP |
| 3 | **Auto-authentification du visiteur** : `AuthContext` créait une session « Sophie Valéry, directeur_achats » avec `ssoProvider: azure_ad` au chargement | Lecture + comportement navigateur |
| 4 | **Escalade de privilèges côté client** : `switchRole()` permettait d'endosser n'importe quel rôle, dont `admin` | Lecture du code |
| 5 | **Attribution de rôle par le client** : `/api/users/sync` et `/api/auth/sso/login` acceptaient un rôle arbitraire | Lecture du code |
| 6 | **SSO factice** : `/api/auth/sso/login` délivrait une session 24 h sur simple e-mail, sans IdP ni vérification | Lecture du code |
| 7 | **Jeton en `localStorage`** (`truetco_enterprise_sso_token`) : exfiltrable par toute injection XSS | Lecture du code |
| 8 | **Journal d'audit falsifiable** : `user_name`, `user_role`, `justification` fournis par le client | Lecture du code |
| 9 | **FK non validées** : `/api/offers` acceptait un `projectId` d'un autre tenant et un `supplierId` inexistant (le flux ERP envoie `'sup-erp-sync'`) | Lecture du code |
| 10 | **Aucun en-tête de sécurité**, aucune politique CORS, aucune limitation de débit, corps JSON accepté jusqu'à 10 Mo | Lecture du code |
| 11 | **Fuite d'informations** : `err.message` (erreurs PostgreSQL) renvoyé au client | Lecture du code |
| 12 | **Benchmarks écrits dans la mauvaise organisation** : `getOrganizationId()` appelé sans `req` retombait sur l'organisation par défaut | Lecture du code |
| 13 | **Bonne nouvelle** : aucun sink XSS (`dangerouslySetInnerHTML` absent), requêtes SQL paramétrées, pas d'injection SQL directe | Recherche exhaustive |

### 12.2 État après correctifs (vérifié à l'exécution)

- **Toutes les routes de données exigent une session** : `/api/projects`, `/api/suppliers`, `/api/audit-logs`, `/api/benchmarks`, `/api/tenants/current`, `/api/auth/me`, `/api/offers` renvoient `401` sans session (serveur réellement démarré et interrogé).
- **Le tenant vient exclusivement de la session** ; toute valeur contradictoire (`x-tenant-id`, `?tenantId`, `body.organizationId`) provoque `403 TENANT_MISMATCH` et une ligne de journal. Un `super_admin` peut cibler un autre tenant, avec traçabilité.
- **Jetons hachés SHA-256 en base** (`user_sessions.token_hash`), session transmise par **cookie HttpOnly / Secure (prod) / SameSite=Lax** ; plus aucun jeton dans `localStorage`.
- **Sessions de démonstration fermées par défaut** : `501 IDP_NOT_CONFIGURED` ; en production, le serveur **refuse de démarrer** si `TRUETCO_ALLOW_DEMO_AUTH=true`. Même en mode démonstration, le rôle demandé est restreint aux rôles non privilégiés et l'organisation est résolue par domaine e-mail (`403 ORG_NOT_PROVISIONED` sinon).
- **RBAC serveur** : 8 rôles, 18 permissions, contrôles par route (`project:write`, `benchmark:write`, `user:write`, `erp:sync`, `ai:parse`, etc.). Un rôle non privilégié ne peut pas modifier les rôles (`user:write` réservé à `admin`/`super_admin`).
- **En-têtes de sécurité** : `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, HSTS en production, CSP en production.
- **CORS explicite** (même origine par défaut, liste blanche par variable d'environnement), **limitation de débit** (globale 600 req/min, connexion 10/min, export/IA 20/min), corps JSON limité à 1 Mo.
- **Erreurs non fuyantes** : plus aucune erreur SQL renvoyée ; identifiant de corrélation par requête.
- **Contrôles d'appartenance** avant toute écriture d'offre (projet et fournisseur du tenant) ; benchmarks refusés sans source et sans référence documentaire (`SOURCE_REQUIRED`) ; entrées d'audit signées par la session.

### 12.3 Ce qui reste à faire en sécurité (exigences Enterprise)

| Exigence | État |
|---|---|
| Fournisseur d'identité réel (OIDC/SAML, MFA, provisioning SCIM) | **ABSENT** — à intégrer (le module d'authentification est prêt à recevoir un IdP) |
| RLS PostgreSQL | **ABSENT** |
| Chiffrement des secrets de connecteurs (KMS/Vault) | **ABSENT** (aucun secret réel n'est stocké aujourd'hui) |
| Rotation des sessions, révocation globale, détection d'anomalies | PARTIELLEMENT (révocation unitaire par `revoked_at`) |
| Journal d'audit inaltérable (append-only, WORM, horodatage) | **ABSENT** (table classique, pas de protection anti-altération) |
| Limitation de débit distribuée (Redis) | ABSENT (limitation en mémoire, à remplacer en multi-instances — documenté dans le code) |
| Analyse de vulnérabilités en CI (SAST, dépendances, secrets) | **ABSENT** |
| Test d'intrusion externe | **ABSENT** |
| Chiffrement au repos | À vérifier avec l'hébergeur (Neon : chiffrement géré, à contractualiser) |
| Réponse à incident, sauvegardes testées, PRA | **ABSENT** |
| Anthropie documents : ISO 27001, SOC 2, DPA, sous-traitants | **ABSENT** |

---

## 13. SCALABILITÉ & PERFORMANCE

### 13.1 Constats mesurés

- **Bundle :** 1 180 kB minifié (324 kB gzip) pour un seul fichier JavaScript, plus le service worker (1,24 Mo précachés). Avertissement Vite « chunks > 500 kB », aucune découpe de code (pas d'import dynamique). L'application charge 16 écrans même si l'utilisateur n'en ouvre qu'un.
- **Serveur :** aucune mise en cache, aucun regroupement de requêtes (« N+1 » implicite côté client : chaque mutation déclenche un appel séparé), aucune pagination sur `/api/audit-logs`, `/api/offers`, `/api/projects`. Une organisation avec 50 000 lignes d'audit est ingérable.
- **Limitation de débit en mémoire** : ne survit pas à un redémarrage et ne se partage pas entre instances (documenté dans `server/security.ts`).
- **Aucune file d'attente** : l'ingestion ERP ou un import volumineux bloquerait la requête HTTP.
- **Aucun index manquant identifié** sur les tables principales (les index composites `organization_id` + date existent), mais aucune mesure de plan d'exécution n'a été faite faute de base accessible.
- **Aucun test de charge, aucun profil mémoire, aucune mesure de latence p95.**

### 13.2 Scénarios de charge à valider avant commercialisation

| Scénario | Cible raisonnable | Réalité |
|---|---|---|
| 5 000 utilisateurs, 200 organisations, 100 k offres | p95 < 300 ms sur la liste de dossiers | Non mesuré, non instrumenté |
| Import de 500 lignes XLSX | < 10 s, asynchrone, reprise sur erreur | Impossible (pas d'import) |
| 10 000 lignes d'audit filtrées | p95 < 500 ms, pagination | Non paginé |
| Export d'un rapport 100 offres | < 5 s | Non mesuré |
| 50 requêtes d'extraction IA simultanées | Quota par organisation | Absent |

### 13.3 Plan de mise à l'échelle

1. Découpage du bundle par route, préchargement conditionnel, budget de performance en CI (`> 250 kB gzip` = échec).
2. Pagination et filtrage serveur sur toutes les collections.
3. Limitation de débit et sessions distribuées (Redis), file d'attente pour l'ingestion et les exports.
4. Cache de lecture (résultats de calcul immuables par `offer_id` + `engine_version`).
5. Budget de requêtes SQL par écran et tests de charge automatisés (k6 ou Artillery) exécutés avant chaque mise en production.
6. Observabilité : traces distribuées, métriques métier (dossiers créés, arbitrages finalisés), p95/p99 par endpoint, alerting.

---

## 14. ENTERPRISE

Exigences réellement vérifiées, en tant qu'acheteur d'un grand groupe :

| Exigence | État | Verdict |
|---|---|---|
| SSO (OIDC/SAML), MFA, SCIM | Aucun IdP branché | ❌ |
| RBAC serveur | 8 rôles, 18 permissions, appliqué | ✅ *(corrigé durant l'audit)* |
| Isolation multi-tenant prouvée | Serveur : oui ; base : pas de RLS | ⚠️ |
| Journal d'audit inaltérable | Table classique, horodatage serveur désormais | ⚠️ |
| Import de données | Absent | ❌ |
| Intégrations ERP / e-Procurement | Aucune | ❌ |
| API publique documentée (OpenAPI) | Absente | ❌ |
| Webhooks | Absents | ❌ |
| Sauvegardes / PRA / RTO-RPO documentés | Absents | ❌ |
| Résidence des données contractuelle | Champ `data_residency: 'EU-FRANCE-PARIS'` non adossé à un hébergement réel documenté | ⚠️ |
| Conformité RGPD (registre, DPA, droits) | Aucun artefact | ❌ |
| Accessibilité (RGAA/WCAG) | Non traitée | ❌ |
| Export de données (portabilité) | Sauvegarde JSON côté navigateur uniquement | ⚠️ |
| Site de confiance (status page, incident) | Absent | ❌ |
| Tarification et contractualisation (MSP, DPA, SLA) | Absent | ❌ |
| Formation, support, documentation | Absents | ❌ |
| Certifications (ISO 27001, SOC 2) | Aucune | ❌ |
| Analyse de sécurité tierce / pentest | Aucune | ❌ |

**Conclusion Enterprise :** 2 exigences satisfaites sur 18. Un grand groupe n'acceptera pas de déployer ce produit en production dans cet état, quelle que soit la qualité du moteur.

---

## 15. COMMERCIAL & MONÉTISATION

### 15.1 Positionnement proposé vs capacité réelle

Le positionnement envisagé — « The Economic Decision Engine for Responsible Procurement », TCO + LCC + Finance + ESG + Risk + Procurement + IA — est cohérent avec l'actif réel du produit (le moteur). Il est en revanche **aujourd'hui en avance de plusieurs années sur la capacité opérationnelle** : un positionnement se prouve par des intégrations, des références et une piste d'audit, pas par une page produit.

### 15.2 Grille tarifaire : ce qui est vendable maintenant

| Offre | Prix envisagé | Ce que le client reçoit réellement aujourd'hui | Verdict |
|---|---|---|---|
| Abonnement Starter 800 €/mois | 9 600 €/an | Comparateur TCO, scénarios, sensibilité, point mort, référentiel, 1 utilisateur, données locales | ⚠️ Vendable uniquement comme outil de pilotage individuel |
| Abonnement Pro 1 500 €/mois | 18 000 €/an | + multi-utilisateurs, RBAC, rapports | ❌ Bloqué par : pas d'import, pas de partage de lecture, pas de gestion d'équipe |
| Abonnement Enterprise 2 500 €/mois | 30 000 €/an | + SSO, ERP, CSRD, signature, SLA | ❌ Aucun de ces éléments n'est fonctionnel |
| Audit d'arbitrage 5 000 € | Unitaire | Analyse d'un dossier réel par un expert + rapport | ✅ Réalisable seulement si l'expert saisit les données (délai 1 à 2 jours par dossier) |

**La seule offre vendable immédiatement est l'audit unitaire accompagné par un expert.** Elle est rentable, elle génère des références, et elle finance l'industrialisation. Recommandation : vendre l'audit, pas l'abonnement, jusqu'à ce que l'import et la persistance serveur existent.

### 15.3 Ce qui manque pour justifier un abonnement

1. **Ingestion** (import fichiers, connecteurs) — sans elle, l'abonnement n'a pas de substance opérationnelle.
2. **Collaboration** (équipe, rôles, commentaires, partage de lecture) — c'est ce qui distingue un abonnement d'un tableur.
3. **Persistance et auditabilité serveur** — le socle de la confiance.
4. **Facturation** : aucune intégration de paiement, aucun quota, aucun compteur d'usage, aucun essai. Le champ `api_usage` existe en base (métrique) mais rien ne le remplit.
5. **Preuve de valeur** : aucune mesure d'économies générées. Un DAF achète un ROI démontré, pas une fonctionnalité. Il faut instrumenter « économies identifiées par dossier », « arbitrages inversés », « coûts évités par le carbone intégré ».

### 15.4 Go-to-market réaliste

1. **Phase 1 (0-3 mois) : 5 à 10 audits d'arbitrage payants** dans des secteurs où le TCO est déjà un réflexe (flottes, énergie, IT, équipements industriels), avec un rapport signé et un chiffrage des économies identifiées.
2. **Phase 2 (3-9 mois) : pilote d'abonnement Pro** avec 3 à 5 clients issus des audits, une fois l'import et la persistance livrés.
3. **Phase 3 (9-18 mois) : Enterprise** avec SSO, ERP, CSRD, SLA — vendu à des directions achats de plus de 50 acheteurs.
4. **Canal indirect** : cabinets d'audit et de conseil en achats, qui achètent le moteur comme outil de mission (licence multi-dossiers).

---

## 16. CONCURRENCE & MOAT

> ⚠️ **Méthode** : les éléments de cette section relèvent de la connaissance de marché et doivent être **revérifiés avant usage commercial** (positions, prix et périmètres produits évoluent). Aucune donnée chiffrée de concurrent n'est affirmée ici sans source vérifiable en main.

### 16.1 Paysage concurrentiel

Le produit se situe à l'intersection de quatre catégories, chacune tenue par des acteurs spécialisés :

| Catégorie | Acteurs représentatifs | Force | Faiblesse exploitable par TrueTCO |
|---|---|---|---|
| Suites Source-to-Pay (S2P) | SAP Ariba, Coupa, Ivalua, Jaggaer, GEP | Intégration ERP profonde, adoption massive, e-sourcing | Le TCO y est un champ, pas un moteur : pas de LCC actualisé multi-scénarios, pas de carbone monétarisé dans le même flux, pas de traçabilité ligne à ligne auditable |
| Notation ESG fournisseurs | EcoVadis, Sedex, Sustainalytics | Référentiels acceptés, réseau | Note ESG sans traduction monétaire : ne répond pas à « combien ça coûte ? » |
| ACV / carbone produit | Sphera, One Click LCA, Ecochain, Circular IQ | Rigueur ACV, bases de données de facteurs | Ne calculent pas la décision économique (CAPEX/OPEX/WACC/point mort) |
| Finance / décision | Lumivero (@RISK/DecisionTools), outils BI et tableurs | Modélisation probabiliste reconnue | Pas de modèle achats, pas de données fournisseurs, pas d'ESG intégré |

### 16.2 Où TrueTCO peut être réellement différenciant

1. **Le « même flux pour tout »** : coûts, risque, carbone et externalités dans une seule VAN, avec la même actualisation. C'est la proposition la plus difficile à répliquer pour un éditeur S2P, dont l'architecture sépare les modules.
2. **L'explicabilité opposable** : trace par poste, version de moteur, méthodologie exportée. Un acheteur peut contester une ligne, pas une boîte noire.
3. **La refus du chiffre facile** : un score de confiance pondéré par la matérialité qui tombe à 2/100 sur des données non sourcées est un **argument commercial** (« nous vous disons quand ne pas nous croire ») — à condition d'être irréprochable partout ailleurs, ce qui n'était pas le cas avant cette passe.
4. **Le coût du renoncement inversé** : la capacité à démontrer qu'une offre responsable *n'est pas* rentable, avec le chiffre exact du surcoût actualisé. C'est ce qui distingue un outil de décision d'un argumentaire RSE.

### 16.3 Le moat n'existe pas encore

Un moat se construit avec au moins un des éléments suivants. Aucun n'est présent aujourd'hui :

| Type de moat | État |
|---|---|
| Données propriétaires (benchmarks de coûts par catégorie, courbes d'apprentissage) | ❌ Aucune donnée propriétaire : les référentiels livrés sont des hypothèses publiques ou inventées |
| Effet de réseau (fournisseurs, bases partagées) | ❌ |
| Coûts de changement (workflows, historique, intégrations) | ❌ (aujourd'hui, un client qui part n'emporte rien) |
| Marque de confiance (références, certifications, publications méthodologiques) | ❌ |
| Avance technologique | ❌ (le moteur est solide, mais reproductible en 6 mois par un éditeur doté d'une équipe) |
| Communauté et écosystème | ❌ |

**Conclusion :** l'avantage actuel est un **actif logiciel**, pas un moat. Le moat le plus atteignable est celui des **données et de la méthodologie de référence** : devenir la source citée pour les facteurs de coût complets par catégorie d'achat (TCO de référence, publié, versionné, audité), avec une méthodologie ouverte et des publications datées. C'est un chemin de 18 à 24 mois, à condition de commencer à collecter ces données dès les premiers audits.

---

## 17. SCORE / 100

### 17.1 Méthode

Pondérations choisies selon ce qui détermine la décision d'achat d'un grand compte : la solidité du calcul (25 % au total avec l'explicabilité), la sécurité et l'isolation (23 %), la capacité à recevoir et conserver les données (18 %), puis le reste (UX, entreprise, exploitation, tests, IA). La note « avant correctifs » correspond à l'état du dépôt au début de cet audit.

| Critère | Poids | Avant | Après | Justification de la note après correctifs |
|---|---:|---:|---:|---|
| Moteur de calcul & méthodologie | 15 | 45 | **70** | Périmètres alignés, carbone/risque intégrés, point mort actualisé, invariants vérifiés (13 tests + 27 Vitest). Retrait : fiscalité, financement, multi-devises, heuristiques non paramétrables |
| Explicabilité & auditabilité | 10 | 55 | **60** | Traçabilité ligne à ligne, version de moteur, méthodologie exportée. Retrait : pas de journal d'audit inaltérable, pas de rejeu d'un calcul historique |
| Sécurité (auth, surface, secrets) | 15 | 12 | **45** | Auth obligatoire, RBAC serveur, cookies HttpOnly, en-têtes, rate-limit, erreurs non fuyantes. Retrait : aucun IdP, aucune RLS, aucun pentest, rate-limit en mémoire, aucune analyse de vulnérabilités en CI |
| Multi-tenant & gestion des rôles | 8 | 5 | **60** | Tenant issu de la session, `TENANT_MISMATCH`, 8 rôles / 18 permissions, promotion de rôle encadrée. Retrait : pas de provisioning (SCIM/invitations), pas d'écran d'administration des utilisateurs validé, pas de RLS |
| Data & persistance | 10 | 15 | **20** | Schémas SQL/Drizzle réalignés, `user_sessions` créée, contraintes `CHECK` corrigées, seed assaini. Retrait : `localStorage` reste la source de vérité, aucune migration versionnée, aucune rétention, aucun RGPD |
| Imports & intégrations | 8 | 3 | **3** | Inchangé : aucun import CSV/XLSX/PDF exploitable, aucun connecteur ERP |
| IA | 6 | 8 | **15** | Fabrications supprimées, provenance de référence, statistut « extraction indisponible » honnête. Retrait : aucune extraction fonctionnelle, aucun IdP de modèle, aucune évaluation |
| UX / parcours | 8 | 40 | **40** | Interface dense mais cohérente, écran d'explicabilité, impression. Retrait : saisie intégrale, accessibilité non traitée, vocabulaire interne, aucun partage |
| Enterprise readiness | 8 | 10 | **10** | Corrigé par la sécurité, mais : ni SSO, ni SLA, ni PRA, ni RGPD, ni documentation, ni support |
| Observabilité, perf, fiabilité | 6 | 10 | **10** | Inchangé : aucune trace, aucune métrique, aucun alerting ; bundle 1,18 Mo non découpé |
| Tests & CI | 6 | 5 | **30** | 40 tests de moteur (13 en application + 27 Vitest), invariants formalisés. Retrait : aucun test d'intégration API, aucun test de sécurité automatisé, aucun E2E, aucune CI |
| **TOTAL** | **100** | **22** | **38** | |

### 17.2 Lecture du score

- **38/100 signifie :** le produit a un cœur technique de qualité professionnelle posé sur une plateforme d'entreprise inexistante.
- **La progression +16 points en une passe** démontre que les déficits les plus graves étaient des défauts, pas des absences structurelles : l'authentification, l'isolation et l'honnêteté des données se rattrapent en semaines.
- **Les 62 points restants** sont, eux, du travail de construction : imports, persistance serveur, IdP, observabilité, documentation, exploitation.

### 17.3 Ce qui ferait passer le score au-dessus de 70/100

| Levier | Gain estimé |
|---|---|
| Import XLSX/CSV + persistance serveur transactionnelle + RLS | +14 |
| IdP OIDC/SAML + provisioning + journal d'audit inaltérable | +9 |
| Observabilité, CI complète, tests d'intégration et de charge | +8 |
| SSO/entreprise : PRA, SLA, RGPD, documentation, support | +8 |
| Extraction IA avec provenance et validation humaine bloquante | +5 |
| UX : assistant de premier dossier, partage de lecture, accessibilité | +6 |

---

## 18. MATRICE DES GAPS

| # | Domaine | État | Écart à combler | Criticité | Effort | Dépendance |
|---|---|---|---|---|---|---|
| 1 | Ingestion de données | ABSENT | Import XLSX/CSV avec mapping, prévisualisation, validation ligne à ligne ; parser PDF via service d'extraction | Bloquant | M (6-8 sem.) | Moteur (OK) |
| 2 | Persistance serveur | PARTIEL | PostgreSQL source de vérité, transactions, migrations versionnées, conflits, reprise | Bloquant | M (4-6 sem.) | IdP pour `created_by` |
| 3 | Identité d'entreprise | ABSENT | OIDC/SAML, MFA, invitations, SCIM, dé-provisionnement | Bloquant | M (4-6 sem.) | — |
| 4 | Isolation base | ABSENT | RLS + `SET LOCAL app.current_organization_id` + tests d'isolation automatisés | Bloquant | S (2 sem.) | Migrations |
| 5 | Auditabilité | PARTIEL | Journal append-only, horodatage serveur, hachage chaîné, export de preuve | Critique | S (2-3 sem.) | Persistance |
| 6 | Import de facteurs ESG sourcés | PARTIEL | Bibliothèque versionnée avec identifiants, dates, périmètres, procédure de mise à jour | Critique | M (4 sem.) | — |
| 7 | Fiscalité & financement | ABSENT | Amortissement, crédit d'impôt, TVA, leasing/dette, coût du capital documenté | Critique | M (4-5 sem.) | Moteur |
| 8 | Multi-devises | ABSENT | Devise de compte, taux datés, conversion à la clôture, arrondis | Majeur | S (2-3 sem.) | — |
| 9 | IA d'extraction | ABSENT (honnête) | Extraction avec provenance, confiance calculée, double passe, validation bloquante | Majeur | L (8-10 sem.) | Import, IdP |
| 10 | Intégrations ERP/e-Procurement | ABSENT | 1 connecteur réel d'abord (SAP Ariba **ou** Coupa), idempotent, journalisé, secrets en coffre | Majeur | L (10-14 sem.) | Persistance, IdP |
| 11 | Observabilité | ABSENT | Traces, métriques, logs structurés, alerting, tableau de bord d'exploitation | Majeur | S (2-3 sem.) | — |
| 12 | Tests & CI | PARTIEL | Tests d'intégration API, tests d'isolation, E2E des 3 parcours clés, CI bloquante, analyse de dépendances | Majeur | M (4 sem.) | — |
| 13 | UX de décision | PARTIEL | Écran « Décision », assistant de premier dossier, partage de lecture, accessibilité | Majeur | M (5-6 sem.) | Import |
| 14 | Rapports & exports | PARTIEL | Rendu PDF serveur, gabarits DAF/Direction, export XLSX multi-onglets documenté, dossier de preuve | Majeur | M (3-4 sem.) | Persistance |
| 15 | Collaboration | ABSENT | Commentaires, affectations, notifications e-mail, circuit d'approbation | Majeur | M (4-5 sem.) | IdP |
| 16 | RGPD & conformité | ABSENT | Registre, DPA, rétention, droits d'accès/effacement, résidence contractuelle | Bloquant | M (4 sem.) | Persistance |
| 17 | Facturation & quotas | ABSENT | Abonnements, essais, compteurs d'usage, dépassements | Majeur | M (3-4 sem.) | Persistance |
| 18 | Documentation | ABSENT | Manuel utilisateur, doc d'API (OpenAPI), méthodologie publiée, guide de déploiement | Majeur | S (2-3 sem.) | — |
| 19 | Performance | PARTIEL | Découpage du bundle, pagination, cache de lecture, tests de charge | Modéré | S (2-3 sem.) | Persistance |
| 20 | Scalabilité opérationnelle | PARTIEL | Rate-limit distribué, files d'attente, multi-instances, sauvegardes/PRA | Modéré | M (3-4 sem.) | Infra |

---

## 19. TOP 20 PROBLÈMES

Classés par gravité décroissante. Les problèmes 1 à 5 ont été corrigés dans cette passe ; ils restent listés car leur réapparition doit être empêchée par des tests.

| # | Problème | Preuve | Statut |
|---|---|---|---|
| 1 | **IDOR total** : l'organisation cible était fournie par le client (`x-tenant-id`, `?tenantId`, `body.organizationId`), avant toute session | `resolveTenantId()` dans le `server.ts` d'origine | ✅ Corrigé (403 `TENANT_MISMATCH`) |
| 2 | **Aucune authentification** sur les 26 endpoints de données | Appels HTTP directs réussis sans jeton | ✅ Corrigé (401 + IdP-ready) |
| 3 | **Données financières fabriquées présentées comme vérifiées** par l'extracteur IA (faux devis Renault 3 850 000 €, confiance 96-98, `sourceType: 'verifiee'`) | `parseLocalHeuristic()` (314 lignes) | ✅ Corrigé (extraction honnêtement indisponible) |
| 4 | **Attestation d'audit ISAE 3000 fabriquée** attribuée à « PwC / OTI Agréé Cofrac », visa « OTI-FR-2026-COFRAC-881 » | `csrdTaxonomyService` + onglet « auditor_memo » | ✅ Corrigé (aucune attestation, mentions supprimées) |
| 5 | **Signature eIDAS factice** : faux SHA-256 (32 bits + constante), certificats « ANSSI/CertEurope QES » inexistants, 4 signataires fictifs, IP et séries aléatoires | `signatureService.computeSha256()` | ✅ Corrigé (SHA-256 FIPS 180-4 réel, statut « non qualifiée », zéro identité inventée) |
| 6 | **Base de données inutilisable telle quelle** : contraintes `CHECK` refusant les valeurs écrites par le produit, `user_sessions` absente, `new_value` mal nommée | `schema.sql` vs `schema.ts` vs code applicatif | ✅ Corrigé (schéma idempotent aligné) |
| 7 | **Références réglementaires inventées** : « Commission Quinet » à 120 €/t (95 % de confiance), enquête BdF inexistante, identifiants ADEME non vérifiables | `seedData.ts` + `seed.sql` | ✅ Corrigé (hypothèses explicitement étiquetées, renvois aux publications réelles) |
| 8 | **Connecteurs ERP simulés présentés comme opérationnels** : latence aléatoire, « TLS 1.3 / OAuth2 validé », offre fabriquée à 3,76 M€, bon de commande à référence aléatoire | `erpService.ts`, `ErpConnectorsView` | ✅ Corrigé (501 explicites, maquette signalée) |
| 9 | **Moteur : bases de comparaison incohérentes** (nominal hors carbone vs actualisé incluant d'autres postes), perte silencieuse de postes, occurrences ignorées | Comparaison des agrégats | ✅ Corrigé (invariants testés) |
| 10 | **Point mort faux** (épargne non actualisée, dépense initiale erronée) pouvant présenter un projet non rentable comme rentable | `calculateBreakEven` d'origine | ✅ Corrigé (`discounted_cumulative_crossover`) |
| 11 | **Source de vérité dans le navigateur** : `localStorage` alimente toutes les vues, PostgreSQL n'est jamais relu | `App.tsx`, `storageService` | ❌ Ouvert (P0 produit) |
| 12 | **Aucun import de fichier exploitable** : un seul lecteur de fichier dans tout le produit (restauration de sauvegarde) | Recherche `FileReader` / parsers | ❌ Ouvert |
| 13 | **Piste d'audit falsifiable** (nom, rôle et justification fournis par le client) | `/api/audit-logs` d'origine | ✅ Corrigé côté serveur / ❌ reste à rendre inaltérable |
| 14 | **Aucun fournisseur d'identité** ; Clerk déclaré mais jamais monté | `package.json` vs `main.tsx` | ❌ Ouvert |
| 15 | **Escalade de privilèges côté client** : sélecteur de rôle permettant d'endosser `admin` | `AuthContext.switchRole` | ✅ Corrigé (sélecteur supprimé, rôle issu de la session) |
| 16 | **Aucun test d'intégration, de sécurité ni E2E ; aucune CI** | Absence de `.github`, de scripts | ❌ Ouvert |
| 17 | **Aucune observabilité** : ni traces, ni métriques, ni alerting ; erreurs avalées en `console.warn` | Recherche exhaustive | ❌ Ouvert |
| 18 | **Facture technique front** : 1,18 Mo en un seul fichier (324 kB gzip), 16 écrans chargés d'office, PWA précachant 1,24 Mo | Sortie de `npm run build` | ❌ Ouvert |
| 19 | **Accessibilité non traitée** : 1 fichier sur 31 utilise un attribut ARIA, aucun test WCAG | Recherche statistique | ❌ Ouvert |
| 20 | **Aucune documentation, aucun RGPD, aucune mesure d'exploitation** (ni SLA, ni PRA, ni support, ni statut de service) | Absence de README, de registre, de runbook | ❌ Ouvert |

---

## 20. TOP 20 OPPORTUNITÉS

Les estimations d'impact sont des ordres de grandeur à valider par le terrain, jamais des mesures d'un marché cité.

| # | Opportunité | Impact attendu | Effort | Priorité |
|---|---|---|---|---|
| 1 | **Import XLSX/CSV avec mapping assisté** : diviser par 10 le temps de constitution d'un dossier | Débloque l'abonnement ; passe d'un outil de démonstration à un outil opérationnel | M | P0 |
| 2 | **Persistance serveur transactionnelle + RLS** : le dossier devient un actif d'entreprise partageable et auditable | Condition de toute vente à un grand compte | M | P0 |
| 3 | **Rapport de décision DAF en PDF** (1 page : recommandation, VAN, point mort, hypothèses critiques, risques) | Ouvre l'accès à la Direction sans formation | S | P0 |
| 4 | **Bibliothèque de TCO de référence par catégorie d'achat**, publiée et versionnée | Première brique de moat (données) ; justifie un abonnement | L | P0 |
| 5 | **Audit d'arbitrage accompagné** (offre de service) | Revenu immédiat, références, collecte de données réelles | — | P0 |
| 6 | **Connecteur ERP réel (un seul, bien fait)** : SAP Ariba **ou** Coupa | Débloque l'Enterprise ; argument décisif en sourcing | L | P1 |
| 7 | **Extraction IA avec provenance et validation bloquante** | Réduit la saisie de 70 % sans introduire de risque | L | P1 |
| 8 | **Circuit d'approbation avec notifications** | Fait entrer le produit dans le processus achats | M | P1 |
| 9 | **Module fiscal & financement** (amortissement, leasing, coût du capital) | Rend le TCO aligné sur le langage de la DAF | M | P1 |
| 10 | **Multi-devises et multi-entités** | Ouvre les groupes internationaux | S | P1 |
| 11 | **Journal d'audit inaltérable + dossier de preuve exportable** | Lève l'objection « contrôle interne / audit » | S | P1 |
| 12 | **Détection d'inversion de décision** : signaler « la recommandation change si le WACC dépasse X % » | Fonctionnalité signature, très démonstrative en comité | S | P1 |
| 13 | **Benchmark interne anonymisé** : « votre dossier se situe au 3ᵉ quartile de coût complet » | Argument de rétention puissant, alimente le moat | L | P2 |
| 14 | **Mode « contestation fournisseur »** : export d'un dossier de justification ligne à ligne à envoyer à un fournisseur | Usage quotidien, différenciation S2P | M | P2 |
| 15 | **Analyse probabiliste (Monte-Carlo)** sur les principales variables | Répond à l'exigence DAF « donnez-moi une distribution » | M | P2 |
| 16 | **API publique + webhooks + OpenAPI** | Intégrations clients, écosystème, partenaires | M | P2 |
| 17 | **Accessibilité RGAA/WCAG AA** | Ouvre les marchés publics et les grands groupes à politique d'inclusion | M | P2 |
| 18 | **Publication de la méthodologie** (livre blanc daté, versionné, citable) | Autorité, référencement, génération de leads | S | P2 |
| 19 | **Canal cabinets d'audit/conseil** (licence multi-dossiers) | Distribution sans coût d'acquisition direct | S | P2 |
| 20 | **Métriques de valeur interne** (économies identifiées, arbitrages inversés, coûts évités) | Preuve de ROI pour le renouvellement | S | P1 |

---

## 21. À SUPPRIMER

| Élément | Raison | Action |
|---|---|---|
| Repli heuristique « intelligent » du parser documentaire | Fabrique des devis complets présentés comme vérifiés | **Supprimé** dans cette passe |
| Génération automatique de numéros de certificat, d'IP et de séries de signature | Simule une PKI inexistante | **Supprimé** |
| Attestation d'audit ISAE 3000 rédigée par le logiciel | Déclarait une revue par un tiers qui n'a jamais eu lieu | **Supprimé** |
| Référentiel d'externalités assorti d'identifiants ADEME non vérifiables et d'une « Commission Quinet » fabriquée | Fait passer une hypothèse pour une référence officielle | **Supprimé/requalifié** |
| Sélecteur de rôle dans l'interface | Laisse croire qu'un utilisateur choisit ses droits | **Supprimé** |
| Migration SQL figée sur l'organisation `00000000-…-0001` / « Acme Group Europe » | Vestige de gabarit livré à l'utilisateur | À supprimer du produit (les sauvegardes doivent porter l'organisation réelle) |
| Vocabulaire « Chantier 1…10 » dans l'interface client | Vocabulaire interne de projet | À remplacer par une navigation métier |
| Mentions « Conforme aux standards d'audit financier », « certifié sans réserve », « eIDAS Qualifié QES », « Norme Juridique » | Affirmations non démontrées | **Supprimées/rectifiées** |
| Dépendance Clerk (`@clerk/clerk-react`) | Déclarée, jamais utilisée ; surface d'attaque et confusion | À retirer ou à réellement monter |
| Dépendance `xlsx` en version vulnérable | Vulnérabilité haute sans correctif amont | À remplacer (ExcelJS) ou à isoler côté serveur |
| Champ « Point mort d'amortissement sous 3,2 ans » pré-rédigé dans les commentaires de signature | Affirmation chiffrée non calculée par le produit | **Retiré** |
| Textes de commentaire de signature pré-remplis portant un engagement juridique | Faisait signer un texte que l'utilisateur n'a pas écrit | **Vidé** |

---

## 22. À RECONSTRUIRE

| Sous-système | Pourquoi reconstruire plutôt que rafistoler |
|---|---|
| **Persistance** | `localStorage` comme source de vérité n'est pas réparable : il faut inverser le flux (serveur d'abord, cache ensuite), avec transactions, migrations et conflits. C'est un basculement, pas un correctif. |
| **Intégrations ERP** | Les « connecteurs » actuels sont des listes statiques. Il faut un socle d'intégration : adaptateurs par éditeur, file d'attente idempotente, coffre de secrets, journal de synchronisation serveur, tests de contrat. |
| **Extraction documentaire** | Le module doit être repensé autour de la provenance (page, ligne, montant, libellé) et de la validation humaine obligatoire, pas autour d'un remplissage de formulaire. |
| **Signature & scellement** | Remplacer par une intégration de prestataire qualifié (certificat + horodatage RFC 3161) ou par un simple circuit de validation interne **clairement nommé comme tel** — ce que fait désormais le code. |
| **Reporting CSRD** | Un vrai connecteur réglementaire demande : mapping ESRS/EU Taxonomy, critères d'examen technique par activité, DNSH, garanties minimales, périmètre de consolidation, export XBRL/ESEF. Le module actuel agrège correctement les données ; il ne qualifie rien. |
| **Journal d'audit** | Doit devenir append-only côté serveur, horodaté, chaîné (hachage de l'entrée précédente), exportable en dossier de preuve, avec horloge de confiance. |
| **Front (architecture)** | 16 écrans dans un seul bundle, état global dans le navigateur, double source de vérité : la cible est un front découpé par route, avec une couche de données serveur unique et un cache explicite. |

---

## 23. À AJOUTER

**Produit :** import XLSX/CSV/PDF avec mapping et validation ; assistant de premier dossier ; écran « Décision » unique ; partage de lecture ; commentaires et affectations ; verrouillage d'un dossier arbitré ; bibliothèque de modèles de coûts par catégorie d'achat ; comparaison budgétaire (budget voté vs TCO calculé) ; module fiscal et financement ; multi-devises ; analyse probabiliste ; détection d'inversion de décision ; benchmark interne anonymisé.

**Plateforme :** IdP OIDC/SAML + MFA + invitations/SCIM ; RLS PostgreSQL ; journal d'audit immuable ; observabilité complète ; files d'attente ; rate-limit distribué ; API publique + webhooks + OpenAPI ; facturation et quotas ; sauvegardes/PRA testés ; environnements séparés (développement, recette, production).

**Confiance & commercial :** registre RGPD + DPA + rétention ; page de statut ; documentation utilisateur et d'API ; méthodologie publiée et citable ; programme de sécurité (analyse de dépendances, SAST, pentest annuel) ; certifications visées (ISO 27001 en premier) ; métriques de valeur client dans l'interface.

**Qualité :** tests d'intégration API, tests d'isolation multi-tenant automatisés, E2E des parcours clés, tests de charge, CI bloquante avec budget de performance, jeu d'évaluation IA versionné.

---

## 24. TRUETCO MOAT

### 24.1 Diagnostic

Le moat actuel est **nul** au sens stratégique : aucun actif non copiable, aucune donnée propriétaire, aucun effet d'installation. Le moteur est bon mais reproductible : une équipe compétente reconstruirait sa logique en quelques mois à partir des principes publics (LCC ISO 15686-5, valeur tutélaire du carbone, P×I). Il faut donc construire délibérément un ou deux avantages durables, dans cet ordre.

### 24.2 Le moat le plus atteignable : la donnée de coût complet

Personne ne possède aujourd'hui de base de référence **publique, versionnée et auditable** des coûts complets par catégorie d'achat (acquisition, énergie, maintenance, fin de vie, carbone, risques typiques) sur le marché français et européen. Les cabinets produisent des études propriétaires ; les éditeurs S2P ne publient rien.

**Plan :**
1. À chaque audit vendu (section 15), capturer les postes de coût réels, anonymisés, avec leur catégorie et leur secteur.
2. Modéliser les distributions par catégorie (par exemple : coût énergétique annuel par véhicule utilitaire électrique, par région, par millésime).
3. Publier chaque trimestre un indice de référence daté, avec méthodologie et taille d'échantillon.
4. Alimenter le produit en valeurs par défaut sourcées : « valeur de référence du marché, échantillon n=412, mise à jour Q3 2026 ».
5. Effet cumulatif : plus d'audits → meilleures références → plus d'audits. C'est le seul cercle vertueux accessible à une structure de cette taille.

### 24.3 Le moat méthodologique : devenir la référence citable

- Publier la méthodologie complète (« Comment calculer le coût complet d'un achat responsable »), datée, versionnée, citable, avec les formules et les conventions (valeur résiduelle non indexée, périmètre unique nominal/actualisé, traitement du risque, trajectoire carbone).
- Rendre le calcul **rejouable** : chaque résultat porte une version de moteur et un jeu d'hypothèses exportable. Un tiers peut reproduire le chiffre — c'est exactement ce qu'un auditeur exige, et aucun concurrent ne l'offre aujourd'hui dans ce périmètre.
- Viser la citation : référentiels sectoriels, associations d'acheteurs, chaires universitaires, presse spécialisée.

### 24.4 Le moat d'installation

- **Dossier historique** : chaque année de données dans le produit rend le départ coûteux (comparaison pluriannuelle, trajectoire de décarbonation, benchmark interne).
- **Intégrations** : un connecteur ERP réel et un export comptable validé par la DAF sont deux points d'ancrage difficiles à retirer.
- **Processus** : une fois que le comité des engagements statue à partir du rapport TrueTCO, l'outil devient la norme interne (coût de changement politique, pas seulement technique).

### 24.5 Ce qui détruirait le moat

1. Publier des chiffres inexacts ou non sourcés (c'est ce que faisait le produit : une seule référence fabriquée suffit à ruiner une réputation de rigueur).
2. Laisser un client découvrir un écart entre la promesse et le code (un binaire faux détruit dix binaires justes).
3. Rester mono-pays, mono-devise, mono-langue au-delà de la phase pilote.
4. Ne pas instrumenter la valeur créée : sans preuve d'économies, l'abonnement est une dépense discrétionnaire, la première coupée en cas de tension budgétaire.

---

## 25. ROADMAP 30 / 60 / 90 JOURS

Hypothèse de moyens : 2 développeurs + 0,5 PM + accès à un expert achats. Les durées sont des estimations d'ingénierie, pas des engagements.

### Jours 1-30 — Rendre le produit honnête, sûr et démontrable

| Livrable | Critère d'acceptation |
|---|---|
| Socle d'authentification OIDC (un fournisseur), sessions serveur, invitations manuelles encadrées | Un utilisateur non invité ne peut pas entrer ; un utilisateur invité voit uniquement son organisation |
| RLS PostgreSQL activée sur les 12 tables + tests d'isolation automatisés en CI | Test : une organisation A ne peut lire/écrire aucune ligne de B, même avec une requête volontairement mal filtrée |
| Bascule de la source de vérité vers PostgreSQL (lecture + écriture), `localStorage` réduit à un cache avec TTL | Test : recharger la page sur un autre navigateur affiche les mêmes dossiers |
| Migrations versionnées (Drizzle `migrate`), procédure de retour arrière documentée | Migration rejouable sur une copie de production |
| Import XLSX/CSV d'offres avec mapping assisté et aperçu validé | Un dossier de 6 offres se constitue en moins de 20 minutes |
| Rapport PDF « Décision » en une page, généré côté serveur | Un membre de la Direction comprend la décision en moins de 60 secondes (test utilisateur sur 5 personnes) |
| Journal d'audit serveur horodaté, non modifiable depuis le client | Toute écriture produit une entrée liée à la session, impossible à altérer depuis le navigateur |
| CI complète : typecheck, tests moteur, tests API, tests d'isolation, analyse de dépendances, budget de bundle | La CI échoue sur toute régression, y compris une baisse de score de performance |
| Observabilité minimale : traces, logs structurés, métriques par endpoint, alerting sur erreurs 5xx | Une erreur en production est visible en moins de 2 minutes |
| Documentation : manuel utilisateur (30 pages) + OpenAPI + guide de déploiement | Un nouvel utilisateur réussit son premier dossier sans assistance |

**Porte de sortie du jour 30 :** le produit peut être montré à un client réel avec ses données, sans que rien ne soit faux.

### Jours 31-60 — Rendre le produit utilisable en équipe et vendable

| Livraison | Critère d'acceptation |
|---|---|
| Module fiscal & financement (amortissement, leasing, coût du capital, TVA) | Le TCO est réconcilié avec le business case financier sur 3 dossiers réels |
| Multi-devises avec taux datés et conversion documentée | Un dossier en GBP et un dossier en EUR s'agrègent dans un portefeuille |
| Circuit d'approbation + notifications e-mail | Un dossier passe de « en analyse » à « arbitré » avec 3 validations tracées |
| Verrouillage d'un dossier arbitré + révision versionnée | Toute modification après arbitrage crée une nouvelle version horodatée |
| Bibliothèque de facteurs ESG avec identifiants, dates, périmètres et procédure de mise à jour trimestrielle | Chaque valeur affichée pointe vers sa fiche source |
| Benchmark interne anonymisé (premier niveau) | L'utilisateur voit sa position par rapport à ses propres dossiers passés |
| Sécurité : pentest externe, corrections, politique de secrets (coffre), sauvegardes testées | Rapport de pentest sans vulnérabilité critique ou haute ouverte |
| RGPD : registre de traitement, DPA avec les sous-traitants, rétention, droits d'accès/effacement | Dossier de conformité complet revu par un juriste |
| Détection d'inversion de décision (« la recommandation change si… ») | Présent sur l'écran de décision, testé sur le jeu de démonstration |

**Porte de sortie du jour 60 :** 3 clients pilotes utilisent le produit sur leurs dossiers réels, en équipe, avec leurs données.

### Jours 61-90 — Rendre le produit Enterprise-compatible

| Livraison | Critère d'acceptation |
|---|---|
| Un connecteur ERP réel (SAP Ariba **ou** Coupa) : import de devis + export d'adjudication | Un cycle complet aller-retour validé dans l'environnement de recette d'un client |
| SSO d'entreprise complet (SAML/OIDC, MFA, SCIM) | Un client branche son annuaire sans intervention de l'éditeur |
| Accessibilité RGAA/WCAG AA sur les 5 écrans clés | Audit d'accessibilité sans non-conformité bloquante |
| Facturation, quotas, compteurs d'usage, essai | Un client peut souscrire et être facturé sans intervention manuelle |
| Performance : découpage du bundle, pagination, tests de charge au palier cible | p95 < 300 ms sur les parcours principaux au palier de charge défini |
| Extraction IA de devis avec provenance et validation bloquante (mise en service) | Zéro montant entrant dans un calcul sans validation humaine tracée |
| Dossier de preuve exportable (audit de dossier) | Un auditeur externe peut reconstituer l'historique complet d'un arbitrage |

**Porte de sortie du jour 90 :** le produit est vendable en abonnement Pro à un premier client, avec un dossier de conformité présentable.

---

## 26. ROADMAP WORLD-CLASS (6 à 24 mois)

### Mois 4-6 — Échelle et profondeur

- Multi-entités, consolidation groupe, périmètre de reporting (entité, pays, devise, centre de coût).
- Analyse probabiliste (Monte-Carlo) sur les variables critiques, avec distributions paramétrables et résultats exploitables en comité.
- Module CSRD réellement réglementaire : mapping ESRS E1/E2/G1, EU Taxonomy (critères techniques, DNSH, garanties minimales), export XBRL/ESEF, périmètre de consolidation.
- API publique versionnée, webhooks, SDK léger, bac à sable.
- Deuxième et troisième connecteurs ERP/e-Procurement (Ivalua, Jaggaer, Oracle, Workday).
- Bibliothèque de modèles de coûts pour 10 catégories d'achat majeures.

### Mois 7-12 — Autorité et écosystème

- Publication trimestrielle de l'indice TrueTCO du coût complet par catégorie (méthodologie ouverte, taille d'échantillon, intervalles).
- Référentiel de facteurs d'externalités multi-pays (électricité, carburants, fret, matériaux, eau, déchets) avec millésimes et identifiants.
- Programme partenaires (cabinets d'audit et de conseil achats) : licences multi-dossiers, espace client, co-branding.
- Certifications : ISO 27001, SOC 2 Type II, hébergement souverain documenté, DPA standardisés.
- Intégrations finance : export comptable validé par des DAF (plan comptable, imputation analytique, échéanciers).

### Mois 13-24 — Standard de marché

- **Standard ouvert de description d'un dossier d'arbitrage** (schéma JSON documenté) pour permettre l'échange entre outils et la rejouabilité des calculs par un tiers — c'est la brique qui transforme un logiciel en référence.
- Analyse prédictive : recommandation de stratégie d'achat (achat vs location vs reconditionné vs prolongation de durée de vie) fondée sur les distributions observées.
- Simulation de trajectoire carbone pluriannuelle avec contraintes budgétaires (optimisation sous contrainte).
- Marketplace de facteurs et de modèles sectoriels validés, éventuellement par des tiers accrédités.
- Présence institutionnelle : contributions aux groupes de travail achats/ESG, publications académiques, enseignement.
- Plateforme : multi-région, résidence des données par contrat, SLA 99,9 %, continuité testée publiquement.

### Ce que « world-class » signifie concrètement pour ce produit

1. Un DAF peut citer un chiffre TrueTCO dans une note interne **sans le revérifier**.
2. Un auditeur peut rejouer le calcul et retrouver exactement le même résultat, en connaissant la version du moteur et les hypothèses.
3. Le référentiel de coûts de TrueTCO est cité par des tiers — y compris par des concurrents.
4. Le produit s'installe dans un grand groupe en moins d'une semaine, avec l'annuaire, l'ERP et les politiques financières du client.
5. La valeur créée est mesurable et publiée : économies identifiées, coûts évités, décisions inversées.

---

## 27. CRITÈRES GO-TO-MARKET

### Critères bloquants (aucune vente en l'état tant qu'ils ne sont pas satisfaits)

| # | Critère | Statut actuel |
|---|---|---|
| 1 | Aucune donnée présentée comme officielle sans source vérifiable | ✅ Atteint (corrigé durant l'audit) |
| 2 | Aucune donnée financière produite par l'IA sans validation humaine tracée | ✅ Atteint (côté produit) — à couvrir par un test automatisé |
| 3 | Aucune attribution de rôle possible côté client | ✅ Atteint |
| 4 | Isolation multi-tenant vérifiée par test automatisé, base incluse | ⚠️ Partiel (serveur oui, RLS non) |
| 5 | Les données du client survivent au navigateur (persistance serveur) | ❌ Non atteint |
| 6 | Le client peut importer ses données sans ressaisie manuelle | ❌ Non atteint |
| 7 | Dossier RGPD complet (registre, DPA, rétention, droits) | ❌ Non atteint |
| 8 | Sauvegardes et restauration testées, procédure documentée | ❌ Non atteint |
| 9 | Un incident de production est détecté et diagnostiqué en < 15 min | ❌ Non atteint |
| 10 | Aucune affirmation de certification (eIDAS, ISAE, CSRD, ISO) non adossée à un tiers réel | ✅ Atteint |

### Critères de qualité (à tenir avant chaque mise en production)

- Typecheck sans erreur, tests moteur et tests API au vert, aucune régression de score de performance.
- Aucun mélange de périmètres dans les agrégats (invariants `Σ flux = total` vérifiés automatiquement).
- Toute valeur d'externalité porte une source, une date, un périmètre et un niveau de confiance.
- Aucune donnée de démonstration visible sans étiquette explicite.
- Revue de sécurité obligatoire pour toute nouvelle route API, avec test d'isolation.

### Critères de succès commercial (à mesurer dès la première vente)

| Indicateur | Cible raisonnable |
|---|---|
| Dossiers réels créés par client et par trimestre | ≥ 6 |
| Temps de constitution d'un dossier de 6 offres | < 20 min |
| Taux de valeurs sourcées sur un dossier publié | ≥ 80 % |
| Décisions inversées après analyse (preuve de valeur) | ≥ 1 par client par an |
| Économies identifiées | Mesurées et publiées au client |
| Renouvellement d'abonnement | ≥ 90 % (objectif après la 2ᵉ année) |
| Temps d'installation chez un client Enterprise | < 5 jours ouvrés |

---

## 28. CONCLUSION

### 28.1 Réponse aux trois questions

**Que vaut ce produit ?** Il vaut son moteur. C'est un actif rare : un calcul de coût complet qui refuse de perdre un poste silencieusement, qui met le carbone et le risque dans le même flux actualisé que les coûts, qui trace chaque euro et qui sait dire « je ne sais pas » quand une donnée n'est pas sourcée. Le reste — les écrans, les intégrations, les rapports — est une enveloppe inachevée, dont une partie était franchement dangereuse avant cette passe (données fabriquées, attestations attribuées à des tiers, isolation multi-tenant inexistante).

**Que faut-il faire maintenant ?** Trois choses, dans cet ordre. (1) **Vendre l'audit, pas l'abonnement** : 5 à 10 audits d'arbitrage à 5 000 €, accompagnés, sur des dossiers réels, pour produire des références et collecter la donnée de coût qui deviendra le moat. (2) **Livrer les 30 jours de la section 25** : identité, RLS, persistance serveur, import, rapport DAF, CI, observabilité, documentation. (3) **Tenir une ligne de fer sur l'honnêteté** : toute valeur affichée porte sa source, tout calcul porte sa version, toute donnée simulée porte son étiquette. C'est la seule ligne qui distingue, sur ce marché, un outil de décision d'un argumentaire.

**Est-ce que ça peut devenir la référence mondiale ?** La thèse est crédible, la position est bonne, l'actif est réel — et l'exécution est très en retard. « The Economic Decision Engine for Responsible Procurement » n'est pas une promesse marketing inaccessible : c'est un produit qui doit savoir ingérer, conserver, prouver et publier. Sur ces quatre verbes, TrueTCO n'est aujourd'hui solide sur aucun.

### 28.2 État retenu, avec justification

> ## 🟠 MVP À TERMINER
>
> **Pas encore 🟡 BÊTA COMMERCIALISABLE** parce qu'un client ne peut ni importer ses données, ni compter sur leur persistance, ni brancher son annuaire : les trois conditions minimales d'un usage réel en entreprise ne sont pas remplies.
>
> **Pas 🔴 PAS PRÊT** parce que le cœur du produit fonctionne réellement : le moteur calcule juste, il est testé, il est traçable, et les défauts qui rendaient le produit dangereux (fabrications, absence d'authentification, isolation inexistante, schéma inexploitable) ont été corrigés et vérifiés dans cette passe.
>
> **Le chemin vers 🟡 est court** (30 jours, section 25) ; **le chemin vers 🟢 et au-delà est un travail de construction** (90 jours puis 18 mois, section 26), et il est conditionné à une seule chose : ne plus jamais afficher un chiffre que le produit n'est pas capable de défendre.

### 28.3 Verdicts finaux

| Verdict | Réponse | Conditions minimales de passage à OUI |
|---|---|---|
| **Commercialisation** (abonnement) | **NON** | Import de données + persistance serveur + dossier RGPD + facturation = porte du jour 90 |
| **Enterprise Ready** | **NON** | SSO/MFA/SCIM + RLS + journal d'audit inaltérable + PRA testé + ISO 27001 engagée = mois 6 à 12 |
| **World-Class** | **NON** | Référentiel de coûts publié et cité + rejouabilité par un tiers + installation autonome chez un grand compte = mois 18 à 24 |
| **Audit d'arbitrage vendable** | **OUI** | Immédiatement, sous supervision experte et avec la méthodologie publiée |

---

## ANNEXE A — MATRICE DE MATURITÉ (7 NIVEAUX)

| Niveau | Définition | TrueTCO |
|---|---|---|
| 1 | Prototype non fonctionnel | Dépassé |
| **2** | **MVP partiel : cœur fonctionnel, périphérie absente ou simulée** | **← position actuelle** |
| 3 | MVP complet : utilisable de bout en bout sur des données réelles | Objectif J+90 |
| 4 | Bêta commercialisable : premiers clients payants, support, documentation | Objectif M+6 |
| 5 | Prêt pour les premiers clients grands comptes : SSO, RLS, auditabilité, SLA | Objectif M+9 |
| 6 | Enterprise Ready : certifications, PRA, conformité, intégrations | Objectif M+12/18 |
| 7 | World-Class : référence citée, standard de fait, écosystème | Objectif M+24 |

**Position détaillée par dimension :**

| Dimension | Niveau (0-7) |
|---|---|
| Moteur de calcul | 5 |
| Explicabilité | 4 |
| Qualité des données | 2 |
| Sécurité applicative | 3 |
| Isolation multi-tenant | 3 |
| Persistance | 1 |
| Ingestion | 0 |
| Intégrations | 0 |
| IA | 1 |
| UX / parcours | 2 |
| Enterprise | 1 |
| Observabilité | 0 |
| Tests & CI | 3 |
| Documentation | 0 |
| Monetisation | 0 |

---

## ANNEXE B — CORRECTIFS APPLIQUÉS PENDANT CET AUDIT

Chaque correctif a été vérifié par compilation TypeScript, par exécution des tests et, lorsque cela était possible, par exécution réelle du serveur.

### B.1 Sécurité & multi-tenant

- `server/security.ts` : en-têtes de sécurité, CSP de production, limitation de débit à fenêtre glissante, identifiant de corrélation par requête, gestionnaire d'erreurs qui ne fuit aucune erreur interne, cookie de session `HttpOnly`/`Secure`/`SameSite=Lax`.
- `server/auth.ts` : 8 rôles, matrice de 18 permissions appliquée côté serveur, hachage SHA-256 des jetons, résolution de session par jointure `user_sessions`/`users`/`organizations`, rejet `403 TENANT_MISMATCH`, extraction du jeton par cookie **ou** en-tête `Bearer`.
- `server/routes.ts` (921 lignes) : 23 routes couvrant santé, authentification, tenants, projets, offres, fournisseurs, benchmarks, journal d'audit, ERP (501 par défaut, données synthétiques étiquetées uniquement si activation explicite), extraction IA (503 sans clé, sans repli inventé).
- `server.ts` : amorçage unique (Vite en développement, statique en production), CORS explicite, refus de démarrage en production si l'authentification de démonstration est activée.
- Vérifications à l'exécution : `401` sur tous les endpoints de données sans session ; en-têtes de sécurité présents ; login de démonstration refusé sans base/IdP.

### B.2 Base de données

- `src/db/schema.sql` réécrit (idempotent, exécutable sur une base existante) : table `user_sessions`, colonnes `organizations.slug/domain/subscription_tier/data_residency/is_active`, `cost_items.year_occurrences`, `supplier_offers.engine_version`, `audit_logs.correlation_id`, `reference_benchmarks` enrichie (URL, référence documentaire, méthodologie, périmètre, intervalle), table `api_usage`.
- Contraintes `CHECK` réalignées sur les valeurs réellement écrites par le produit (`users.role`, `cost_items.source_type`, `carbon_items.scope`, `projects.status`).
- `src/db/schema.ts` aligné sur le SQL, y compris `newValue` → `new_value` (divergence qui aurait détruit une colonne lors d'un `db:push`).
- `src/db/seed.sql` : organisation avec `slug`/`domain`, référentiel d'externalités assaini (plus d'identifiant ADEME non vérifiable, plus de « Quinet à 120 €/t »), agrégats de résultats laissés nuls (les colonnes de résultats ne doivent pas devenir une seconde source de vérité).

### B.3 Moteur de calcul

- Un seul chemin d'agrégation par vecteurs annuels ; `totalComprehensiveTCO` (nominal) et `lifecycleCostLCC` (actualisé) portent le **même** périmètre : économique + risque + carbone monétarisé.
- Occurrences pluriannuelles honorées, valeur résiduelle non indexée, catégories inconnues comptées avec avertissement critique et `isComplete = false`.
- Traçabilité ligne à ligne : crédits en valeur absolue avec drapeau `isCredit`, identité `Σ coûts − Σ crédits = TCO économique nominal` vérifiée.
- Point mort refondu (`discounted_cumulative_crossover`) : flux actualisés, dépense initiale réelle, sensibilité au taux, absence de rentabilité annoncée explicitement.
- Sensibilité : tous les drivers mesurés en Δ de VAN complète, classement **relatif à l'échelle du dossier**, bornes de stress documentées comme conventions paramétrables.
- Scénarios relatifs au projet (un projet à 300 €/tCO2e ne voit plus son scénario pessimiste à 200 €/t).
- Score de confiance pondéré par la matérialité, sans valeur par défaut flatteuse ; enveloppe d'incertitude étiquetée comme non statistique.
- Version de moteur (`2.0.0`) et méthodologie exportées dans chaque résultat.

### B.4 Suppression des fabrications

| Module | Avant | Après |
|---|---|---|
| Extraction documentaire | Repli heuristique produisant de faux devis (Renault 3 850 000 €, confiance 96-98, `sourceType: 'verifiee'`) | Aucun repli : `extractionStatus: 'unavailable'`, `requiresHumanInput: true`, injection neutralisée dans l'interface |
| Signature électronique | Faux SHA-256, certificats « ANSSI/CertEurope eIDAS QES », 4 signataires fictifs, IP et séries aléatoires | SHA-256 réel (FIPS 180-4), aucune identité/série/IP inventée, statut juridique « non qualifiée », avertissement légal imprimé, migration qui neutralise les certificats déjà enregistrés |
| Reporting CSRD | Rapport constant attribué à « PwC / OTI Agréé Cofrac », « certifié sans réserve », visa fabriqué | Rapport recalculé sur les données réelles des projets et offres, aucune attestation, avertissements de complétude, KPI d'alignement affichés « non évalué » |
| Connecteurs ERP | Latence aléatoire, « TLS 1.3 / mTLS validé », offre fabriquée à 3 760 000 €, PO aléatoire | `501` explicite, maquette signalée dans l'interface, aucune donnée fabriquée (sync renvoie 0 offre) |
| Référentiel ESG | « Quinet 2026 » 120 €/t, enquête BdF inexistante, identifiants ADEME non vérifiables, références générées au hasard | Hypothèses de démonstration étiquetées `isDemoHypothesis`, renvois aux publications réelles, aucune référence générée automatiquement, migration des données déjà stockées dans le navigateur |
| Interface | « Conforme aux standards d'audit financier », « eIDAS Qualifié QES », « certifié sans réserve », « 100 % immuable » | Mentions remplacées par l'état réel du produit |

### B.5 Client

- Suppression de l'auto-authentification (« Sophie Valéry », `azure_ad`) et du sélecteur de rôle : le rôle provient de la session serveur et n'est plus modifiable dans l'interface.
- Jeton retiré du `localStorage` au profit d'un cookie `HttpOnly` ; plus de repli silencieux sur un utilisateur en cache en cas de panne réseau.
- `NeonService` : plus d'en-tête `x-tenant-id` envoyé par le client ; appels authentifiés par cookie ; conservation du contexte d'organisation côté serveur.
- Journal d'audit côté client : identité issue de la session, plus aucun nom inventé (« Sophie Valéry », « Éléonore Chen ») attribué à une action.

### B.6 Outillage

- `package.json` : nom `truetco`, version `2.0.0`, scripts `test`, `test:watch`, `typecheck` ; `vitest` 3.2.7 ajouté ; `esbuild` retiré des dépendances de développement (bloquait l'installation).
- `vitest.config.ts` + `src/engine/tcoEngine.spec.ts` (27 tests) en complément des 13 contrôles du moteur exécutables dans l'application.
- `.env.example` documenté : authentification de démonstration, origines autorisées, connecteurs synthétiques, clé d'extraction.

### B.7 Résultats de vérification

| Vérification | Commande | Résultat |
|---|---|---|
| Compilation | `npx tsc --noEmit` | 0 erreur |
| Tests moteur (application) | `npx tsx /tmp/enginetest.mjs` | **13/13** |
| Tests unitaires | `npx vitest run` | **27/27** |
| Invariants financiers | `npx tsx /tmp/verify.ts` | **tous les contrôles passent** (Σ flux nominaux = TCO, Σ flux actualisés = LCC, Σ économique actualisé = `economicLCC`, pureté des entrées, occurrences, catégorie inconnue, point mort, sensibilité, scénarios, valeur résiduelle) |
| Build de production | `npm run build` | succès (1,18 Mo, 324 kB gzip — point d'attention performance) |
| Installation | `npm install` | succès sans `--legacy-peer-deps` |
| Sécurité API (serveur réellement démarré) | `curl` sur 7 endpoints sans session | **401** partout ; en-têtes de sécurité présents ; login de démonstration refusé |

### B.8 Points d'attention laissés ouverts (assumés)

- La limitation de débit est en mémoire : à porter sur Redis avant toute exploitation multi-instances (documenté dans le code).
- Le schéma SQL prévoit la RLS en commentaire mais ne l'active pas : l'activation est une décision d'exploitation (elle nécessite un rôle applicatif dédié).
- Les agrégats de résultats en base sont laissés nuls volontairement : ils doivent être recalculés par le moteur avec `engine_version`.
- Les connecteurs ERP synthétiques restent disponibles derrière `TRUETCO_ENABLE_SYNTHETIC_CONNECTORS`, avec étiquette `synthetic: true` — utile pour les démonstrations commerciales, jamais pour une décision.
- Le jeu de démonstration (2 projets, 9 offres, 5 fournisseurs) contient des données fictives assumées comme telles : elles ne doivent jamais être présentées comme des références.

---

## ANNEXE C — REPRODUCTIBILITÉ

```bash
# 1. Installation
npm install

# 2. Vérifications statiques et unitaires
npx tsc --noEmit          # 0 erreur attendue
npx vitest run            # 27 tests attendus

# 3. Tests du moteur tels qu'exécutés dans l'application
npx tsx /tmp/enginetest.mjs   # 13 contrôles, 0 échec attendu

# 4. Invariants financiers
npx tsx /tmp/verify.ts        # tous les contrôles doivent passer

# 5. Serveur réel + vérification de sécurité
NODE_ENV=development PORT=3100 npx tsx server.ts &
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/projects   # 401 attendu
curl -s -X POST http://127.0.0.1:3100/api/auth/sso/login \
     -H 'Content-Type: application/json' -d '{"email":"x@y.z"}'              # 501 ou 503 attendu

# 6. Base de données (nécessite DATABASE_URL)
npm run db:migrate        # schéma idempotent + seed
```

---

*Fin du rapport. Les sections 1 à 28 répondent au périmètre demandé ; les annexes A à C documentent la maturité, les correctifs appliqués et la reproduction des vérifications.*
