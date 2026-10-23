// Draws the app icons as PNG files (no image editor needed).
// Run with:  node tools/make-icons.mjs
// The icon is a white "×" on a blue rounded square.

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const BLUE = [44, 86, 201];
const WHITE = [255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp = (v) => Math.max(0, Math.min(1, v));
// signed distance to a rounded square centred at c with half-size h, radius r
function roundedSquare(x, y, c, h, r) {
  const qx = Math.abs(x - c) - (h - r);
  const qy = Math.abs(y - c) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
// distance to a line segment (a thick stroke with round ends)
function segment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function icon(size, { maskable }) {
  const c = size / 2;
  const arm = size * (maskable ? 0.17 : 0.2); // keep inside the safe zone for maskable
  const stroke = size * (maskable ? 0.055 : 0.065);
  return png(size, (x, y) => {
    const bg = maskable ? 1 : clamp(0.5 - roundedSquare(x, y, c, size * 0.47, size * 0.2));
    const d = Math.min(segment(x, y, c - arm, c - arm, c + arm, c + arm), segment(x, y, c + arm, c - arm, c - arm, c + arm));
    const fg = clamp(stroke + 0.5 - d);
    const col = BLUE.map((v, i) => Math.round(v * (1 - fg) + WHITE[i] * fg));
    return [...col, Math.round(255 * Math.max(bg, 0) * 1)];
  });
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect x="15" y="15" width="482" height="482" rx="102" fill="rgb(${BLUE.join(',')})"/>
  <path d="M154 154 358 358M358 154 154 358" stroke="#fff" stroke-width="66" stroke-linecap="round"/>
</svg>
`;

const out = new URL('../icons/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icon-192.png', out), icon(192, { maskable: false }));
writeFileSync(new URL('icon-512.png', out), icon(512, { maskable: false }));
writeFileSync(new URL('maskable-512.png', out), icon(512, { maskable: true }));
writeFileSync(new URL('apple-touch-icon.png', out), icon(180, { maskable: true }));
writeFileSync(new URL('icon.svg', out), svg);
console.log('Icons written to icons/');
