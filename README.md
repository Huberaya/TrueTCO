# TrueTCO

Plateforme B2B d'arbitrage économique et d'intelligence de décision achats :
coût complet (TCO/LCC), carbone, risque, et **réponse aux quatre questions** qui
décident réellement un arbitrage :

1. Combien cela coûte-t-il, sur la durée ?
2. Pourquoi ce montant (décomposition, formule, sources) ?
3. Quelle option est préférable, et de combien ?
4. Dans quelles hypothèses la décision change-t-elle ?

> **État du produit : MVP à terminer.** Le score d'audit est de **38/100**, la
> maturité est de **2/7**, et les verdicts « commercialisable », « enterprise
> ready » et « world-class » sont **NON**. Le détail complet, y compris ce qui ne
> fonctionne pas, est dans [`AUDIT-TRUETCO-2026.md`](./AUDIT-TRUETCO-2026.md).

---

## État exact de la Phase 1 (fondation)

### Ce qui fonctionne réellement (vérifié par des tests exécutés)

| Domaine | État | Preuve |
|---|---|---|
| PostgreSQL comme source de vérité | Implémenté | `src/db/migrations/0001..0003`, `server/db/*` |
| Isolation multi-tenant par RLS | Implémenté et testé | `tests/isolation.spec.ts` (15 tests) |
| Pilote de production (`pg`, protocole réseau) | Testé | `tests/pg-adapter.spec.ts` (6 tests, PGlite exposé en socket PostgreSQL) |
| Authentification par session révocable | Implémenté et testé | `server/auth/*`, `tests/api-security.spec.ts` |
| RBAC (7 rôles, 24 permissions) | Implémenté et testé | `server/auth/types.ts`, tests T-API-15 → T-API-20 |
| Journal d'audit append-only et chaîné | Implémenté et testé | `server/audit.ts`, migration 0003, tests T-API-27 → T-API-30 |
| Écriture métier transactionnelle (offre + postes de coût) | Implémenté et testé | `server/repositories/offers.ts`, tests T-API-22 → T-API-25 |
| Protection CSRF par contrôle d'origine | Implémenté et testé | tests T-API-31 → T-API-33 |
| Migration du front vers le serveur (dossiers, fournisseurs, audit) | Implémenté | `src/services/serverData.ts`, `src/App.tsx` |
| Offres et postes de coût vus par l'interface | **Partiel** | les offres restent locales ; le mapping complet est branché avec le moteur (Phase 3) |
| Moteur de calcul v2 | Préservé | `src/engine/tcoEngine.ts`, 27 tests |
| Import XLSX/CSV, ERP, IA d'extraction, benchmark, PDF | **Absent** | ces routes répondent `501` avec la raison exacte |

### Ce qui n'existe pas (et n'est donc jamais simulé)

- **Aucun connecteur ERP** (SAP, Odoo, Sage…) : les routes `/api/erp/*` répondent
  `501 ERP_CONNECTOR_NOT_IMPLEMENTED`.
- **Aucune extraction IA** : `/api/ai/extract` répond `501`.
- **Aucun référentiel de benchmark** : `/api/benchmarks` répond `501`.
- **Aucun mot de passe, MFA, OIDC, SAML ni SCIM.** La connexion réelle dépend d'un
  fournisseur d'identité, non branché. Le mode `TRUETCO_ALLOW_DEMO_AUTH` est une
  session de recette sans vérification d'identité : il est interdit en production
  (le serveur refuse de démarrer).
- **Aucun envoi d'e-mail** : les invitations produisent un lien que l'appelant
  transmet lui-même ; la réponse de l'API l'indique explicitement.

---

## Démarrage

### 1. Base de données (obligatoire)

```bash
cp .env.example .env      # puis renseigner DATABASE_URL
npm install
npm run db:migrate        # applique les migrations (empreintes vérifiées)
npm run db:create-org -- \
  --name "Société Exemple" --slug societe-exemple --domain exemple.com \
  --email admin@exemple.com --admin "Prénom Nom"
```

Le serveur **refuse de démarrer** sans base : une application sans base perdrait
silencieusement les données de l'utilisateur.

### 2. Serveurs

```bash
npm run dev:api     # API sur :3000 (migrations si TRUETCO_AUTO_MIGRATE=true)
npm run dev         # front Vite sur :5173, proxy /api → :3000
```

### 3. Vérifications

```bash
npm run typecheck   # TypeScript, zéro erreur exigée
npm run test        # 85 tests : moteur, isolation, API, pilote de production
npm run build       # build de production
npm run verify      # les trois précédents
```

---

## Architecture

```
Navigateur (React/Vite)
   │  fetch avec cookie HttpOnly (credentials: same-origin)
   ▼
API Express (server/app.ts, server/api/router.ts)
   │  session → RBAC → validation → transaction
   ▼
Services métier (server/auth, server/repositories, server/audit)
   │  Db.tx()        = rôle applicatif truetco_app → SOUMIS AU RLS
   │  Db.systemTx()  = propriétaire, réservé aux migrations et à l'amorçage
   ▼
PostgreSQL  →  RLS + FORCE RLS, 24 policies, journal d'audit immuable
```

Le moteur de calcul (`src/engine/tcoEngine.ts`) est une **bibliothèque pure**,
sans dépendance au navigateur ni à la base : il est appelable côté serveur,
côté test et côté client, et produit le même résultat dans les trois cas.

### Dossiers

| Chemin | Contenu |
|---|---|
| `src/engine/` | moteur de calcul (cœur métier, testé) |
| `src/db/migrations/` | schéma PostgreSQL, RLS, vérification d'intégrité |
| `server/db/` | accès base : contrat, adaptateurs, migrations |
| `server/auth/` | sessions, rôles, invitations |
| `server/api/` | routes HTTP |
| `server/repositories/` | requêtes métier (dossiers, offres, fournisseurs, audit) |
| `src/services/` | clients du navigateur |
| `tests/` | isolation, API/sécurité, pilote de production |

---

## Feuille de route

| Phase | Objet | État |
|---|---|---|
| 1 | Fondation : auth, organisation, RBAC, PostgreSQL, RLS, migrations, audit, tests d'isolation | **en cours d'achèvement** |
| 2 | Ingestion : Import Center XLSX/CSV, validation, provenance documentaire | à venir |
| 3 | Décision : moteur v2 côté serveur, écran Decision, inversion de décision | à venir |
| 4 | Rapports : PDF serveur, export Excel 12 onglets | à venir |
| 5 | Enterprise : MFA/OIDC/SAML/SCIM, facturation, RGPD, jobs | à venir |
| 6 | IA : extraction avec provenance et validation humaine bloquante | à venir |
| 7 | World-class : benchmark, documentation complète, CI, observabilité | à venir |

Chaque phase est livrée avec ses tests exécutés ; aucune fonctionnalité n'est
annoncée avant d'être vérifiée.
