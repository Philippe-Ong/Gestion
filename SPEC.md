# ThéCol Gestion - Spécifications

## 1. Aperçu du projet

**Nom:** ThéCol Gestion  
**Type:** Application web SPA (Single Page Application)  
**Hébergement:** GitHub Pages  
**Stockage:** localStorage  
**Style:** Minimaliste, éco-responsable (style thecol.ch)

## 2. Structure des données

### Tables synchronisées (ALL_TABLES)
Les 12 tables persistées dans localStorage et synchronisées avec Firebase Firestore :
`employees`, `aromes`, `formats`, `recettes`, `clients`, `lots`, `commandes`, `pointages`, `inventaire`, `livraisons`, `history`, `todos`.

### Tables modifiées localement (non synchronisées)
Clé localStorage hors `ALL_TABLES` : `thecol_dirty_tables`.

Stocke un tableau JSON des noms de tables qui ont été modifiées localement mais pas encore synchronisées avec Firebase Firestore. Gérée par les helpers :
- `getDirtyTables()` — retourne le tableau (parsing JSON, défaut `[]`)
- `markDirty(key)` — ajoute une table à la liste si elle n'y est pas déjà
- `unmarkDirty(key)` — retire une table de la liste

Ces helpers sont appelés automatiquement par `DB.set()` et `DB.forceSet()` lors des écritures locales, et par les fonctions de synchronisation Firestore une fois l'envoi réussi.

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
  "numLot": "string (optionnel, numéro de lot commun par arôme et date de production)",
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

### Livraisons / Bulletins de livraison
```json
{
  "id": "uuid",
  "numeroBL": "string",
  "commandeId": "uuid",
  "clientId": "uuid",
  "dateBL": "date",
  "lignes": [
    { "aromeId": "uuid", "formatId": "uuid", "quantite": "number" }
  ],
  "caissesVertesLivrees": "number (optionnel)",
  "caissesNoiresLivrees": "number (optionnel)",
  "notes": "string (optionnel, interne)",
  "dateDernierExport": "datetime (optionnel)",
  "lotsTraces": [
    { "lotId": "uuid", "arome": "string", "format": "string", "dlc": "date", "quantite": "number" }
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

**Pointages de nuit :** Les pointages où `heureFin < heureDebut` (ex. 22:00 → 02:00) sont supportés. La durée est calculée par le helper `computePointageMinutes` qui ajoute 24h (1440 min) à l'heure de fin si elle est antérieure à l'heure de début, avant de soustraire la pause.

### Historique de production
```json
{
  "id": "string (PROD-{timestamp}-{random} | VENTE-{timestamp}-{random} | RESTAURE-{timestamp}-{random})",
  "lotId": "string (uuid or numeric)",
  "arome": "string",
  "format": "string",
  "quantity": "number",
  "productionDate": "date",
  "dateAdded": "datetime (ISO string)"
}
```

Les entrées d'historique utilisent trois préfixes d'ID :
- **`PROD-`** : créées lors de la production d'un lot (ajout de stock).
- **`VENTE-`** : créées lors de la vente/livraison d'une commande (déduction de stock).
- **`RESTAURE-`** : créées lors de la restauration d'une commande livrée (re-crédit des quantités aux lots). Ces entrées sont filtrées par `renderHistorique` et ne sont pas affichées dans la vue historique de production.

### Tâches du dashboard
```json
{
  "id": "uuid",
  "text": "string",
  "done": "boolean",
  "dateAdded": "datetime (ISO string)"
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
4. Répartir les litres par récipients:
   - Jusqu'à 25L: cuve 25L partielle ou pleine
   - Reste jusqu'à 4L: casserole 4L
   - Reste jusqu'à 9L: casserole 9L
   - Reste supérieur à 9L: cuves 25L équilibrées
5. Afficher résumé:
   - Bouteilles par arôme/format
   - Litres totaux par arôme
   - Ingrédients requis

6. **Déduction des bouchons :** Lors de la confirmation de production, les bouchons sont déduits de l'inventaire par taille :
   - **"Bouchons 25cl"** pour les formats dont la contenance est < 50 cl
   - **"Bouchons 50cl/100cl"** pour les formats ≥ 50 cl
   - Une marge de 5 % est ajoutée au nombre de bouchons déduits
   - Ces articles sont créés ou migrés automatiquement depuis l'ancien nom "Capsules" par `syncRecettesInventaire`

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
