# Phase 4 : une semaine active

Le propriétaire a remplacé l'observation sans mises par une seule semaine active. Le compte courant est `survival-004-active` : 1 000 € entièrement fictifs, sept jours après son START, sans pilote ni qualification préalable obligatoire.

Les prévisions indépendantes, résultats officiels, scores, calibration et comparaisons sont conservés. Ils sont mesurés en parallèle des investissements et ne constituent pas une validation déjà acquise. Les données manquantes, un carnet inexécutable ou une exposition épuisée peuvent toujours empêcher une mise. Aucun pari n'est forcé.

## Paramètres

- Politique `survival-active-1`, `requireQualification=false`.
- Fonds disponible au départ : 1 000 € fictifs, conversion figée au lancement.
- Réserve de 20 %, plafond de 5 % par mise et de 20 % par événement commun.
- Enveloppe des méthodes encore non qualifiées : 2,5 % du fonds initial, soit 25 € par proposition. Le conseil peut réduire le montant. Le Kelly fondé sur un intervalle non calibré n'est pas utilisé pour imposer le dimensionnement.
- L'avantage estimé est vérifié contre les prix achetables et les frais ; seuil configurable de 2 points de probabilité. Cela reste une estimation, jamais une assurance de gain.
- La limite de prix initiale peut tolérer deux ticks de mouvement, bornée par l’avantage estimé et les frais. Le vote porte sur cette limite ; les fills utilisent toujours le carnet réellement observé.
- Mises conservées jusqu'au règlement officiel, sans vente ni levier.
- Réunions à 9 h, 13 h, 17 h et 21 h Paris, plus urgences justifiées. Un premier examen est prévu environ deux minutes après le lancement, si un dossier est déjà prêt ; il reste distinct des statistiques des réunions ordinaires.
- Aucun achat six heures avant la fin ; le calendrier des événements doit aussi respecter cette marge. Les retards de règlement officiels restent possibles et visibles.

## Commandes

```powershell
.venv\Scripts\python.exe operations/reform_admin.py state
.venv\Scripts\python.exe operations/reform_admin.py health
# Une seule fois, pour le nouveau compte :
.venv\Scripts\python.exe operations/reform_admin.py start --stage full --confirm survival-004-active
```

Le stage `full` désigne le compte actif. Le dashboard ouvre ce fonds par défaut : https://project-survival.pages.dev/?phase=4 . La page « Les paris » expose montant en EUR, choix, raison, état du règlement et lien vers le débat.

L'observation précédente est arrêtée explicitement avec `archive-observation --stage shadow --confirm survival-004-shadow`. Ses prévisions et journaux restent conservés ; aucune mise ni faux résultat ne lui est ajouté. Le lancement actif utilise un nouvel identifiant et son propre compte à rebours.

Sauvegardes et restauration : voir PHASE4_GUIDE.md. Les commandes `export` ciblent désormais le fonds actif par défaut ; préciser `--stage shadow` pour l'archive. La même protection contre les doubles débits, le même watchdog et le même gel de code continuent de s'appliquer.

## Coûts et fiabilité

Les données de marché et recherches sont partagées, les contextes restent bornés et les jetons mesurés. Le collecteur conserve sa date de collecte complète lors des actualisations ciblées, afin de ne pas recommencer tout le catalogue de flux à chaque passage. Les estimations Azure ne sont pas des factures.

Les mises fictives ne coûtent pas d'argent réel. Les appels Azure consomment les crédits configurés. Une semaine active peut rester sans investissement si aucun dossier ne passe les décisions et contraintes observables ; il n'existe aucune obligation cachée d'investir pour animer l'écran.
