# TrueTCO — matrice RBAC / état P0.4

**État :** politique d’accès non approuvée; toutes les routes métier restent fermées par défaut. Cette matrice inventorie les capacités visibles dans le dépôt et distingue explicitement les rôles historiques des autorisations réellement décidées. Elle ne constitue pas une activation d’accès.

Le schéma local limite maintenant la valeur de `users.role` à la liste historique via un `CHECK`; cela ne crée ni rôle vérifié ni permission. La pile API et les handlers métier simulés sont testés en HTTP local, et aucun rôle ne passe le gate. Les tests PGlite vérifient uniquement les contraintes de schéma, pas l’autorisation applicative/RLS.

## 1. Rôles présents dans les contrats existants

Les six libellés ci-dessous apparaissent dans `src/types/domain.ts` et/ou les validations/UI. Leur présence dans le client ou les seeds ne prouve ni identité vérifiée ni permission accordée.

| Rôle historique | Présence vérifiée | Autorisations serveur effectives |
|---|---|---|
| `admin` | type/validation/UI | Aucune; pas de rôle plateforme implicite |
| `directeur_achats` | type, validations, seeds/UI | Aucune |
| `acheteur` | type, validations/UI | Aucune |
| `finance_controleur` | type, validations, seeds/UI | Aucune |
| `rse_esg` | type, validations, seeds/UI | Aucune |
| `direction_generale` | type/validation/UI | Aucune |

## 2. Matrice des routes et état présent

**Légende :** `BLOQUÉ` = la garde API répond HTTP 503 avant tout handler; cela ne préjuge pas des permissions futures. `À DÉCIDER` = les sources ne justifient pas une autorisation rôle/action suffisamment précise; aucune permission n’est attribuée.

| Domaine / route(s) observées | Action métier | `admin` | `directeur_achats` | `acheteur` | `finance_controleur` | `rse_esg` | `direction_generale` | Décision manquante avant ouverture |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `/api/tenants`, `/api/tenants/current` | Lire organisations/contexte | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Règles d’adhésion, visibilité et sélection d’organisation |
| `POST /api/tenants` | Créer une organisation | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Qui peut provisionner, invitation, validation et attribution du premier membre |
| `/api/auth/*`, `/api/users/sync` | Profil, utilisateurs, sessions historiques | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Source Clerk, mapping d’appartenance, suspension, rôles administrés; supprimer l’autorité du body |
| `GET/POST /api/projects` | Lire/créer consultations | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Lecture vs création, propriété projet, éventuelles restrictions par statut |
| `POST /api/offers` | Créer offre fournisseur | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Qui saisit/revoit une offre et quels contrôles de phase sont requis |
| `GET/POST /api/suppliers` | Lire/créer fournisseurs | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Référentiel partagé/tenant, création, revue ESG et accès aux données sensibles |
| `GET/POST /api/benchmarks` | Lire/créer hypothèses de référence | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Références globales vs tenant, autorité de publication et revue indépendante |
| `GET/POST /api/audit-logs` | Lire/écrire événements applicatifs | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Qui peut lire, génération exclusivement serveur, intégrité/rétention; ne pas qualifier de preuve certifiée |
| ERP, IA, signatures et rapports réglementaires | Connecteurs / intégrations non opérationnelles | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | BLOQUÉ | Hors matrice de permissions tant que service, consentement, identité et effets réels ne sont pas validés |

### Permissions candidates non accordées

Les noms tels que `projects:read`, `projects:create`, `offers:create`, `suppliers:write`, `benchmarks:publish`, `users:manage` peuvent servir de vocabulaire à la revue. Ils ne sont **pas** des grants implémentés ni des décisions produit. Aucun lien rôle→permission n’est inscrit ici, car les écrans, valeurs de rôle seedées et annotations de code ne définissent pas les séparations de fonctions exigées.

## 3. Contrat d’autorisation obligatoire avant activation

1. Identité tirée exclusivement du résultat de vérification Clerk côté serveur; jamais du body, query, header, localStorage ou d’un rôle React.
2. Résolution de l’utilisateur local et de son appartenance active à une organisation interne; l’`orgId` Clerk n’est qu’un identifiant externe à mapper, pas une clé de base présumée.
3. Permission explicite et testée par route et action, avec `deny by default`; aucun rôle `admin` ou utilisateur nouvellement synchronisé ne reçoit de privilège implicite.
4. Tenant résolu depuis le contexte vérifié/membership, puis injecté dans chaque requête DB et vérifié par contrainte/RLS; un ID d’objet hors tenant rend 404/403 sans différence révélatrice.
5. Contrôle des transitions métier (brouillon, consultation, décision, etc.) séparé du RBAC général; aucune approbation de signature ou adjudication n’est inférée d’un rôle historique.

## 4. Tests d’acceptation requis

- Table de décision approuvée par le propriétaire métier/sécurité, incluant chaque rôle, route, méthode, lecture, écriture, export et transition.
- Tests 401 sans/avec token invalide, 403 pour principal valide mais permission absente, refus des rôles/permissions inconnus et des claims incomplets.
- Pour chaque route, accès positif du rôle explicitement approuvé **et** négatif des autres rôles; tester IDs inter-tenant sur lecture, mutation, export et chemins imbriqués.
- Tester rôle transmis dans body/header/query, tenant transmis dans toutes les variantes et changement d’organisation Clerk; aucun de ces inputs ne peut accorder un accès.
- Tester révocation/désactivation, membership suspendu et suppression/mapping absent.
- Jusqu’à ces tests, maintenir `createFailClosedApiGate()`; la couche Clerk ajoutée en P0.2 vérifie la session quand configurée mais ne remplace ni RBAC ni l’isolation et ne libère aucune route.
