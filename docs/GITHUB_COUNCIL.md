# Conseil sur GitHub Actions

## Ce qui change

Le moteur TypeScript du conseil est commun aux deux environnements. `reform/runtime.ts` contient les routes, les tâches et les reprises ; l'ancien Worker est seulement un adaptateur. Le nouveau `src/node/host.ts` utilise Node 24, SQLite sur disque (WAL, synchronous FULL), une transaction pour chaque mutation atomique et le même journal append-only. Les tests de votes, de données, de règlement, de frais et d'apprentissage s'appliquent aux deux.

Cloudflare Pages peut continuer à servir les fichiers du dashboard. Le moteur et les nouvelles lectures de phase 4 ne consultent plus les Durable Objects. Les anciens liens phase 1/2/3 restent des archives distinctes ; leur migration n'est pas nécessaire au fonctionnement du nouveau conseil.

## Stockage durable et confidentialité

- Chaque checkpoint utilise `VACUUM INTO` pour produire une image SQLite cohérente, gzip et AES-256-GCM avec un nonce aléatoire. Le nom du périmètre est authentifié, ce qui interdit de restaurer une base pilote à la place du fonds.
- Les sauvegardes chiffrées sont des fichiers de la release GitHub `council-state`, **pas** des artefacts à expiration, des caches ni des binaires ajoutés à chaque commit. Une base inchangée ne fait pas l'objet d'un nouvel envoi. Les archives terminées sont figées : elles ne sont ni recopiées ni recompressées à chaque cycle. Les trois dernières images de chaque périmètre sont conservées.
- La branche `survival-state` contient un manifeste et les produits publics nécessaires au dashboard. Aucun endpoint administratif ni outbox ntfy n'est exporté. Les valeurs secrètes connues sont retirées du texte publié. La clé `COUNCIL_STATE_KEY` reste dans le `.env` ignoré et les secrets Actions ; une copie hors GitHub est nécessaire pour une récupération indépendante.
- Un nouveau fichier est envoyé avant la publication de son manifeste. Le push Git normal fait office de contrôle de concurrence : aucun force-push, aucun portefeuille vide de secours en cas d'échec de restauration. Un échec de sauvegarde arrête le runner.
- Une concurrence unique Actions et un verrou local interdisent les deux écrivains. Les baux SQL reprennent les tâches interrompues. Les écritures financières et identifiants uniques restent les protections contre les doubles paris/règlements.
- Le dernier checkpoint confirmé est le point de reprise, pas les fichiers temporaires du runner. Une coupure peut refaire du calcul depuis ce point ; un appel Azure accepté juste avant une coupure peut être facturé à nouveau lors d'une reprise. Aucun ordre financier réel n'est possible.
- Les checkpoints sont regroupés à environ trente secondes pendant les tâches et à la sortie normale. Les images dépassant 512 Mio par base ou 50 Mio compressés sont refusées explicitement ; il faudra alors déplacer/archiver des données non financières, sans supprimer le journal.

## Exécution et direct

`council-actions.yml` se réveille environ toutes les cinq minutes, déchiffre l'état, traite les tâches pendant quatre minutes, collecte les données publiques et envoie les notifications ntfy. Il sauvegarde et publie les résultats régulièrement. Le prochain runner reprend au dernier état confirmé. Les appels IA ne sont pas déclenchés par un simple rafraîchissement du dashboard.

Le navigateur interroge les exports publics toutes les quinze secondes ; il affiche des interventions effectivement produites et sauvegardées. Ce mécanisme est du polling de snapshots, pas une connexion WebSocket. Le délai de calcul, de sauvegarde, les caches GitHub et les retards du planificateur s'ajoutent. Le cron Actions ne garantit pas moins de cinq minutes de retard ; des réunions peuvent être décalées. Il n'y a pas de ralentissement artificiel des agents.

Le dépôt doit rester public et utiliser des runners Linux standards pour bénéficier du calcul gratuit. Les limites d'API GitHub, la taille de stockage et les disponibilités des fournisseurs continuent de s'appliquer. Cette migration ne garantit ni un SLA ni un bénéfice.

## Configuration

Secrets : `COUNCIL_STATE_KEY` (64 caractères hexadécimaux générés aléatoirement), `COUNCIL_ADMIN_TOKEN`, `COUNCIL_NTFY_TOPIC`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`. Le workflow utilise son `GITHUB_TOKEN` éphémère avec `contents: write`, pas un jeton Cloudflare ni un jeton GitHub personnel conservé dans le moteur.

Variables : `COUNCIL_ACTIONS_ENABLED=true` après validation ; `COUNCIL_AZURE_DEPLOYMENT=gpt-6.1-sol-3` par défaut. Le frontend accepte `VITE_COUNCIL_SNAPSHOTS` pour une autre origine publique. Le jeton `CLOUDFLARE_ANALYTICS_TOKEN` n'est plus requis.

## Migration sans START

1. Exporter les trois périmètres par `operations/reform_admin.py export --stage full|shadow|pilot --output exports/actions-migration/<stage>`. Chaque export exige un checkpoint cohérent.
2. `cd council` puis `node --import tsx src/node/bootstrap.ts ../exports/actions-migration ../data/actions` : import neuf uniquement, vérification SHA-256 et nombre de lignes pour toutes les tables.
3. Vérifier l'empreinte du journal, des positions et fills par rapport à `/admin/integrity`. Ne pas modifier les dates, le capital ni la politique archivés.
4. Initialiser `survival-state`, publier le premier checkpoint chiffré avec le host Node, puis vérifier sa restauration dans un autre répertoire.
5. Déployer le workflow et lancer manuellement avec `preflight=true`. Aucun START ; clé Azure retirée du host dans ce mode. Les cinq connecteurs doivent être examinés, avec un échec explicite si certains sont indisponibles.
6. Après validation, activer `COUNCIL_ACTIONS_ENABLED` et retirer les cron Cloudflare. Les anciens workflows de services, validation et sauvegarde Cloudflare se mettent en retrait automatiquement.

Le host de migration refuse toujours `/admin/start`. Il ne réinitialise pas un fonds fini. La prochaine compétition nécessitera un nouvel identifiant, une initialisation séparée et un START explicitement autorisé ; la migration technique seule ne démarre pas de semaine.

## Vérifications

`cd council; npm run check; npm test; npm run build`

Le contrôle de reconstruction sur disque vérifie l'intégrité de la sauvegarde, les mauvaises clés/périmètres, l'immuabilité du journal, les identifiants uniques et la reprise d'un bail. Les sondes de sources réelles et les tests synthétiques restent distincts.

## Récupération et export

Arrêter les dispatchs d'abord (`COUNCIL_ACTIONS_ENABLED=false`) et attendre la fin du seul runner. Lire le manifeste courant de `survival-state`, récupérer les assets désignés et vérifier leur SHA-256. Avec la clé de secours, `node --import tsx src/node/state-cli.ts restore` restaure les bases dans `COUNCIL_DATA_DIR`. Ne jamais restaurer par-dessus un processus SQLite actif ou un fichier WAL.

Commande d'export local, depuis `council` : `node --import tsx src/node/export-cli.ts ../data/actions/full.sqlite ../exports/actions-json-csv`. Le répertoire doit être neuf ; les sommes restent des chaînes décimales et la base source est ouverte en lecture seule.

Les anciennes archives gzip NDJSON et leurs manifestes restent disponibles localement dans `exports/actions-migration`. L'export JSON/CSV peut être réalisé en lecture sur ces bases SQLite ; aucun appel de marché ni aucune IA n'est nécessaire pour lire le journal, les positions, les votes ou les débats.

Les réveils ordinaires sans fonds actif ni précontrôle à reprendre se terminent immédiatement après la restauration. Le workflow de validation réutilise le même moteur, sans Azure et sans START, deux fois par heure jusqu’à la borne `COUNCIL_VALIDATION_UNTIL` ; il partage le verrou du moteur.

Sur Node, un flux sportif public absent est récupéré directement par le moteur puis mutualisé avec son véritable horodatage. Le moteur respecte les délais/cooldowns fournisseurs ; une erreur ne devient pas une donnée inventée. L'ancien Worker conserve son relais de collecte, sans changement de comportement pour les archives.

Le précontrôle tennis privilégie les rencontres à venir afin de tester le complément avant-match ; les rencontres en cours exigent toujours un véritable score en direct. Ce choix de diagnostic ne force aucune décision du spécialiste.

## Configuration de publication vérifiée lors de la bascule

La branche de données `survival-state` est exclue des previews Cloudflare Pages (`preview_deployment_setting=custom`, `preview_branch_includes=["*"]`, `preview_branch_excludes=["survival-state"]`). Une sauvegarde ou une intervention ne doit pas reconstruire le site ; seule une modification du frontend nécessite une nouvelle version du dashboard. La production reste sur `main`. Les cron du conseil et de l'ancien watchdog Cloudflare ont été retirés ; les Workers restent accessibles pour lire les anciennes archives.

La version figée du moteur Node est fondée sur l'arbre Git `council/src` et le déploiement Azure. Une modification du dashboard ou de la documentation ne suspend donc pas une compétition ; une modification du moteur reste détectée et suspend les nouveaux avis, comme prévu par le protocole.

## Source esport de secours

Pour les séries Dota 2 BLAST Slam avant match, le moteur lit les données publiques structurées intégrées à https://blast.tv/dota, le site de l'organisateur. Aucun script n'est exécuté. Deux identités d'équipe distinctes, le tournoi, l'horaire (écart maximal de deux heures), le format et au moins un résultat de série effectivement terminé pour chaque équipe doivent correspondre. Une association ambiguë, un autre jeu, un match commencé ou un pari sur une carte ne bénéficient pas de ce complément. La source est renouvelée après cinq minutes et ses limites restent visibles : absence de rating OpenDota, de roster confirmé et de télémétrie de carte. Elle ne sert jamais au règlement financier : seul le résultat officiel Polymarket règle le portefeuille. OpenDota reste utilisé pour les dossiers non couverts.

La donnée enregistrée pour les tests est issue de la page publique du 24 novembre 2026, avec les champs d'environnement et d'authentification retirés. Les tests ne constituent pas le précontrôle réseau ; la validation réelle doit encore récupérer le marché, ses règles et ses carnets depuis GitHub.
