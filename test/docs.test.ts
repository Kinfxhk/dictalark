// SPDX-License-Identifier: AGPL-3.0-or-later
// Documentation and sample-list checks: links resolve, voice instructions cite only
// official vendor help pages (and say "not verified" where we could not check), the two
// language versions of the guide cite the same sources, and the bundled sample lists
// are valid, small and CC0.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LIMITS, parseLibrary } from '../packages/core/src/index';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const DOCS = ['README.md', 'docs/guide.md', 'docs/guide.zh-Hant.md', 'examples/README.md'];
const OFFICIAL = ['support.microsoft.com', 'support.apple.com', 'support.google.com'];

const links = (md: string) => [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!);
const urls = (md: string) => links(md).filter((l) => /^https?:/.test(l));

describe('documentation', () => {
  it.each(DOCS)('%s: relative links point at files that exist', (doc) => {
    for (const l of links(read(doc)).filter((x) => !/^(https?:|mailto:|#)/.test(x))) {
      const target = join(ROOT, dirname(doc), l.replace(/#.*$/, ''));
      expect(existsSync(target), `${doc} → ${l}`).toBe(true);
    }
  });

  it('the guide cites only official vendor help pages for voices', () => {
    for (const doc of ['docs/guide.md', 'docs/guide.zh-Hant.md']) {
      const hosts = urls(read(doc)).map((u) => new URL(u).hostname);
      expect(hosts.length, doc).toBeGreaterThanOrEqual(4);
      for (const h of hosts) expect(OFFICIAL, `${doc}: ${h}`).toContain(h);
    }
  });

  it('both language versions cite the same sources and mark the same items as unverified', () => {
    const en = read('docs/guide.md');
    const zh = read('docs/guide.zh-Hant.md');
    expect(urls(zh)).toEqual(urls(en));
    const nEn = en.match(/\*\*not verified\*\*/g)?.length ?? 0;
    const nZh = zh.match(/\*\*未能核實\*\*/g)?.length ?? 0;
    expect(nEn).toBeGreaterThan(0);
    expect(nZh).toBe(nEn);
  });

  it('the guide states the privacy and marking promises in both languages', () => {
    const en = read('docs/guide.md');
    const zh = read('docs/guide.zh-Hant.md');
    expect(en).toContain('only on your device');
    expect(en).toContain('only a guide');
    expect(en).toContain('羣 is not 群');
    expect(zh).toContain('只存於你的裝置');
    expect(zh).toContain('只供參考');
    expect(zh).toContain('羣 不等於 群');
  });

  it('the README links to both guides and records the unverified HK name search', () => {
    const r = read('README.md');
    expect(r).toContain('(docs/guide.md)');
    expect(r).toContain('(docs/guide.zh-Hant.md)');
    expect(r).toContain('未能核實');
    expect(read('docs/NAME-CHECK.md')).toContain('未能核實');
  });
});

describe('sample lists', () => {
  const files = readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.json'));

  it('there are English, Cantonese and Mandarin samples, all bundled in the app', () => {
    expect(files.sort()).toEqual([
      'cantonese-sample.json',
      'english-sample.json',
      'mandarin-sample.json',
    ]);
    const bundled = read('packages/web/src/samples.ts');
    for (const f of files) expect(bundled).toContain(`examples/${f}?raw`);
  });

  it.each(files)('%s is a valid, small, CC0 Dictalark file', (f) => {
    const text = read(`examples/${f}`);
    expect(Buffer.byteLength(text)).toBeLessThan(8 * 1024);
    expect(JSON.parse(text).license).toBe('CC0-1.0');
    const lib = parseLibrary(text);
    expect(lib.lists).toHaveLength(1);
    const list = lib.lists[0]!;
    expect(list.items.length).toBeGreaterThanOrEqual(8);
    expect(list.items.length).toBeLessThanOrEqual(LIMITS.itemsPerList);
    expect(lib.attempts).toEqual([]);
  });

  it('each sample reads in the right language', () => {
    const lang = (f: string) => parseLibrary(read(`examples/${f}`)).lists[0]!;
    expect(lang('english-sample.json')).toMatchObject({ subject: 'english', lang: 'en-GB' });
    expect(lang('cantonese-sample.json')).toMatchObject({ subject: 'chinese', lang: 'yue-HK' });
    expect(lang('mandarin-sample.json')).toMatchObject({ subject: 'mandarin', lang: 'zh-TW' });
  });
});
