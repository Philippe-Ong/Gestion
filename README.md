# ThéCol Gestion

Application de gestion pour votre entreprise de thé froid.

## Version

**v12.4**

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
- Statut automatique: OK, DLV proche, Invendable (DLV dépassée), Expiré (DLC dépassée)
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
- Export PDF des BL — rendu pixel-perfect avec fonds A4 rasterisés (`page-full.png` / `page-continuation.png`) issus du template Excel ; données variables (numéro BL, date, destinataire, lignes articles, IFCO, facturation) superposées en Calibri aux positions exactes du modèle via `window.print()`
- Remplissage automatique des lignes par arôme/format, triés alphabétiquement
- Saisie des caisses IFCO vertes/noires livrées

### Production
- Planificateur de production avec sélection optionnelle des commandes à produire
  - Panneau dépliant listant toutes les commandes éligibles (non livrées, non annulées)
  - Cases à cocher individuelles par commande
  - Boutons « Tout sélectionner » / « Tout désélectionner »
- Calcul automatique des litres par arôme
- Ingrédients nécessaires selon les recettes
- Répartition par récipients: cuves 25L, casserole 9L et casserole 4L
- Confirmation des quantités réellement produites par format
- Ajout automatique des bouteilles produites au stock
- Déduction automatique de l'inventaire à la validation de production:
  - Ingrédients de recette: **+1.5%** (perte de production)
  - Eau: **ignorée** (pas de déduction)
  - Bouteilles vides: **1 pour 1** selon le format
  - Capsules/Bouchons: **+5%** (arrondi supérieur)
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

### Nouveautés v11.5

- **🔒 Démarrage sécurisé** — `startApp()` refuse de démarrer si `window.firebaseReady !== true`. Toute tentative d'accès aux données locales sans session Firebase active est bloquée (appel console, script tiers, boot précoce).
- **⬆️ Firebase SDK 12.16.0** — Mise à jour du SDK Firebase de la version 10.8.0 vers 12.16.0, appliquée dans le module inline principal ainsi que dans le fallback dynamique (`app.js`).
- **🔐 Intégrité des dépendances** — Les scripts JSZip et XLSX sont chargés depuis cdnjs avec attributs `integrity` (SRI) et `crossorigin=anonymous` pour prévenir les altérations.
- **🛡️ Content Security Policy** — CSP appliquée via une balise `<meta http-equiv="Content-Security-Policy">` dans `index.html`, avec `unsafe-inline` conservé à titre transitoire pour les gestionnaires inline non encore migrés vers la délégation centralisée. `unsafe-eval` est explicitement interdit.

### Nouveautés v11.6

- **⏳ Rendu différé V11** — Les snapshots temps réel de Firestore diffèrent le re-rendu de `#content` lorsqu'un champ de saisie est actif (input, textarea, select). Le rendu est rejoué automatiquement au blur, sans effacer le formulaire en cours de saisie.
- **📋 Livraison : messages d'erreur distincts** — `deliverCommandeTransaction()` vérifie explicitement la session Auth active avant la transaction. Les échecs distinguent désormais session expirée / conflit de transaction (concurrence) / erreur réseau, avec des messages utilisateur en français distincts pour chaque cas.
- **🏭 Production : validation des unités** — La confirmation de production est bloquée si la conversion entre une unité de recette et l'unité d'inventaire correspondante est impossible ou incompatible. Les alertes de stock insuffisant restent confirmables (warning seulement).
- **📥 Import JSON : pré-validation + rollback** — Le fichier est intégralement validé avant toute écriture (y compris les champs `_version` V11). Si une écriture échoue pendant l'import, un rollback synchrone restaure automatiquement les tables locales et les métadonnées V11 (cache, versions, file d'attente, tables protégées) à leur état antérieur.
- **📡 Chargement legacy ignoré** — `DB.loadFromFirebase()` ne lit plus les documents `data/*` (legacy) lorsque V11 est déjà actif (`V11._isReady === true`), évitant tout écrasement involontaire des données synchronisées.

### Nouveautés v11.7

- **🕐 Horodatage d'export BL local (navigateur)** — Les dates d'export d'un Bulletin de Livraison sont stockées dans `localStorage` sous la clé `thecol_bl_export_dates`, sans modifier le document Firestore `livraisons`. La lecture est locale d'abord, avec fallback sur l'ancien champ `dateDernierExport` pour rétrocompatibilité. L'horodatage est spécifique au navigateur et n'est pas partagé entre appareils.
- **↩️ Export BL sans opération V11** — Un export BL ne crée plus d'opération dans la file d'attente V11 (`thecol_v11_queue`), évitant toute écriture Firestore superflue et tout conflit de synchronisation.
- **🔇 Suppression de l'écho local dans le listener V11** — Le snapshot temps réel (`onSnapshot`) ne déclenche plus d'alerte de conflit si le document distant reçu est strictement identique au payload de l'opération locale en attente (self-echo). Les vrais conflits concurrents (divergence entre appareils) continuent d'être signalés normalement.

### Nouveautés v12.4

Correctifs de l'audit du 23.10.2026 (`AUDIT-2026-10-23.md`) :

- **🛡️ Plus d'effacement des changements des autres appareils** — Confirmer une production malgré un avertissement d'inventaire, ou restaurer une commande, relit désormais les données après la boîte de confirmation. Auparavant, une vente ou une livraison faite sur un autre appareil pendant que la boîte était ouverte pouvait être effacée (lot livré ressuscité, vente supprimée de l'historique, commande supprimée). Une restauration de commande est annulée si la commande a changé entre-temps.
- **✓ Stock** — Les bouteilles des commandes déjà « produites » leur sont réservées : le bouton ne passe plus en « produite » une commande que seul ce stock réservé couvrirait.
- **📂 Restaurer depuis JSON** — Affiche d'abord un bilan à confirmer (ajouts, modifications, suppressions par table, appliqués sur tous les appareils) et télécharge une sauvegarde de l'état actuel avant d'écrire.
- **Clients** — « Effacer tout » devient « Effacer les clients sans commande » : les clients liés à une commande sont conservés, comme pour une suppression unitaire.
- **♻️ Backup pré-synchro retiré** — Le bouton « Restaurer le backup pré-synchro » (synchro legacy) est supprimé et l'ancienne copie locale effacée au démarrage : sa restauration repoussait des valeurs périmées vers le cloud.

### Nouveautés v12.3

- **🎨 Jumeau 3D « maquette premium », calqué sur les photos de l'atelier** — L'étage est reconstruit pièce par pièce comme une maquette d'architecte : labo de production (meubles de labo blancs à lisses vert-de-gris et clips rouges, plans en résine vert sauge, évier et robinetterie de labo, armoires hautes avec les cartons d'Einkochautomat, réfrigérateur, prises industrielles), laverie, stock, couloir, réserve avec chambre froide (évaporateur, étagères inox à clayettes, boîtes hermétiques de fruits séchés, rayonnage noir à tablettes), vestiaire-bureau et expédition avec monte-charge. Les cloisons sont coupées à hauteur d'appui ; les façades côté caméra s'abaissent automatiquement, les autres gardent leurs fenêtres à cadres bronze avec les arbres d'automne dehors. Le quai et le camion disparaissent.
- **Rendu** : ombres douces, occlusion ambiante (GTAO), arêtes adoucies, couleurs neutres, reflets de l'inox sur un environnement d'atelier (réglettes LED, baies vitrées), ciel et terrain. Toutes les matières sont générées par code (linoléum, mosaïque, faïence, crépi, inox brossé, chêne, pelouse, pavés) : aucun fichier image ajouté.
- **Objets fidèles** : cuves 25 L inox à robinet et thermostat sur la paillasse (couvercle relevé quand une production est planifiée), casseroles sur plaques à induction avec **vapeur**, bouteilles en verre au thé ambré avec étiquette ThéCol et bouchon noir dans des casiers noirs, commandes en **caisses vertes ajourées sur chariots bleus** avec bon de livraison (bouteilles visibles une fois produites), consommables rangés selon leur nature (boîtes dont le niveau suit le stock, sacs kraft, packs de bouteilles sous film, cartons de bouchons, rouleaux d'étiquettes, bidons).
- **Équipe** : mannequins en blouse, charlotte, gants bleus et tablier à la couleur de l'employé, à leur poste ; un absent est représenté par sa blouse suspendue au portant du vestiaire.
- **Indicateurs intégrés au décor** : halos d'état au sol, vrais gyrophares sur les commandes en retard ou urgentes, marquage hachuré d'un emplacement vide, étiquettes de rayon à bande d'état et voyant clignotant.
- **✦ Qualité du rendu** — Nouveau menu dans la barre du jumeau : Auto (choisie selon l'appareil), Haute, Standard ou Économie, mémorisée sur l'appareil. En Auto, la qualité baisse d'un cran si les mouvements de caméra deviennent saccadés. Les ombres ne sont recalculées que lorsque la scène change.

### Nouveautés v12.2

- **📏 Jumeau 3D à l'échelle réelle (1 unité = 1 m)** — Corrige les incohérences de proportions : une cuve de 25 L mesure maintenant Ø 34 cm (rebord à 90 cm, à hauteur du plan de travail) au lieu de 1,24 m, les casseroles de 9 L et 4 L ont leur vraie taille, les employés mesurent 1,75 m. Palettes Europe 1,20 × 0,80 m chargées de 8 casiers ou cartons par couche, bouteilles de 20 à 31 cm selon le format, bacs de 60 × 40 cm sur des rayonnages de 2 m, atelier d'environ 24 × 16 m.
- **Pièces corrigées** : les pieds des cuves touchent le fond conique (trépied), le film étirable épouse les cartons réellement présents, les gyrophares et fiches palette sont posés sur un carton ou casier existant, plus d'enseigne ni d'enrouleur encastrés dans un pilier, plus d'extincteur devant une fenêtre, essieu arrière du camion à sa place, étiquettes des plaques fixées au bandeau du plan de travail.
- **Lisibilité** : en vue rapprochée, les étiquettes des objets lointains sont masquées ; la caméra de zoom sur un objet passe au-dessus des employés postés devant.

### Nouveautés v12.1

- **🏭 Jumeau 3D fidèle à l'atelier** — La zone Production montre l'équipement réel : **4 cuves inox de 25 L** et **2 plaques à induction** avec une **casserole de 9 L** (plaque 1) et une **de 4 L** (plaque 2). La production à faire est répartie sur ces postes comme dans le planificateur (cuves de 25 L, casserole pour le reste), par ordre d'urgence ; ce qui ne rentre pas apparaît en « prochaine fournée ». Cuve planifiée = couvercle ouvert, liquide à la couleur de l'arôme et tube de niveau ; plaque planifiée = zone de chauffe allumée.
- **Modèles plus détaillés** partout : plan de travail inox (évier, balance, bocaux, planche), poste d'embouteillage, palettes Europe, casiers avec bouteilles visibles, cartons étiquetés et filmés, rayonnage avec sacs/bidons/boîtes, employés en tablier et charlotte à leur poste, vestiaire avec casiers, quais et camion détaillés, reflets réalistes de l'inox.

### Nouveautés v12.0

- **🏭 Jumeau numérique 3D (`#jumeau`, nouvelle page d'accueil)** — L'atelier est reconstruit en 3D à partir des données synchronisées, et se met à jour en temps réel (flash sur les objets modifiés depuis un autre appareil) :
  - **Production** : une cuve par arôme, remplie des litres restant à produire (commandes actives − stock vendable).
  - **Entrepôt** : une palette par arôme × format, hauteur selon le stock ; anneau rouge pulsé si lots expirés, orange si stock insuffisant, palette fantôme en cas de rupture.
  - **Expédition** : une palette par commande active (carton = en attente, film vert = produite), gyrophare sur les commandes urgentes (≤ 3 j) ou en retard.
  - **Consommables** : bacs sur étagères, niveau et couleur selon le seuil d'alerte.
  - **Équipe** : personnages présents (pointage ouvert) ou absents.
- **Interactions** : survol = info-bulle, clic = inspecteur avec actions directes (vendre/modifier un lot, marquer produite, livrer, ±1/±10 sur un consommable, pointer arrivée/départ), double-clic = zoom sur l'objet, puces de zones et indicateurs cliquables, panneau « Alertes / Objets » navigable au clavier, rotation automatique et plein écran (affichage mural).
- **⚡ Palette de commandes (Ctrl/⌘ + K)** — navigation, actions (nouvelle commande, nouveau lot, pointage…), recherche dans l'atelier 3D et dans les données.
- **⌨️ Raccourcis clavier** — `?` aide, `/` recherche, `G` puis une lettre pour changer de page, `0–5` / `←` `→` / `R` / `F` / `Échap` dans le jumeau.
- **Transitions de page** discrètes (désactivées si « réduire les animations » est actif).
- **Three.js 0.185.1** embarqué dans `vendor/three/` (chargé à la demande, fonctionne hors ligne dans l'APK) ; repli automatique sur la liste des objets si WebGL est indisponible.

### Nouveautés v11.8

- **🔢 Numéro de lot partagé par arôme et date** — À l'ajout manuel, les lots ayant le même arôme et la même date de production partagent un `numLot` commun, même si le format diffère. Les formats restent des enregistrements de stock distincts. En cas d'arôme+format+date strictement identiques, la quantité est fusionnée avec le lot existant. La DLV et la DLC du lot de référence sont toujours reprises ; si les dates saisies divergent, un avertissement en français est affiché.

### Nouveautés v11.9

- **📄 Export PDF des Bulletins de Livraison** — Depuis la modale Préparer BL, deux boutons permettent désormais d'exporter au choix : **Exporter Excel** (inchangé) ou **Exporter PDF**. Le PDF n'est pas un fichier généré silencieusement : c'est un aperçu HTML au format A4 qui ouvre la boîte de dialogue d'impression du navigateur, permettant à l'utilisateur d'enregistrer au format PDF ou d'imprimer sur papier.
  - **Mise en page ThéCol** : logo, coordonnées client, numéro BL/date/commande, articles fusionnés et triés par arôme/format, total, caisses IFCO, mode de facturation et zones de signature.
  - **Pagination automatique** : 18 lignes maximum par page ; la dernière page limite à 11 lignes pour laisser la place aux blocs de total, IFCO, facturation et signatures. Les en-têtes (logo, numéro BL, page X/N) sont répétés sur chaque page.
  - **Notes internes** : non imprimées dans le PDF.
  - **Sans dépendance** : pas de bibliothèque externe — le PDF est généré via `window.print()` depuis une fenêtre ouverte. L'export enregistre uniquement la date locale d'export (`thecol_bl_export_dates`) et ne crée pas d'opération V11.
  - **L'export Excel reste inchangé** et disponible en parallèle.

### Nouveautés v11.11

- **📄 PDF BL pixel-perfect avec fonds A4 rasterisés** — L'export PDF des Bulletins de Livraison (`exportBLPDF`) a été repensé pour un rendu pixel-perfect. Au lieu d'assembler 6 médias individuels (v11.10), il utilise désormais **deux fonds A4 rasterisés** extraits du template Excel :
  - `page-full.png` — fond complet de la dernière page (logo, coordonnées, titre, grille, IFCO, signature, montagne)
  - `page-continuation.png` — fond des pages de continuation
  - Les données variables (numéro BL, date, destinataire, lignes articles, caisses IFCO, marques de facturation, société cliente) sont superposées en **Calibri** aux positions exactes en mm du modèle via des `position: absolute` en CSS.
  - Les lignes articles utilisent une grille CSS avec hauteur de ligne fixe **5,29 mm**.
  - **Pagination** : 18 articles par page de continuation, **5 maximum** sur la dernière page (réduit depuis 11 pour s'aligner au template rasterisé).
  - Typographie `Calibri` pour correspondre au template Excel.
  - Pied de page « BL-XXX · Page X / N » uniquement si plusieurs pages.
  - **L'export Excel reste inchangé** et disponible en parallèle.
  - Les 6 médias individuels de v11.10 (`logo.jpeg`, `contact.png`, `title.png`, `to.jpeg`, `signature.png`, `mountain.png`) sont conservés mais ne sont plus utilisés par `exportBLPDF`.

### Nouveautés v11.10

- **📄 PDF BL fidèle au template Excel** — L'aperçu HTML A4 de l'export PDF des Bulletins de Livraison (`exportBLPDF`) a été entièrement repensé pour reproduire fidèlement la mise en page du template Excel `templates/bl_template.xlsx`. Le mécanisme reste HTML + `window.print()` (pas de conversion XLSX→PDF), mais le rendu visuel s'appuie désormais sur 6 médias extraits dans `icons/bl-template/` :
  - **Logo ThéCol** (`logo.jpeg`), **coordonnées** (`contact.png`), **titre « Bulletin de Livraison »** (`title.png`), **glyphe « À »** (`to.jpeg`), **signature Noah Bevegni** (`signature.png`), **décor montagne** (`mountain.png`).
  - **En-tête** : logo et coordonnées à gauche ; titre, numéro BL discret, date et bloc destinataire (avec glyphe « À ») à droite.
  - **Tableau** : fond blanc, grille noire intégrale (pas de fond vert d'en-tête).
  - **IFCO et facturation** : disposition et libellés identiques au template (caisses vertes/noires livrées et retour, cases à cocher facturation).
  - **Bas de page** : société cliente, auteur « Noah Bevegni, ThéCol », image de signature et décor montagne.
  - **Pagination multi-page** conservée avec en-têtes répétés et pied de page « BL-XXX · Page X / N ».
  - **L'export Excel reste inchangé** et disponible en parallèle.

### Nouveautés v11.4

- **BL Excel dynamique** — L'export des Bulletins de Livraison accepte désormais tous les arômes configurés (actifs ou inactifs) au lieu d'une liste statique de 8 arômes. Les lignes article sont remplies dynamiquement avec insertion de lignes supplémentaires si nécessaire, sans perte du pied de page (facturation, IFCO, société, signature).

### Nouveautés v11.3

- **Validation des restaurations JSON** — Le fichier est contrôlé dans son intégralité avant toute écriture. Un ID non conforme annule la restauration, sans modification partielle des données locales.

### Nouveautés v11.2

- **🔒 Authentification Firebase Email/Password** — L'application utilise un compte technique `gestion@thecol.ch` avec mot de passe partagé. L'email n'est jamais affiché dans l'UI ; le mot de passe est saisi via un écran de verrouillage et n'est jamais stocké dans le dépôt. Session persistée (IndexedDB). Bouton Déconnexion dans l'en-tête et dans Paramètres > Compte.
- **📦 Livraison transactionnelle** — `deliverCommandeTransaction()` exécute une transaction atomique Firestore multi-documents (commande + lots). Exige connexion réseau, session active, et file d'attente vide. Anti-double-clic intégré. En cas d'échec, aucun document n'est modifié.
- **🔧 Délégation des événements** — Tous les gestionnaires `onclick`/`onchange` interpolant des données métier ont été remplacés par des attributs `data-click`/`data-change` avec gestion centralisée. Pas d'interpolation XSS dans les chaînes d'attributs JS.
- **📅 Correction DLV** — `isLotSellable()` vérifie désormais d'abord la DLV (Date Limite de Vente) avant la DLC. Un lot avec DLV expirée est invendable même si sa DLC est encore valide.
- **❌ Stress test retiré** — `stress-test.js` n'est plus copié vers `www/` ni chargé. Il n'est plus disponible dans l'application.
- **🆔 Validation des IDs V11** — Les IDs contenant des caractères non autorisés (hors lettres, chiffres, `_`, `:`, `-`, `.`) sont bloqués à la synchronisation. Les données restent en localStorage.
- **🎨 `safeColor()`** — Nouvelle fonction de validation des couleurs hexadécimales avant interpolation dans `style` (prévient l'injection CSS).

### Synchronisation Cloud (v11.0 — collaborative)

La synchronisation Firestore a été migrée en **v11.0** d'un modèle « document unique par table » (`data/<table>`) vers un modèle **« un document Firestore par enregistrement métier »** (`tables/<table>/records/<recordId>`).

- **Architecture :** chaque enregistrement (lot, commande, employé…) possède son propre document Firestore, avec un champ `_version` (timestamp) pour la détection de conflit.
- **Migration one-shot :** au démarrage, l'application vérifie l'état de migration dans `syncMeta/schema`. Si non migrée, elle pousse d'abord les modifications locales en attente (legacy `data/<table>`), valide l'intégrité des IDs, puis copie toutes les données vers la nouvelle structure par batches de 500. Les anciens documents `data/<table>` sont conservés intacts (legacy).
- **Verrou de migration :** un lock transactionnel (`syncMeta/migrationLock`, 30 s d'expiration) empêche deux clients de migrer simultanément. Le document contient les champs `locked` (booléen), `owner` (ID de session unique, généré par `generateId()`), `lockedAt` (ISO datetime) et `version` (11). Le champ `owner` permet la libération sécurisée du lock : seules les requêtes du même `_sessionId` peuvent le libérer ou en renouveler le bail (« lease »).
- **Opérations hors-ligne :** les modifications sont persistées dans une file d'attente localStorage (`thecol_v11_queue`) avec sémantique de fusion (upsert après delete, delete après upsert). En ligne, la file est vidée transactionnellement avec détection de conflit par `_version`.
- **Écoute temps réel :** un `onSnapshot` est attaché à chaque collection `tables/{table}/records`. Les modifications distantes sont appliquées à localStorage sans boucle de synchronisation (`DB._applyRemoteSnapshot`), et les opérations locales en attente sont ré-appliquées par-dessus. Le re-rendu est anti-rebond à 300 ms.
- **Bouton "Sync" :** après migration et authentification, `forceFirebaseSync()` vide la file, recharge tous les enregistrements depuis Firestore, redémarre les listeners et nettoie les anciens flags `dirty_tables`.
- **Fonctionnement hybride :** avant migration (ou si Firebase est indisponible), le comportement legacy (tableau complet, `dirty_tables`) reste actif. Une fois V11 activé (`V11._isReady = true`), toutes les écritures passent par la file d'attente différentielle — plus jamais de remplacement de tableau complet.
- **Débogage :** `window.v11Debug` expose `getQueue()`, `flushQueue()`, `mergeOp()`, `runMigration()`, et `status()`.
- **Authentification :** Depuis v11.2, Firebase Auth (Email/Password) est requis. `window.firebaseReady` ne devient `true` qu'après une session active. Voir `SPEC.md` §7 pour les détails de configuration.

### Procédure : première migration v11.0

La migration est automatique au démarrage, mais **ne doit être exécutée que sur un seul appareil à la fois** :

1. Ouvrir l'application sur **un seul** appareil (bureau, mobile — le premier à démarrer avec v11.0).
2. Vérifier que la connexion Firebase est active (bouton 🔄 Sync visible dans l'en-tête après connexion).
3. La migration s'exécute automatiquement :
   - Push des tables locales modifiées vers l'ancien format `data/<table>`.
   - Validation de tous les IDs (absence d'ID vide, pas de doublon).
   - Fusion des données legacy cloud + locales (legacy sert de base).
   - Écriture par batches de 500 docs dans `tables/{table}/records/{recordId}`.
   - Marquage `syncMeta/schema` comme `ready: true`.
4. **Attendre la fin** (toast « Migration v11 terminée avec succès »). Ne pas fermer l'app pendant la migration.
5. Une fois terminée, les autres appareils peuvent se connecter : ils détecteront `syncMeta/schema.ready = true` et chargeront directement les données depuis la nouvelle structure, sans ré-exécuter la migration.
6. En cas d'échec (ID invalide, erreur batch), un toast d'erreur s'affiche. Les données locales et legacy cloud restent intactes. Corriger les données puis recharger la page (ou exécuter `window.v11Debug.runMigration()` dans la console).

### ⚠️ Authentification et règles Firestore (v11.2)

Depuis v11.2, l'application utilise **Firebase Auth Email/Password** avec un compte technique fixe `gestion@thecol.ch`. Le mot de passe est saisi par l'utilisateur (écran de verrouillage) et **n'est jamais stocké dans le dépôt**. La session est persistée via `browserLocalPersistence` (IndexedDB).

**Configuration manuelle obligatoire** dans la console Firebase (avant tout déploiement) — voir la procédure complète dans `SPEC.md` §7 :

1. Activer **Email/Password** dans Authentication > Sign-in method.
2. Créer l'utilisateur `gestion@thecol.ch` avec un mot de passe fort.
3. Récupérer l'UID depuis la liste des utilisateurs.
4. Publier des règles Firestore limitées à cet UID.
5. **(Recommandé)** Activer **App Check** pour une défense complémentaire.

**Règles Firestore minimales** (déployées manuellement dans la console Firebase — ce dépôt ne les déploie pas) :

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /tables/{table}/records/{record} {
      allow read, write: if request.auth != null
        && request.auth.uid == 'UID_DU_COMPTE_TECHNIQUE';
    }
    match /syncMeta/{document} {
      allow read, write: if request.auth != null
        && request.auth.uid == 'UID_DU_COMPTE_TECHNIQUE';
    }
    // À SUPPRIMER après migration legacy terminée
    match /data/{table} {
      allow read, write: if request.auth != null
        && request.auth.uid == 'UID_DU_COMPTE_TECHNIQUE';
    }
  }
}
```

⚠️ **Configuration manuelle indispensable** : sans ces étapes, la connexion échouera ou les règles resteront ouvertes.

### Build mobile (Android / iOS)

L'appli web est emballée via **Capacitor 8**. Le code source reste à la racine — `www/` est généré par `npm run sync`.

- **APK debug** : `npm run sync && cd android && .\gradlew.bat assembleDebug`
- **App ID** : `ch.thecol.gestion`
- Voir `MOBILE.md` pour les instructions complètes (prérequis, release, iOS).

## Structure du projet

| Fichier | Rôle |
|---------|------|
| `index.html` | Structure HTML, conteneurs modals/toasts, écran de connexion, init Firebase SDK (App + Auth + Firestore) |
| `app.js` | Toute la logique applicative: routing, vues, data layer, CRUD, auth, V11 sync, event delegation |
| `styles.css` | Styles CSS, variables de thème, responsive, écran de connexion |
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
3. Vérifiez le bilan affiché (ajouts, modifications, suppressions par table) puis confirmez. La restauration remplace les données sur **tous les appareils** ; une sauvegarde de l'état actuel est téléchargée juste avant.

## Tests

Aucune CI. Le stress test (`stress-test.js`) a été retiré en **v11.2** — il n'est plus copié vers `www/` ni chargé en localhost. La validation se fait manuellement en vérifiant les données dans `localStorage` et la console.
