# Refonte après phase 3 - suivi d'implémentation

Objectif autorisé : appliquer les 80 corrections discutées. Aucun START de compétition n'est implicite.
Les archives et comptes phase 3 sont conservés. Le protocole de remplacement sera isolé, préparé en READY,
avec une étape d'observation sans mises, puis des fonds pilotes et complets distincts soumis à qualification.
Un correctif logiciel et une hypothèse de performance ne sont pas la même chose : l'échantillon futur reste nécessaire.

## Séquence de travail

1. Politique validée et figée, données typées, probabilités et calibration hors échantillon.
2. Observations météo/règles de station, qualité et recherche documentaire précise.
3. Prévisions indépendantes, conseil, votes et fonds de paper trading reliés à la politique.
4. Mesure, surveillance, coûts, exports et récupération sur longue durée.
5. Dashboard pédagogique, vérification locale et déployée, documentation et trace des 80 points.

## État vérifié le 11 novembre 2026

- Protocole réformé déployé dans une classe Cloudflare séparée. Trois fonds READY, aucun START.
- Prévisions indépendantes, révélation, débat, votes, paper trading Decimal et règlements reliés.
- Météo : relevés routine, priorité T, corrections, journée locale et source de règlement contrôlés.
- Tests locaux : pilote complet et reprise sans double débit/paiement, faits modifiés, contexte avec
  centaines de positions, sauvegarde/restauration, absence de membres et couverture d'une semaine synthétique.
- Préflight hébergé : Gamma et carnets YES/NO accessibles, au moins une source extérieure retrouvée
  pour chacun des cinq domaines. Flux football UWCL et bra.2 ajoutés après diagnostic réel.
- Sonde Azure hébergée : réponse structurée ok=true, 622 tokens entrée / 17 sortie pour le test initial.
- Leçons phase3 importées avec empreinte du fichier source ; zéro échantillon de qualification ajouté.
- Deux sauvegardes restaurées dans des objets privés recovery-r4 en lecture seule, vérification des
  comptages et lots répétables ; aucun START, aucun mouvement de fonds lors de cette vérification.
- Watchdog externe exécuté : aucun incident actif. Secrets GitHub du relais synchronisés.
- Dashboard vérifié localement sur ordinateur et viewport 390×844 : navigation, conseil, diagnostics,
  données réelles READY et absence de débordement horizontal. Publication et CI vérifiées séparément.
- Les tests backend/frontend et leurs résultats finaux sont consignés dans le contrôle GitHub du commit.

Voir PHASE4_CORRECTIFS.md pour les 80 points et PHASE4_GUIDE.md pour les commandes et limites.
Les seuils de qualification sont des choix d'expérience. Aucun modèle sportif ou météo entraîné n'est
prétendu qualifié au départ, aucune performance future ni disponibilité de plusieurs jours n'est inventée.
Une véritable ablation contrôlée des rôles et les performances des politiques d'allocation restent des
expériences à mesurer ; le système fournit les prévisions appariées et contrefactuels nécessaires.

## Vérifications documentaires

- https://aviationweather.gov/data/api/ : observations METAR, date du rapport et distinction routine/SPECI.
- https://open-meteo.com/en/docs/historical-forecast-api : ne pas substituer la réanalyse météo à une prévision historique.
- https://developers.cloudflare.com/durable-objects/platform/pricing/ : limites gratuites quotidiennes de lectures/écritures distinctes du stockage.

## Correspondance à maintenir

1-8 : probabilités, méthodes, intervalles, calibration, comparaison et séparation temporelle.
9-18 : preuves pertinentes, observations, fraîcheur et limites des sources gratuites.
19-26 : sélection, couverture équilibrée, variantes et recherche demandée par les spécialistes.
27-38 : consignes, indépendance avant débat, rôles, votes et évaluations comparées.
39-48 : réserve, allocation progressive, risques communs et qualification des méthodes.
49-58 : mémoire structurée, recherche ciblée, leçons mesurables et validation ultérieure.
59-68 : convocations utiles, dossiers compacts, coûts attribués et affichage compréhensible.
69-80 : couverture réelle, alertes, version active, endurance, quotas, sauvegardes et évaluations équitables.
