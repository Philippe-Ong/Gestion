# ThéCol Gestion

Application de gestion pour votre entreprise de thé froid.

## Adresse

**https://philippe-ong.github.io/Gestion/**

## Fonctionnalités

### Stock
- Gestion des lots de production (arôme, format, quantité)
- Suivi des dates (production, DLV, DLC)
- Statut automatique: OK, < 1 mois, Expiré
- Vente de bouteilles (déstockage)
- Historique de production
- Résumé du stock vendable par arôme/format

### Pointage
- Saisie des heures de travail
- Horloge temps réel
- Historique des pointages avec filtres
- Statistiques: heures totales, jours travaillés, moyenne/jour
- Graphique de répartition par employé
- Export CSV

### Commandes
- Gestion des commandes clients
- Articles multiples (arôme, format, quantité)
- Suivi du statut (en attente, produite, livrée, annulée)

### Production
- Planificateur de production
- Calcul automatique des litres par arôme
- Ingrédients nécessaires selon les recettes

### Paramètres
- **Employés**: Ajout, modification, activation/désactivation
- **Arômes**: Gestion des aromes avec couleurs
- **Formats**: Gestion des formats (0.25l, 0.5l, 1l)
- **Recettes**: Ingrédients par litre pour chaque arôme
- **Clients**: 
  - Ajout manuel
  - Import/Export Excel
  - Import/Export CSV

## Technologies

- HTML5, CSS3, Vanilla JavaScript
- Stockage local (localStorage)
- Hébergement: GitHub Pages

## Données

Les données sont stockées dans le navigateur (localStorage). Pour réinitialiser:
- Allez dans Paramètres → Clients → "Effacer tout"
- Ou nettoyez les données du site dans les paramètres du navigateur
