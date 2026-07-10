# ThéCol Gestion

Application de gestion pour votre entreprise de thé froid.

## Version

**v9.4**

## Adresse

**https://philippe-ong.github.io/Gestion/**

## Fonctionnalités

### Dashboard
- Vue d'ensemble du stock (total bouteilles, expirations)
- Commandes en attente
- Heures travaillées aujourd'hui

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
- Export Excel

### Commandes
- Gestion des commandes clients
- Articles multiples (arôme, format, quantité)
- Affichage par société client
- Suivi du statut (en attente, produite, livrée, annulée)
- Filtres par client et statut

### Livraisons
- Génération de Bulletins de Livraison (BL) depuis les commandes livrées
- Export Excel des BL avec template pré-formaté
- Remplissage automatique des lignes par arôme/format
- Saisie des caisses IFCO vertes/noires livrées

### Production
- Planificateur de production
- Calcul automatique des litres par arôme
- Ingrédients nécessaires selon les recettes
- Répartition par récipients: cuves 25L, casserole 9L et casserole 4L
- Confirmation des quantités réellement produites par format
- Ajout automatique des bouteilles produites au stock
- Déduction automatique de l'inventaire à la validation de production:
  - Ingrédients de recette: **+1.5%** (perte de production)
  - Eau: **ignorée** (pas de déduction)
  - Bouteilles vides: **1 pour 1** selon le format
  - Capsules/Bouchons: **+7.5%** (arrondi supérieur)
- Si stock inventaire insuffisant: warning affiché, la production continue
- Matching intelligent des bouteilles vides (alias 25cl ↔ 0.25l ↔ 250ml)

### Inventaire
- Suivi des consommables et équipements
- Ajustement rapide des quantités (+/−)
- Alertes de stock bas (seuil configurable)
- **Synchronisation automatique** avec les recettes:
  - Suggestions d'ingrédients à la saisie (datalist)
  - Bouton "Synchroniser inventaire" dans Paramètres > Recettes
  - Ajout automatique des ingrédients manquants depuis les recettes

### Archives
- Historique des commandes livrées
- Filtres par année et client
- Consultation en lecture seule
- Export Excel des résultats filtrés

### Paramètres
- **Employés**: Ajout, modification, activation/désactivation
- **Arômes**: Gestion des aromes avec couleurs
- **Formats**: Gestion des formats (25cl, 50cl, 100cl)
- **Recettes**: Ingrédients par litre pour chaque arôme
  - Suggestions d'ingrédients depuis l'inventaire (datalist)
  - Vérification à la sauvegarde: alerte si ingrédient absent de l'inventaire
  - Bouton **"Synchroniser inventaire"**: ajoute automatiquement les ingrédients manquants
- **Clients**: 
  - Société, Prénom & Nom, Adresse, NPA & Localité
  - Tarifs (25cl/50cl/100cl), Mode facturation, Coordonnées
  - Import/Export Excel
  - Import/Export CSV
- **Sauvegarde & Restauration**:
  - Export JSON complet de toutes les données
  - Import depuis un fichier JSON

### Synchronisation Cloud
- Synchronisation avec Firebase Firestore
- Bouton "Sync" pour synchroniser manuellement
- Sauvegarde automatique des données non-vides

### Build mobile (Android / iOS)

L'appli web est emballée via **Capacitor 8**. Le code source reste à la racine — `www/` est généré par `npm run sync`.

- **APK debug** : `npm run sync && cd android && .\gradlew.bat assembleDebug`
- **App ID** : `ch.thecol.gestion`
- Voir `MOBILE.md` pour les instructions complètes (prérequis, release, iOS).

## Structure du projet

| Fichier | Rôle |
|---------|------|
| `index.html` | Structure HTML, conteneurs modals/toasts, init Firebase SDK |
| `app.js` | Toute la logique applicative: routing, vues, data layer, CRUD |
| `styles.css` | Styles CSS, variables de thème, responsive |
| `SPEC.md` | Schémas de données et spécifications |
| `templates/bl_template.xlsx` | Template Excel pour export Bulletin de Livraison (BL) |
| `capacitor.config.json` | Configuration Capacitor (appId, webDir) |
| `scripts/copy-web.js` | Copie les fichiers racine vers `www/` |
| `android/` `ios/` | Scaffolds natifs Capacitor 8 |
| `www/` | Généré par `npm run sync` (gitignoré) |
| `MOBILE.md` | Instructions de build mobile |

## Technologies

- HTML5, CSS3, Vanilla JavaScript
- Stockage local (localStorage)
- Firebase Firestore (sync cloud)
- Hébergement: GitHub Pages

## Sauvegarde

Pour sauvegarder vos données:
1. Allez dans **Paramètres** → **Sauvegarde & Restauration**
2. Cliquez sur **"Sauvegarder tout (JSON)"**

Pour restaurer:
1. Cliquez sur **"Restaurer depuis JSON"**
2. Sélectionnez votre fichier de sauvegarde

## Tests

Aucune CI ; le filet de sécurité est `stress-test.js` (≈850 lignes). Il s'exécute depuis l'UI :

1. Ouvrez **Paramètres** → encadré **🔧 Outils de développement**
2. Cliquez sur **"Lancer le stress test"**

Le runner couvre :
- Phase 1 : rendu de toutes les vues + alerte si > 2 s
- Phase 2-5 : CRUD massif (création / mise à jour / suppression / opérations en lot)

Une sauvegarde automatique des données est faite avant l'exécution.
