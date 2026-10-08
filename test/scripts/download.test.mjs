// SPDX-License-Identifier: AGPL-3.0-or-later
// The CI download helper is tested against a local mock server that fails on purpose.
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checksumFor,
  downloadVerified,
  fetchWithRetry,
  sha256Hex,
} from '../../scripts/lib/download.mjs';

const PAYLOAD = Buffer.from('pretend gitleaks tarball\n');
const SUMS = `${sha256Hex(PAYLOAD)}  tool.tar.gz\n${'0'.repeat(64)}  other.tar.gz\n`;
let server;
let base;
const hits = new Map();

beforeAll(async () => {
  server = createServer((req, res) => {
    const n = (hits.get(req.url) ?? 0) + 1;
    hits.set(req.url, n);
    const path = req.url.replace(/\?.*$/, '');
    if (path === '/flaky/tool.tar.gz' && n === 1) {
      req.socket.destroy(); // connection reset, like the ShiftKnit M6 failure
      return;
    }
    if (path === '/busy/tool.tar.gz' && n <= 2) {
      res.writeHead(503).end();
      return;
    }
    if (path.endsWith('/missing.tar.gz')) {
      res.writeHead(404).end();
      return;
    }
    if (path.endsWith('/sums.txt')) {
      res.writeHead(200).end(SUMS);
      return;
    }
    if (path.startsWith('/tampered')) {
      res.writeHead(200).end(Buffer.from('evil'));
      return;
    }
    if (path.endsWith('/tool.tar.gz')) {
      res.writeHead(200).end(PAYLOAD);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const fast = { delayMs: 1, log: () => {} };

describe('download with retry and checksum', () => {
  it('a connection reset on the first try is retried and then succeeds', async () => {
    const data = await downloadVerified(
      `${base}/flaky/tool.tar.gz`,
      `${base}/flaky/sums.txt`,
      'tool.tar.gz',
      fast,
    );
    expect(data.equals(PAYLOAD)).toBe(true);
    expect(hits.get('/flaky/tool.tar.gz')).toBe(2);
  });

  it('without retries the same flaky server fails (so the retry is what fixes it)', async () => {
    await expect(
      fetchWithRetry(`${base}/flaky/tool.tar.gz?fresh`, { ...fast, retries: 0 }),
    ).rejects.toThrow(/download failed/);
  });

  it('HTTP 503 twice, then 200, succeeds within the retry budget', async () => {
    const data = await fetchWithRetry(`${base}/busy/tool.tar.gz`, fast);
    expect(data.equals(PAYLOAD)).toBe(true);
    expect(hits.get('/busy/tool.tar.gz')).toBe(3);
  });

  it('HTTP 404 is not retried (a wrong URL must fail fast)', async () => {
    await expect(fetchWithRetry(`${base}/x/missing.tar.gz`, fast)).rejects.toThrow(/HTTP 404/);
    expect(hits.get('/x/missing.tar.gz')).toBe(1);
  });

  it('a tampered file fails the checksum even though the download worked', async () => {
    await expect(
      downloadVerified(
        `${base}/tampered/tool.tar.gz`,
        `${base}/tampered/sums.txt`,
        'tool.tar.gz',
        fast,
      ),
    ).rejects.toThrow(/checksum mismatch/);
  });

  it('a file missing from the checksum list fails closed', async () => {
    await expect(
      downloadVerified(`${base}/ok/tool.tar.gz`, `${base}/ok/sums.txt`, 'nope.tar.gz', fast),
    ).rejects.toThrow(/no checksum listed/);
  });

  it('parses sha256sum lists (binary marker, CRLF) and ignores junk lines', () => {
    const h = 'a'.repeat(64);
    expect(checksumFor(`junk\r\n${h} *x.zip\r\n`, 'x.zip')).toBe(h);
    expect(checksumFor(`${h}  x.zip.sig\n`, 'x.zip')).toBeUndefined();
  });
});
