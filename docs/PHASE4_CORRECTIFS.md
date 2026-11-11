# Suivi des correctifs après la phase 3

**Évolution autorisée par le propriétaire : le fonds courant utilise une [semaine active](PHASE4_ACTIVE.md) avec 1 000 € fictifs dès le départ. Les seuils de qualification des points 40–45 restent des outils d'évaluation, sans être des conditions préalables obligatoires pour ce fonds. Les protections d'exécution, de données et d'exposition restent actives.**

Les lignes suivantes détaillent les changements par thème. « Implémenté » désigne une capacité logicielle, pas une efficacité prédictive prouvée. Les limites et mesures futures restent explicites. Le code est sous `council/src/reform/`, les tests principaux sous `council/test/reform.test.ts`.

| N° | Correctif | Réalisation ou limite explicite |
|---:|---|---|
| 1 | Probabilité définie pour le premier outcome réel | `forecast.ts`, schéma strict, labels fournis |
| 2 | Méthode déclarée | `judgement` distingué des modèles statistiques |
| 3 | Incertitude explicite | Bornes ordonnées et hypothèse réfutable, validées |
| 4 | Avantage recalculé | Prix achetable et frais du carnet, `engine.ts` |
| 5 | Mesure de précision | Brier sur résultats officiels, `forecast.ts` |
| 6 | Mesure de calibration | Groupes de probabilités et erreur observée |
| 7 | Évaluation temporelle séparée | Résultats effectivement connus à la coupure ; événements communs exclus |
| 8 | Comparaison au marché | Référence de prévision bid/ask, jamais un fill au mid |
| 9 | Pertinence des preuves par événement | Sources rattachées au dossier et au groupe |
| 10 | Station météo exacte | `evidence.ts`, correspondance avec règles |
| 11 | Observations déjà réalisées | METAR routine, journée locale, extrême partiel |
| 12 | Sémantique météo | Min/max, unité, arrondi, bornes, T prioritaire, SPECI exclus |
| 13 | Corrections de relevés | Rapport le plus récent au même instant d'observation |
| 14 | Date de collecte distincte du fait | Fraîcheur d'observation et collecte contrôlées séparément |
| 15 | Indépendance des sources | Familles identifiées ; produits Open-Meteo non comptés comme indépendants |
| 16 | Données sportives en direct | Pré-match non accepté comme score live |
| 17 | Limites des connecteurs | Jeux esport sans source spécifique explicitement non couverts |
| 18 | Modèle météo empirique | Module de résidus station/horizon, journées distinctes et Wilson ; historique adéquat non inventé, modèle non qualifié au départ |
| 19 | Répartition entre cinq domaines | Scans séparés et statistiques par catégorie |
| 20 | Moins de doublons d'événement | Variantes regroupées avant sélection |
| 21 | Moins de sélection toujours identique | Priorité aux événements les moins récemment examinés |
| 22 | Recherche du spécialiste | Requêtes Gamma supplémentaires, bornées et dédupliquées |
| 23 | Couverture honnête du catalogue | Catalogue borné explicitement annoncé |
| 24 | Entonnoir de sélection | Découverts, recevables, événements, sélection, exclusions |
| 25 | Observation distincte de mise | SHADOW sans ledger, positions ni fills financiers |
| 26 | Source manquante visible | DATA_PENDING, pas de faux fait pour compléter le dossier |
| 27 | Fin des incitations à investir coûte que coûte | Nouveau prompt `prompts.ts` |
| 28 | Pas de consensus demandé | Avis personnels et objections falsifiables |
| 29 | Première prévision indépendante | Aucun prix ni avis d'autrui dans le contexte initial |
| 30 | Trace avant débat immuable | BEFORE en écriture seule, trigger SQLite |
| 31 | Révélation commune | Événement FORECAST_REVEAL horodaté |
| 32 | Fonction Quant précise | Hypothèses, calculs, prix tout compris |
| 33 | Fonction Risk précise | Trésorerie et exposition, pas de veto personnel |
| 34 | Contradiction utile | Hypothèse réfutable et objection nouvelle |
| 35 | Chairman responsable | Amendement, question, arbitrage et annulation possibles |
| 36 | Abstention motivée | Justification et condition de réexamen obligatoires |
| 37 | Absences reprises explicitement | Pause, tentative bornée, règles de quorum conservées |
| 38 | Évaluer le débat | Comparaisons avant/après appariées sur les mêmes dossiers ; pas de causalité prétendue |
| 39 | Aucun quota de paris | Aucun achat forcé pour remplir un objectif d'activité |
| 40 | Qualification avant fonds | `evaluation.ts`, seuils et raisons visibles |
| 41 | Qualification par domaine/méthode | Un domaine performant ne valide pas tous les autres |
| 42 | Petit pilote distinct | 100 € fictifs avant fonds complet |
| 43 | Réserve explicite | `allocation.ts`, calcul Decimal |
| 44 | Libération progressive | Enveloppe initiale puis progression temporelle |
| 45 | Mise reliée à l'incertitude | Kelly fractionné prudent après qualification seulement |
| 46 | Corrélation par événement | Exposition agrégée et plafond, variantes non indépendantes |
| 47 | Suspension sur dégradation mesurée | Scores récents significativement sous la référence ; aucune perte isolée assimilée à une faute |
| 48 | Référence d'allocation réalisable | Portefeuille contrefactuel à capital borné, mises simultanément réservées ; comparaison de politiques optimales non démontrée |
| 49 | Mémoire de résultats vérifiés | `r4_outcomes`, provenance et date de connaissance |
| 50 | Recherche ciblée | Événement exact, catégorie, station, jour et type |
| 51 | Avis antérieurs distingués des faits | Pas d'ancienne opinion donnée comme preuve indépendante |
| 52 | Secrétaire relié au conseil | Demandes et documents retrouvés archivés ; aucune recherche factice |
| 53 | Leçons de la phase 3 conservées | Import à empreinte du fichier, sans crédit de validation |
| 54 | Révisions traçables | Chaque révision puis AFTER au vote, sans écraser BEFORE |
| 55 | Prévision distincte de décision | Score de probabilité indépendant du vote et du résultat financier |
| 56 | Dimensionnement distinct | Mise, frais, cash et risque calculés côté moteur |
| 57 | Apprentissage sans fuite temporelle | Calibration sur résultats antérieurement connus, événements distincts |
| 58 | Aucun faux réentraînement | Mémoire contextuelle et calibration décrites ; paramètres LLM inchangés |
| 59 | Pas de réunion artificielle | Bilan sans LLM si pas de dossier admissible |
| 60 | Pas de répétition d'un dossier bloqué inchangé | Empreinte des faits et report jusqu'à nouveauté |
| 61 | Réexamen après changement réel | Changement des faits impose de nouvelles prévisions |
| 62 | Contexte borné | `context.ts`, textes secondaires raccourcis |
| 63 | Règles et chiffres protégés | Règles intégrales, proposition exacte, observations typées ; profondeur affichée bornée et explicitée |
| 64 | Coûts par fonds et membre | Tokens, appels inconnus, estimation min/max |
| 65 | Coûts par réunion | Attribution via meeting_id ; dossiers et rôles distincts dans les clés d'appel |
| 66 | Test/pilote/fonds séparés | Objets et journaux indépendants, routing allowlist |
| 67 | Dashboard humain | Prévisions, débats, votes, raisons et résultats en français |
| 68 | Mobile et archives | Navigation téléphone, replay, anciens fonds accessibles |
| 69 | Couverture temporelle réelle | Périodes absentes comptées, cinq catégories requises |
| 70 | Watchdog indépendant | GitHub, réveil et ntfy sur changement d'état |
| 71 | Version active vérifiable | Métadonnée Cloudflare et empreinte de politique |
| 72 | Gel en cours d'expérience | Code modifié : nouveaux avis suspendus, règlements conservés |
| 73 | Tests de reprise et comptabilité | Pilote, perte de réponse, redémarrage, règlement sans double mouvement |
| 74 | Contextes et volume | Test de centaines de positions ; pas de prétendue endurance réelle de plusieurs jours |
| 75 | Pannes de fournisseurs | Erreurs explicites, retries bornés, circuit et diagnostic préflight |
| 76 | Stockage et export | SQLite isolé, preuves épinglées, caches transitoires, pages gzip et SHA-256 |
| 77 | Restauration vérifiable | Objet vierge privé, lots idempotents, comptages, lecture seule, aucune exécution automatique |
| 78 | Quotas gratuits suivis | Compteurs locaux, marge pour comptes/règlements, limites du compte global explicites |
| 79 | Résultats tardifs honnêtes | CLOSING et surveillance officielle, aucune liquidation ni paiement inventé |
| 80 | Contrefactuels équitables | Carnet archivé, référence 10 €, déduplication et capital borné ; pertinence initiale distincte du gain ultérieur |

## Ce qui ne peut pas être déclaré acquis au déploiement

- La supériorité prédictive des agents, leur calibration future ou une rentabilité.
- Une méthode météo ou sportive statistiquement qualifiée sans historique adéquat et évaluation prospective.
- Une disponibilité réelle de 95 % pendant des jours sur la seule base de tests logiciels.
- La couverture de tous les jeux esport, blessures, compositions ou observations absentes des sources gratuites.
- Des quotas illimités ou l'absence de retard de règlement officiel.
- L'utilité causale de chaque rôle : une comparaison avant/après sur les mêmes dossiers est descriptive ; une véritable ablation nécessite une expérience contrôlée future.

Ces limites sont affichées et empêchent de confondre une capacité implémentée avec un résultat scientifique déjà établi.
