# Nouveau protocole après la phase 3

## Principe

Les spécialistes donnent une probabilité et un intervalle avant de voir les prix et les autres avis. Le conseil révèle ensuite les prévisions, débat et vote sur une proposition précisément versionnée. Une méthode subjective reste appelée `judgement`, sans se prétendre calibrée. Les résultats officiels permettent de mesurer précision, calibration et comparaison aux prix sur les mêmes événements. Le score de Brier est la moyenne des erreurs au carré : plus bas est meilleur.

Le fonds de la phase 3 n'est ni remis à zéro ni recyclé.

| Étape | Identifiant | Capital fictif | Condition de départ |
|---|---|---:|---|
| Observation | survival-004-shadow | 0 € | START explicite |
| Pilote | survival-004-pilot | 100 € | Observation qualifiée + START |
| Fonds complet | survival-004-full | 1 000 € | Observation qualifiée, pilote avec mises terminé non négatif + START |

Chaque étape dure 168 heures après son propre START. L'ensemble peut donc dépasser une semaine. L'observation ne constitue pas la compétition du fonds complet. Comptabilité en unités de cotation, référence EUR/USD horodatée et figée au départ.

## Commandes

Dashboard : https://project-survival.pages.dev/?phase=4&stage=shadow . Archives : `?phase=3`, `?phase=2`, `?phase=1`. L'ancien `?mode=demo` reste une démonstration identifiée. Les réunions sont lisibles sur téléphone et ordinateur.

Depuis la racine du dépôt :

```powershell
.venv\Scripts\python.exe operations/reform_admin.py state
.venv\Scripts\python.exe operations/reform_admin.py health
.venv\Scripts\python.exe operations/reform_admin.py preflight
.venv\Scripts\python.exe operations/reform_admin.py probe-azure
.venv\Scripts\python.exe operations/reform_admin.py qualification
```

Le préflight vérifie des connecteurs et marchés réels, sans démontrer une capacité prédictive. La sonde Azure consomme un petit appel mesuré, jamais un investissement. Les anciennes leçons peuvent être importées une seule fois avant l'observation : `seed-history --input exports/phase3-final-export.json`. Elles ne donnent aucun crédit de validation.

Seulement au moment choisi :

```powershell
.venv\Scripts\python.exe operations/reform_admin.py start --confirm survival-004-shadow
# Après qualification mesurée :
.venv\Scripts\python.exe operations/reform_admin.py start --stage pilot --confirm survival-004-pilot
# Après évaluation du pilote :
.venv\Scripts\python.exe operations/reform_admin.py start --stage full --confirm survival-004-full
```

START n'est jamais une remise à zéro. Le lancement papier refuse une observation non qualifiée. Les paramètres centraux sont dans `council/src/reform/policy.ts` : 48 h minimum d'observation, 100 événements réglés hors entraînement, 30 par méthode/domaine, couverture 95 %, erreur de calibration au plus 0,10, borne basse d'amélioration positive face au marché. Ce sont des choix de recherche, sans garantie ; une méthode peut ne jamais les atteindre.

Les 24 premières heures constituent l'entraînement prospectif. Les résultats doivent avoir été effectivement connus avant la coupure. Les variantes du même événement restent regroupées. Les anciens avis ne sont pas des observations ; la dispersion météo n'est pas un intervalle stationnel calibré. Le module de résidus météo exige au moins 30 journées stationnelles distinctes et un historique vérifiable. Aucun historique ni modèle entraîné n'est inventé au lancement.

## Allocations et réunions

Les mises restent jusqu'au règlement officiel : aucune vente, aucun levier, aucun ordre réel. Réserve de 20 %, limite de 5 % par mise et 20 % par événement commun. Une enveloppe initiale de 20 % progresse sur la durée. Le Kelly fractionné utilise la borne prudente et les frais du carnet ; une méthode non qualifiée ne reçoit pas de mise. Ces valeurs ne sont pas prétendues optimales. Les méthodes dont les scores récents sont significativement moins bons que la référence sont suspendues.

Réunions à 9 h, 13 h, 17 h et 21 h Paris, plus urgences si une occasion expire avant le prochain créneau. Sans dossier prêt, un bilan remplace le faux débat. Les modifications de marché nécessitent une nouvelle prévision aveugle ; côté et montant imposent une nouvelle version de proposition. Absences, abstentions, réexamen et arbitrage sont tracés. Aucun quota de paris ni injonction de consensus.

## Données

Polymarket Gamma/CLOB/règlements publics, NOAA AWC, Open-Meteo, ESPN et Dota via le collecteur commun. Le catalogue reste borné. Les spécialistes peuvent demander une recherche ciblée supplémentaire. Les événements sont répartis entre domaines, les variantes ne monopolisent pas les places. Un jeu esport sans connecteur ne reçoit pas des données Dota par substitution.

Météo : station, journée locale, max/min, unité et seuil reconnus. Les observations routine sont distinctes des prévisions maillées. Le groupe T en dixièmes prime sur les degrés entiers ; les SPECI sont exclus et une correction remplace le rapport antérieur. Un extrême déjà observé peut exclure une tranche, sous réserve de corrections. Il ne constitue jamais le règlement officiel.

Une fin prévue six heures avant la clôture ne garantit pas un paiement à temps. Après l'échéance, les nouvelles décisions s'arrêtent ; le moteur surveille les positions et affiche CLOSING tant que des résultats officiels manquent. Aucun paiement n'est inventé.

## Infrastructure et limites

Le moteur utilise Cloudflare Durable Objects SQLite ; le nouveau protocole n'écrit pas dans Supabase. Les journaux financiers et prévisions initiales sont immuables. Réveils, baux et transactions protègent des doubles exécutions. Les scans dépassés sont remplacés ; votes et mouvements sont conservés.

La politique et le code actif Cloudflare sont affichés. Un changement de code pendant un run suspend les nouvelles décisions, tandis que les règlements restent suivis. La qualification et les étapes suivantes exigent la même version de code et de politique ; un pilote sans aucune mise ne valide pas le fonds complet. Ne pas redéployer une semaine en cours comme un changement neutre de méthode.

Un watchdog GitHub externe contrôle la progression, tente un réveil et alerte via ntfy. Il ne lance pas START. GitHub et ntfy restent des dépendances ; leur disponibilité absolue n'est pas garantie. Le relais et le collecteur fonctionnent environ toutes les cinq minutes ; GitHub peut retarder les horaires.

Les quotas affichés sont locaux au moteur, pas au compte Cloudflare entier. À 80 % du plafond local de référence, la recherche ralentit pour préserver comptes et règlements. Les quotas fournisseurs existent toujours. Les sources exploratoires sont temporaires ; les dossiers épinglent leurs preuves. Les journaux restent conservés, la taille SQLite est exposée dans health.

Les coûts Azure estimés à partir des tokens sont séparés par fonds, membre et réunion. Ce ne sont pas des factures. Aucun plafond financier arbitraire n'est réintroduit.

## Sauvegarde

```powershell
.venv\Scripts\python.exe operations/reform_admin.py export --stage shadow --output exports/reform/shadow
.venv\Scripts\python.exe operations/reform_admin.py restore --input exports/reform/shadow --instance recovery-r4-audit --confirm survival-004-shadow
```

Pages gzip NDJSON, manifeste SHA-256, propositions versionnées incluses. Un verrou temporaire met en pause les mutations pendant l'export cohérent : au plus dix minutes, libération automatique si panne. Un export trop long échoue. La restauration vise exclusivement un espace recovery-r4 vierge, reste en lecture seule, vérifie empreintes et comptages, accepte les lots répétés et ne lance aucun job.

Vérification privée : `/admin/recovery-state?phase=4&instance=recovery-r4-audit`. La restauration volontaire d'un moteur actif nécessite un audit distinct. Les artefacts du workflow `council-backup.yml` restent deux jours ; télécharger les sauvegardes à conserver durablement. La rétention gratuite n'est pas illimitée. Les exports JSON historiques utilisent aussi des pages.

## Tests

```powershell
cd council
npm run check
npm test
npm run build
cd ../frontend
npm run build
node --test tests/*.test.mjs
cd ..
.venv\Scripts\python.exe -m pytest -q
```

Les tests couvrent comptabilité, frais, liquidité, votes, reprise, prévisions immuables, contrefactuels, météo, fuite temporelle, contexte et restauration. Les fixtures utilisent SQLite en test ; ALLOW_FIXTURES=true est refusé par le protocole live réformé. Des tests réussis ne mesurent ni rentabilité ni 48 heures de disponibilité réelle. Scores, couverture temporelle et réunions tenues restent à observer.
