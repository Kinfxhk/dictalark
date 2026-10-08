#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Usage: node scripts/fetch-verified.mjs <url> <checksums-url> <out-file>
// Downloads with retries (network errors, 5xx, 429) and verifies the SHA-256 from the
// checksums list; writes <out-file> only when the checksum matches.
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { downloadVerified } from './lib/download.mjs';

const [url, sumsUrl, out] = process.argv.slice(2);
if (!url || !sumsUrl || !out) {
  console.error('usage: node scripts/fetch-verified.mjs <url> <checksums-url> <out-file>');
  process.exit(2);
}
try {
  const name = basename(new URL(url).pathname);
  const data = await downloadVerified(url, sumsUrl, name, { log: (m) => console.warn(m) });
  writeFileSync(out, data);
  console.info(`downloaded and verified ${name} (${data.length} bytes)`);
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exit(1);
}
