# Build mobile (Android / iOS)

L'appli web est emballée via **Capacitor**. `scripts/copy-web.js` copie les fichiers source de la racine, dont `app.js` et les scripts `app-*.js`, dans `www/`. Capacitor synchronise ensuite ce dossier vers les projets natifs `android/` et `ios/`.

`npm run copy:web` génère `www/` pour vérifier la copie seule. Pour synchroniser les projets natifs, utilise `npm run sync`. Les scripts chargés par `index.html` doivent aussi figurer dans `scripts/copy-web.js`.

## Workflow de dev

1. Modifie les fichiers à la racine comme avant.
2. Synchronise vers les plateformes natives :
   ```
   npm run sync
   ```
3. Ouvre la plateforme cible :
   ```
   npm run open:android   # ouvre Android Studio
   npm run open:ios       # ouvre Xcode (Mac uniquement)
   ```

## Prérequis Android

- **Java JDK 21** (recommandé pour Capacitor 8)
- **Android Studio** (https://developer.android.com/studio) — installe automatiquement le SDK Android
- Variables d'env :
  - `JAVA_HOME` → dossier du JDK
  - `ANDROID_HOME` → typiquement `C:\Users\<toi>\AppData\Local\Android\Sdk`

### Générer un APK de debug

```
npm run sync
cd android
.\gradlew.bat assembleDebug
```

L'APK sera dans `android/app/build/outputs/apk/debug/app-debug.apk` — installable sur n'importe quel téléphone Android (autoriser "sources inconnues").

### Générer un APK de release (signé) pour le Play Store

1. Crée un keystore :
   ```
   keytool -genkey -v -keystore release.keystore -alias gestion -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Dans `android/app/build.gradle`, ajoute la config `signingConfigs.release` pointant vers le keystore.
3. Build :
   ```
   cd android
   .\gradlew.bat bundleRelease
   ```
4. Upload le `.aab` produit dans `android/app/build/outputs/bundle/release/` sur la Play Console.

## Prérequis iOS

- **Mac avec macOS** + **Xcode**. Pas possible depuis Windows.
- **CocoaPods** : `sudo gem install cocoapods`
- Compte développeur Apple (99 $/an) pour publier sur l'App Store.

Sur Mac :
```
npm run sync
npm run open:ios
```
Puis dans Xcode : Product → Archive → Distribute App.

## Notes importantes

- **localStorage fonctionne** dans Capacitor (il utilise WebView native).
- **Firebase Auth** utilise le compte technique avec la méthode Email/Password, comme sur le Web.
- **Ressources externes.** Le SDK Firebase, Outfit, XLSX, JSZip et jsPDF sont chargés depuis des CDN. Une connexion est nécessaire lorsque ces ressources ne sont pas en cache.
- **Téléchargements.** L’export PDF des BL génère un fichier avec jsPDF. Le PDF, l’Excel du BL et la sauvegarde JSON sont téléchargés via une URL temporaire de fichier (`Blob`). Vérifie le téléchargement dans la WebView de chaque plateforme cible.
- L'**ID de l'app** est `ch.thecol.gestion` (modifiable dans `capacitor.config.json` + projets natifs).

## Pour mettre à jour après modif du code web

```
npm run sync
```
Puis recompile et réinstalle l’application native, ou relance Live Reload dans ton environnement de développement.
