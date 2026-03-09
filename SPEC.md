# ThéCol Gestion - Spécifications

## 1. Aperçu du projet

**Nom:** ThéCol Gestion  
**Type:** Application web SPA (Single Page Application)  
**Hébergement:** GitHub Pages  
**Stockage:** localStorage  
**Style:** Minimaliste, éco-responsable (style thecol.ch)

## 2. Structure des données

### Employés
```json
{
  "id": "uuid",
  "nom": "string",
  "prenom": "string",
  "tauxHoraire": "number",
  "actif": "boolean"
}
```

### Arômes
```json
{
  "id": "uuid",
  "nom": "string",
  "couleur": "string (hex)",
  "actif": "boolean"
}
```

### Formats
```json
{
  "id": "uuid",
  "nom": "string (ex: 50cl, 1L)",
  "contenanceCl": "number"
}
```

### Recettes
```json
{
  "id": "uuid",
  "aromeId": "uuid",
  "nom": "string",
  "ingredients": [
    { "nom": "string", "quantite": "number", "unite": "string" }
  ]
}
```

### Clients
```json
{
  "id": "uuid",
  "nom": "string",
  "adresse": "string",
  "email": "string",
  "telephone": "string",
  "actif": "boolean"
}
```

### Lots de production (Stock)
```json
{
  "id": "uuid",
  "aromeId": "uuid",
  "formatId": "uuid",
  "quantite": "number",
  "dateProduction": "date",
  "dlv": "date (date limite de vente)",
  "dlc": "date (date limite de consommation)",
  "statut": "en_stock|vendu|expiré"
}
```

### Commandes
```json
{
  "id": "uuid",
  "clientId": "uuid",
  "dateCommande": "date",
  "dateLivraison": "date",
  "statut": "en_attente|produite|livrée|annulee",
  "items": [
    { "aromeId": "uuid", "formatId": "uuid", "quantite": "number }
  ]
}
```

### Pointages
```json
{
  "id": "uuid",
  "employeId": "uuid",
  "date": "date",
  "heureDebut": "time",
  "heureFin": "time",
  "pause": "number (minutes)",
  "notes": "string"
}
```

## 3. Pages/Vues

### Navigation principale
- Dashboard (accueil)
- Stock
- Pointage (heures)
- Commandes
- Production (planificateur)
- Paramètres (employés, aromes, recettes, clients)

### 3.1 Dashboard
- Résumé du stock (total bouteilles, expiré, < 1 mois)
- Commandes en attente
- Heures aujourd'hui
- Raccourcis rapides

### 3.2 Gestion du Stock
- Tableau des lots avec filtres (arôme, format, statut)
- Ajouter nouveau lot
- Statistiques: total, expirés, < 1 mois

### 3.3 Pointage (Heures)
- Vue calendrier/semaine
- Pointer arrivée/départ
- Tableau des pointages avec filtres
- Calcul automatique des heures

### 3.4 Commandes
- Liste des commandes avec filtres
- Créer nouvelle commande (sélectionner client, articles, date)
- Voir détails commande
- Statut modifiable

### 3.5 Planificateur de Production
- Sélectionner période (commandes à produire)
- Calcul automatique:
  - Litres par arôme nécessaires
  - Ingrédients nécessaires par recette
- Générer liste de production

### 3.6 Paramètres
- **Employés:** CRUD, activer/désactiver
- **Arômes:** CRUD, couleur, activer/désactiver
- **Formats:** CRUD
- **Recettes:** CRUD par arôme, liste ingrédients
- **Clients:** CRUD, activer/désactiver

## 4. Design

### Couleurs (thème thecol.ch)
- **Primaire:** #5D7B3E (vert olive)
- **Secondaire:** #8BA66B (vert clair)
- **Accent:** #2C4A2E (vert foncé)
- **Fond:** #FAFBF7 (crème blanc)
- **Texte:** #333333
- **Blanc:** #FFFFFF
- **Gris clair:** #F0F0F0
- **Danger:** #C0392B
- **Warning:** #F39C12
- **Success:** #27AE60

### Typographie
- **Font:** "Outfit" (Google Fonts) - moderne, épurée
- **Titres:** 600-700 weight
- **Corps:** 400 weight

### Layout
- Sidebar navigation (250px)
- Header avec titre et actions
- Contenu principal avec cards
- Tables responsives

### Composants
- Boutons: vert olive, border-radius 8px
- Inputs: border gris, focus vert
- Cards: fond blanc, shadow léger
- Tables: stripe alterné, hover highlight
- Modals: overlay semi-transparent

## 5. Fonctionnalités clés

### Production Planner
1. Sélectionner date de commande(start/end)
2. Agréger toutes les commandes de la période
3. Pour chaque arôme:
   - Calculer total bouteilles par format
   - Convertir en litres
   - Appliquer recette pour ingrédients
4. Afficher résumé:
   - Bouteilles par arôme/format
   - Litres totaux par arôme
   - Ingrédients requis

### Pointage
1. Sélectionner employé
2. Pointer entrée (horodatage)
3. Pointer sortie (horodatage)
4. Calcul automatique: (fin - début - pause) / 60

### Stock
1. Nouveau lot: arôme, format, quantité, dates
2. Mise à jour statut automatique (expiré si DLC passée)
3. Historique de production

## 6. Déploiement GitHub Pages

1. Créer fichier `index.html`
2. Créer fichier `styles.css`
3. Créer fichier `app.js`
4. Pousser vers repo GitHub
5. Activer GitHub Pages dans settings

## 7. Contraintes techniques

- HTML5, CSS3, Vanilla JavaScript (ES6+)
- Pas de framework (simplicité)
- localStorage pour persistance
- Responsive (mobile first)
- Works offline après premier chargement
