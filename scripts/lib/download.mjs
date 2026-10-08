// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Download with retries and SHA-256 verification. Used by CI to install pinned tools
// (gitleaks) so that one network hiccup does not turn a build red (ShiftKnit M6 lesson),
// while a wrong or tampered file still fails. Pure Node (fetch), so it behaves the same on
// Linux and Windows.

import { createHash } from 'node:crypto';

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET `url` and return its bytes. Retries network errors and HTTP 5xx/429 up to
 * `retries` extra times; 4xx (other than 429) fails at once, because retrying a wrong
 * URL only hides the mistake.
 */
export async function fetchWithRetry(
  url,
  {
    retries = 5,
    delayMs = 3000,
    fetchImpl = globalThis.fetch,
    sleep = sleepMs,
    log = () => {},
  } = {},
) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      log(`retry ${attempt}/${retries} for ${url} after: ${lastError?.message ?? lastError}`);
      await sleep(delayMs * attempt);
    }
    let res;
    try {
      res = await fetchImpl(url, { redirect: 'follow' });
    } catch (err) {
      lastError = err;
      continue;
    }
    if (res.ok) {
      try {
        return Buffer.from(await res.arrayBuffer());
      } catch (err) {
        lastError = err; // body cut off mid-stream
        continue;
      }
    }
    lastError = new Error(`HTTP ${res.status}`);
    if (res.status < 500 && res.status !== 429) break;
  }
  throw new Error(`download failed: ${url}: ${lastError?.message ?? lastError}`);
}

export const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex');

/** Find the checksum for `fileName` in a `sha256sum`-style list ("<hex>  <name>"). */
export function checksumFor(listText, fileName) {
  for (const line of String(listText).split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/.exec(line.trim());
    if (m && m[2] === fileName) return m[1].toLowerCase();
  }
  return undefined;
}

/** Download `url`, verify it against the entry for `fileName` in `checksumsUrl`. */
export async function downloadVerified(url, checksumsUrl, fileName, opts = {}) {
  const [data, sums] = await Promise.all([
    fetchWithRetry(url, opts),
    fetchWithRetry(checksumsUrl, opts),
  ]);
  const expected = checksumFor(sums.toString('utf8'), fileName);
  if (!expected) throw new Error(`no checksum listed for ${fileName}`);
  const actual = sha256Hex(data);
  if (actual !== expected)
    throw new Error(`checksum mismatch for ${fileName}: expected ${expected}, got ${actual}`);
  return data;
}
