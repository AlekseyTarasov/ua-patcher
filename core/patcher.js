// Liquidator UA patcher: takes the player's own jar and the translation (patch.json), returns a new jar.
// Runs in the browser and in Node 18+ (needs DecompressionStream). No game files are shipped with it.
// The jar is read and written here, in the page: nothing is uploaded anywhere.

// ------------------------------------------------------------------ CRC32
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf, start = 0, end = buf.length, crc = 0xffffffff) {
  for (let i = start; i < end; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}
const crcOf = (b) => (crc32(b) ^ 0xffffffff) >>> 0;

async function inflate(data, format) {
  const ds = new DecompressionStream(format);
  const out = new Response(new Blob([data]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}

// ------------------------------------------------------------------ zip
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('це не jar/zip');
  const n = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const entries = [];
  for (let i = 0; i < n; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error('пошкоджений jar');
    const method = u16(buf, p + 10), crc = u32(buf, p + 16), csize = u32(buf, p + 20), size = u32(buf, p + 24);
    const nl = u16(buf, p + 28), el = u16(buf, p + 30), cl = u16(buf, p + 32), lho = u32(buf, p + 42);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    const dataStart = lho + 30 + u16(buf, lho + 26) + u16(buf, lho + 28);
    entries.push({ name, method, crc, csize, size, raw: buf.subarray(dataStart, dataStart + csize), time: u16(buf, p + 12), date: u16(buf, p + 14) });
    p += 46 + nl + el + cl;
  }
  return entries;
}

async function entryData(e) {
  if (e.method === 0) return e.raw;
  if (e.method === 8) return inflate(e.raw, 'deflate-raw');
  throw new Error('невідоме стиснення в ' + e.name);
}

// Writes the zip back: unchanged entries keep their compressed bytes, changed ones are stored.
function writeZip(entries) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let off = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const lh = new Uint8Array(30 + name.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, e.method, true); dv.setUint16(10, e.time, true); dv.setUint16(12, e.date, true);
    dv.setUint32(14, e.crc, true); dv.setUint32(18, e.raw.length, true); dv.setUint32(22, e.size, true);
    dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0, true);
    cv.setUint16(10, e.method, true); cv.setUint16(12, e.time, true); cv.setUint16(14, e.date, true);
    cv.setUint32(16, e.crc, true); cv.setUint32(20, e.raw.length, true); cv.setUint32(24, e.size, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, off, true);
    ch.set(name, 46);
    parts.push(lh, e.raw);
    central.push(ch);
    off += lh.length + e.raw.length;
  }
  const csize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, csize, true); ev.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/java-archive' });
}

// ------------------------------------------------------------------ PNG (indexed, as in the game)
async function decodePng(d) {
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0, plte = null, trns = null;
  const idat = [];
  while (p < d.length) {
    const n = u32be(d, p), type = String.fromCharCode(...d.subarray(p + 4, p + 8)), c = d.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') { w = u32be(c, 0); h = u32be(c, 4); depth = c[8]; ctype = c[9]; interlace = c[12]; }
    else if (type === 'PLTE') plte = c.slice();
    else if (type === 'tRNS') trns = c.slice();
    else if (type === 'IDAT') idat.push(c);
    else if (type === 'IEND') break;
    p += 12 + n;
  }
  if (ctype !== 3) throw new Error('шрифт не в палітрі');
  const raw = await inflate(concat(idat), 'deflate');
  const px = new Uint8Array(w * h);
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  let off = 0;
  for (const [sx, sy, dx, dy] of passes) {
    const pw = Math.ceil((w - sx) / dx), ph = Math.ceil((h - sy) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil(pw * depth / 8);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const f = raw[off];
      for (let i = 0; i < stride; i++) {
        let x = raw[off + 1 + i];
        const a = i >= 1 ? cur[i - 1] : 0, b = prev[i], cc = i >= 1 ? prev[i - 1] : 0;
        if (f === 1) x += a;
        else if (f === 2) x += b;
        else if (f === 3) x += (a + b) >> 1;
        else if (f === 4) { const pp = a + b - cc, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - cc); x += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; }
        cur[i] = x & 255;
      }
      for (let i = 0; i < pw; i++) {
        const bit = i * depth;
        px[(sy + y * dy) * w + sx + i * dx] = (cur[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
      }
      off += stride + 1;
      [prev, cur] = [cur, prev];
    }
  }
  return { w, h, px, plte, trns };
}

// 8-bit indexed, not interlaced: every MIDP phone reads that
async function encodePng(img) {
  const { w, h, px, plte, trns } = img;
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w, y * w + w), y * (w + 1) + 1);
  const cs = new CompressionStream('deflate');
  const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(cs)).arrayBuffer());
  const chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length);
    const v = new DataView(b.buffer);
    v.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8);
    v.setUint32(8 + data.length, crcOf(b.subarray(4, 8 + data.length)));
    return b;
  };
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w); v.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 3;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
  if (trns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', z), chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
function concat(arrs) {
  const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// ------------------------------------------------------------------ the translation
function encodeText(s, remap) {
  const out = [];
  for (const ch of s) {
    if (remap[ch] !== undefined) { out.push(remap[ch]); continue; }
    const c = ch.codePointAt(0);
    if (c < 128) out.push(c);
    else if (c >= 0x410 && c <= 0x44f) out.push(c - 0x350);  // А..я in cp1251
    else throw new Error('літери «' + ch + '» немає в шрифті гри');
  }
  return out;
}

// The game's text files: an optional 2-byte "_x" header, lines split by CR LF, fields by '='.
function patchTextFile(data, strings, remap) {
  const pre = data[0] === 95 ? 2 : 0;
  let end = data.indexOf(0, pre);
  if (end < 0) end = data.length;
  const lines = [[[]]];
  for (let i = pre; i < end; i++) {
    const b = data[i];
    if (b === 13 && data[i + 1] === 10) { lines.push([[]]); i++; }
    else if (b === 61) lines[lines.length - 1].push([]);
    else lines[lines.length - 1][lines[lines.length - 1].length - 1].push(b);
  }
  let n = 0;
  for (const [key, s] of Object.entries(strings)) {
    const [li, fi] = key.split(':').map((x) => parseInt(x, 10) - 1);
    if (!lines[li] || !lines[li][fi]) throw new Error('у тексті немає рядка ' + key);
    lines[li][fi] = encodeText(s, remap);
    n++;
  }
  const out = [...data.subarray(0, pre)];
  lines.forEach((fields, li) => {
    if (li) out.push(13, 10);
    fields.forEach((f, fi) => { if (fi) out.push(61); out.push(...f); });
  });
  out.push(...data.subarray(end));
  return { bytes: new Uint8Array(out), n };
}

// New glyphs go under the font image; the metric table entries of Э Ъ Ы point at them.
async function patchFont(pngData, table, spec) {
  const img = await decodePng(pngData);
  const nPal = img.plte.length / 3;
  const findColor = ([r, g, b]) => {
    for (let i = 0; i < nPal; i++) {
      const opaque = !img.trns || i >= img.trns.length || img.trns[i] === 255;
      if (opaque && img.plte[i * 3] === r && img.plte[i * 3 + 1] === g && img.plte[i * 3 + 2] === b) return i;
    }
    throw new Error('у шрифті немає потрібного кольору');
  };
  let clear = -1;
  for (let i = 0; img.trns && i < img.trns.length; i++) if (img.trns[i] === 0) { clear = i; break; }
  if (clear < 0) throw new Error('у шрифті немає прозорого кольору');
  const pal = Object.fromEntries(Object.entries(spec.palette).map(([k, c]) => [k, findColor(c)]));
  const gl = Object.entries(spec.glyphs);
  const gh = Math.max(...gl.map(([, g]) => g.length));
  const H = img.h + 1 + gh;
  const px = new Uint8Array(img.w * H).fill(clear);
  px.set(img.px);
  const t = new Int8Array(table.buffer.slice(table.byteOffset, table.byteOffset + table.length));
  let x = 0;
  for (const [idx, rows] of gl) {
    const gw = rows[0].length;
    if (x + gw > img.w) throw new Error('шрифт завузький');
    rows.forEach((row, yy) => {
      for (let xx = 0; xx < gw; xx++) if (pal[row[xx]] !== undefined) px[(img.h + 1 + yy) * img.w + x + xx] = pal[row[xx]];
    });
    const i = parseInt(idx, 10) * 6;
    t[i] = x; t[i + 1] = img.h + 1; t[i + 2] = gw; t[i + 3] = rows.length; t[i + 4] = 0; t[i + 5] = 0;
    x += gw + 1;
  }
  if (img.h + 1 > 127) throw new Error('шрифт зависокий');
  return { png: await encodePng({ ...img, h: H, px }), table: new Uint8Array(t.buffer) };
}

// ------------------------------------------------------------------ kinds of patches
// netlizard-text: NET Lizard J2ME games (text files with '=' fields, PNG bitmap fonts + metric tables)
// options.lilkaHelp: the help names the buttons of Lilka instead of the phone keys
async function patchNetLizard(jarBytes, patch, options = {}, log = () => {}) {
  const entries = readZip(jarBytes);
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  for (const [name, crc] of Object.entries(patch.crc)) {
    const e = byName[name];
    if (!e) throw new Error('у jar немає ' + name + ': це інша гра або інша версія');
    if (e.crc !== crc) throw new Error(name + ' не збігається: потрібна версія ' + patch.game);
  }
  log('jar підходить: ' + patch.game);
  const replace = (name, bytes) => {
    const e = byName[name];
    e.method = 0; e.raw = bytes; e.size = bytes.length; e.crc = crcOf(bytes);
  };
  for (const [file, strings] of Object.entries(patch.text)) {
    const s = file === 'HELP' && options.lilkaHelp ? { ...strings, ...patch.helpLilka } : strings;
    const { bytes, n } = patchTextFile(await entryData(byName[file + '.png']), s, patch.remap);
    replace(file + '.png', bytes);
    log(file + ': ' + n + ' рядків');
  }
  for (const [font, spec] of Object.entries(patch.fonts)) {
    const { png, table } = await patchFont(await entryData(byName[font + '.png']), await entryData(byName[spec.table + '.png']), spec);
    replace(font + '.png', png);
    replace(spec.table + '.png', table);
    log(font + ': додано Є Ї Ґ');
  }
  return writeZip(entries);
}

export const KINDS = { 'netlizard-text': patchNetLizard };

// Applies a patch of any kind to the player's file (Uint8Array); returns a Blob.
export async function applyPatch(fileBytes, patch, options = {}, log = () => {}) {
  const fn = KINDS[patch.kind];
  if (!fn) throw new Error('невідомий тип патча: ' + patch.kind);
  return fn(fileBytes, patch, options, log);
}
export { readZip, writeZip, entryData, decodePng, encodePng };
