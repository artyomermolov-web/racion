// Одноразовый генератор PNG-иконок PWA из того же рисунка, что и icon.svg.
// Запуск: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "latin1");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

// Композит слоя с покрытием (мягкий край ~1px).
function over(dst, src, a) {
  return [lerp(dst[0], src[0], a), lerp(dst[1], src[1], a), lerp(dst[2], src[2], a)];
}

function render(size) {
  const s = size / 512;
  const bgTop = hex("#0a84ff");
  const bgBot = hex("#0060df");
  const white = hex("#ffffff");
  const dots = [
    { x: 256, y: 188, r: 24, c: hex("#ff375f") },
    { x: 197, y: 290, r: 24, c: hex("#ff9f0a") },
    { x: 315, y: 290, r: 24, c: hex("#30d158") },
  ];
  const cx = 256 * s;
  const cy = 256 * s;
  const plateR = 150 * s;

  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // фон-градиент (полный квадрат — подходит под maskable)
      const t = y / (size - 1);
      let col = [lerp(bgTop[0], bgBot[0], t), lerp(bgTop[1], bgBot[1], t), lerp(bgTop[2], bgBot[2], t)];

      const dPlate = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      col = over(col, white, clamp01(plateR - dPlate + 0.5));

      for (const d of dots) {
        const dd = Math.hypot(x + 0.5 - d.x * s, y + 0.5 - d.y * s);
        col = over(col, d.c, clamp01(d.r * s - dd + 0.5));
      }

      const i = (y * size + x) * 4;
      buf[i] = Math.round(col[0]);
      buf[i + 1] = Math.round(col[1]);
      buf[i + 2] = Math.round(col[2]);
      buf[i + 3] = 255;
    }
  }
  return encodePNG(size, size, buf);
}

mkdirSync("public", { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(`public/${name}`, render(size));
  console.log("wrote public/" + name);
}
