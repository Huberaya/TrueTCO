# TrueTCO — Sécurité

Ce document décrit ce qui est **réellement en place**, et ce qui ne l'est pas.
Aucune mesure n'est annoncée sans être vérifiable dans le code ou par un test.

---

## 1. Modèle de menaces couvert

| Menace | Mesure | Preuve |
|---|---|---|
| Fuite entre organisations (lecture, modification, suppression) | RLS PostgreSQL + `FORCE ROW LEVEL SECURITY`, 24 policies, `organization_id` sur chaque table | `tests/isolation.spec.ts` (15 tests), `tests/api-security.spec.ts` T-API-10 → T-API-14 |
| Usurpation de tenant par en-tête, paramètre ou corps de requête | Le tenant est dérivé de la session ; tout identifiant d'organisation fourni par le client est comparé puis refusé (`403 TENANT_MISMATCH`) | T-API-05, T-API-06 |
| Escalade de rôle | Matrice de permissions serveur ; un `org_admin` ne peut pas attribuer `platform_admin` ; changement de rôle = révocation des sessions | T-API-17, T-API-18, T-API-19 |
| Vol de jeton de session | Le jeton n'est jamais exposé au JavaScript de la page : cookie `HttpOnly`, `SameSite=Lax`, `Secure` en production ; seul son SHA-256 est stocké | `server/auth/session.ts` |
| Rejeu après déconnexion | Révocation effective en base ; vérifié de bout en bout | T-API-08, T-API-09 |
| CSRF | Contrôle d'origine pour toute requête mutante authentifiée par cookie | T-API-31 → T-API-33 |
| Falsification du journal d'audit depuis l'application | Journal append-only (policies sans `UPDATE`/`DELETE` + trigger d'immuabilité) ; écriture serveur uniquement | T-API-09, T-API-27, T-API-30 |
| Falsification du contenu d'une entrée d'audit en base | Chaîne de hachage + hachage de contenu recalculé en SQL depuis les colonnes | T-API-30 |
| Injection SQL | Requêtes paramétrées exclusivement ; les identifiants de rôle passent par `assertSafeRoleName` | `server/db/adapters.ts` |
| Fuite d'informations par les messages d'erreur | Les erreurs de schéma sont remplacées par un message générique ; la cause technique reste dans les journaux serveur | T-PG-04, T-API-37 |
| Injection de contenu dans les prompts d'IA | Sans objet actuellement : aucune fonctionnalité d'IA n'est active (route `501`) | — |

## 2. Ce qui n'est PAS en place (à ne pas supposer acquis)

- **MFA (TOTP/WebAuthn), OIDC, SAML, SCIM** : schéma de données préparé
  (`users.idp_provider`, `users.idp_subject`, `users.mfa_enrolled`), aucune
  implémentation. La connexion réelle est **indisponible**.
- **Fournisseur d'identité** : aucun. Le mode `TRUETCO_ALLOW_DEMO_AUTH=true`
  délivre une session sans vérifier d'identité : interdit en production (le
  serveur refuse de démarrer), journalisé `is_demo = true`.
- **Ancrage externe du journal d'audit** : un attaquant disposant d'un accès
  complet en écriture à la base peut réécrire le contenu et recalculer toute la
  chaîne. Le mécanisme de défense correspondant (horodatage qualifié ou dépôt
  scellé périodique du digest de tête) n'existe pas. Sans lui, la chaîne prouve
  une altération accidentelle ou partielle, **pas** une opposition à un
  administrateur malveillant.
- **Limitation de débit distribuée** : le compteur est en mémoire, par instance
  (suffisant pour un déploiement mono-instance, insuffisant en cluster).
- **Antivirus et analyse des téléversements** : aucun téléversement n'est encore
  accepté (Import Center en Phase 2).
- **Chiffrement au repos et gestion des clés** : dépend intégralement du
  fournisseur PostgreSQL ; aucune gestion de clés applicative.
- **Journalisation centralisée, alerting, SIEM** : les erreurs sont journalisées
  sur la sortie standard avec un identifiant de corrélation ; il n'existe ni
  agrégation, ni alerte.
- **Tests d'intrusion, revue de code externe, certification** : aucun.

## 3. Règles de conception appliquées

1. **Échec fermé.** `Db.tx()` sans contexte d'organisation ne voit rien et
   n'écrit rien (vérifié par T-ISO-07). Un défaut applicatif qui oublierait un
   filtre ne provoquerait pas de fuite.
2. **Aucune donnée d'identité fournie par le client.** Rôle, organisation et
   permissions proviennent de la session serveur.
3. **Le journal n'est pas écrit par le client.** Une entrée produite par le
   navigateur serait dépourvue de valeur probante (`403 AUDIT_SERVER_WRITTEN_ONLY`).
4. **Le code privilégié est isolé.** `systemTx` (propriétaire des tables) est
   réservé aux migrations et à l'amorçage ; le code de requête s'exécute sous le
   rôle `truetco_app` soumis au RLS.
5. **Pas de fonctionnalité simulée.** Une fonctionnalité absente répond `501`
   avec sa raison : c'est une mesure de sécurité (on ne peut pas se fier à ce
   qui n'existe pas) autant qu'une exigence d'honnêteté.

## 4. Signalement

Toute vulnérabilité doit être signalée en privé au responsable du produit. Ce
document ne constitue ni une certification ni une garantie : il décrit l'état
du code à la date de la dernière modification du dépôt.
