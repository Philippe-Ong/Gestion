# ThéCol Gestion - Spécifications

## 1. Aperçu du projet

**Nom:** ThéCol Gestion  
**Type:** Application web SPA (Single Page Application)  
**Hébergement:** GitHub Pages  
**Stockage:** localStorage + Firebase Firestore (cloud optionnel)  
**Version:** v11.9
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

**Rendu différé (v11.6) :** les snapshots `onSnapshot` n'écrasent plus `#content` si un champ de saisie y est actif. Le re-rendu est différé et rejoué automatiquement au blur (`focusout`). Le flag `V11._pendingRender` et `_renderCurrentViewSafe()` coordonnent ce mécanisme.

**Legacy ignoré en mode V11 (v11.6) :** `DB.loadFromFirebase()` retourne immédiatement si `V11._isReady === true` (ligne 751). Les documents `data/<table>` ne sont plus lus ni écrits en local une fois le schéma V11 actif.

**Écho local supprimé (v11.7) :** le snapshot `onSnapshot` ne déclenche plus d'alerte de conflit si le document distant reçu est strictement identique (`JSON.stringify`) au payload de l'opération locale en attente (self-echo). Seuls les vrais conflits concurrents — divergence réelle entre appareils — sont signalés.
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
  "numLot": "string (optionnel — partagé entre lots de même arôme et même dateProduction, même si le format diffère)",
  "arome": "string (nom de l'arôme)",
  "format": "string (nom du format)",
  "quantite": "number",
  "dateProduction": "date",
  "dlv": "date (date limite de vente)",
  "dlc": "date (date limite de consommation)"
}
```

**Règles d'attribution du `numLot` (v11.8) :** À l'ajout manuel d'un lot, le système attribue un `numLot` commun à tous les lots partageant le même `arome` et la même `dateProduction`, indépendamment du `format`. Chaque format reste un enregistrement de stock distinct (un `id` unique par lot). Si un lot existe déjà avec le même `arome`, `format` et `dateProduction`, sa `quantite` est incrémentée plutôt qu'un nouveau lot créé. Lorsqu'un nouveau format est ajouté sous un `numLot` existant, la DLV et la DLC du lot de référence sont toujours appliquées au nouveau lot ; si les dates saisies divergent, un avertissement en français est affiché.

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
  "dateDernierExport": "datetime (optionnel, legacy — v11.7: remplacé par la clé locale non synchronisée thecol_bl_export_dates)",
  "lotsTraces": [
    { "lotId": "uuid", "arome": "string", "format": "string", "dlc": "date", "quantite": "number" }
  ]
}
```

**Export PDF des BL (`exportBLPDF`, v11.9) :**
Génère un aperçu HTML au format A4 dans une nouvelle fenêtre, sans bibliothèque externe. L'utilisateur imprime ou enregistre via la boîte de dialogue du navigateur (`window.print()`).

- **Fusion et tri :** les lignes de livraison de même arôme+format sont fusionnées (quantité cumulée). Les articles sont triés alphabétiquement par arôme puis par format.
- **Données imprimées :** logo ThéCol, numéro BL, date, numéro de commande, coordonnées client (première page uniquement), tableau des articles (QTT, description, arôme, format), total bouteilles, caisses IFCO vertes/noires, mode de facturation, zones de signature client et ThéCol.
- **Données non imprimées :** notes internes (`livraison.notes`).
- **Pagination :**
  - 18 lignes articles maximum par page.
  - Dernière page : 11 lignes maximum pour ménager l'espace des blocs finaux (total, IFCO, facturation, signatures).
  - En-têtes (logo, infos BL, page X/N) répétés sur chaque page.
  - Pied de page avec numéro BL et page X/N sur chaque page.
- **Horodatage d'export :** seul `recordBLExportDate()` est appelé (clé locale `thecol_bl_export_dates`). Aucune opération V11 ni écriture Firestore.
- **Export Excel (`exportBLExcel`) :** inchangé, toujours disponible. Le choix du format (Excel ou PDF) se fait depuis la modale Préparer BL via les boutons `data-click="export-bl-excel"` / `data-click="export-bl-pdf"`.
- **Fonction de dispatch :** `exportPreparedBL(livraisonId, format)` — appelle `exportBLExcel` ou `exportBLPDF` selon le format.

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
- Firebase Firestore v12.16.0 pour synchronisation cloud optionnelle
- **Firebase Auth — Authentification par mot de passe partagé (Email/Password) :**
  - L'application utilise un compte technique fixe `gestion@thecol.ch` (Email/Password).
  - L'adresse email n'est jamais affichée dans l'interface utilisateur — elle est définie comme constante `FIREBASE_AUTH_EMAIL` dans le module Firebase d'`index.html`.
  - Le mot de passe est saisi par l'utilisateur via l'écran de verrouillage (connexion). **Il n'est jamais stocké dans le code ni dans le dépôt.**
  - La session est persistée via `browserLocalPersistence` (IndexedDB) : l'utilisateur reste connecté entre les visites tant que le SDK Firebase est en cache.
  - **Limites :** mot de passe partagé, pas d'audit individuel (tous les utilisateurs partagent la même identité Firestore). L'email ne doit pas être changé sans mettre à jour la constante dans `index.html` et les règles Firestore.
  - Un bouton « Déconnexion » est accessible dans l'en-tête et dans la page Paramètres > Compte.

- **Procédure manuelle — Configuration Firebase Console (obligatoire avant mise en ligne) :**
  1. Aller dans **Firebase Console → Authentication → Sign-in method** et activer **Email/Password**.
  2. Aller dans **Authentication → Users** et cliquer **Ajouter un utilisateur**.
     - Email : `gestion@thecol.ch`
     - Mot de passe : choisir un mot de passe fort (jamais commité). Le communiquer séparément aux utilisateurs.
  3. Après création, récupérer **l'UID** de ce compte (visible dans la liste des utilisateurs).
  4. Aller dans **Firestore → Rules** et remplacer par les règles ci-dessous :
     ```firestore
     rules_version = '2';
     // REMPLACER « UID_DU_COMPTE_TECHNIQUE » par l'UID réel récupéré à l'étape 3.
     // Exemple : allow read, write: if request.auth.uid == 'abc123def456';
     service cloud.firestore {
       match /databases/{database}/documents {
         // V11 — accès par enregistrement
         match /tables/{table}/records/{record} {
           allow read, write: if request.auth != null
             && request.auth.uid == 'UID_DU_COMPTE_TECHNIQUE';
         }
         // Verrou de migration et statut schéma
         match /syncMeta/{document} {
           allow read, write: if request.auth != null
             && request.auth.uid == 'UID_DU_COMPTE_TECHNIQUE';
         }
         // Legacy — nécessaire temporairement PENDANT la migration
         // (lecture des données cloud legacy + push dirty avant one-shot migration).
         // À SUPPRIMER APRÈS MIGRATION de toutes les tables.
         match /data/{table} {
           allow read, write: if request.auth != null
             && request.auth.uid == 'UID_DU_COMPTE_TECHNIQUE';
         }
       }
     }
     ```
     ⚠️ **Ces règles ne sont pas déployées automatiquement** — ce dépôt ne contient pas de script de déploiement Firestore. La mise à jour est manuelle dans la console.
  5. **(Recommandé)** Activer **App Check** dans Firebase Console (reCAPTCHA ou DeviceCheck) pour une défense complémentaire contre les appels non autorisés à Firestore, même avec un UID connu.
  6. **Après migration** de toutes les tables vers le schéma V11 (`tables/{table}/records/{record}`), retirer la règle `match /data/{table}`.

- **Configuration manuelle indispensable :** si les étapes 1-4 ne sont pas exécutées avant le déploiement, la connexion échouera (Email/Password désactivé) ou les règles resteront ouvertes (risque de sécurité). L'application ne fonctionnera pas sans authentification.

- **Stress-test retiré :** `stress-test.js` a été exclu des fichiers copiés vers `www/` (`scripts/copy-web.js`) et n'est plus chargé même en localhost. Le stress test n'est plus disponible dans l'application.

- **Livraison transactionnelle :** `deliverCommandeTransaction()` exécute une transaction atomique Firestore multi-documents (commande + lots) qui exige :
  - Une connexion réseau active (refus immédiat si `navigator.onLine === false`)
  - Firebase Auth authentifié (session active) — vérification explicite du fournisseur Auth (objet `window.firebaseAuth` et méthode `isAuthenticated()`) avant la transaction
  - V11 prêt (synchronisation collaborative active)
  - File d'attente vide pour les documents concernés (commande + lots)
  - La transaction valide l'intégrité des données distantes (statut commande, stock, DLV/DLC) avant toute écriture.
  - En cas d'échec, aucun document n'est modifié et l'erreur est catégorisée avec un message français distinct :
    - **Session expirée / refusée** (`permission-denied`, `unauthenticated`)
    - **Conflit de concurrence** (`aborted`, `failed-precondition`) — un autre appareil a modifié les mêmes documents
    - **Erreur réseau** (`unavailable`, `deadline-exceeded`)

- **Correction DLV :** la fonction `isLotSellable()` vérifie désormais d'abord la **DLV** (Date Limite de Vente) avant la DLC (Date Limite de Consommation). Si la DLV est présente et expirée, le lot est considéré invendable même si la DLC est encore valide. La DLV est la date de vente primaire ; la DLC reste la date ultime de consommation. Dans `restaurerCommande()`, le champ `dlv` est préservé depuis les données distantes (fallback sur `dlc` pour les lots legacy).

- **Délégation des événements (event delegation) :** tous les `onclick`/`onchange`/`oninput`/`onkeydown` interpolant des données métier ont été migrés vers un système central de délégation au niveau document :
  - Les éléments portent des attributs `data-click` / `data-change` avec une clé d'action.
  - Les paramètres sont lus via `data-*` supplémentaires (jamais d'interpolation dans des chaînes d'attributs JS).
  - Le gestionnaire `initEventDelegation()` est appelé dans `bootLocal()`.
  - Avantages : pas de XSS par interpolation d'attributs JS, fonctionne sur le contenu re-rendu (notamment les modales), réduit les fuites mémoire.

- **Validation des IDs V11 :** la fonction `v11ValidateId()` vérifie désormais que les IDs contiennent uniquement des caractères autorisés : lettres, chiffres, `_`, `:`, `-`, `.` (1-128 caractères). Un ID invalide bloque la synchronisation mais les données restent en localStorage.
- **Restauration JSON atomique :** le fichier est validé intégralement avant toute écriture. Une table contenant un ID invalide annule toute la restauration. Depuis v11.6, l'import capture un snapshot complet (localStorage + caches mémoire V11) avant la première écriture. Si un `DB.set()` échoue (exception ou valeur de retour inattendue), un rollback synchrone restaure localStorage, `V11._localCache`, `V11._versions`, la file d'attente, la liste des tables protégées et les clés de versions, en écrivant directement dans localStorage (sans repasser par `DB.set`). Le toast d'erreur confirme qu'aucune donnée n'a été modifiée.

- **Capacitor 8** pour emballage mobile Android/iOS
- **`safeColor()`** — nouvelle fonction utilitaire qui valide les couleurs hexadécimales avant interpolation dans les attributs `style` (prévient l'injection CSS). Fallback sur `#cccccc` si la valeur est invalide.
- **Responsive (mobile first)**
- **Works offline après premier chargement** (les opérations hors-ligne sont mises en file d'attente dans `thecol_v11_queue`)
- **Validation des unités en production (v11.6) :** la confirmation de production vérifie la compatibilité des unités entre chaque ingrédient de recette et l'article d'inventaire correspondant via `areUnitsCompatible()`. Si les unités sont incompatibles (ex. grammes vs litres) ou si la conversion échoue, la production est bloquée avec un toast d'erreur et la liste des ingrédients en échec. Les alertes de stock insuffisant restent des warnings confirmables.
