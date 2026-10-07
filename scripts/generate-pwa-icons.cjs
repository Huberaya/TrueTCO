const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'binary'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function createPng(width, height, pixelFn) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(6, 9); // RGBA color type
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const ihdrChunk = makeChunk('IHDR', ihdr);

  const rowLength = 1 + width * 4;
  const rawData = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// Draw a beautiful TrueTCO icon: dark slate #020617 background, rounded or full-bleed, emerald badge, chart bars
function renderTrueTCOIcon(isMaskable) {
  return function (x, y, width, height) {
    const nx = x / width;
    const ny = y / height;
    const cx = 0.5;
    const cy = 0.5;
    const distSq = (nx - cx) ** 2 + (ny - cy) ** 2;

    // Background color: #020617 (slate-950) with subtle radial highlight
    let r = 2;
    let g = 6;
    let b = 23;
    let a = 255;

    if (!isMaskable) {
      // Rounded corners for non-maskable / apple-touch
      const cornerRadius = 0.22;
      const dx = Math.max(0, Math.abs(nx - 0.5) - (0.5 - cornerRadius));
      const dy = Math.max(0, Math.abs(ny - 0.5) - (0.5 - cornerRadius));
      if (Math.hypot(dx, dy) > cornerRadius) {
        return [0, 0, 0, 0]; // transparent outside squircle
      }
    }

    // Hexagonal / shield badge in center
    // Coordinates normalized within [0.2, 0.8] for safe zone
    const scale = isMaskable ? 0.72 : 0.85;
    const px = (nx - 0.5) / scale + 0.5;
    const py = (ny - 0.5) / scale + 0.5;

    // Check if inside inner shield
    const inShieldX = px >= 0.24 && px <= 0.76;
    const inShieldY = py >= 0.22 && py <= 0.78;

    // Inner shield background #091324
    if (inShieldX && inShieldY) {
      r = 9;
      g = 19;
      b = 36;

      // 3 bars: Bar 1 (left, grey), Bar 2 (center, cyan), Bar 3 (right, emerald)
      // Bar 1: x: 0.32-0.40, y: 0.54 - 0.72
      if (px >= 0.33 && px <= 0.41 && py >= 0.52 && py <= 0.72) {
        r = 71; g = 85; b = 105; // Slate-600
      }
      // Bar 2: x: 0.46-0.54, y: 0.42 - 0.72
      else if (px >= 0.46 && px <= 0.54 && py >= 0.42 && py <= 0.72) {
        r = 56; g = 189; b = 248; // Sky-400
      }
      // Bar 3: x: 0.59-0.67, y: 0.30 - 0.72
      else if (px >= 0.59 && px <= 0.67 && py >= 0.30 && py <= 0.72) {
        r = 52; g = 211; b = 153; // Emerald-400
      }
      
      // Top accent badge (Leaf/Check in Emerald)
      const distFromAccent = Math.hypot(px - 0.5, py - 0.28);
      if (distFromAccent <= 0.05) {
        r = 16; g = 185; b = 129; // Emerald-500
      }
    }

    return [r, g, b, a];
  };
}

const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

// 1. pwa-192x192.png
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), createPng(192, 192, renderTrueTCOIcon(false)));
console.log('✓ pwa-192x192.png created');

// 2. pwa-512x512.png
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), createPng(512, 512, renderTrueTCOIcon(false)));
console.log('✓ pwa-512x512.png created');

// 3. pwa-maskable-512x512.png (with safe-zone bleed)
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), createPng(512, 512, renderTrueTCOIcon(true)));
console.log('✓ pwa-maskable-512x512.png created');

// 4. apple-touch-icon.png (180x180)
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), createPng(180, 180, renderTrueTCOIcon(false)));
console.log('✓ apple-touch-icon.png created');

// 5. favicon.ico
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), createPng(32, 32, renderTrueTCOIcon(false)));
console.log('✓ favicon.ico created');
