// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { fallbackHits, secretScanMode } from '../../scripts/lib/secret-mode.mjs';

describe('secret scan mode', () => {
  it('uses gitleaks whenever it is installed', () => {
    for (const platform of ['linux', 'win32', 'darwin'])
      expect(secretScanMode({ hasGitleaks: true, ci: true, platform })).toBe('gitleaks');
  });
  it('Linux CI without gitleaks is a failure, never a silent fallback', () => {
    expect(secretScanMode({ hasGitleaks: false, ci: true, platform: 'linux' })).toBe('fail');
  });
  it('Windows CI and local machines without gitleaks use the labelled fallback', () => {
    expect(secretScanMode({ hasGitleaks: false, ci: true, platform: 'win32' })).toBe('fallback');
    expect(secretScanMode({ hasGitleaks: false, ci: false, platform: 'linux' })).toBe('fallback');
  });
});

describe('fallback patterns', () => {
  // Built at run time so that the test file itself never contains a token-shaped string.
  const fakeGithub = ['gh', 'p_', 'A'.repeat(36)].join('');
  const fakeKey = ['-----BEGIN ', 'RSA PRIVATE', ' KEY-----'].join('');
  it('flag token-shaped strings and private-key headers by line', () => {
    expect(fallbackHits(`ok\nconst t = "${fakeGithub}";\n${fakeKey}\n`)).toEqual([2, 3]);
  });
  it('do not flag ordinary text', () => {
    expect(fallbackHits('默書 雲雀 receive colour don’t\nsk-short\n')).toEqual([]);
  });
});
