# Incidents DOSSIER_TOO_LARGE — 4 novembre 2026

## Cause

Les incidents des dernières réunions étaient nouveaux, sous la version v2.2. La correction du 3 novembre testait surtout le contexte de base. Au stade CHAIR, les trois interventions indépendantes et leurs amendements s’ajoutent aux sources, variantes de marché, historique, positions et leçons. Même après les réductions fixes, le paquet entier pouvait dépasser les 26 000 caractères imposés par le backend. Il s’agissait d’un refus local avant l’appel Azure concerné, pas d’un quota fournisseur.

Le défaut a été reproduit depuis l’export réel du 4 novembre à 07:46 UTC, en reconstruisant le paquet CHAIR complet avec sa discussion. La correction précédente était insuffisante ; les archives conservent les réunions annulées et leurs incidents.

## Correction v2.3

La taille JSON complète est recalculée pendant le compactage. Les plus grands textes secondaires sont raccourcis progressivement, avec des minimums de contenu et un avertissement explicite sur les extraits. Les débats, votes d’arbitrage et documents supplémentaires du secrétaire sont pris en compte. Les identifiants, prix exécutables, frais, horodatages, propositions exactes, montants et totaux d’exposition ne sont pas tronqués. Les archives intégrales restent en base.

Une réponse déjà obtenue et validée est relue du cache avant de reconstruire un nouveau paquet : un historique ayant grossi depuis son premier appel ne bloque plus cette reprise et ne provoque pas de nouvel appel facturé.

Le journal technique conserve les tailles originales et compactées par rôle et étape dans les entrées meta `context_pack:*`. La limite reste 26 000 caractères : elle n’est pas augmentée pour contourner le défaut. Le contrôle continue de refuser un noyau obligatoire qui serait lui-même impossible à contenir.

## Validation locale

- Reconstitution de **870 paquets** depuis les dossiers et réunions archivés, pour les étapes discussion, Chairman, vote, arbitrage et retour du secrétaire : **aucun dépassement**, taille maximale 25 999 caractères. Ces tests sont hors ligne, sans appels Azure ni transactions.
- **72 tests du conseil réussis**, notamment un paquet volumineux combinant les cinq types de contenu, la conservation des chiffres/identifiants et la reprise d’une réponse en cache malgré un contexte ultérieur trop grand.
- Vérification TypeScript réussie.

La phase officielle conserve sa date de départ, son historique et ses comptes. Les réunions déjà annulées ne sont pas réécrites rétroactivement. La prochaine réunion traite les données et propositions encore valides.

## Adoption effective du code

Un contrôle supplémentaire a trouvé la version v2.2 encore active après l’acceptation du déploiement v2.3. Cloudflare a changé son comportement par défaut le 30 octobre : un objet actif peut différer l’adoption de la nouvelle version (voir [le changelog officiel](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/)).

La version du 4 novembre a été activée avec `--durable-objects-code-update-mode immediate`, puis la lecture du moteur officiel a confirmé v2.3. Les commandes de déploiement du projet incluent désormais ce paramètre. Les tâches interrompues restent protégées par leurs baux persistants et leurs clés d’idempotence ; elles peuvent attendre l’expiration du bail avant de reprendre. Une commande de publication réussie ne remplace plus le contrôle de version active.
