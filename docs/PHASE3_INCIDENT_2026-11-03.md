# Incident de règlement — 3 novembre 2026

## Constat vérifié

À 13 h 32, heure de Paris, le dernier suivi financier abouti datait du 2 novembre à 19 h 10. Les 22 positions étaient encore PENDING. Sept marchés avaient pourtant un résultat officiel. Les quinze autres échéances étaient encore à venir.

Le réveil persistant indiquait encore le 2 novembre à 21 h, alors qu’aucune tâche n’était en cours. Le heartbeat créait de nouvelles tâches mais ne réarmait pas ce réveil périmé. L’origine de la non-exécution initiale n’est pas établie par les preuves conservées ; le défaut de récupération est confirmé.

Un second défaut concernait les résultats météo avec `new_version_q=true` : leur identifiant de question oracle avait changé après une mise à jour des règles, mais pas leur condition de marché. Le moteur les rejetait malgré une condition identique, une transaction finale et des prix Gamma concordants.

## Correction

- Réarmement automatique d’une alarme périmée lorsque le moteur n’exécute aucune tâche ; conservation des baux actifs et d’une trace de récupération.
- Regroupement des anciens polls après interruption, sans supprimer les écritures financières, votes, analyses ou réunions. Les tâches remplacées restent archivées.
- Priorité du règlement des fonds sur le travail de recherche et les étapes de réunion en attente.
- Acceptation d’une question oracle mise à jour uniquement si le fournisseur la signale, si la condition correspond et si les preuves finales concordent. Un résultat proposé ou une simple dernière cotation ne suffisent jamais.
- Compactage des longues archives fournies aux réunions pour éviter DOSSIER_TOO_LARGE ; montants votés, prix, identifiants et exposition totale restent conservés.

## Résultat observé

Les sept positions concernées ont été réglées : sept pertes, **185,84 € fictifs nets perdus**. Les quinze positions portant sur des événements ultérieurs restent ouvertes. Le solde disponible ne monte pas lors du règlement d’une perte : la mise avait déjà été déduite à l’achat et le paiement final vaut zéro.

Les dates de l’expérience et le portefeuille initial n’ont pas été réinitialisés. Le redémarrage ne récupère pas les réunions et opportunités manquées pendant l’incident ; l’interruption doit rester prise en compte dans le bilan de phase 3.

Validation : 70 tests Node réussis et vérification TypeScript ; cas de règles mises à jour, fausse identité refusée, alarme périmée, conservation des baux, regroupement des polls et dossiers longs. Les exports locaux de diagnostic et résultats officiels se trouvent dans `exports/phase3-resolution-*` et `exports/resolution-*.json` (non publiés).
