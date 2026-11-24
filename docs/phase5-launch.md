# Phase 5 — lancement explicite

Le fonds officiel `survival-005-active` dispose de 1 000 EUR fictifs communs. Le test technique `survival-005-smoke` utilise une autre base et son capital ne compte jamais dans le classement. Les archives restent dans leurs bases historiques.

Dans le workflow **Council on GitHub (durable SQLite)**, exécuter successivement :

1. `action=initialize` : créer explicitement les nouvelles bases, vérifier les cinq domaines sans appel Azure. Le fonds reste READY, sans crédit comptabilisé.
2. `action=smoke` : tester les cinq spécialistes avec Azure et un conseil réel isolé. Les opinions, votes et investissements éventuels sont libres. Les notifications sont préfixées TEST. Un refus motivé peut valider la chaîne technique ; un membre absent ne la valide pas.
3. `action=start`, `confirm=survival-005-active` : refaire les contrôles de données puis créditer le fonds une seule fois. Un test réussi avec le même moteur et la même politique est obligatoire.

START enregistre le taux de référence réel et les dates UTC. L'expérience dure 168 heures ; les évènements doivent se terminer au moins six heures avant l'échéance. Relancer START ne réinitialise rien. Une expérience terminée nécessite un nouvel identifiant et une nouvelle initialisation explicite.

Les cycles programmés utilisent GitHub Actions. Les heures de réunion sont celles du protocole en heure de Paris. GitHub ne garantit pas leur ponctualité : un rattrapage de moins de trente minutes reste signalé en retard et ne compte pas comme réunion ponctuelle. Les sauvegardes SQLite sont chiffrées et les écritures sérialisées.

Le tableau de bord officiel est `https://project-survival.pages.dev/?phase=5`. Le test se consulte avec `&stage=smoke` ; les archives précédentes avec `?phase=4`.

À l'échéance, aucune nouvelle décision d'investissement n'est permise. Un règlement réellement publié est nécessaire pour payer une position : une résolution en retard reste explicitement en attente, sans cours ni remboursement inventé. Le rapport JSON final est publié seulement après règlement de toutes les positions.

Les crédits Azure sont réellement consommés pendant le test. Les jetons et appels sont enregistrés ; un test synthétique local ne remplace pas ce contrôle réel. Aucune transaction avec de l'argent réel n'est disponible dans ce moteur.

Après START, chaque runner déclenche le suivant tant que le fonds officiel est RUNNING ou CLOSING. La sérialisation empêche les écritures concurrentes ; le cron reste un secours indépendant de cette chaîne dans GitHub. Les fonds READY, terminés et les tests ne déclenchent pas cette chaîne. Une indisponibilité globale de GitHub reste une limite externe.
