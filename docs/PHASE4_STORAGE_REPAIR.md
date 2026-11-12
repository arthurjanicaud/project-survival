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
