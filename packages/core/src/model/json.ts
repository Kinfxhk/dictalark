// SPDX-License-Identifier: AGPL-3.0-or-later
// Hostile-input-safe JSON reading: size cap before parsing, prototype keys rejected
// during parsing, depth cap, numbers must be finite.

import { DictalarkError } from './errors';
import { LIMITS } from './limits';
import { FORBIDDEN_KEYS } from './validate';

/** UTF-8 byte length without allocating a buffer. */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

/** Decode file bytes as strict UTF-8 (BOM removed). Big5 or other encodings are refused. */
export function decodeUtf8(bytes: Uint8Array, maxBytes: number = LIMITS.importBytes): string {
  if (bytes.byteLength > maxBytes) throw new DictalarkError('too-large', { max: maxBytes });
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new DictalarkError('not-utf8');
  }
}

export function safeJsonParse(text: string, maxBytes: number = LIMITS.importBytes): unknown {
  if (text.length > maxBytes || utf8Bytes(text) > maxBytes)
    throw new DictalarkError('too-large', { max: maxBytes });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\ufeff/, ''), (key, value: unknown) => {
      if (FORBIDDEN_KEYS.has(key)) throw new DictalarkError('forbidden-key', { key });
      if (typeof value === 'number' && !Number.isFinite(value))
        throw new DictalarkError('bad-number', { key });
      return value;
    });
  } catch (e) {
    if (e instanceof DictalarkError) throw e;
    // A stack overflow from absurd nesting also lands here.
    throw new DictalarkError(e instanceof RangeError ? 'too-deep' : 'bad-json');
  }
  checkDepth(parsed, LIMITS.jsonDepth);
  return parsed;
}

/** Iterative depth check (no recursion, so it cannot overflow the stack itself). */
export function checkDepth(root: unknown, max: number): void {
  const stack: [unknown, number][] = [[root, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (typeof v !== 'object' || v === null) continue;
    if (d > max) throw new DictalarkError('too-deep', { max });
    for (const child of Object.values(v)) stack.push([child, d + 1]);
  }
}
