'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');

const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c;
}

function crc32(buffer) {
  let c = -1;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function encodePNG(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0; // filter: none
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a, b, t) => a + (b - a) * t;

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  let t = length2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / length2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function makeIcon(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const points = maskable
    ? [[0.36, 0.50], [0.46, 0.60], [0.64, 0.42]]
    : [[0.24, 0.51], [0.43, 0.70], [0.77, 0.30]];
  const thickness = maskable ? 0.075 : 0.095;
  const softness = 2 / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const gradient = (u + v) / 2;

      let r = mix(37, 79, gradient);
      let g = mix(99, 70, gradient);
      let b = mix(235, 229, gradient);

      const glow = Math.max(0, 1 - Math.hypot(u - 0.78, v - 0.16) * 1.8);
      r = mix(r, 140, glow * 0.25);
      g = mix(g, 180, glow * 0.25);
      b = mix(b, 255, glow * 0.25);

      const d = Math.min(
        distanceToSegment(u, v, points[0][0], points[0][1], points[1][0], points[1][1]),
        distanceToSegment(u, v, points[1][0], points[1][1], points[2][0], points[2][1])
      );
      const alpha = Math.max(0, Math.min(1, (thickness / 2 + softness - d) / (softness * 2)));
      r = mix(r, 255, alpha);
      g = mix(g, 255, alpha);
      b = mix(b, 255, alpha);

      const i = (y * size + x) * 4;
      rgba[i] = clamp(r);
      rgba[i + 1] = clamp(g);
      rgba[i + 2] = clamp(b);
      rgba[i + 3] = 255;
    }
  }

  return encodePNG(size, rgba);
}

fs.mkdirSync(OUT, { recursive: true });
const icons = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];

for (const [name, size, maskable] of icons) {
  fs.writeFileSync(path.join(OUT, name), makeIcon(size, maskable));
  console.log(`created ${name} (${size}x${size})`);
}
