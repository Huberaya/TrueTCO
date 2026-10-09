# TrueTCO — Fausses fonctionnalités retirées (et pourquoi)

Ce document recense les fonctionnalités qui **prétendaient faire quelque chose qu'elles
ne faisaient pas**, ce qui a été mis à la place, et le test qui empêche leur retour.

Règle appliquée : une fonctionnalité qui n'engage personne, qui n'est vérifiée par
personne ou qui attribue une donnée à une source inexistante est **plus dangereuse
qu'une absence de fonctionnalité** : elle fait croire qu'une décision a été prise, qu'une
donnée est vérifiée ou qu'une conformité est acquise. Ces éléments ont donc été retirés,
pas maquillés.

| # | Ce qui existait | Pourquoi c'était faux | Ce qui le remplace | Ce qui verrouille |
|---|---|---|---|---|
| 1 | Écran « Signature électronique » produisant un **certificat d'adjudication** dans le navigateur (identifiant, empreintes locales, paraphe au canevas, stockage local) | Aucune vérification serveur, aucun identifiant de personne, document modifiable et disparaissant avec le navigateur. Une signature qui n'engage personne fait croire à une approbation | Écran **Approbations** : transitions de statut réelles via `POST /api/projects/:id/status` (justification ≥ 10 caractères exigée par le serveur, `project:write` pour avancer, `project:lock` pour figer) + historique lu dans le journal d'audit serveur + démenti explicite « ce n'est pas une signature électronique qualifiée au sens d'eIDAS » | `T-UI-10` à `T-UI-14` ; `src/services/signatureService.ts` et les types `AdjudicationCertificate` / `DigitalSignatureRecord` supprimés |
| 2 | « Collège des Visas & Signatures Électroniques Comex » : 4 signataires **inventés**, 3 déjà marqués SIGNÉS, bouton « Apposer le Visa » | Identités, fonctions, citations et horodatages fabriqués dans l'interface. Ces validations n'existaient nulle part côté serveur | Section **Approbations enregistrées** alimentée par `GET /api/audit-logs?projectId=…` : auteur de session, rôle, `avant → après`, horodatage, motif. S'il n'y a aucune approbation, l'écran l'écrit | `T-UI-15`, `T-UI-16` |
| 3 | Bouton « Prononcer l'Adjudication » : bascule du dossier en `adjudiqué` côté navigateur + message « enregistré de manière immuable dans le journal d'audit Neon PostgreSQL » | Le statut ne bougeait que dans l'onglet ; le journal local était un `handleAddAuditLog` **vide** ; « Neon » était une marque non vérifiée | Transition demandée à l'API avec motif écrit (l'écran affiche le refus du serveur tel quel : permission, transition interdite, motif trop court) | `T-UI-17` |
| 4 | « Extraction Devis PDF (Assistant IA) » : après 600 ms, une offre complète pré-remplie (prix, garanties, pénalités, « score de confiance : 94 % ») **identique quel que soit le texte collé** | Ce n'était pas une extraction mais une démonstration figée, injectant dans le moteur des montants que personne n'avait vérifiés | Onglet retiré ; la saisie manuelle et le Centre d'import (XLSX/CSV, avec provenance et validation) restent les voies réelles. L'extraction assistée sera rebranchée en phase IA avec modèle, stockage du document, provenance par passage et validation humaine bloquante | `R9`, tests d'import existants |
| 5 | Saisie manuelle marquée `sourceType: 'verifiee'` (« Devis commercial ferme », confiance 98 %) et `emissionFactorSource: 'ADEME 2026'` | Les montants étaient TYPÉS par l'acheteur : les présenter comme vérifiés, ou attribuer un facteur d'émission à l'ADEME, est une fausse source | `sourceType: 'utilisateur'`, libellés « montant déclaré par l'acheteur — pièce non jointe », confiance abaissée, et mention explicite que rien n'est complété automatiquement par un référentiel | Tests d'import + relecture `T-UI-05` |
| 6 | Auteur des saisies codé en dur : « Sophie Valéry », « Alexandre Meyer », « Éléonore Chen » | Attribution d'une donnée financière à des personnes qui ne l'ont jamais saisie | Auteur = utilisateur de la session, sinon « saisie locale non attribuée » | `tsc`, relecture de code |
| 7 | Fournisseur pré-rempli avec « ISO 9001, ISO 14001, EcoVadis Gold » et « Bilan Carbone certifié » | Créait un fournisseur certifié sans aucune pièce | Champs vides : la certification doit être saisie, avec sa référence | — |
| 8 | Revendications de conformité à l'écran : « ISO 27001 · SOC 2 Type II », « Conformité CAC & Article L. 823-10 », « chiffrement des flux de bout en bout », « Neon PostgreSQL », « Certifié ISO 15686-5 & GHG Protocol », « Moteur de calcul certifié », « Journal immuable », « immuable » | Aucune certification, homologation ni habilitation n'existe ; un flux interne n'est pas chiffré de bout en bout par le produit | Mentions remplacées par l'état réel (ex. « démarche LCC inspirée d'ISO 15686-5, sans certification », « journal en écriture serveur uniquement, chaîne de hachage vérifiable ») ; le contrôle statique **R9** échoue désormais si une telle mention revient sans négation | `R9` (7 écarts détectés puis corrigés lors de son introduction) |
| 9 | « Portail d'Authentification Entreprise & SSO » : annuaire de 4 collaborateurs inventés avec fournisseur d'identité attribué, sélecteur « Rôle Métier Attribué par l'Annuaire » inopérant, badges ISO 27001 / SOC 2, « Connexion certifiée » | Personnes inexistantes présentées comme comptes de l'entreprise ; le rôle transmis n'était utilisé par personne (il vient de la base) ; badges sans objet | La modale lit `GET /api/auth/config` (nouvelle route) et déclare ce qui est réellement déployé : connecteurs fédérés = aucun, MFA/SCIM = non implémentés, mode démonstration = activé/désactivé, avec la phrase du serveur. L'utilisateur saisit l'adresse d'un compte existant ; le rôle est celui de la base | Tests API « Configuration d'authentification déclarée par le serveur » |
| 10 | L'avertissement du serveur à la connexion (« session de démonstration : aucun mot de passe, aucun second facteur, aucune fédération ») était **reçu puis jeté** par l'interface | L'utilisateur ne voyait jamais que sa session n'offrait aucune garantie d'identité | Avertissement affiché en bandeau tant que la session est active (`useAuth().authWarning`) | `tsc`, revue de `AuthContext` |
| 11 | « Validation de la grille multicritères » créant une entrée d'audit signée d'un nom inventé et d'un identifiant fictif | Écriture cliente dans un journal qui refuse précisément les écritures clientes | Bouton désactivé portant la raison : le journal est en écriture serveur uniquement | `T-UI-07` (principe) + libellé d'écran |
| 12 | Sensibilités écrites en dur dans le rapport Comex : « gain accéléré de 4,2 mois », « gain cumulé × 1,15 », scénario carbone attribué au « rapport France Stratégie », « Prix Tutélaire Quinet », « Validation Direction Financière » | Aucun de ces chiffres ne sortait du moteur ; les attributions institutionnelles n'existaient pas dans le dossier | Tableau de sensibilité **recalculé par le moteur** (recalcul complet des deux offres à chaque borne : impact, amplitude, classe) ; les paramètres sont présentés comme des hypothèses du dossier, avec « source à vérifier » | `T-UI-15` (absence de mention ISO15686/certification), moteur `calculateSensitivity` |
| 13 | Jargon de projet visible dans l'interface : « Chantier 1 », « Chantier 3 (Appels d'Offres) », « Section 26 », badges « Validé (100%) » | Le client final lisait un plan de transformation interne à la place d'un produit ; le badge « validé à 100 % » était une auto-déclaration | Libellés métier (« Moteur de calcul », « Projets & appels d'offres », « Approbations »…), écran d'ouverture = Tableau de bord, plus aucune auto-certification à l'écran | Revue de code + `R9` |
| 14 | « Dump SQL de migration » généré dans le navigateur à partir d'arrays locaux, avec organisation Acme et identifiant racine codés en dur | Ce n'était ni un snapshot PostgreSQL, ni un export complet du serveur ; le script pouvait donner l'illusion d'une migration de production et mélanger un jeu de démonstration aux données client | Générateur retiré ; JSON de démonstration limité au mode local sans session. Les migrations de schéma sont versionnées dans `src/db/migrations/` et exécutées côté exploitation avec `npm run db:migrate` | `tests/data-backup.spec.tsx` |

## Ce qui n'a PAS été retiré, et pourquoi

- **Le moteur de calcul** et ses invariants : il est testé et reproductible ; ses
  formules sont documentées dans l'interface (`Moteur de calcul`) et dans les tests.
- **L'auto-vérification du moteur** (`AutomatedTestsModal`) : elle exécute réellement
  les assertions du moteur dans le navigateur. Seul le mot « certification » a été
  retiré, et il est précisé qu'il ne s'agit ni d'un audit ni d'une certification externe.
- **Le Centre d'import, la décision, la simulation de risque** : fonctionnalités
  réelles branchées sur l'API, testées de bout en bout (voir `TESTING.md`).

## Ce qui reste à traiter (honnêtement)

- Les écrans hérités qui calculent encore avec le moteur côté navigateur au lieu de
  lire les exécutions serveur : ils affichent des résultats recalculables localement,
  pas des décisions tracées. Leur migration est prévue phase par phase.
- L'extraction documentaire assistée par IA (provenance par passage, validation
  humaine bloquante) n'existe pas : elle est annoncée comme telle, jamais simulée.
- La signature électronique qualifiée (prestataire de confiance, certificat, horodatage
  RFC 3161) reste à intégrer. Tant qu'elle ne l'est pas, le produit ne produit **aucun**
  document signé et le dit.
