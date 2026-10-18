# Chantier 3 — Fiabilité du moteur TCO / LCC (v2)

> Numérotation : dans la feuille de route initiale ce chantier portait le n° 4 (« Moteur TCO/LCC v2 ») ; « Qualité & DevOps » (CI, staging, remplacement de `xlsx`) reste à faire.

Spécification : [`METHODOLOGIE-TCO.md`](./METHODOLOGIE-TCO.md).

## Défauts de la v1 corrigés
| Défaut | Correction |
|---|---|
| « LCC » sans carbone vs TCO nominal avec carbone | Une matrice de flux unique ; LCC = direct + risques + carbone actualisés. |
| Carbone : tonnes × prix constant, hors phases | Calendrier par phase, prix du carbone indexable, valorisé année par année. |
| Coefficients d'usure / vieillissement / scénarios codés en dur et invisibles | Paramètres exposés, modifiables par projet, affichés et étiquetés « non sourcés ». |
| Point mort = division linéaire non actualisée | Croisement des flux cumulés (actualisé et nominal), interpolé, sans extrapolation, inversion détectée. |
| Sensibilité : métriques mélangées, libellé « ±30 % » faux, seuils en € fixes, 4 variables | Métrique unique (écart de LCC), 10 variables, plages explicites, seuil de bascule, classement relatif. |
| « Intervalle de confiance 90 % » inventé | Supprimé : fourchette de scénarios + simulation de robustesse reproductible (probabilité, P10/P50/P90). |
| Scénarios : taux choqués, ordre non garanti, gagnant au TCO nominal | Taux non choqué, ordre garanti, gagnant au LCC. |
| Qualité des données : défauts 70/75 inventés | Moyenne pondérée par le poids financier ; donnée absente = 0. |
| Unités ignorées, postes ponctuels tous en année 1, catégories dupliquées | Avertissements explicites ; années des postes ponctuels respectées ; double comptage évité. |
| Le moteur modifiait ses entrées | Fonctions pures (test d'immutabilité sur objets gelés). |
| Deux « gagnants » selon l'écran (nominal vs actualisé) | Critère de décision unique (LCC) partout. |

## Interface
- **Comparateur, tableau de bord, rapport, multicritère, Excel** : classement et économies sur le coût complet actualisé ; le rapport se lit de haut en bas sans écart (ligne « risques » sortie des postes directs).
- **Point mort** : courbes tracées depuis les flux cumulés actualisés du moteur (elles étaient des droites) ; double base ; avantage final.
- **Sensibilité** : plages, seuils de bascule, message « ce qui peut changer la décision », simulation de robustesse.
- **Scénarios** : paramètres étiquetés (projet / défaut non sourcé), synthèse de stabilité du classement ; **conclusions écrites d'avance supprimées**.
- **Rapport Comex** : récit de stress-tests (« +4,2 mois », « × 1,15 », « 120 → 250 € Quinet ») **remplacé par des calculs du moteur** sur les offres réelles ; score ESG inventé (92/65) supprimé.
- **Détail du calcul** : hypothèses du modèle utilisées, avertissements de données ; limites restantes énoncées.
- **Excel** : une feuille par offre avec de vraies formules, vérifiées par un tableur indépendant. Au passage : SheetJS supprime silencieusement les formules sans valeur en cache (corrigé, avec test de régression).
- « Valeur tutélaire / Quinet » retiré des libellés : le prix du carbone est une hypothèse saisie.

## Déploiement
Aucune migration. Les projets existants utilisent les hypothèses par défaut tant que `modelAssumptions` n'est pas défini.
**Les chiffres affichés changent** pour les projets existants (LCC incluant désormais le carbone, point mort actualisé, classement au LCC) : prévenir les utilisateurs.

## Limites assumées
- Conventions par défaut non sourcées (§ 10 de la méthodologie) ; pas de fiscalité, de multi-devises ni de rachat automatique.
- `hyperformula` (GPL-3.0) n'est utilisé qu'en test (dépendance de développement, non distribuée).
- Qualité des données : niveaux de confiance toujours déclaratifs (Data Confidence Score = chantier suivant).
