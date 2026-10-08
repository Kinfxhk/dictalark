// SPDX-License-Identifier: AGPL-3.0-or-later
// Strict base64 (RFC 4648 §4, with padding) and base64url (§5, no padding) for backups
// and share links. Decoding refuses anything that is not canonical, so a file cannot
// smuggle extra bytes or whitespace through.

import { DictalarkError } from './errors';

const STD_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const URL_RE = /^[A-Za-z0-9_-]*$/;

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(out);
}

export function base64ToBytes(s: string, path = 'data'): Uint8Array {
  if (typeof s !== 'string' || !STD_RE.test(s))
    throw new DictalarkError('bad-shape', { path, expected: 'base64' });
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  // Canonical form only: re-encoding must give the same text (no stray padding bits).
  if (bytesToBase64(out) !== s) throw new DictalarkError('bad-shape', { path, expected: 'base64' });
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(s: string, path = 'data'): Uint8Array {
  if (typeof s !== 'string' || !URL_RE.test(s) || s.length % 4 === 1)
    throw new DictalarkError('bad-shape', { path, expected: 'base64url' });
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(std + '='.repeat((4 - (std.length % 4)) % 4), path);
}
