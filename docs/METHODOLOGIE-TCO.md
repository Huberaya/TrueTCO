# Méthodologie de calcul TrueTCO (moteur v2)

Spécification du moteur (`src/engine/`). Elle décrit **ce que le code fait réellement**, conventions et limites comprises.
Elle n'est ni certifiée ni auditée par un tiers. Chaque formule est vérifiée par des tests (voir § 10).

## 1. Principe

Une **matrice de flux annuels par composante** (années 0..N) est la source unique de vérité. Tous les indicateurs en dérivent :
TCO nominal, coût complet actualisé, point mort, sensibilité, scénarios, robustesse, export Excel. Aucun calcul parallèle.

## 2. Conventions

| Sujet | Convention |
|---|---|
| Temps | t = 0 : investissement initial ; t = 1..N : flux de fin d'année. Pas d'actualisation intra-annuelle. |
| Prix | Les montants saisis sont exprimés en **prix de l'année 1**. Un poste de l'année t est multiplié par (1+i)^(t−1) (t ≥ 1). |
| Actualisation | Facteur 1/(1+r)^t ; r = 0 donne exactement 1. |
| Montants | Les montants d'un poste sont des **totaux pour la quantité achetée** (pas des prix unitaires). L'unité (`€/an`…) est contrôlée mais **jamais convertie en silence** (avertissement). |
| Précision | Calcul en flottants IEEE-754 ; les champs affichés sont arrondis à l'euro, les valeurs exactes sont exposées (`exact`). |

## 3. Composantes et calendrier

| Composante | Catégorie saisie | Calendrier | Indexation |
|---|---|---|---|
| Acquisition, logistique, installation | `acquisition`, `logistique_douanes`, `installation_mise_en_service` | t = 0 (ou années listées) | inflation générale si t > 1 |
| Énergie | `energie_consommables` | récurrent : 1..N ; ponctuel : années listées, sinon année 1 (avertissement) | (1+i_énergie)^(t−1) |
| Maintenance | `maintenance_reparations` | idem | (1+i)^(t−1) × (1 + (t−1)×usure) |
| Remplacements / pannes | `remplacement_pannes` | idem | (1+i)^(t−1) × (1 + max(0, t−début)×vieillissement) |
| Administratif / conformité | `couts_administratifs_conformite` | récurrent : 1..N ; ponctuel : t = 0 | (1+i)^(t−1) |
| Fin de vie | `fin_de_vie_recyclage` | t = N | aucune |
| Valeur résiduelle | `valeur_residuelle` | t = N, **toujours un crédit** (signe saisi neutralisé) | aucune |
| Risques | liste `riskItems` | années 1..N, répartition uniforme | aucune |
| Carbone | liste `carbonItems` | selon la phase (§ 5) | prix₀ × (1+g)^t |

Les catégories `risques_operationnels` et `externalite_carbone` des postes de coût sont **ignorées** (avertissement) : ces dimensions
sont calculées par les listes de risques et de carbone ; les compter deux fois serait un double comptage.
Si aucun poste `acquisition` n'existe, le prix du devis (prix unitaire × quantité) est utilisé (avertissement).

## 4. Définitions des indicateurs

Soit D_t les coûts directs, R_t l'espérance de perte des risques, C_t le carbone monétisé, r le taux d'actualisation.

- **TCO économique nominal** = Σ D_t
- **TCO complet nominal** = Σ (D_t + R_t + C_t)
- **Coût complet actualisé (LCC)** = Σ (D_t + R_t + C_t) / (1+r)^t — **critère de décision unique** de l'application
- Coût direct actualisé = Σ D_t/(1+r)^t ; LCC hors carbone = Σ (D_t + R_t)/(1+r)^t

> Correction v1 → v2 : le « LCC » de la v1 excluait le carbone alors que le TCO nominal l'incluait ; les deux totaux n'étaient pas comparables.

## 5. Carbone

Total d'une ligne = `totalLifecycleEmissions` si renseigné, sinon `emissionsTCO2e`, sinon facteur unitaire × quantité (× N si l'unité contient « /an »).
Un écart > 1 % entre total déclaré et recalcul est signalé (le total déclaré prévaut).

| Phase | Année(s) des émissions |
|---|---|
| `fabrication`, `transport` | t = 0 |
| `utilisation_annuelle` | total/N pour chaque t = 1..N |
| `fin_de_vie` | t = N |
| absente | t = 0 (avertissement) |

Coût de l'année t = tonnes_t × prix₀ × (1 + g)^t, où g = croissance annuelle du prix du carbone (0 par défaut : prix constant).
Le prix du carbone est une **hypothèse du projet**, pas une valeur officielle.

## 6. Risques

Espérance de perte = min(max(p, 0), 1) × impact, où p est la probabilité de survenance **sur l'horizon d'analyse**, répartie uniformément sur les années 1..N.
Pas de corrélation entre risques. Une probabilité hors [0 ; 1] est bornée et signalée.

## 7. Point mort

Soit d_t l'écart cumulé (candidate − référence) des coûts complets à la fin de l'année t. Calculé sur base **actualisée** (principale) et **nominale**.
Le point mort est le premier t où d_t ≤ 0, interpolé linéairement dans l'année : mois = 12 × [(t−1) + d_{t−1}/(d_{t−1} − d_t)], arrondi au mois supérieur.
d_0 ≤ 0 : point mort immédiat (mois 0). **Aucune extrapolation** au-delà de l'horizon. Une inversion ultérieure est signalée.

## 8. Sensibilité, scénarios, robustesse

**Métrique** : écart de coût complet actualisé Δ = LCC(candidate) − LCC(référence). Δ < 0 : la candidate est moins chère.

**Sensibilité** (une variable à la fois, mêmes plages pour les deux offres sauf le prix d'achat, qui ne varie que pour la candidate) :

| Variable | Plage testée (convention d'analyse) |
|---|---|
| Taux d'actualisation | ± 2 points |
| Inflation de l'énergie | ± 2 points |
| Inflation générale | ± 1 point |
| Prix du carbone | × 0,5 à × 1,5 |
| Niveau de prix de l'énergie | ± 20 % |
| Coût de maintenance | ± 20 % |
| Coût des pannes / remplacements | ± 50 % |
| Exposition aux risques | ± 50 % |
| Valeur résiduelle | ± 25 % |
| Prix d'achat de la candidate | ± 10 % |

Classement : **critique** si la décision change de camp dans la plage ; sinon fort / moyen / faible selon l'amplitude relative à |Δ| (≥ 50 % / ≥ 20 %).
**Seuil de bascule** : valeur du paramètre annulant Δ, la plus proche de la valeur de base (balayage de 60 pas puis bissection) ; « aucun » si pas de basculement dans la plage étendue.

**Scénarios** : central = valeurs du projet. Pessimiste / optimiste = chocs **par défaut du modèle, non sourcés** (inflation 4,5 % / 1,5 %, énergie 8 % / 2 %,
carbone 200 / 80 €/t, pannes × 1,4 / × 0,8), avec garantie d'ordre pessimiste ≥ central ≥ optimiste. Le taux d'actualisation n'est pas choqué.
Le meilleur choix est désigné sur le LCC.

**Robustesse** : simulation de Monte Carlo (2 000 tirages, graine fixe → reproductible). Chaque variable ci-dessus est tirée **indépendamment** selon une loi triangulaire
(mode = valeur de base, bornes = plage de sensibilité). Résultat : probabilité que la candidate reste la moins chère, percentiles P10/P50/P90 de Δ.
Plages et indépendance sont des **hypothèses** : ce n'est pas un intervalle de confiance statistique.

**Fourchette d'incertitude d'une offre** : min / max du TCO complet nominal sur les trois scénarios (pas un intervalle de confiance).

## 9. Qualité des données et avertissements

**Score de qualité** = moyenne des niveaux de confiance, pondérée par le poids financier de chaque donnée (|montant| × N pour un poste récurrent, carbone monétisé, p × impact pour les risques).
Une donnée sans niveau de confiance compte 0 (avertissement). Aucune donnée : score 0. *Les niveaux de confiance sont déclarés, non vérifiés ; le Data Confidence Score formalisera cette notion.*

Avertissements émis (jamais de correction silencieuse) : paramètre de projet manquant, absence de poste de coût, acquisition issue du devis, quantité issue du projet,
total du devis ≠ acquisition, unité/récurrence incohérentes, date de poste ponctuel non précisée, catégorie ignorée, montant négatif, phase carbone absente,
total carbone incohérent, probabilité bornée, durée de vie < horizon (aucun rachat n'est inventé), confiance absente.

## 10. Hypothèses par défaut du modèle (non sourcées)

| Paramètre | Défaut | Origine |
|---|---|---|
| Vieillissement de la maintenance | + 3 %/an | convention reprise de la v1 |
| Vieillissement des pannes | + 8 %/an après l'année 3 | convention reprise de la v1 |
| Croissance du prix du carbone | 0 %/an | neutre |
| Chocs des scénarios | cf. § 8 | convention reprise de la v1 |

Modifiables par projet (fiche du projet) ; la mention « défaut du modèle » s'affiche tant qu'aucune valeur n'est enregistrée.

## 11. Vérification

- **Valeurs d'or** calculées indépendamment (Python), pas par le moteur : TCO nominal 2 180, coût complet actualisé 1 991,35988, point mort actualisé 87,384671 mois,
  seuil de bascule du taux 15,098414 %, seuil du prix d'achat × 1,07630447.
- **Implémentation de référence indépendante** (`tests/engine/reference.ts`), écrite à partir de ce document : 300 cas aléatoires comparés au moteur.
- **Propriétés** : homogénéité (× k), invariance à l'ordre des postes, additivité, monotonie en r, cohérence cumul/LCC, immutabilité des entrées.
- **Reproductibilité Excel** : la feuille de formules exportée, évaluée par un tableur indépendant (HyperFormula), retrouve le moteur sur 120 cas aléatoires ; chaque valeur en cache égale l'évaluation de sa formule.
- **Sabotages** : des régressions volontaires du moteur (LCC sans carbone, actualisation décalée, signe du résiduel, point mort non interpolé…) sont toutes détectées.

## 12. Limites connues

- Conventions de § 10 non sourcées ; actualisation en fin d'année ; répartition uniforme des risques sans corrélation.
- Pas de rachat automatique si durée de vie < horizon (avertissement) ; pas de fiscalité (amortissement, TVA, impôt sur les sociétés) ; pas de multi-devises.
- Les scores et confiances sont déclaratifs. Aucun facteur d'émission ni prix du carbone n'est fourni par l'outil.
- La simulation suppose l'indépendance des variables.
