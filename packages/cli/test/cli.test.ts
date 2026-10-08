// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseLibrary } from '@dictalark/core';
import { run } from '../src/main';

const dir = mkdtempSync(join(tmpdir(), 'dictalark-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, data: string | Uint8Array) => {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
};

describe('cli', () => {
  it('converts a CSV (CRLF, BOM) to a valid export file', () => {
    const p = file('w.csv', '\ufefftext,accept\r\ncolour,color\r\nspoon,\r\n');
    const r = run(['convert', p, '--name', 'Week 1', '--lang', 'en-gb']);
    expect(r.code).toBe(0);
    const lib = parseLibrary(r.out);
    expect(lib.lists[0]!.lang).toBe('en-GB');
    expect(lib.lists[0]!.items.map((i) => [i.text, i.accept])).toEqual([
      ['colour', ['color']],
      ['spoon', []],
    ]);
    expect(run(['validate', file('out.json', r.out)]).out).toMatch(/1 lists, 2 items/);
  });
  it('refuses Big5 with a clear message', () => {
    const r = run(['convert', file('b5.csv', new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5]))]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/UTF-8/);
  });
  it('rejects a hostile JSON file', () => {
    const r = run(['validate', file('x.json', '{"format":"dictalark","__proto__":{}}')]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/forbidden key/);
  });
  it('prints usage for unknown commands', () => {
    expect(run([]).code).toBe(2);
    expect(run(['frobnicate', 'x']).code).toBe(2);
  });
});
