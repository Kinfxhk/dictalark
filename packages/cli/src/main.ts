// SPDX-License-Identifier: AGPL-3.0-or-later
// Dictalark command line (word-list conversion and validation; no network).
//   npm run dictalark -- convert words.csv --name "Week 3" --lang en-GB > list.json
//   npm run dictalark -- validate export.json

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  decodeUtf8,
  errorMessage,
  importTable,
  isDictalarkError,
  parseLibrary,
  serializeLibrary,
  validateLang,
  validateList,
  type WordList,
} from '@dictalark/core';

const USAGE = `usage:
  dictalark convert <file.csv|file.tsv> [--name NAME] [--lang BCP47] [--subject english|chinese|mandarin|other]
  dictalark validate <export.json>`;

export function run(argv: string[], now = new Date()): { code: number; out: string; err: string } {
  const [cmd, file, ...rest] = argv;
  const opt = (k: string) => {
    const i = rest.indexOf(`--${k}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    if (!cmd || !file || !['convert', 'validate'].includes(cmd))
      return { code: 2, out: '', err: USAGE };
    const text = decodeUtf8(new Uint8Array(readFileSync(file)));
    if (cmd === 'convert') {
      const t = importTable(text);
      const stamp = now.toISOString().replace(/\.\d+Z$/, 'Z');
      const list: WordList = validateList({
        id: randomUUID(),
        name: opt('name') ?? 'Imported list',
        subject: opt('subject') ?? 'english',
        lang: validateLang(opt('lang') ?? 'en-GB', '--lang'),
        items: t.items.map((it) => ({ ...it, id: randomUUID() })),
        createdAt: stamp,
        updatedAt: stamp,
      });
      const out = serializeLibrary({ lists: [list], attempts: [], srs: {} }, stamp);
      const err = t.skippedRows.length ? `skipped empty rows: ${t.skippedRows.join(', ')}` : '';
      return { code: 0, out, err };
    }
    if (cmd === 'validate') {
      const lib = parseLibrary(text);
      const items = lib.lists.reduce((n, l) => n + l.items.length, 0);
      return { code: 0, out: `ok: ${lib.lists.length} lists, ${items} items\n`, err: '' };
    }
    return { code: 2, out: '', err: USAGE };
  } catch (e) {
    if (isDictalarkError(e)) return { code: 1, out: '', err: errorMessage(e, 'en') };
    return { code: 1, out: '', err: String((e as Error).message ?? e) };
  }
}

if (process.argv[1] && /main\.[cm]?[jt]s$/.test(process.argv[1])) {
  const r = run(process.argv.slice(2));
  if (r.out) process.stdout.write(r.out);
  if (r.err) process.stderr.write(r.err + '\n');
  process.exitCode = r.code;
}
