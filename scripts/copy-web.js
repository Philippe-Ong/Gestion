const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const www = path.join(root, 'www');

const FILES = ['index.html', 'app.js', 'styles.css', 'stress-test.js'];
const DIRS = ['templates'];

fs.mkdirSync(www, { recursive: true });

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
