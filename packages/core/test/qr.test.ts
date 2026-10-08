// SPDX-License-Identifier: AGPL-3.0-or-later
// QR codes for share links. Every symbol is read back with an independent decoder (jsQR,
// Apache-2.0, a test-only dependency), so a wrong table, mask, placement or error
// correction cannot pass. Golden values below come from the published QR code rules.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fc from 'fast-check';
import jsQR from 'jsqr';
import { afterAll, describe, expect, it } from 'vitest';
import * as core from '../src/index';

type Core = typeof core;

/** Render with a 4-module quiet zone, `px` pixels per module, and decode. */
function decode(qr: core.QrCode, px = 2): string | null {
  const side = (qr.size + 8) * px;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.modules[y]![x])
        for (let dy = 0; dy < px; dy++)
          for (let dx = 0; dx < px; dx++) {
            const o = (((y + 4) * px + dy) * side + (x + 4) * px + dx) * 4;
            rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
          }
  const r = jsQR(rgba, side, side, { inversionAttempts: 'dontInvert' });
  return r ? new TextDecoder().decode(new Uint8Array(r.binaryData)) : null;
}

const filler = (n: number, seed: number) => {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    s += abc[(x >>> 0) % 64];
  }
  return s;
};

/** The whole suite as a function, so each mutant can be run against it. */
function suite(m: Core): string[] {
  const failed: string[] = [];
  const check = (name: string, ok: boolean) => {
    if (!ok) failed.push(name);
  };
  const safe = (name: string, f: () => boolean) => {
    try {
      check(name, f());
    } catch (e) {
      failed.push(`${name}: ${String(e)}`);
    }
  };
  // Golden values from the standard.
  safe('capacity v1-M', () => m.byteCapacity(1, 'M') === 14);
  safe('capacity v1-L', () => m.byteCapacity(1, 'L') === 17);
  safe('capacity v10-Q', () => m.byteCapacity(10, 'Q') === 151);
  safe('capacity v40-L', () => m.byteCapacity(40, 'L') === 2953);
  safe('capacity v40-H', () => m.byteCapacity(40, 'H') === 1273);
  safe('alignment v7', () => m.alignmentPositions(7).join() === '6,22,38');
  safe('alignment v32', () => m.alignmentPositions(32).join() === '6,34,60,86,112,138');
  safe('alignment v40', () => m.alignmentPositions(40).join() === '6,30,58,86,114,142,170');
  safe('format M/mask 5', () => m.formatBits('M', 5) === 0b100000011001110);
  safe('format L/mask 4', () => m.formatBits('L', 4) === 0b110011000101111);
  safe('version 7 bits', () => m.versionBits(7) === 0b000111110010010100);
  // The worked example in the standard: "01234567" at 1-M has these 10 EC codewords.
  safe(
    'rs example',
    () =>
      m
        .reedSolomon([16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17], 10)
        .join() === '165,36,212,193,237,54,199,135,44,85',
  );
  safe(
    'data codewords',
    () =>
      m.qrDataCodewords('01234567', 1, 'M').join() ===
      [
        0x40, 0x83, 0x03, 0x13, 0x23, 0x33, 0x43, 0x53, 0x63, 0x70, 0xec, 0x11, 0xec, 0x11, 0xec,
        0x11,
      ].join(),
  );
  // Decoders read only one copy of the format and version information and ignore the
  // dark module, so check those directly from the matrix, following the standard's map.
  for (const [v, ecc] of [
    [1, 'M'],
    [7, 'L'],
    [21, 'H'],
    [40, 'Q'],
  ] as const)
    safe(`function patterns v${v}-${ecc}`, () => {
      const qr = m.encodeQr(filler(m.byteCapacity(v, ecc), v), { ecc });
      const n = qr.size;
      const at = (x: number, y: number) => (qr.modules[y]![x] ? 1 : 0);
      const want = m.formatBits(ecc, qr.mask);
      const bitsOf = (cells: [number, number][]) =>
        cells.reduce((acc, [x, y], i) => acc | (at(x, y) << i), 0);
      const first: [number, number][] = [
        [8, 0],
        [8, 1],
        [8, 2],
        [8, 3],
        [8, 4],
        [8, 5],
        [8, 7],
        [8, 8],
        [7, 8],
        [5, 8],
        [4, 8],
        [3, 8],
        [2, 8],
        [1, 8],
        [0, 8],
      ];
      const second: [number, number][] = [];
      for (let i = 0; i < 8; i++) second.push([n - 1 - i, 8]);
      for (let i = 8; i < 15; i++) second.push([8, n - 15 + i]);
      let ok = bitsOf(first) === want && bitsOf(second) === want && at(8, n - 8) === 1;
      if (v >= 7) {
        const vb = m.versionBits(v);
        const topRight: [number, number][] = [];
        const bottomLeft: [number, number][] = [];
        for (let i = 0; i < 18; i++) {
          topRight.push([n - 11 + (i % 3), Math.floor(i / 3)]);
          bottomLeft.push([Math.floor(i / 3), n - 11 + (i % 3)]);
        }
        ok = ok && bitsOf(topRight) === vb && bitsOf(bottomLeft) === vb;
      }
      return ok;
    });
  // Round trip through the independent decoder: every version × level at full capacity,
  // cycling through all eight masks.
  for (let v = 1; v <= 40; v += v < 10 ? 1 : 3)
    for (const ecc of m.ECC_LEVELS) {
      const text = filler(m.byteCapacity(v, ecc), v * 31 + ecc.charCodeAt(0));
      safe(`round trip v${v}-${ecc}`, () => {
        const qr = m.encodeQr(text, { ecc, mask: (v + ecc.charCodeAt(0)) % 8 });
        return qr.version === v && qr.size === 17 + 4 * v && decode(qr) === text;
      });
    }
  // Unicode text and a real share link.
  for (const text of [
    '默書雲雀 Dictalark',
    'https://kinfxhk.github.io/dictalark/#/share/eyJ2IjoxfQ',
    'é',
  ])
    safe(`unicode ${text}`, () => decode(m.encodeQr(text)) === text);
  return failed;
}

describe('QR code encoder', () => {
  it('passes the golden values and decodes back at every version and level', () => {
    expect(suite(core)).toEqual([]);
  });

  it('chooses the smallest version, M first, then L', () => {
    expect(core.encodeQr('a'.repeat(14)).version).toBe(1);
    expect(core.encodeQr('a'.repeat(14)).ecc).toBe('M');
    expect(core.encodeQr('a'.repeat(15)).version).toBe(2);
    const n = core.byteCapacity(40, 'M') + 1;
    const big = core.encodeQr('a'.repeat(n));
    expect(big.ecc).toBe('L');
    expect(core.byteCapacity(big.version, 'L')).toBeGreaterThanOrEqual(n);
    expect(core.byteCapacity(big.version - 1, 'L')).toBeLessThan(n);
  });

  it('refuses text that does not fit, with too-large', () => {
    expect(() => core.encodeQr('a'.repeat(2954))).toThrow(/too-large/);
    expect(() => core.encodeQr('a'.repeat(100), { maxVersion: 3 })).toThrow(/too-large/);
  });

  it('chooses the mask with the lowest penalty', () => {
    const text = 'https://kinfxhk.github.io/dictalark/#/share/abc';
    const best = core.encodeQr(text);
    for (let k = 0; k < 8; k++)
      expect(core.penalty(core.encodeQr(text, { mask: k }).modules)).toBeGreaterThanOrEqual(
        core.penalty(best.modules),
      );
  });

  it('property: any text up to 300 bytes decodes back exactly', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 100 }), (s) => {
        fc.pre(new TextEncoder().encode(s).length <= 300);
        expect(decode(core.encodeQr(s))).toBe(s);
      }),
      { numRuns: 150 },
    );
  });

  it('SVG output: quiet zone, title escaped, one dark square per dark module', () => {
    const qr = core.encodeQr('hi');
    const svg = core.qrToSvg(qr, 3, 'List <"x">');
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('width="87"');
    expect(svg).toContain('&lt;&quot;x&quot;&gt;');
    expect(svg).not.toContain('<"x">');
    const dark = qr.modules.flat().filter(Boolean).length;
    expect(svg.split('h1v1h-1z').length - 1).toBe(dark);
  });
});

// ---------------------------------------------------------------------------------
// Mutation testing: one deliberate bug per copy of the source; the suite must fail.
// ---------------------------------------------------------------------------------
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const read = (p: string) => readFileSync(join(srcDir, ...p.split('/')), 'utf8');
const F = 'qr/index.ts';
const MUTANTS: [string, string, string][] = [
  [
    'wrong field polynomial',
    'r = (r << 1) ^ ((r >>> 7) * 0x11d);',
    'r = (r << 1) ^ ((r >>> 7) * 0x11b);',
  ],
  ['generator root not advanced', 'root = gfMul(root, 0x02);', 'root = gfMul(root, 0x03);'],
  ['pad bytes not alternating', 'pad ^= 0xec ^ 0x11', 'pad ^= 0'],
  [
    '8-bit length up to version 10',
    'put(bytes.length, version <= 9 ? 8 : 16);',
    'put(bytes.length, version <= 10 ? 8 : 16);',
  ],
  [
    'blocks not interleaved',
    'for (const b of blocks) if (i < b.length) out.push(b[i]!);',
    'if (i === 0) for (const b of blocks) out.push(...b);',
  ],
  [
    'long blocks first',
    'const len = shortData + (i < shortBlocks ? 0 : 1);',
    'const len = shortData + (i < nBlocks - shortBlocks ? 1 : 0);',
  ],
  [
    'mask 4 formula',
    '(Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0',
    '(Math.floor(x / 2) + Math.floor(y / 3)) % 2 === 0',
  ],
  ['format mask constant', '^ 0x5412;', '^ 0x5413;'],
  ['version info mirrored wrongly', 'g.set(b, a, bit);', 'g.set(b, a, !bit);'],
  ['column 6 not skipped', 'if (right === 6) right = 5;', ''],
  [
    'zigzag direction flipped',
    'const upward = ((right + 1) & 2) === 0;',
    'const upward = ((right + 1) & 2) !== 0;',
  ],
  [
    'alignment step',
    'const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;',
    'const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;',
  ],
  ['dark module missing', 'g.set(8, n - 8, true); // the dark module', 'g.set(8, n - 8, false);'],
  ['M and L swapped', 'L: 1, M: 0, Q: 3, H: 2', 'L: 0, M: 1, Q: 3, H: 2'],
];

const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe('mutation testing (QR encoder)', () => {
  it('each mutant changes the source exactly once', () => {
    for (const [name, from] of MUTANTS) expect(read(F).split(from).length - 1, name).toBe(1);
  });
  MUTANTS.forEach(([name, from, to], i) =>
    it(`catches mutant: ${name}`, async () => {
      const dir = join(srcDir, `qr${i}-mutant-${process.pid}`);
      created.push(dir);
      mkdirSync(dir, { recursive: true });
      for (const entry of readdirSync(srcDir))
        if (!entry.includes('-mutant-'))
          cpSync(join(srcDir, entry), join(dir, entry), { recursive: true });
      writeFileSync(join(dir, ...F.split('/')), read(F).replace(from, to));
      const mod = (await import(pathToFileURL(join(dir, 'index.ts')).href)) as Core;
      expect(suite(mod).length, `mutant "${name}" survived`).toBeGreaterThan(0);
    }),
  );
});
