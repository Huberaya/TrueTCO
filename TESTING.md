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
| `tests/isolation.spec.ts` | Cloisonnement multi-tenant sur PostgreSQL réel (RLS) : IDOR, UPDATE/DELETE croisés, jointures, échec fermé, audit immuable, sessions | 15 |
| `tests/api-security.spec.ts` | API complète : session, RBAC, transitions de statut, écriture transactionnelle, journal non forgeable, CSRF, parcours inscription/invitation | 37 |
| `tests/pg-adapter.spec.ts` | **Pilote de production** (`pg`) sur le protocole réseau PostgreSQL, exposé par PGlite en socket | 6 |

Total : **85 tests**.

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
