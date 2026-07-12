// Génère les icônes PWA (PNG) sans dépendance externe.
// Design : silhouette blanche d'une tasse (thé froid → pas de vapeur) sur
// dégradé vert de marque. Rendu supersamplé (anti-aliasing) puis encodé en PNG.
//
//   node scripts/gen-icons.js
//
// Produit icons/icon-180.png (apple-touch-icon), icons/icon-192.png,
// icons/icon-512.png (manifest, purpose "any maskable").
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0
    rgba.copy ? rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
              : Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ── Géométrie (coordonnées normalisées 0..1, y vers le bas) ──────────────
const TOP = [110, 143, 76];   // #6E8F4C
const BOT = [74, 101, 48];    // #4A6530
const WHITE = [255, 255, 255];

const cup = { x0: 176 / 512, x1: 336 / 512, y0: 176 / 512, yr: 220 / 512, r: 80 / 512 };
const saucer = { cx: 0.5, cy: 336 / 512, rx: 120 / 512, ry: 20 / 512 };
const handle = { cx: 336 / 512, cy: 222 / 512, rOut: 65 / 512, rIn: 39 / 512, cap: 14 / 512,
                 topY: 170 / 512, botY: 274 / 512 };

const inRect = (x, y, r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.yr;
const inDiscLower = (x, y) => {
  const dx = x - 0.5, dy = y - cup.yr;
  return y >= cup.yr && (dx * dx + dy * dy) <= cup.r * cup.r;
};
const inEllipse = (x, y, e) => {
  const dx = (x - e.cx) / e.rx, dy = (y - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
};
const disc = (x, y, cx, cy, r) => {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
};
const inHandle = (x, y) => {
  const dx = x - handle.cx, dy = y - handle.cy;
  const d2 = dx * dx + dy * dy;
  const ring = d2 >= handle.rIn * handle.rIn && d2 <= handle.rOut * handle.rOut && x >= handle.cx;
  return ring || disc(x, y, handle.cx, handle.topY, handle.cap) || disc(x, y, handle.cx, handle.botY, handle.cap);
};

function sample(x, y) {
  if (inEllipse(x, y, saucer) || inRect(x, y, cup) || inDiscLower(x, y) || inHandle(x, y)) return WHITE;
  const t = y; // dégradé vertical
  return [Math.round(TOP[0] + (BOT[0] - TOP[0]) * t),
          Math.round(TOP[1] + (BOT[1] - TOP[1]) * t),
          Math.round(TOP[2] + (BOT[2] - TOP[2]) * t)];
}

function render(size) {
  const SS = 4, N = size * SS, s2 = SS * SS;
  const acc = new Float64Array(size * size * 3);
  for (let sy = 0; sy < N; sy++) {
    const ny = (sy + 0.5) / N, oy = (sy / SS) | 0;
    for (let sx = 0; sx < N; sx++) {
      const c = sample((sx + 0.5) / N, ny);
      const i = (oy * size + ((sx / SS) | 0)) * 3;
      acc[i] += c[0]; acc[i + 1] += c[1]; acc[i + 2] += c[2];
    }
  }
  const rgba = Buffer.alloc(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    rgba[p * 4] = Math.round(acc[p * 3] / s2);
    rgba[p * 4 + 1] = Math.round(acc[p * 3 + 1] / s2);
    rgba[p * 4 + 2] = Math.round(acc[p * 3 + 2] / s2);
    rgba[p * 4 + 3] = 255;
  }
  return encodePNG(size, size, rgba);
}

const outDir = path.resolve(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`generated icons/icon-${size}.png`);
}
