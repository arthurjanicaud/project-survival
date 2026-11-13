# Incident de lectures de stockage — 12 novembre 2026

## Constat

La protection locale arrêtait toutes les nouvelles recherches au-delà de 80 % du plafond de référence. Le dernier scan confirmé était le 12 novembre à 02:50:57 UTC, soit 03:50:57 Paris. Le compteur local dépassait 4,27 millions de lectures. Le plafond réel partagé du compte Cloudflare a ensuite été atteint ; les endpoints ont répondu `Exceeded allowed rows read in Durable Objects free tier.` Les compteurs d'un seul objet ne couvrent pas tout le compte.

La limite du fournisseur n'est ni supprimée ni contournée. Cloudflare documente une remise à zéro quotidienne à 00:00 UTC, soit 01:00 Paris en novembre. Tant que le fournisseur refuse SQL, le correctif ne peut ni lire le portefeuille ni prétendre que la recherche a repris.

## Corrections

- Les dates de dernier examen sont lues en une seule requête groupée et mises en cache, au lieu d'une recherche complète de l'historique pour chaque événement du catalogue.
- Index ajoutés pour événement/date, derniers dossiers, prévisions, résultats, agendas et jobs par type/statut. Les requêtes du dashboard avec LIMIT n'ont plus besoin de trier tous les dossiers.
- Le prochain réveil utilise deux recherches indexées avec LIMIT 1, au lieu d'agréger tous les jobs futurs. Cela s'applique aussi au moteur historique.
- Les scores ne sont recalculés qu'après des données qui peuvent les changer. La réception d'un nouveau résultat et l'ajout tardif d'une prévision pour un résultat déjà connu invalident les caches.
- Les compteurs quotidiens restent conservés. À 80 %, un flux réduit de recherches reste possible, équitablement par domaine ; à 90 %, la marge restante est réservée aux comptes et règlements. Les tentatives différées pour budget ne consomment pas les tentatives de reprise technique.
- Les anciens scans sont remplacés selon leur bucket d'observation, même s'ils avaient été repoussés dans le futur par le quota. Cela évite d'accumuler les anciennes recherches.
- Le watchdog externe devient l'unique expéditeur des incidents de recherche. Il notifie les changements d'état et le retour à une progression réelle ; le moteur conserve un journal d'incident sans envoyer une alerte toutes les trente minutes.
- Un quota fournisseur renvoie désormais HTTP 503, sa remise à zéro prévue et un délai de nouvelle tentative. Le Worker utilise un circuit de cinq minutes, sans modifier les données. Le dashboard explique le blocage au lieu d'afficher une erreur générique.
- Pour le quota confirmé du 12 novembre, une pause technique expirant automatiquement le 13 novembre à 00:00 UTC évite de répéter des lectures impossibles avant la remise à zéro. Elle ne modifie ni le compteur du fournisseur ni les comptes de l'expérience.
- Le workflow externe conserve son état d'incident même si une étape suivante échoue. Pendant un quota global, il suspend la collecte et le relais devenus impossibles et émet une seule alerte groupée, au lieu de recommencer les mêmes notifications à chaque passage.
- Les lectures et requêtes coûteuses du dernier cycle sont consultables via l'endpoint privé `/admin/query-costs?phase=4&stage=full`. Les valeurs sont celles du curseur SQLite en production, pas une estimation de facturation inventée.

## Vérification locale de coût

Un test utilise le vrai moteur SQLite sur un jeu synthétique de 5 000 lignes, avec les index de l'ancienne version comme référence. Il compte les instructions VM par blocs de 100 ; ce compteur n'est pas la facture Cloudflare.

| Opération testée | Ancien travail VM | Nouveau travail VM |
|---|---:|---:|
| Historique pour 1 000 événements | 15 026 100 | 63 100 |
| Derniers 60 dossiers | 75 400 | 800 |
| Prochain réveil | 40 100 | 100 |

Les tests vérifient également les plans de requête, l'invalidation des scores, l'équité du rythme réduit, les alertes sans doublons et l'absence de réinitialisation financière.

## Reprise de cette expérience

Un amendement technique strictement limité à `survival-004-active`, à l'ancienne version Cloudflare `5e038186-a995-46d3-8bd6-28b9e43df491` et à l'empreinte de politique `bf727ff20cdb97d8893b413bbfdc0df3a94d3900dcf207869f8f46b6d9cb3cff` autorise ce correctif au prochain accès possible au stockage. Il est demandé par le propriétaire et enregistré dans `r4:technical_repair` et le journal d'événements.

Il conserve la même base, le journal financier, les positions, les règles de mise, started_at et end_at. Aucun START, aucune restauration d'un snapshot ancien et aucune remise à zéro de consommation ne sont effectués. Les recherches périmées sont remplacées par de nouvelles observations ; les réunions manquées restent comptées comme manquées.

Le cron Cloudflare réessaie les réveils et le watchdog GitHub continue ses contrôles. La reprise effective doit être confirmée par un nouveau last_scan et les lectures des cycles de production après la remise à zéro. La date de fin reste le 18 novembre à 16:19 Paris.

Source du plafond et du reset fournisseur : https://developers.cloudflare.com/durable-objects/platform/pricing/

## Nouvel incident du 13 novembre : écritures

Les métriques officielles GraphQL `durableObjectsPeriodicGroups` montrent le renouvellement du quota : le 13 novembre UTC, le namespace ReformCouncil a consommé 565 252 lectures et 109 521 écritures, contre 51 300 lectures et 305 écritures pour Council (mesure vers 15:55 UTC). L'essentiel des nouvelles écritures s'est produit entre 01:00 et 02:00 UTC. Le plafond quotidien d'écritures est de 100 000 pour le compte. Ce nouvel incident ne résulte donc pas d'un quota de lectures resté bloqué la veille.

Un endpoint privé sans migrations, préparation d'expérience, mesure persistante ni réveil a été déployé pour lire l'état. Même ses seuls SELECT échouent avec `Exceeded allowed rows written in Durable Objects free tier.` L'état financier courant et les dernières requêtes ne sont donc pas récupérables par cet accès tant que le fournisseur refuse SQL. Aucun export réussi ni nouvelle activité n'est annoncé.

L'audit du code identifie une boucle de croissance possible : une erreur d'un job NOTIFY créait une notification d'incident, donc un nouveau job NOTIFY. Le déclenchement du relais utilisait en outre l'ancien propriétaire GitHub. Faute d'accès SQL aux erreurs historiques, on ne peut pas attribuer avec certitude toutes les écritures de production à cette seule boucle.

Corrections du 13 novembre :

- Une erreur de notification reste journalisée et ne génère jamais une autre notification. En phase 4 avec github-relay, les jobs de notification ne déclenchent plus eux-mêmes de workflow : le consommateur planifié toutes les cinq minutes conserve cette responsabilité.
- Les adresses de déclenchement du moteur historique visent le dépôt canonique `arthurjanicaud/project-survival`.
- Les anciens jobs et messages récursifs sont exclus de la sélection, du calcul du prochain réveil et de l'envoi. Leur historique est conservé. L'amendement ne modifie qu'au plus 20 anciennes notifications et 20 jobs ; aucune purge massive ne consomme le nouveau quota.
- L'insertion d'un événement déjà connu s'arrête avant INSERT OR IGNORE : SQLite n'avance plus AUTOINCREMENT sur chaque doublon.
- La purge du cache est limitée à 100 entrées par dix minutes et par instance active ; le journal financier n'est pas concerné.
- La télémétrie des requêtes HTTP est regroupée au maximum une fois par minute. Les diagnostics de coût affichent aussi les requêtes les plus coûteuses en écritures.
- Une erreur de quota dans une alarme n'essaie plus d'écrire un autre incident ou d'entretenir le réveil en échec. Les accès externes sont suspendus jusqu'au 14 novembre 00:00 UTC, soit 01:00 Paris, puis le cron retente automatiquement.
- La préparation/adoption technique est aussi exécutée au réveil d'une alarme, avant de traiter les tâches.

L'amendement `write-opt-20261113` n'accepte que les deux versions précédentes explicitement identifiées (`5e038186-a995-46d3-8bd6-28b9e43df491` et `c85214f3-946f-441b-bbd3-316f16ea4b0f`), l'identifiant `survival-004-active` et la même empreinte de politique. Une version ultérieure non autorisée reste suspendue. Aucun START, changement de capital, pari, restauration ou prolongation n'est effectué.

Commande privée de contrôle après renouvellement : `python operations/reform_admin.py storage-diagnostic --stage full`. La reprise ne sera effective qu'après un nouveau `last_scan` réel ; le watchdog indépendant doit la constater. Les tests locaux vérifient 1 000 doublons sans nouvelle écriture, l'absence de récursion après un échec d'envoi, l'exclusion de 1 000 anciens jobs récursifs, le bornage de la maintenance et la conservation des comptes pendant l'adoption.
