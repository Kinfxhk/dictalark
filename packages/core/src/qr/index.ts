// SPDX-License-Identifier: AGPL-3.0-or-later
//
// A small QR code encoder (byte mode, versions 1–40, error correction L/M/Q/H), written for
// Dictalark from the public QR code model 2 symbol rules (ISO/IEC 18004). It turns a share
// link into dark/light modules on this device; nothing is sent anywhere. The test suite
// decodes every symbol with an independent decoder, and the Python oracle recomputes the
// Reed–Solomon error correction.

import { DictalarkError } from '../model/errors';

export const ECC_LEVELS = ['L', 'M', 'Q', 'H'] as const;
export type EccLevel = (typeof ECC_LEVELS)[number];

/** Format-information bits for each level (L = 01, M = 00, Q = 11, H = 10). */
const ECC_FORMAT_BITS: Record<EccLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Error-correction codewords per block and number of blocks, by version (index 0 unused).
// prettier-ignore
const EC_PER_BLOCK: Record<EccLevel, readonly number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
// prettier-ignore
const BLOCKS: Record<EccLevel, readonly number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

export interface QrCode {
  version: number;
  ecc: EccLevel;
  mask: number;
  /** Modules per side (21 + 4 × (version − 1)). */
  size: number;
  /** `modules[y][x]`, true = dark. No quiet zone. */
  modules: boolean[][];
}

/** Side length in modules. */
export const qrSize = (version: number): number => 17 + 4 * version;

/** Positions of alignment pattern centres along one axis (empty for version 1). */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
  const out: number[] = [];
  for (let pos = qrSize(version) - 7; out.length < count - 1; pos -= step) out.unshift(pos);
  return [6, ...out];
}

/** Modules available for data and error correction (everything but function patterns). */
export function rawDataModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const a = Math.floor(version / 7) + 2;
    n -= (25 * a - 10) * a - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

/** Data codewords (bytes) a symbol of this version and level holds. */
export function dataCodewords(version: number, ecc: EccLevel): number {
  return (
    Math.floor(rawDataModules(version) / 8) - EC_PER_BLOCK[ecc][version]! * BLOCKS[ecc][version]!
  );
}

/** How many bytes of text fit in byte mode. */
export function byteCapacity(version: number, ecc: EccLevel): number {
  const headerBits = 4 + (version <= 9 ? 8 : 16);
  return Math.floor((dataCodewords(version, ecc) * 8 - headerBits) / 8);
}

// ---- Reed–Solomon over GF(2^8) with the polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D) ----

function gfMul(a: number, b: number): number {
  let r = 0;
  for (let i = 7; i >= 0; i--) {
    r = (r << 1) ^ ((r >>> 7) * 0x11d);
    r ^= ((b >>> i) & 1) * a;
  }
  return r & 0xff;
}

/** Generator polynomial coefficients (highest degree first, leading 1 omitted). */
function rsGenerator(degree: number): number[] {
  const g = new Array<number>(degree).fill(0);
  g[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      g[j] = gfMul(g[j]!, root);
      if (j + 1 < degree) g[j] = g[j]! ^ g[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return g;
}

/** Error-correction codewords for `data` (remainder of data·x^n ÷ generator). */
export function reedSolomon(data: readonly number[], ecLen: number): number[] {
  const g = rsGenerator(ecLen);
  const r = new Array<number>(ecLen).fill(0);
  for (const b of data) {
    const factor = b ^ r.shift()!;
    r.push(0);
    for (let i = 0; i < ecLen; i++) r[i]! ^= gfMul(g[i]!, factor);
  }
  return r;
}

// ---- Data codewords ----

/** Data codewords before error correction (mode, length, bytes, terminator, padding). */
export function qrDataCodewords(text: string, version: number, ecc: EccLevel): number[] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > byteCapacity(version, ecc))
    throw new DictalarkError('too-large', { max: byteCapacity(version, ecc) });
  return dataBits(bytes, version, dataCodewords(version, ecc));
}

function dataBits(bytes: Uint8Array, version: number, capacityBytes: number): number[] {
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1);
  };
  put(0b0100, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  const cap = capacityBytes * 8;
  put(0, Math.min(4, cap - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]!;
    out.push(v);
  }
  for (let pad = 0xec; out.length < capacityBytes; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/** Split into blocks, add error correction, interleave. */
export function codewords(data: readonly number[], version: number, ecc: EccLevel): number[] {
  const nBlocks = BLOCKS[ecc][version]!;
  const ecLen = EC_PER_BLOCK[ecc][version]!;
  const total = Math.floor(rawDataModules(version) / 8);
  const shortBlocks = nBlocks - (total % nBlocks);
  const shortData = Math.floor(total / nBlocks) - ecLen;
  const blocks: number[][] = [];
  const ecs: number[][] = [];
  let k = 0;
  for (let i = 0; i < nBlocks; i++) {
    const len = shortData + (i < shortBlocks ? 0 : 1);
    const block = data.slice(k, k + len);
    k += len;
    blocks.push(block);
    ecs.push(reedSolomon(block, ecLen));
  }
  const out: number[] = [];
  for (let i = 0; i <= shortData; i++) for (const b of blocks) if (i < b.length) out.push(b[i]!);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]!);
  return out;
}

// ---- Matrix ----

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** BCH remainder of `value` (already shifted) by `poly`. */
function bchRemainder(value: number, poly: number): number {
  const polyLen = 32 - Math.clz32(poly);
  let v = value;
  while (32 - Math.clz32(v) >= polyLen) v ^= poly << (32 - Math.clz32(v) - polyLen);
  return v;
}

export function formatBits(ecc: EccLevel, mask: number): number {
  const d = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  return ((d << 10) | bchRemainder(d << 10, 0x537)) ^ 0x5412;
}

export function versionBits(version: number): number {
  return (version << 12) | bchRemainder(version << 12, 0x1f25);
}

class Grid {
  readonly dark: boolean[][];
  readonly fixed: boolean[][];
  constructor(readonly size: number) {
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean): void {
    this.dark[y]![x] = dark;
    this.fixed[y]![x] = true;
  }
}

function drawFunctionPatterns(g: Grid, version: number): void {
  const n = g.size;
  for (let i = 0; i < n; i++) {
    g.set(6, i, i % 2 === 0);
    g.set(i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        g.set(x, y, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(n - 4, 3);
  finder(3, n - 4);
  const pos = alignmentPositions(version);
  const last = pos.length - 1;
  pos.forEach((cy, i) =>
    pos.forEach((cx, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          g.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(g, 'M', 0); // reserve; drawn again with the real values
  if (version >= 7) {
    const v = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((v >>> i) & 1) === 1;
      const a = n - 11 + (i % 3);
      const b = Math.floor(i / 3);
      g.set(a, b, bit);
      g.set(b, a, bit);
    }
  }
}

function drawFormat(g: Grid, ecc: EccLevel, mask: number): void {
  const n = g.size;
  const f = formatBits(ecc, mask);
  const bit = (i: number) => ((f >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) g.set(8, i, bit(i));
  g.set(8, 7, bit(6));
  g.set(8, 8, bit(7));
  g.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) g.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) g.set(n - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) g.set(8, n - 15 + i, bit(i));
  g.set(8, n - 8, true); // the dark module
}

function placeData(g: Grid, cw: readonly number[]): void {
  const n = g.size;
  let i = 0;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let v = 0; v < n; v++) {
      const y = upward ? n - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (g.fixed[y]![x]) continue;
        if (i < cw.length * 8) g.dark[y]![x] = ((cw[i >>> 3]! >>> (7 - (i & 7))) & 1) === 1;
        i++;
      }
    }
  }
}

function applyMask(g: Grid, mask: number): void {
  const m = MASKS[mask]!;
  for (let y = 0; y < g.size; y++)
    for (let x = 0; x < g.size; x++) if (!g.fixed[y]![x] && m(x, y)) g.dark[y]![x] = !g.dark[y]![x];
}

/** Penalty score used to choose the mask (lower is better). */
export function penalty(m: readonly (readonly boolean[])[]): number {
  const n = m.length;
  let score = 0;
  const at = (x: number, y: number, vertical: boolean) => (vertical ? m[x]![y]! : m[y]![x]!);
  for (const vertical of [false, true]) {
    for (let y = 0; y < n; y++) {
      let run = 1;
      for (let x = 1; x <= n; x++) {
        if (x < n && at(x, y, vertical) === at(x - 1, y, vertical)) run++;
        else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      // 1:1:3:1:1 finder-like pattern with four light modules on one side
      for (let x = 0; x + 7 <= n; x++) {
        const core =
          at(x, y, vertical) &&
          !at(x + 1, y, vertical) &&
          at(x + 2, y, vertical) &&
          at(x + 3, y, vertical) &&
          at(x + 4, y, vertical) &&
          !at(x + 5, y, vertical) &&
          at(x + 6, y, vertical);
        if (!core) continue;
        const lightRun = (from: number, to: number) => {
          for (let k = from; k < to; k++) if (k >= 0 && k < n && at(k, y, vertical)) return false;
          return true;
        };
        if (lightRun(x - 4, x)) score += 40;
        if (lightRun(x + 7, x + 11)) score += 40;
      }
    }
  }
  for (let y = 0; y + 1 < n; y++)
    for (let x = 0; x + 1 < n; x++) {
      const c = m[y]![x];
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
    }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = n * n;
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return score;
}

export interface QrOptions {
  /** Lowest error-correction level to use; default M, falling back to L when too long. */
  ecc?: EccLevel;
  /** Force one mask (0–7); default: the one with the lowest penalty. */
  mask?: number;
  /** Largest version allowed (1–40); default 40. */
  maxVersion?: number;
}

/** Encode text (UTF-8, byte mode). Throws `too-large` when it does not fit any symbol. */
export function encodeQr(text: string, opts: QrOptions = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  const maxVersion = opts.maxVersion ?? 40;
  const levels: EccLevel[] = opts.ecc ? [opts.ecc] : ['M', 'L'];
  for (const ecc of levels) {
    for (let version = 1; version <= maxVersion; version++) {
      if (bytes.length > byteCapacity(version, ecc)) continue;
      const data = dataBits(bytes, version, dataCodewords(version, ecc));
      const cw = codewords(data, version, ecc);
      const build = (mask: number) => {
        const g = new Grid(qrSize(version));
        drawFunctionPatterns(g, version);
        placeData(g, cw);
        applyMask(g, mask);
        drawFormat(g, ecc, mask);
        return g.dark;
      };
      let mask = opts.mask ?? -1;
      let modules: boolean[][];
      if (mask >= 0) modules = build(mask);
      else {
        let best = Infinity;
        modules = [];
        for (let k = 0; k < 8; k++) {
          const m = build(k);
          const p = penalty(m);
          if (p < best) {
            best = p;
            mask = k;
            modules = m;
          }
        }
      }
      return { version, ecc, mask, size: qrSize(version), modules };
    }
  }
  throw new DictalarkError('too-large', { max: byteCapacity(maxVersion, 'L') });
}

/** An SVG drawing of the code with a 4-module quiet zone; `scale` pixels per module. */
export function qrToSvg(qr: QrCode, scale = 4, title = ''): string {
  const q = 4;
  const side = qr.size + 2 * q;
  let d = '';
  qr.modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) d += `M${x + q} ${y + q}h1v1h-1z`;
    }),
  );
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side * scale}" height="${side * scale}" shape-rendering="crispEdges" role="img"${title ? ` aria-label="${esc(title)}"` : ''}>` +
    (title ? `<title>${esc(title)}</title>` : '') +
    `<rect width="${side}" height="${side}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`
  );
}
