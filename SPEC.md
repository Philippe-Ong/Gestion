# ThéCol Gestion - Spécifications

## 1. Aperçu du projet

**Nom:** ThéCol Gestion  
**Type:** Application web SPA (Single Page Application)  
**Hébergement:** GitHub Pages  
**Stockage:** localStorage + Firebase Firestore (cloud optionnel)  
**Version:** v11.1  
**Style:** Minimaliste, éco-responsable (style thecol.ch)

## 2. Structure des données

### Tables synchronisées (ALL_TABLES)
Les 12 tables persistées dans localStorage et synchronisées avec Firebase Firestore :
`employees`, `aromes`, `formats`, `recettes`, `clients`, `lots`, `commandes`, `pointages`, `inventaire`, `livraisons`, `history`, `todos`.

### Tables modifiées localement (legacy, pré-v11)
Clé localStorage hors `ALL_TABLES` : `thecol_dirty_tables`.

Stocke un tableau JSON des noms de tables qui ont été modifiées localement mais pas encore synchronisées avec Firebase Firestore. Gérée par les helpers :
- `getDirtyTables()` — retourne le tableau (parsing JSON, défaut `[]`)
- `markDirty(key)` — ajoute une table à la liste si elle n'y est pas déjà
- `unmarkDirty(key)` — retire une table de la liste

Ces helpers sont utilisés uniquement avant la migration v11 (légacy). Après migration, le suivi local se fait via la file d'attente `thecol_v11_queue`.

### V11 — File d'opérations hors-ligne (`thecol_v11_queue`)
Clé localStorage : `thecol_v11_queue`.

Tableau JSON d'opérations en attente de synchronisation Firestore. Chaque opération :
```json
{
  "id": "string (generateId())",
  "table": "string (nom de table ALL_TABLES)",
  "type": "upsert|delete",
  "recordId": "string (ID de l'enregistrement)",
  "record": "object|null (données complètes pour upsert, null pour delete)",
  "timestamp": "number (Date.now())",
  "knownVersion": "number|null (_version distant au moment du queuing)"
}
```

**Sémantique de fusion** (v11MergeOp) :
- `upsert` après `delete` pour le même `recordId` → remplace le delete par l'upsert
- `delete` après `upsert` → conserve le delete
- `upsert` après `upsert` → conserve le dernier
- `delete` après `delete` → no-op (déjà supprimé)

### V11 — Structure Firestore (après migration)

#### Collection `tables/{table}/records/{recordId}`
Un document par enregistrement métier. Chaque document contient :
```json
{
  "record": { "id": "string", ... /* les champs métier */ },
  "updatedAt": "string (ISO datetime)",
  "_version": "number (timestamp, utilisé pour le conflit)"
}
```

#### Collection `syncMeta/schema`
Document unique indiquant l'état de la migration :
```json
{
  "version": 11,
  "ready": true,
  "migratedAt": "string (ISO datetime)",
  "tables": ["employees", "aromes", ...]
}
```

#### Collection `syncMeta/migrationLock`
Verrou transactionnel pour éviter les migrations concurrentes. Chaque client génère un `_sessionId` unique via `generateId()` :
```json
{
  "locked": true,
  "owner": "string (_sessionId du client qui détient le lock)",
  "lockedAt": "string (ISO datetime)",
  "version": 11
}
```
- `owner` : identifiant de session unique (généré par `V11._sessionId`). Seul le propriétaire du lock peut le libérer ou en renouveler le bail (lease). Les autres clients reçoivent une erreur `LOCKED`.
- Expiration après 30 secondes (`V11.LOCK_EXPIRY_MS`). Si le bail expire, un autre client (ou le même) peut ré-acquérir le lock.

### Clés localStorage v11
| Clé | Rôle |
|-----|------|
| `thecol_v11_queue` | File d'opérations hors-ligne (tableau JSON) |
| `thecol_v11_ready` | Flag local `'1'` si migration v11 confirmée |
| `thecol_dirty_tables` | Flag legacy (pré-v11) des tables modifiées hors-ligne |
| `thecol_backup_pre_sync` | Backup avant tout pull legacy |

### Architecture de synchronisation
```
DB.set(key, data)
  ├─ V11._isReady ? oui → compute diff → v11EnqueueOp() → setTimeout(v11FlushQueue)
  │                     → v11FlushQueue() → runTransaction() par op → conflit _version
  └─ V11._isReady ? non → DB.syncToFirebase(data/<table>) → markDirty/unmarkDirty

v11BootFirebase() → waitForFirebase → check syncMeta/schema
  ├─ non migré → push dirty legacy → v11RunMigration()
  │               (lock → valider IDs → merge legacy+local → batch write → schema.ready)
  └─ migré     → v11LoadTableRecords() → v11OverlayQueueOnCache() → v11FlushQueue()
                 → v11StartAllListeners() (onSnapshot par table)
```

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
- **Sélection optionnelle** des commandes à inclure (panneau dépliant avec cases à cocher, « Tout sélectionner » / « Tout désélectionner »)
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
2. **Sélection optionnelle des commandes :** panneau dépliant listant toutes les commandes éligibles (non livrées, non annulées) avec cases à cocher individuelles, boutons « Tout sélectionner » / « Tout désélectionner ». Par défaut, toutes les commandes éligibles sont incluses.
3. Agréger les commandes sélectionnées de la période
4. Pour chaque arôme:
   - Calculer total bouteilles par format
   - Convertir en litres
   - Appliquer recette pour ingrédients
5. Répartir les litres par récipients:
   - Jusqu'à 25L: cuve 25L partielle ou pleine
   - Reste jusqu'à 4L: casserole 4L
   - Reste jusqu'à 9L: casserole 9L
   - Reste supérieur à 9L: cuves 25L équilibrées
6. Afficher résumé:
   - Bouteilles par arôme/format
   - Litres totaux par arôme
   - Ingrédients requis

7. **Déduction des bouchons :** Lors de la confirmation de production, les bouchons sont déduits de l'inventaire par taille :
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
- localStorage pour persistance locale
- Firebase Firestore v10.8.0 pour synchronisation cloud optionnelle
- **Pas d'authentification (temporaire, non sécurisé) :** `firebase-auth.js` non importé, pas de `signInAnonymously`. C'est un choix délibéré du propriétaire pour la phase v11.0 — la base est accessible à quiconque connaît l'ID du projet Firebase. L'authentification sera ajoutée ultérieurement (voir `PLAN_DELEGATION.md` A3).
- **Règles Firestore requises (mises à jour manuellement dans la console) :**
  - `tables/{table}/records/{record}` — accès en lecture/écriture (v11 per-record)
  - `syncMeta/{document}` — accès en lecture/écriture (verrou migration + statut schéma)
  - `data/{table}` — **nécessaire temporairement** pour la migration legacy : lecture des données cloud legacy (base de fusion) et push des tables modifiées localement (dirty) avant la migration one-shot
  - Les règles doivent être déployées manuellement dans la console Firebase. Ce dépôt ne les déploie pas.
- **Capacitor 8** pour emballage mobile Android/iOS
- Responsive (mobile first)
- Works offline après premier chargement (les opérations hors-ligne sont mises en file d'attente dans `thecol_v11_queue`)
