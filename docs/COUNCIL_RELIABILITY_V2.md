# Corrections après la phase 4

## Périmètre

Le fonds `survival-004-active` reste terminé et archivé. Ses positions, fills, écritures financières, dates et politique ne sont ni réinitialisés ni réécrits. Aucun START n'est effectué par la validation. `REFORM_IMPROVEMENTS=true` prépare les politiques `survival-active-2` / `survival-reform-2` uniquement pour de nouveaux objets ou des objets READY sans fonds. Une phase en cours conserve son empreinte de politique.

## Les dix problèmes et leur traitement

1. **Dossiers périmés.** Les marchés sont inspectés avant convocation et avant une intervention si le dernier rafraîchissement dépasse une minute. Le contrôle final au carnet demeure. Les nouvelles cotations sont conservées dans `payload.live` ; les prix de référence des prévisions initiales ne sont jamais écrasés. Des faits réellement différents produisent un nouveau dossier et de nouvelles prévisions, sans recycler les anciens votes.
2. **Documents coupés ou mal associés.** Chaque interprétation est identifiée par market_id, et les identifiants des sources incluent ce périmètre. Station, date, bornes, extrême et relevés utiles sont structurés et ne sont pas tronqués avec la prose. La récupération du secrétaire filtre le marché exact. Ses résultats sont vidés entre deux dossiers. Les prévisions météo structurées visent la journée cible ; le texte original reste archivé.
3. **Abstention sans issue.** Un premier vote sans majorité et avec abstentions déclenche une collecte effective avant réexamen. Une seule reprise est autorisée. Des données essentielles encore manquantes terminent le dossier avec une raison et une demande de nouveau dossier ; aucune abstention ne devient POUR. Le prompt distingue l'incertitude, qui permet CONTRE ou une mise révisée, d'un manque factuel indispensable.
4. **Majorité bloquée.** Trois POUR approuvent et trois CONTRE refusent avant le contrôle du nombre de votes exprimés. Deux POUR et trois abstentions ne suffisent jamais. Président absent ou deux membres absents annulent toujours. L'égalité à quatre votes exprimés passe d'abord par le réexamen des abstentions, puis par l'arbitrage du président.
5. **Probabilités biaisées.** Un profil de calibration par rôle, domaine et méthode ne voit que les résultats effectivement connus à la date de décision, avec un événement indépendant par observation. Il ne corrige les probabilités que si une validation temporelle sur au moins dix événements ultérieurs montre une amélioration. Les probabilités brutes, corrigées, tailles d'échantillons et erreurs sont conservées. Sans preuve, la correction reste désactivée.
6. **Débats répétitifs.** Les rôles doivent apporter respectivement un calcul, un scénario de risque, une hypothèse falsifiable et une résolution d'objection. Aucun tour supplémentaire n'est créé pour obtenir du consensus. Les comparaisons avant/après restent appariées ; aucun changement fictif de probabilité n'est imposé pour animer la réunion.
7. **Domaines inégaux.** L'agenda tourne entre les catégories éligibles. Un précontrôle exige un véritable dossier avec règles, prix, minimum de liquidité et sources actuelles dans chacun des cinq domaines avant START. Une catégorie sans connecteur ou sans événement compatible apparaît explicitement indisponible ; aucun marché de remplacement n'est inventé.
8. **Quotas et notifications.** Le relais planifié est propriétaire de l'envoi, sans dispatch GitHub par notification, y compris pour les anciens moteurs. Les erreurs d'envoi ne créent plus d'erreurs à envoyer. Les métriques de tout le compte Cloudflare sont collectées séparément, avec un jeton de lecture, puis prises en compte par le budget de recherche. Les métriques périmées ne deviennent pas un compteur zéro. Les règlements restent prioritaires.
9. **Mémoire sans apprentissage prouvé.** Le précontrôle d'un nouvel objet READY importe les prévisions évaluables du fonds phase 4 terminé, via un appel interne en lecture. Ces données servent à la mémoire et à l'apprentissage, jamais à créditer la qualification du nouveau fonds. Le profil expose si la correction améliore réellement un échantillon ultérieur ; le dashboard indique aussi l'absence de preuve.
10. **Coût Azure estimé erroné.** Le dashboard sépare le coût communiqué et les estimations de tarifs/cache. L'enregistrement du coût vérifie l'identifiant et les bornes exactes de l'expérience ; il ne touche pas le journal du portefeuille. Une déclaration utilisateur ne devient pas une facture auditée. Le coût phase 4 communiqué est de 11,60 €.

## Vérifications disponibles

```powershell
cd council
npm run check
npm test
npm run build
cd ..
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe operations/reform_admin.py readiness --stage pilot
# Contrôle de fournisseurs sur l'objet pilote jamais lancé : aucun START, aucun LLM
.venv\Scripts\python.exe -m operations.reform_validation --stage pilot
```

La suite inclut un parcours de sept jours à horloge virtuelle : reprise après reconstruction, panne d'un fournisseur pendant une heure, votes, achat, règlement unique et marge finale. Ce test synthétique ne prouve pas un SLA réel de 168 heures et ses compteurs SQLite locaux ne constituent pas une facture Cloudflare.

Le workflow `council-validation.yml` permet des sondes réelles sur un objet READY sans fonds. Le dispatch manuel produit un artefact de diagnostic. Une observation prolongée peut être activée par la variable GitHub `COUNCIL_VALIDATION_UNTIL` (date ISO UTC) ; les collectes cessent après cette borne. Ce contrôle n'appelle ni START ni Azure et refuse un objet déjà lancé. La présence de cinq objets graphiques ou un HTTP 200 n'est pas une preuve de disponibilité de cinq domaines.

## Surveillance globale Cloudflare

Le collecteur `operations/cloudflare_usage.py` utilise les métriques officielles du compte, incluant tous les namespaces. Configurer dans GitHub une variable `CLOUDFLARE_ACCOUNT_ID` et un secret **en lecture seule** `CLOUDFLARE_ANALYTICS_TOKEN`, permission Account Analytics / Read. Le workflow des services l'exécute toutes les cinq minutes. L'absence de ce secret est signalée ; un nouveau START amélioré exige une mesure globale récente. La remontée Cloudflare peut être retardée : une marge de quota reste nécessaire.

Référence : https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/

## Limites à vérifier avant un prochain lancement

- Les connecteurs réels et leur disponibilité doivent passer les précontrôles ; les tests synthétiques ne peuvent pas remplacer leurs réponses.
- Quand le tableau ESPN ne couvre pas un match de tennis, un complément gratuit retrouve les deux joueurs par identité exacte, puis leurs statistiques de saison ESPN. Il est limité à l'avant-match, ne confirme pas le calendrier par un second fournisseur et n'est pas un historique complet des Challengers. Les zéros de statistiques ne signifient pas que le joueur n'a jamais perdu. Aucune valeur absente n'est inventée. L'absence d'identité unique ou de statistiques pour l'un des joueurs reste bloquante.
- Les sources ESPN partagées de plus de dix minutes déclenchent un renouvellement anticipé ; elles restent utilisables jusqu’à la limite de quinze minutes pour éviter une coupure artificielle pendant la collecte. Au-delà, elles sont refusées. Un classement d'équipe OpenDota récemment collecté ne doit pas supprimer une demande explicite pour son historique de matchs. Une file vide signifie « rien à collecter », pas « fournisseur en panne ».
- Les jeux esport sans connecteur restent indisponibles. Aucun quota d'investissement n'est ajouté pour masquer le problème.
- Le gain prédictif, la qualité des débats et l'utilisation du capital doivent être mesurés prospectivement. Ils ne deviennent pas garantis grâce à ces corrections.
- Il faut choisir un nouvel identifiant de fonds avant un prochain START ; l'identifiant phase 4 archivé ne doit pas être réutilisé.
- Les sauvegardes financières se contrôlent avec `/admin/integrity`, qui calcule une empreinte du journal, des positions, des fills et du périmètre de l'expérience.

Accès publics ESPN vérifiés pour le complément tennis : `https://site.web.api.espn.com/apis/common/v3/search?query=Alafia%20Ayeni&limit=5&type=player` puis les profils du domaine `sports.core.api.espn.com`. Les références de statistiques proviennent du profil officiel ; elles ne sont pas devinées. Ces routes sont limitées à la recherche de joueurs et aux profils/statistiques tennis par la liste d'autorisation du collecteur.
