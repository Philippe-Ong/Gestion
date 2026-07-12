// Génère les icônes PWA (PNG) à partir de l'icône adaptive Android (l'icône de
// l'APK), pour que le web/iPhone ait exactement la même identité visuelle.
//
//   node scripts/gen-icons.js
//
// Source : android/.../mipmap-xxxhdpi/ic_launcher_foreground.png (432px, RGBA)
// composé sur la couleur de fond de l'icône adaptive (values/ic_launcher_background.xml).
// Produit icons/icon-{180,192,512}.png. Sans dépendance externe.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.resolve(__dirname, '..');
const FG_SRC = path.join(root, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png');

// ── PNG encoder (RGBA, 8 bits) ───────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
};
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── PNG decoder (8-bit, colortype 6/2/0, non-interlaced) ─────────────────
const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
};
function decodePNG(buf) {
  let pos = 8, w = 0, h = 0, ct = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : 1;
  const stride = w * ch;
  const cur = Buffer.alloc(h * stride);
  let rp = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const v = raw[rp++];
      const a = x >= ch ? cur[y * stride + x - ch] : 0;
      const b = y > 0 ? cur[(y - 1) * stride + x] : 0;
      const c = (x >= ch && y > 0) ? cur[(y - 1) * stride + x - ch] : 0;
      let r;
      switch (ft) {
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: r = v;
      }
      cur[y * stride + x] = r & 0xff;
    }
  }
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (ch === 4) { data[i*4]=cur[i*4]; data[i*4+1]=cur[i*4+1]; data[i*4+2]=cur[i*4+2]; data[i*4+3]=cur[i*4+3]; }
    else if (ch === 3) { data[i*4]=cur[i*3]; data[i*4+1]=cur[i*3+1]; data[i*4+2]=cur[i*3+2]; data[i*4+3]=255; }
    else { data[i*4]=data[i*4+1]=data[i*4+2]=cur[i]; data[i*4+3]=255; }
  }
  return { w, h, data };
}

// ── Compose : foreground over adaptive background color ──────────────────
const lerp = (a, b, t) => a + (b - a) * t;
function sampleBilinear(img, fx, fy) {
  fx = Math.max(0, Math.min(img.w - 1, fx)); fy = Math.max(0, Math.min(img.h - 1, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0, o = [0, 0, 0, 0];
  const at = (x, y, c) => img.data[(y * img.w + x) * 4 + c];
  for (let c = 0; c < 4; c++)
    o[c] = lerp(lerp(at(x0, y0, c), at(x1, y0, c), dx), lerp(at(x0, y1, c), at(x1, y1, c), dx), dy);
  return o;
}
// Boîte englobante du contenu opaque (le panneau clair + le logo).
function contentBBox(img) {
  let minX = img.w, minY = img.h, maxX = -1, maxY = -1;
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++)
      if (img.data[(y * img.w + x) * 4 + 3] > 16) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
  if (maxX < 0) return { minX: 0, minY: 0, w: img.w, h: img.h };
  return { minX, minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// FILL < 1 laisse une marge (même couleur que le panneau → invisible) pour
// que le logo reste dans la zone de sécurité des icônes "maskable".
const FILL = 0.9;
function render(size, fg, fillCol, bb) {
  const scale = (FILL * size) / Math.max(bb.w, bb.h);
  const cw = bb.w * scale, chh = bb.h * scale;
  const ox = (size - cw) / 2, oy = (size - chh) / 2;
  const SS = Math.max(2, Math.ceil(fg.w / size) + 1);
  const N = size * SS, acc = new Float64Array(size * size * 3);
  for (let sy = 0; sy < N; sy++) {
    const cy = (sy + 0.5) / SS, oyIdx = (sy / SS) | 0;
    for (let sx = 0; sx < N; sx++) {
      const cx = (sx + 0.5) / SS;
      let r = fillCol[0], g = fillCol[1], b = fillCol[2];
      if (cx >= ox && cx < ox + cw && cy >= oy && cy < oy + chh) {
        const s = sampleBilinear(fg, bb.minX + (cx - ox) / scale, bb.minY + (cy - oy) / scale);
        const a = s[3] / 255;
        r = s[0] * a + fillCol[0] * (1 - a);
        g = s[1] * a + fillCol[1] * (1 - a);
        b = s[2] * a + fillCol[2] * (1 - a);
      }
      const i = (oyIdx * size + ((sx / SS) | 0)) * 3;
      acc[i] += r; acc[i + 1] += g; acc[i + 2] += b;
    }
  }
  const s2 = SS * SS, rgba = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    rgba[p*4]   = Math.round(acc[p*3]     / s2);
    rgba[p*4+1] = Math.round(acc[p*3 + 1] / s2);
    rgba[p*4+2] = Math.round(acc[p*3 + 2] / s2);
    rgba[p*4+3] = 255;
  }
  return encodePNG(size, size, rgba);
}

const fg = decodePNG(fs.readFileSync(FG_SRC));
const bbRaw = contentBBox(fg);
// Couleur du panneau : coin haut-gauche du contenu (au-dessus du logo centré).
const pad = Math.round(bbRaw.w * 0.06);
const cpx = ((bbRaw.minY + pad) * fg.w + (bbRaw.minX + pad)) * 4;
const fillCol = [fg.data[cpx], fg.data[cpx + 1], fg.data[cpx + 2]];
// Rogne le liseré anti-aliasé du panneau (sinon couture visible avec la marge).
const inset = Math.round(bbRaw.w * 0.02);
const bb = { minX: bbRaw.minX + inset, minY: bbRaw.minY + inset, w: bbRaw.w - 2 * inset, h: bbRaw.h - 2 * inset };
console.log(`source ${fg.w}x${fg.h}, contenu ${bbRaw.w}x${bbRaw.h} (inset ${inset}), panneau rgb(${fillCol.join(',')})`);

const outDir = path.join(root, 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), render(size, fg, fillCol, bb));
  console.log(`generated icons/icon-${size}.png`);
}
