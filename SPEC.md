# ThéCol Gestion - Spécifications

## 1. Aperçu du projet

**Nom:** ThéCol Gestion  
**Type:** Application web SPA (Single Page Application)  
**Hébergement:** GitHub Pages  
**Stockage:** localStorage + Firebase Firestore (cloud optionnel)  
**Version:** v12.9
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

L'ancienne clé `thecol_backup_pre_sync` (copie locale avant un pull legacy) n'est plus créée et est supprimée au démarrage depuis v12.4 : sa restauration repoussait des valeurs périmées vers le cloud.

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

**Écritures de table entière (v12.4) :** `DB.set(key, data)` compare `data` au localStorage courant : tout enregistrement absent de `data` devient une suppression, tout enregistrement différent une réécriture, sans conflit signalé si un instantané distant est arrivé entre-temps (la version connue est déjà à jour). Une fonction qui attend (`await confirmDialog(...)`, `.then(...)`) relit donc ses tables **après** l'attente avant d'écrire : `finaliserProductionFormats`, `restaurerCommande`, `resetClients`.

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
  "dlc": "date (date limite de consommation)",
  "bloque": "boolean (optionnel, v11.12 — lot bloqué : invendable et non livrable)",
  "motifBlocage": "string (optionnel, v11.12 — obligatoire à la saisie du blocage)",
  "dateBlocage": "datetime ISO (optionnel, v11.12)"
}
```

**Règles d'attribution du `numLot` (v11.8) :** À l'ajout manuel d'un lot, le système attribue un `numLot` commun à tous les lots partageant le même `arome` et la même `dateProduction`, indépendamment du `format`. Chaque format reste un enregistrement de stock distinct (un `id` unique par lot). Si un lot existe déjà avec le même `arome`, `format` et `dateProduction`, sa `quantite` est incrémentée plutôt qu'un nouveau lot créé. Lorsqu'un nouveau format est ajouté sous un `numLot` existant, la DLV et la DLC du lot de référence sont toujours appliquées au nouveau lot ; si les dates saisies divergent, un avertissement en français est affiché (corrigé en v11.12 : ce cas provoquait auparavant une erreur « Erreur lors de la création du lot »).

**Numérotation sans réutilisation (v11.12) :** `nextLotNumero` prend le plus grand `numLot` numérique trouvé dans `lots`, `history`, `commandes[].lotsUtilises` et `livraisons[].lotsTraces` (`maxLotNumero`), puis ajoute 1. Un lot épuisé dont l'entrée `PROD-` a été supprimée ne voit donc jamais son numéro réattribué. Le `numLot` est celui imprimé sur les bouteilles : il ne change jamais lors d'une modification du lot. Affichage via `formatLotNumero` (6 chiffres, ou 6 derniers caractères d'un ancien id opaque) ; comparaison via `normLotNumero` (« 42 » = « 000042 »).

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
  ],
  "lotsUtilises": [
    {
      "lotId": "string (id du lot)",
      "numLot": "string",
      "arome": "string",
      "format": "string",
      "dateProduction": "date",
      "dlv": "date",
      "dlc": "date",
      "quantite": "number (agrégée par lot)"
    }
  ],
  "dateLivraisonEffective": "datetime ISO (optionnel, v11.12 — horodatage de la transaction de livraison)",
  "clientLivraison": "object (optionnel, v11.12 — instantané { societe, nom, adresse, npa, coord } du client au moment de la livraison)",
  "numeroBL": "string (optionnel, v11.12 — n° du BL généré pour cette livraison)"
}
```

`lotsUtilises`, `dateLivraisonEffective` et `clientLivraison` sont écrits par `deliverCommandeTransaction` (transaction Firestore). `dateLivraison` reste la date **prévue**. `numeroBL` est mémorisé par `generateBL` / `getOrCreateBL` : un BL supprimé puis régénéré pour la même livraison reprend son numéro. La restauration d'une commande livrée vide `lotsUtilises` et retire `dateLivraisonEffective`, `clientLivraison` et `numeroBL` (ces informations sont conservées dans les entrées `RESTAURE-`).

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
    { "lotId": "uuid", "numLot": "string", "arome": "string", "format": "string", "dlv": "date (v11.12)", "dlc": "date", "quantite": "number", "forceStockInsuffisant": "boolean (legacy, plus écrit)" }
  ]
}
```

`lotsTraces` est une copie de `commande.lotsUtilises` (`buildLotsTracesForCommande`), resynchronisée par `syncBLTraceFromCommande` à chaque préparation/export du BL. Les n° de lot ne sont pas imprimés sur le BL client (traçabilité interne). **Numéros de BL (v11.12) :** `getNextBLNumero` prend le maximum des `numeroBL` des BL existants, des commandes (`commande.numeroBL`) et de l'historique (entrées `RESTAURE-`) : un numéro de BL supprimé n'est jamais attribué à une autre livraison.

**Export PDF des BL (`exportBLPDF`, v11.11 — pixel-perfect avec fonds A4 rasterisés) :**
Génère un aperçu HTML au format A4 dans une nouvelle fenêtre, sans bibliothèque externe. L'utilisateur imprime ou enregistre via la boîte de dialogue du navigateur (`window.print()`). Depuis v11.11, le rendu est **pixel-perfect** : plutôt que d'assembler des médias individuels, l'export superpose des données variables (Calibri, positionnées en mm) sur deux fonds A4 rasterisés extraits du template Excel lui-même.

- **Fonds rasterisés (depuis v11.11) :**
  - `icons/bl-template/page-full.png` — fond complet de la dernière page (inclut logo, coordonnées, titre, tableau, IFCO, facturation, signature, décor montagne)
  - `icons/bl-template/page-continuation.png` — fond des pages de continuation (en-tête avec logo, coordonnées, titre, tableau vide)
  - Ces images sont rendues en `position: absolute; inset: 0; object-fit: fill` et couvrent intégralement la page A4 (210×297 mm). Tous les éléments fixes du template Excel (logo, trames, titres, grille du tableau, blocs IFCO/facturation/signature/montagne) sont dans le raster ; seules les données variables sont superposées en HTML/CSS.
- **Données variables superposées :**
  - Numéro BL (positionné à 101,3 mm de la gauche, 16 mm du haut)
  - Date (163,5 mm × 50,8 mm)
  - Bloc destinataire (144,5 mm × 61,7 mm, jusqu'à 4 lignes, aligné à droite, Calibri 11 pt, interligne 5,29 mm)
  - En-têtes de colonnes « Arôme » (86,1 mm) et « Format » (115,7 mm), superposés séparément (pas de `<table>` native — les en-têtes sont des `<div>` positionnés)
  - Lignes articles (à partir de 25,4 mm × 101 mm, largeur 101 mm) : chaque ligne est une grille CSS (`grid-template-columns: 13% 47% 29% 11%`) de hauteur fixe 5,29 mm, avec `font-family: Calibri; font-size: 11 pt`
  - Caisses IFCO verte et noire (25,4 mm de la gauche, positions 154,7 mm et 160 mm du haut)
  - Marques de facturation (115,5 mm de la gauche, positions 149 / 154,35 / 159,7 mm du haut)
  - Société cliente en bas (27 mm × 192,65 mm, Calibri 16 pt)
  - Pied de page « BL-XXX · Page X / N » (centré, en bas de page) — uniquement si `pageCount > 1`
  - Mention « Suite — page X » sur les pages de continuation (121 mm × 21 mm)
- **Typographie :** `font-family: Calibri, Arial, sans-serif` — correspond exactement à la police du template Excel.
- **Fusion et tri :** les lignes de livraison de même arôme+format sont fusionnées (quantité cumulée). Les articles sont triés alphabétiquement par arôme puis par format.
- **Données imprimées :** fond complet du template (logo, coordonnées, titre, grille, IFCO, signature, montagne) via raster + numéro BL, date, destinataire, en-têtes Arôme/Format, lignes article, caisses IFCO livrées, cases de facturation, société cliente.
- **Données non imprimées :** numéro de commande, notes internes (`livraison.notes`), total bouteilles.
- **Pagination :**
  - 18 lignes articles maximum par page de continuation.
  - Dernière page : **5** lignes maximum (réduit depuis 11 en v11.10 pour s'aligner sur le template rasterisé).
  - Chaque page est un conteneur `position: relative` de 210×297 mm avec `break-after: page`.
  - Le fond raster est utilisé : `page-continuation.png` pour toutes les pages sauf la dernière, `page-full.png` pour la dernière.
  - Pas d'en-tête répété en HTML — le fond raster contient déjà les éléments fixes.
- **Évolution depuis v11.10 :** l'approche précédente (assemblage de 6 médias individuels — `logo.jpeg`, `contact.png`, `title.png`, `to.jpeg`, `signature.png`, `mountain.png`) est remplacée par deux fonds A4 complets rasterisés. Les 6 médias individuels sont conservés dans `icons/bl-template/` mais ne sont plus utilisés par `exportBLPDF`.
- **Horodatage d'export :** seul `recordBLExportDate()` est appelé (clé locale `thecol_bl_export_dates`). Aucune opération V11 ni écriture Firestore.
- **Export Excel (`exportBLExcel`) :** inchangé (toujours basé sur `templates/bl_template.xlsx`), disponible en parallèle. Le choix du format se fait depuis la modale Préparer BL via les boutons `data-click="export-bl-excel"` / `data-click="export-bl-pdf"`.
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
  "id": "string ({PROD|VENTE|SORTIE|AJUST|RESTAURE}-{timestamp}-{random})",
  "lotId": "string (uuid or numeric)",
  "numLot": "string",
  "arome": "string",
  "format": "string",
  "quantity": "number (positif ; signé pour AJUST-)",
  "productionDate": "date",
  "dlv": "date (optionnel, v11.12)",
  "dlc": "date (optionnel, v11.12)",
  "dateAdded": "datetime (ISO string)",
  "motif": "string (optionnel, v11.12 — vente | echantillon | casse | destruction | correction)",
  "clientId": "string (optionnel, v11.12 — VENTE-/SORTIE-/RESTAURE-)",
  "clientNom": "string (optionnel, v11.12 — instantané du nom du client)",
  "note": "string (optionnel, v11.12)",
  "commandeId": "string (RESTAURE- uniquement, v11.12)",
  "commandeNumero": "string (RESTAURE- uniquement, v11.12)",
  "numeroBL": "string (RESTAURE- uniquement, v11.12 — n° du BL supprimé, jamais réattribué)",
  "dateLivraison": "datetime ou date (RESTAURE- uniquement, v11.12 — date de la livraison annulée)"
}
```

Les entrées d'historique sont créées par `buildLotHistoryEntry(prefixe, lot, quantite, extra)`, qui copie `numLot`, `productionDate`, `dlv` et `dlc` du lot : ces données survivent à la suppression du lot épuisé. Le type est lu par `getHistoryType(entry)` et l'effet sur le stock par `getHistoryDelta(entry)`. Préfixes d'ID :
- **`PROD-`** : production d'un lot (ajout de stock). Les anciennes entrées sans préfixe connu sont traitées comme des productions.
- **`VENTE-`** : vente directe depuis le stock (`motif: vente`, client facultatif). Les livraisons de commandes ne créent **pas** d'entrée d'historique : elles sont tracées par `commande.lotsUtilises`.
- **`SORTIE-`** (v11.12) : autre sortie motivée — dégustation/échantillon, casse/perte, destruction/péremption — depuis la modale « Sortie de stock » ou lors de la suppression d'un lot.
- **`AJUST-`** (v11.12) : correction de quantité, `quantity` signée (modification de la quantité d'un lot, ou suppression d'un lot créé par erreur, `motif: correction`).
- **`RESTAURE-`** : restauration d'une commande livrée (re-crédit des quantités aux lots). Depuis v11.12, l'entrée porte la commande, le client, le n° de BL et la date de la livraison annulée. Ces entrées restent masquées dans la timeline Historique (les livraisons n'y figurent pas non plus) mais apparaissent dans la traçabilité du lot et la fiche Rappel.

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
- Jumeau 3D (accueil, `#jumeau`)
- Tableau de bord (`#dashboard`)
- Stock
- Pointage (heures)
- Commandes
- Production (planificateur)
- Paramètres (employés, aromes, recettes, clients)

### 3.0 Jumeau numérique 3D (v12.0)
Vue 3D de l'atelier, reconstruite par `buildTwinModel()` (lecture seule) à chaque rendu de `renderJumeau()`. Les re-rendus (snapshots V11, actions) mettent à jour la scène sur place sans recréer le contexte WebGL.
- **Zones** (`TWIN_ZONES`) : Production (labo : cuves et plaques), Entrepôt (piles de casiers arôme × format), Expédition (commandes `en_attente`/`produite`), Consommables (réserve et chambre froide, articles d'inventaire `consommable`), Équipe (employés actifs, présents = pointage du jour sans `heureFin`).
- **Équipement réel (v12.1)** : `CONSTANTS.ATELIER_CUVES` cuves de `CUVE_MAX_L` (4 × 25 L) et une casserole par plaque à induction (`CONSTANTS.ATELIER_CASSEROLES_L` = [9, 4] → plaque 1 : 9 L, plaque 2 : 4 L). Les litres à produire par arôme (Σ max(0, demande des commandes actives − stock vendable à leur date de livraison, cf. `createStockPool`) × contenance) sont découpés par `getProductionRecipients()` (même logique que le planificateur), puis affectés aux postes libres par échéance du manque — la première livraison dont une ligne n'est pas couverte par le stock (v12.6 ; auparavant la première commande contenant l'arôme, même couverte) ; le surplus forme la « prochaine fournée ». Items : `equip:cuve-N` / `equip:casserole-N` (statut `planned` ou `idle`), détail dans `model.production`.
- **Plan de l'étage (v12.3)** : 1 unité = 1 m ; étage d'environ 24 × 16 m (`TWIN_PLAN`) posé sur un rez-de-chaussée vitré, d'après les photos de l'atelier : labo de production, laverie et stock côté fenêtres, couloir central, réserve avec chambre froide, vestiaire-bureau et expédition (monte-charge). Les cloisons (`TWIN_PARTITIONS`) sont coupées à 1,10 m avec un chapeau sombre ; la partie haute fenêtrée de chaque façade (`TWIN_FACADES`) est masquée quand la caméra est du côté extérieur de ce mur (`twinUpdateCutaways`).
- **Modèles 3D (v12.3)** : paillasse de labo (caissons blancs, lisse vert-de-gris à clips rouges, plan en résine sauge, évier et robinetterie de labo), îlot d'embouteillage, armoires hautes avec cartons d'Einkochautomat ; cuves 25 L inox à robinet et thermostat posées sur la paillasse (Ø 38 cm, `TWIN_CUVE`, couvercle relevé et thé visible si planifiée), casseroles 9 L / 4 L (`TWIN_POTS`) sur plaques à induction avec vapeur ; stock en piles de casiers noirs (8 par couche, ~1,9 m au plus), bouteilles en verre au thé ambré, étiquette ThéCol par arôme et bouchon noir (`twinBottleSpec()`) ; commandes en caisses vertes ajourées sur chariots bleus avec bon de livraison (bouteilles visibles si produite) ; consommables rangés par nature (`twinBinKind`) sur étagères inox (ingrédients, chambre froide) ou rayonnages noirs (emballages) : boîtes hermétiques dont le niveau suit le stock, sacs kraft, packs de bouteilles sous film, cartons de bouchons, rouleaux d'étiquettes, bidons ; mannequins en blouse, charlotte, gants et tablier à la couleur de l'employé ; absent = blouse suspendue au portant du vestiaire. Les pièces répétées sont instanciées (`InstancedMesh`) et la sélection passe par des volumes invisibles hors scène.
- **Statuts** (`getLotStatus`) : lot expiré (DLC) ou invendable (DLV dépassée) → halo rouge pulsé ; DLV proche → halo orange pâle ; stock < demande → halo orange, emplacement vide hachuré si plus rien ; commande en retard (date passée) ou urgente (`en_attente`, ≤ 3 j) → gyrophare ; consommable ≤ seuil → critique, ≤ 2 × seuil → bas (bande d'état et voyant sur l'étiquette de rayon).
- **Inspecteur** : actions réutilisant les gestionnaires existants (`sell-lot`, `edit-lot`, `show-lot-trace`, `marquer-commande-produite`, `livrer-commande`, `update-inventaire-qty`, `show-inventaire-modal`) et `clockInEmployee` / `clockOutEmployee`.
- **Préférences locales** (non synchronisées) : `thecol_filter_twin_zone`, `thecol_filter_twin_tab`, `thecol_filter_twin_panel`, `thecol_filter_twin_quality` (vide = Auto).
- **Moteur** : Three.js 0.185.1 embarqué (`vendor/three/`), importé dynamiquement ; rendu à la demande (boucle arrêtée quand rien ne bouge, une seule image planifiée à la fois, animations d'ambiance cadencées par la qualité — `ambient` : 30 i/s en Haute, 15 i/s en Standard, figées en Économie —, respect de `prefers-reduced-motion`). Les étiquettes HTML ne sont repositionnées que si la caméra ou le cadre change ; un re-rendu sans changement de niveau de cuve ne relance aucune animation. À l'ouverture et à chaque changement de qualité, les shaders sont compilés en arrière-plan (`twinWarmUp`, extension `KHR_parallel_shader_compile`, garde de 5 s) et l'indicateur de chargement reste affiché jusqu'à la première image. Sans WebGL 2 : repli sur la liste des objets et l'inspecteur.
- **Rendu (v12.3)** : lumière « jour + plafonniers » (soleil à ~55°, ombres douces PCF recalculées seulement quand la scène change), carte de reflets d'atelier générée (`twinEnvironmentMap`), rendu des couleurs neutre (`NeutralToneMapping`), ciel, terrain et arbres d'automne. Toutes les textures sont procédurales (`twinNoise`, linoléum, mosaïque, faïence, crépi, inox brossé, chêne, pelouse, pavés…) et plaquées en coordonnées monde ; les boîtes reçoivent des arêtes adoucies par shader (`twinPatchMaterial`).
- **Qualité** (`TWIN_QUALITY_LEVELS`, bouton ✦ du jumeau) : Haute (occlusion ambiante GTAO pleine résolution, ombres 4096, textures 1024), Standard (GTAO en demi-résolution, 2048, 512), Économie (rendu direct sans post-traitement, 1024, 256, bouteilles simplifiées, animations d'ambiance figées, HUD sans flou d'arrière-plan via la classe `twin--lite`). Auto choisit selon l'appareil (`twinDetectQuality` : Économie sur téléphones et tablettes — pointeur tactile ou écran ≤ 768 px — et rendu logiciel, sinon selon le GPU) et descend d'un niveau quand plus de 60 % des images d'un mouvement de caméra passent sous ~24 i/s sur 1,5 s de mouvement cumulé (`twinMonitorPerf`, `twinStepDown`) ; en Économie, le rapport de pixels du rendu est alors ramené à 1 (`Twin.dprCap`, Auto uniquement, le temps de la session). Un changement reconstruit le monde sans recréer le contexte WebGL (`twinApplyQuality`).

### 3.0bis Palette de commandes et raccourcis (v12.0)
- `Ctrl/⌘ + K` : palette (pages, actions, pointage par employé, zones du jumeau, objets de l'atelier, résultats de la recherche globale).
- `?` aide · `/` recherche · `G` puis `J/D/C/P/S/L/H/I/A/R` navigation · jumeau : `0–5` zones, `←/→` objet suivant, `R` vue d'ensemble, `F` plein écran, `Échap` fermer l'inspecteur.
- Les actions d'enregistrement (lots, commandes, inventaire, clients) re-rendent la vue courante (`renderCurrentView()`), ce qui permet de les déclencher depuis n'importe quelle page.

### 3.1 Tableau de bord (v12.6)
Cockpit du jour puis « Chiffres & tendances ». Rendu en lecture seule par `renderDashboard()` à partir de `buildDashboardModel()`, qui réutilise `buildTwinModel()` (mêmes règles que le jumeau 3D) ; le jumeau reste la page d'accueil.
- **En-tête** : salutation, date, résumé (priorités critiques, commandes à livrer sous 7 jours, litres à produire) ; actions « + Commande » (`showCommandeModal`), « + Lot » (`showNouveauLotModal`), « Pointage ».
- **Tuiles** (liens vers la page concernée) : À produire (litres, bouteilles, postes occupés) ; Livraisons · 7 j (commandes `en_attente` / `produite` en retard ou dues dans les 7 jours ; retards, sinon prêtes / total) ; Stock vendable (lots expirés, invendables ou à DLV proche, sinon bouteilles produites sur 7 jours d'après les entrées `PROD-`) ; Équipe (sur place / effectif actif, heures pointées du jour) ; Livré ce mois (CA des commandes livrées depuis le 1er, comparé aux mêmes jours du mois précédent ; en bouteilles quand aucun tarif n'est connu).
- **Priorités** : alertes du jumeau (commandes en retard ou urgentes, lots expirés / invendables / DLV proche, consommables sous le seuil ou bas) et pointages restés ouverts les jours précédents, triés critique → attention → à surveiller (icône + libellé, jamais la couleur seule) ; 6 visibles puis « Voir N autres ». Chaque ligne ouvre l'action existante : `show-commande-details`, `twin-goto-stock` (stock filtré), `show-inventaire-modal`, `cloturer-pointage`. Les besoins de production ont leur propre carte.
- **Livraisons · 7 jours** : bande des 7 jours (commandes et bouteilles par jour ; un jour ouvre Commandes filtrée sur ce jour via `weekCalendarSelectedDate`) puis les 6 prochaines commandes, retards en tête.
- **Production à lancer** : les postes de l'atelier (4 cuves, 2 casseroles) remplis à la couleur de l'arôme selon le plan du jumeau, puis par arôme : litres, bouteilles, postes (ou « En attente »), recette manquante, échéance du manque et détail par format ; « Planifier » ouvre le planificateur.
- **Équipe** : pointer l'arrivée ou le départ (`clockInEmployee` / `clockOutEmployee`).
- **À faire** : tâches (`todos`) ; « Effacer les terminées » demande confirmation et relit la table après l'attente. La saisie en cours et le focus clavier survivent aux re-rendus temps réel.
- **Chiffres & tendances** : commandes livrées, datées par `dateLivraisonEffective` (repli sur `dateLivraison`) ; période 12 semaines (lundi → dimanche) ou 12 mois et mesure CA ou bouteilles (CA désactivé sans tarif), préférences locales `thecol_filter_dash_periode` / `thecol_filter_dash_mesure`. Chiffres de la fenêtre : CA (livraisons sans tarif signalées), bouteilles livrées (+ ventes directes `VENTE-`), livraisons, panier moyen, bouteilles produites (`PROD-`). Histogramme à une série (période en cours plus claire ; infobulle au survol, au toucher ou au clavier avec ← → ; tableau « Voir les données »), meilleurs clients (5) et ventes par arôme (6, part en %).
- **Mise en page** : requêtes de conteneur (`container: dash`) — 5 tuiles et cartes sur 2 colonnes quand la largeur le permet, 1 colonne sur téléphone.

### 3.2 Gestion du Stock
- Page organisée en quatre zones (v12.7) :
  - **À traiter** : bandeau affiché seulement s'il y a une action (lots à écouler d'abord, bouteilles à produire, lots hors vente, lots dont l'arôme ou le format est absent des Paramètres)
  - **Disponible à la vente** : tableau arôme × format (`buildStockOverview`, noms comparés par `normalizeName`) — bouteilles libres (vendables − réservées), réservées, à produire, signal « DLV proche » ; une case filtre les lots (filtre `stockCell`)
  - **Lots vendables** : groupés par arôme × format, triés par DLV (FEFO), avec les commandes qui réservent ce stock ; actions « Sortie » et menu ⋯ (Tracer, Modifier, Supprimer)
  - **Hors vente** : lots expirés, invendables, bloqués ou à quantité invalide, avec l'action adaptée (Sortir, Rappel, Modifier)
- Réservation : les commandes ouvertes réservent le stock par date de livraison, les « produite » d'abord puis les « en attente » (même règle que « ✓ Stock ») ; c'est une prévision, la livraison choisit toujours ses lots. La modale « Sortie » affiche le stock libre et demande une confirmation si la sortie entame des bouteilles réservées (relecture des lots après la confirmation)
- Ajouter nouveau lot
- Statut par lot (DLV d'abord, repli DLC pour les lots sans DLV) : OK, DLV proche (< 7 j), Invendable (DLV dépassée, DLC valide), Expiré (DLC dépassée)
- Durée de vie (`lotShelfLifeHtml`, aussi dans l'inspecteur du jumeau) : phrase « Vendable encore N j » / « DLV dépassée de N j » / « DLC dépassée de N j » et frise Prod. → DLV → DLC (vert : vente, jaune : DLV proche, gris puis rouge après la DLV) avec un repère « aujourd'hui »
- Bouton « Sortie » : le motif « vente » n'est proposé que si le lot est vendable (ni bloqué, ni DLV/DLC dépassée)

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
- **« ✓ Stock » (v12.4) :** passe en « produite » les commandes en attente couvertes par le stock libre, par date de livraison. Les bouteilles des commandes déjà « produites » (pas encore livrées, donc toujours dans les lots) leur restent réservées et ne comptent pas comme libres.

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
- **Clients:** CRUD, activer/désactiver ; « Effacer les clients sans commande » supprime en masse les clients non référencés (les clients liés à une commande sont conservés, comme pour une suppression unitaire)
- **Sauvegarde & Restauration:** export JSON de toutes les tables ; « Restaurer depuis JSON » affiche un bilan (ajouts, modifications, suppressions par table) à confirmer et télécharge une sauvegarde de l'état actuel avant d'écrire (v12.4)

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
- En-tête de page (v12.8) : le titre est celui de la barre du haut ; la page n'affiche qu'une barre d'outils (`pageToolbar`) — onglets ou sélecteur de mode à gauche, actions à droite, l'action principale en dernier
- Actions secondaires d'une ligne dans un menu « ⋯ » (`rowMenuHtml`) ; les suppressions y sont rangées. Le rouge est réservé aux boîtes de confirmation
- Textes ≥ 11 px, pas de libellés en majuscules (sauf logo, badge « LIVE » et jumeau 3D) ; cibles tactiles ≥ 40 px sur téléphone et écrans tactiles
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
2. Mise à jour statut automatique (invendable si DLV passée, expiré si DLC passée)
3. Historique de production
4. Recherche par n° de lot (« 42 » ou « 000042 »), arôme ou format, sans tenir compte des accents ; la saisie est conservée telle quelle et la liste n'est re-rendue qu'après une pause, jamais pendant une composition (clavier prédictif) — même comportement dans l'Historique (`data-live-search`). Les lots épuisés sont retrouvés via les commandes, les BL et l'historique
5. Lots bloqués rangés dans « Hors vente » (v12.7)

### Traçabilité des bouteilles (v11.12)

**Parcours lot → client.** Production (`PROD-`) → stock (`lots`) → livraison (`commande.lotsUtilises`, avec `dateLivraisonEffective` et instantané `clientLivraison`) → BL (`livraison.lotsTraces`). Les sorties hors commande sont journalisées : vente directe (`VENTE-`), autres sorties motivées (`SORTIE-`), corrections (`AJUST-`), livraisons annulées (`RESTAURE-`).

**Parcours client/BL → lots.** Détail d'une commande livrée (« Lots utilisés ») et détail d'un BL (« Traçabilité interne ») : chaque n° de lot ouvre sa traçabilité. La recherche des Livraisons et la recherche globale trouvent un BL par n° de lot.

**Modale Tracer** (`data-click="show-lot-trace"`, `data-id` = id du lot — contrat inchangé) : `getLotTraceData(lotId)` assemble arôme, format, dates (DLV/DLC retrouvées même pour un lot épuisé), statut de blocage, livraisons clients (date effective, ou date prévue signalée « (prévue) »), ventes/sorties/ajustements avec client et note, livraisons annulées. Bilan : produit + ajustements − livré − ventes − sorties − stock = « Écart non expliqué » (affiché seulement s'il est non nul ; les retours n'entrent pas dans le bilan car la livraison annulée a déjà été retirée et le stock re-crédité).

**Fiche Rappel de lot** (`data-click="show-lot-rappel"`, `data-num` = numLot), ouverte depuis la modale Tracer : regroupe tous les enregistrements portant le même `numLot` (tous formats, y compris épuisés) via `getLotRappelData(numLot)` :
- synthèse (produit, livré, ventes et sorties, stock, nombre de destinataires connus) ;
- tableau par format avec accès au détail ;
- clients livrés avec adresse et coordonnées (client actuel, sinon instantané de livraison), commande, BL, format, quantité ;
- ventes directes, sorties et ajustements (motif, client, note) ;
- livraisons annulées ;
- avertissement si le numéro est partagé par plusieurs arômes ou dates ;
- **Exporter Excel** (`exportLotRappelExcel`) : classeur `rappel_lot_<n°>_<date>.xlsx` (feuilles Synthèse, Par format, Clients livrés, Sorties, Annulations).

**Blocage d'un lot.** « Bloquer le stock restant » (motif obligatoire) pose `bloque`, `motifBlocage` et `dateBlocage` sur tous les enregistrements en stock du numéro. Un lot bloqué est exclu par `isLotSellable` (stock vendable, planificateur, modale de livraison, vente directe) et refusé par `deliverCommandeTransaction` (vérification sur la donnée distante). Seules les sorties hors vente (casse, destruction…) restent possibles. « Débloquer le stock » retire ces champs après confirmation.

**Sortie de stock** (bouton « Sortie » sur une carte de lot, actions `sell-lot` / `vendre-lot`) : motif (vente directe, dégustation/échantillon, casse/perte, destruction/péremption), quantité, client facultatif, note. La vente n'est proposée que si le lot est vendable.

**Suppression d'un lot** : la modale demande ce que deviennent les bouteilles restantes — destruction/péremption ou casse/perte (`SORTIE-`), ou lot créé par erreur (`AJUST-` négatif) — avant de supprimer l'enregistrement.

**Modification d'un lot** : un changement de quantité crée un `AJUST-` signé (note facultative) ; un changement d'arôme, de format ou de dates est répercuté sur les entrées d'historique du lot. Le `numLot` ne change pas et les livraisons déjà effectuées gardent leurs informations d'origine.

### Traçabilité amont : lots d'ingrédients (v12.9)

**Articles suivis.** Les ingrédients de l'inventaire (`isLotSuiviArticle` : consommables qui ne sont pas des contenants — bouteilles, bouchons, étiquettes… — ni de l'eau) portent `lots: [{ id, numLot, quantite, quantiteRecue, dateReception, fournisseur?, dateLimite?, dateRetrait? }]`. `quantite` de l'article reste le total ; la part non couverte par les lots est le stock « sans n° de lot » (`invSansLot`), antérieur au suivi.

**Réception** (`showReceptionModal` / `saveReception`) : quantité, n° de lot du fournisseur (obligatoire pour un ingrédient), fournisseur et date limite facultatifs. Un n° déjà connu complète le lot existant.

**Consommation** (`consommerLotsIngredient`) : d'abord le stock sans n° de lot, puis les lots par date limite croissante (repli : date de réception). Appelée par `deduireInventaireProduction` (production confirmée), qui renvoie `ingredients: [{ article, unite, numLot, fournisseur, quantite }]`, et par le ± du jumeau (`updateInventaireQty`). Chaque entrée `PROD-` d'une production porte `productionId` et ces `ingredients` (quantités pour toute la production, tous formats).

**Lecture.** Tracer et Rappel du lot affichent « Ingrédients utilisés » (dédoublonnés par `productionId`) ; l'export Excel ajoute la feuille Ingrédients. Côté inventaire, la fenêtre d'un ingrédient liste les lots en stock dans l'ordre d'utilisation, le stock sans n° de lot, les lots épuisés ou retirés, et pour chacun les lots de bouteilles produits avec (`getUsagesLotIngredient`) ; « Rappel fournisseur » ouvre la liste de ces lots de bouteilles avec l'accès à leur rappel. Chaque lot se corrige (recomptage) ou se retire (périmé, perdu : `dateRetrait`).

**Limites.** Les lots de bouteilles créés avec « + Lot » ne déduisent pas l'inventaire et n'ont donc pas d'ingrédients rattachés ; les productions antérieures à v12.9 non plus.

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
- Three.js 0.185.1 (licence MIT) embarqué dans `vendor/three/` pour le jumeau 3D — les modules complémentaires (`OrbitControls.js`, post-traitement `EffectComposer`/`RenderPass`/`GTAOPass`/`OutputPass` et leurs shaders) importent `./three.module.min.js` et leurs voisins en chemins relatifs (imports réécrits, arborescence aplatie, pas d'importmap)
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
- **Restauration JSON atomique :** le fichier est validé intégralement avant toute écriture. Une table contenant un ID invalide annule toute la restauration. Depuis v11.6, l'import capture un snapshot complet (localStorage + caches mémoire V11) avant la première écriture. Si un `DB.set()` échoue (exception ou valeur de retour inattendue), un rollback synchrone restaure localStorage, `V11._localCache`, `V11._versions`, la file d'attente, la liste des tables protégées et les clés de versions, en écrivant directement dans localStorage (sans repasser par `DB.set`). Le toast d'erreur confirme qu'aucune donnée n'a été modifiée. Depuis v12.4, rien n'est écrit avant que l'utilisateur ait confirmé le bilan de la restauration (ajouts, modifications, suppressions par table, appliqués sur tous les appareils) ; une sauvegarde JSON de l'état actuel est téléchargée juste avant l'écriture.

- **Capacitor 8** pour emballage mobile Android/iOS
- **`safeColor()`** — nouvelle fonction utilitaire qui valide les couleurs hexadécimales avant interpolation dans les attributs `style` (prévient l'injection CSS). Fallback sur `#cccccc` si la valeur est invalide.
- **Responsive (mobile first)**
- **Works offline après premier chargement** (les opérations hors-ligne sont mises en file d'attente dans `thecol_v11_queue`)
- **Validation des unités en production (v11.6) :** la confirmation de production vérifie la compatibilité des unités entre chaque ingrédient de recette et l'article d'inventaire correspondant via `areUnitsCompatible()`. Si les unités sont incompatibles (ex. grammes vs litres) ou si la conversion échoue, la production est bloquée avec un toast d'erreur et la liste des ingrédients en échec. Les alertes de stock insuffisant restent des warnings confirmables.
