// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RULE_IDS, SUBJECTS, MODES } from '@dictalark/core';
import { STRINGS, setLocale, t, type StringKey } from '../src/strings';

const SRC = join(import.meta.dirname, '../src');

describe('interface text', () => {
  it('every key has non-empty English and Traditional Chinese text with the same placeholders', () => {
    for (const [key, [en, zh]] of Object.entries(STRINGS)) {
      expect(en.trim(), key).not.toBe('');
      expect(zh.trim(), key).not.toBe('');
      const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(ph(zh), key).toEqual(ph(en));
    }
  });

  it('Chinese text uses Traditional characters for common words', () => {
    const zh = Object.values(STRINGS)
      .map(([, z]) => z)
      .join('');
    // A few Simplified forms that must never appear in the zh-HK interface.
    for (const simplified of ['词', '录', '练', '设', '语', '传', '删', '储', '页', '错'])
      expect(zh.includes(simplified), simplified).toBe(false);
  });

  it('keys built at run time exist (subjects, modes, marking rules)', () => {
    const keys = new Set(Object.keys(STRINGS));
    for (const s of SUBJECTS) expect(keys.has(`subject.${s}`), s).toBe(true);
    for (const m of MODES) expect(keys.has(`mode.${m}`), m).toBe(true);
    for (const r of RULE_IDS) expect(keys.has(`rule.${r}`), r).toBe(true);
  });

  it('every t() key and data-t attribute used in the source exists', () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));
    const used = new Set<string>();
    for (const f of files) {
      const text = readFileSync(join(SRC, f), 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([\w.-]+)'/g)) used.add(m[1]!);
    }
    const html = readFileSync(join(SRC, '../index.html'), 'utf8');
    for (const m of html.matchAll(/data-t="([\w.-]+)"/g)) used.add(m[1]!);
    expect(used.size).toBeGreaterThan(50);
    for (const k of used) expect(k in STRINGS, k).toBe(true);
  });

  it('fills placeholders and keeps unknown ones visible', () => {
    setLocale('en');
    expect(t('home.items', { n: 3 })).toBe('3 items');
    expect(t('home.items')).toBe('{n} items');
    setLocale('zh-HK');
    expect(t('results.score', { r: 2, n: 3 })).toBe('3 項中答對 2 項');
    expect(t('nav.home' as StringKey)).toBe('我的詞表');
  });
});
