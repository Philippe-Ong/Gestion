const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');

const FILES = [
  'index.html', 'styles.css', 'manifest.webmanifest',
  'app-core.js', 'app-sync.js', 'app-ui.js', 'app-dashboard.js', 'app-jumeau.js',
  'app-stock.js', 'app-pointage.js', 'app-commandes.js', 'app-livraisons.js',
  'app-production.js', 'app-inventaire.js', 'app-parametres.js', 'app-sauvegardes.js', 'app.js'
];
const DIRS = ['templates', 'icons', 'vendor'];

fs.mkdirSync(www, { recursive: true });

// Nettoyer un éventuel stress-test.js d'une build antérieure
const oldStressTest = path.join(www, 'stress-test.js');
if (fs.existsSync(oldStressTest)) {
  fs.rmSync(oldStressTest);
  console.log('cleaned www/stress-test.js');
}

for (const f of FILES) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(www, f));
    console.log(`copied ${f}`);
  }
}

for (const d of DIRS) {
  const src = path.join(root, d);
  const dst = path.join(www, d);
  if (fs.existsSync(src)) {
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
    console.log(`copied ${d}/`);
  }
}
