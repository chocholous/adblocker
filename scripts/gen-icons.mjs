// Pure-Node PNG icon generator for the "Stealth Content Hider" extension.
//
// Generates public/icon/{16,32,48,128}.png using ONLY Node built-ins
// (zlib + manual PNG chunk encoding with CRC32). No image libraries.
//
// Design: a rounded-square tile in brand blue (#2563eb) with a white circle
// outline and a diagonal slash through it — the universal "no / block" motif.
//
// Run: node scripts/gen-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'icon');
const SIZES = [16, 32, 48, 128];

// --- Colors (RGBA) ---
const BG = [37, 99, 235, 255]; // #2563eb brand blue
const FG = [255, 255, 255, 255]; // white circle + slash
const TRANSPARENT = [0, 0, 0, 0];

// --- CRC32 (PNG spec) ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'latin1');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Encode an RGBA pixel buffer (size*size*4) as an 8-bit RGBA PNG.
function encodePng(size, rgba) {
  const SIGNATURE = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); // width
  ihdr.writeUInt32BE(size, 4); // height
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type 6 = truecolor + alpha
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Raw image: each scanline prefixed with filter byte 0 (None).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(buf, size, x, y, color) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const i = (y * size + x) * 4;
  buf[i] = color[0];
  buf[i + 1] = color[1];
  buf[i + 2] = color[2];
  buf[i + 3] = color[3];
}

function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);

  // Geometry scaled to size.
  const radiusCorner = Math.max(1, Math.round(size * 0.18)); // rounded-square corner radius
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const ringOuter = size * 0.34; // outer edge of white ring
  const ringInner = size * 0.24; // inner edge of white ring
  const ringThickHalf = (ringOuter - ringInner) / 2;
  const ringMid = (ringOuter + ringInner) / 2;
  // Slash: diagonal line from top-left to bottom-right of the circle.
  const slashHalf = Math.max(1, size * 0.045); // half-thickness of slash
  const slashLen = ringMid; // extends to the ring mid-radius

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 1) Rounded-square background mask.
      const inSquare = insideRoundedSquare(x, y, size, radiusCorner);
      if (!inSquare) {
        setPixel(buf, size, x, y, TRANSPARENT);
        continue;
      }

      setPixel(buf, size, x, y, BG);

      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // 2) White circle ring.
      if (Math.abs(dist - ringMid) <= ringThickHalf) {
        setPixel(buf, size, x, y, FG);
        continue;
      }

      // 3) Diagonal slash (top-left to bottom-right): direction (1,1)/sqrt2.
      // Perpendicular distance from the line y=x through center, and bounded length.
      const along = (dx + dy) / Math.SQRT2; // projection onto slash direction
      const perp = (dx - dy) / Math.SQRT2; // perpendicular distance
      if (Math.abs(perp) <= slashHalf && Math.abs(along) <= slashLen) {
        setPixel(buf, size, x, y, FG);
        continue;
      }
    }
  }

  return buf;
}

// Rounded-square (full-tile) membership test.
function insideRoundedSquare(x, y, size, r) {
  const min = 0;
  const max = size - 1;
  if (x < min || y < min || x > max || y > max) return false;
  // Distance into each corner region.
  const left = min + r;
  const right = max - r;
  const top = min + r;
  const bottom = max - r;
  let qx = 0;
  let qy = 0;
  if (x < left) qx = left - x;
  else if (x > right) qx = x - right;
  if (y < top) qy = top - y;
  else if (y > bottom) qy = y - bottom;
  return qx * qx + qy * qy <= r * r;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const rgba = renderIcon(size);
  const png = encodePng(size, rgba);
  const path = join(OUT_DIR, `${size}.png`);
  writeFileSync(path, png);
  console.log(`wrote ${path} (${png.length} bytes)`);
}
console.log('done');
