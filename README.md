# ThéCol Gestion

Application de gestion pour votre entreprise de thé froid.

## Version

**v11.1**

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

### Synchronisation Cloud (v11.0 — collaborative)

La synchronisation Firestore a été migrée en **v11.0** d'un modèle « document unique par table » (`data/<table>`) vers un modèle **« un document Firestore par enregistrement métier »** (`tables/<table>/records/<recordId>`).

- **Architecture :** chaque enregistrement (lot, commande, employé…) possède son propre document Firestore, avec un champ `_version` (timestamp) pour la détection de conflit.
- **Migration one-shot :** au démarrage, l'application vérifie l'état de migration dans `syncMeta/schema`. Si non migrée, elle pousse d'abord les modifications locales en attente (legacy `data/<table>`), valide l'intégrité des IDs, puis copie toutes les données vers la nouvelle structure par batches de 500. Les anciens documents `data/<table>` sont conservés intacts (legacy).
- **Verrou de migration :** un lock transactionnel (`syncMeta/migrationLock`, 30 s d'expiration) empêche deux clients de migrer simultanément. Le document contient les champs `locked` (booléen), `owner` (ID de session unique, généré par `generateId()`), `lockedAt` (ISO datetime) et `version` (11). Le champ `owner` permet la libération sécurisée du lock : seules les requêtes du même `_sessionId` peuvent le libérer ou en renouveler le bail (« lease »).
- **Opérations hors-ligne :** les modifications sont persistées dans une file d'attente localStorage (`thecol_v11_queue`) avec sémantique de fusion (upsert après delete, delete après upsert). En ligne, la file est vidée transactionnellement avec détection de conflit par `_version`.
- **Écoute temps réel :** un `onSnapshot` est attaché à chaque collection `tables/{table}/records`. Les modifications distantes sont appliquées à localStorage sans boucle de synchronisation (`DB._applyRemoteSnapshot`), et les opérations locales en attente sont ré-appliquées par-dessus. Le re-rendu est anti-rebond à 300 ms.
- **Bouton "Sync" :** après migration, `forceFirebaseSync()` vide la file, recharge tous les enregistrements depuis Firestore, redémarre les listeners et nettoie les anciens flags `dirty_tables`.
- **Fonctionnement hybride :** avant migration (ou si Firebase est indisponible), le comportement legacy (tableau complet, `dirty_tables`) reste actif. Une fois V11 activé (`V11._isReady = true`), toutes les écritures passent par la file d'attente différentielle — plus jamais de remplacement de tableau complet.
- **Débogage :** `window.v11Debug` expose `getQueue()`, `flushQueue()`, `mergeOp()`, `runMigration()`, et `status()`.

### Procédure : première migration v11.0

La migration est automatique au démarrage, mais **ne doit être exécutée que sur un seul appareil à la fois** :

1. Ouvrir l'application sur **un seul** appareil (bureau, mobile — le premier à démarrer avec v11.0).
2. Vérifier que la connexion Firebase est active (bouton 🔄 Sync visible dans l'en-tête).
3. La migration s'exécute automatiquement :
   - Push des tables locales modifiées vers l'ancien format `data/<table>`.
   - Validation de tous les IDs (absence d'ID vide, pas de doublon).
   - Fusion des données legacy cloud + locales (legacy sert de base).
   - Écriture par batches de 500 docs dans `tables/{table}/records/{recordId}`.
   - Marquage `syncMeta/schema` comme `ready: true`.
4. **Attendre la fin** (toast « Migration v11 terminée avec succès »). Ne pas fermer l'app pendant la migration.
5. Une fois terminée, les autres appareils peuvent se connecter : ils détecteront `syncMeta/schema.ready = true` et chargeront directement les données depuis la nouvelle structure, sans ré-exécuter la migration.
6. En cas d'échec (ID invalide, erreur batch), un toast d'erreur s'affiche. Les données locales et legacy cloud restent intactes. Corriger les données puis recharger la page (ou exécuter `window.v11Debug.runMigration()` dans la console).

### ⚠️ Règles Firestore requises — accès ouvert temporaire (non sécurisé)

> **Décision explicite du propriétaire :** Firebase reste temporairement en accès ouvert, **sans authentification**. Ce choix est volontaire pour la phase actuelle, mais **la base est accessible à quiconque connaît l'URL du projet Firebase**. L'authentification (Firebase Auth, anonyme ou par utilisateur) sera ajoutée ultérieurement (voir `PLAN_DELEGATION.md` A3).

L'application **n'importe pas `firebase-auth`** et **n'appelle pas `signInAnonymously`**. La migration et la synchronisation collaborative fonctionnent uniquement si les règles Firestore le permettent.

Les règles Firestore déployées dans la console Firebase doivent couvrir **au minimum** les chemins suivants :

```
// Nouvelle structure v11 — un document par enregistrement
tables/{table}/records/{record}    // allow read, write

// Métadonnées de synchronisation (migration, schéma)
syncMeta/{document}                // allow read, write

// Legacy — nécessaire temporairement pour la migration v11
// Permet de lire les données cloud legacy (base de fusion) et de pousser
// les tables modifiées localement (dirty) avant la migration one-shot.
// Cette collection n'est plus utilisée après migration réussie.
data/{table}                       // allow read, write
```

Si les règles actuelles ne couvrent que `data/{table}` (legacy), la migration échouera et le verrou (`syncMeta/migrationLock`) ne pourra pas être posé. **Les règles exactes déployées n'ont pas été inspectées** — elles doivent être vérifiées et mises à jour manuellement dans la console Firebase (ce fichier ne les déploie pas).

> **⚠️ Insecure — temporaire :** tant que l'authentification n'est pas activée, les règles doivent rester en mode ouvert (`allow read, write: if true;`). C'est un choix délibéré pour la phase v11.0. L'authentification sera ajoutée plus tard (voir `PLAN_DELEGATION.md` A3). Aucun audit utilisateur n'est présent dans l'application.

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
