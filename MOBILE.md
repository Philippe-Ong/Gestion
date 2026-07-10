# Build mobile (Android / iOS)

L'appli web est emballée via **Capacitor**. Le code source reste à la racine (`index.html`, `app.js`, `styles.css`, `stress-test.js`, `templates/`) — un script copie ces fichiers dans `www/`, qui est ensuite synchronisé vers les projets natifs `android/` et `ios/`.

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
- **Firebase fonctionne** aussi mais l'auth web peut nécessiter des plugins natifs pour OAuth.
- **CDN externes** (Outfit font, XLSX, Firebase SDK) : le téléphone doit avoir internet au moins au premier lancement pour les charger. Pour offline complet, on peut télécharger ces libs en local plus tard.
- L'**ID de l'app** est `ch.thecol.gestion` (modifiable dans `capacitor.config.json` + projets natifs).

## Pour mettre à jour après modif du code web

```
npm run sync
```
Puis relance l'APK (ou Live Reload depuis Android Studio).
