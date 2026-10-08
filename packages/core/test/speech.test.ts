// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { pickVoice, speakPunctuation, speechTimeoutMs, type VoiceInfo } from '../src/index';

const v = (name: string, lang: string, localService = true, def = false): VoiceInfo => ({
  name,
  lang,
  localService,
  default: def,
});

describe('voice choice', () => {
  it('no voices at all → none (the UI asks for a recording)', () => {
    expect(pickVoice([], 'yue-HK')).toEqual({
      voice: undefined,
      quality: 'none',
      remoteSkipped: false,
    });
  });
  it('Cantonese list with only a zh-CN voice → mismatch, never silently "exact"', () => {
    const r = pickVoice([v('Mei', 'zh-CN')], 'yue-HK');
    expect(r.quality).toBe('mismatch');
    expect(r.voice?.name).toBe('Mei');
  });
  it('Cantonese list with zh-HK but no yue-HK → zh-HK is a Cantonese voice (exact)', () => {
    const r = pickVoice([v('Mei', 'zh-CN'), v('Sinji', 'zh-HK'), v('Kate', 'en-GB')], 'yue-HK');
    expect(r).toMatchObject({ quality: 'exact', voice: { name: 'Sinji' } });
  });
  it('yue-HK beats zh-HK', () => {
    expect(pickVoice([v('A', 'zh-HK'), v('B', 'yue-HK')], 'yue-HK').voice?.name).toBe('B');
  });
  it('fallback order for Cantonese mismatch: zh-TW before zh-CN', () => {
    expect(pickVoice([v('CN', 'zh-CN'), v('TW', 'zh-TW')], 'yue-HK').voice?.name).toBe('TW');
  });
  it('Android-style tags (zh_HK, lower case) are understood', () => {
    expect(pickVoice([v('A', 'zh_hk')], 'yue-HK').quality).toBe('exact');
  });
  it('Mandarin list never uses a Cantonese voice as exact', () => {
    const r = pickVoice([v('HK', 'zh-HK')], 'zh-Hans-CN');
    expect(r.quality).toBe('mismatch');
    expect(pickVoice([v('HK', 'zh-HK'), v('CN', 'zh-CN')], 'cmn-Hans-CN').voice?.name).toBe('CN');
    expect(pickVoice([v('HK', 'zh-HK'), v('TW', 'zh-TW')], 'zh-Hans-CN')).toMatchObject({
      quality: 'exact',
      voice: { name: 'TW' },
    });
  });
  it('English: exact region first, then any English voice', () => {
    const voices = [v('US', 'en-US'), v('GB', 'en-GB')];
    expect(pickVoice(voices, 'en-GB').voice?.name).toBe('GB');
    expect(pickVoice([v('US', 'en-US')], 'en-GB')).toMatchObject({
      quality: 'exact',
      voice: { name: 'US' },
    });
    expect(pickVoice([v('FR', 'fr-FR')], 'en-GB').quality).toBe('none');
  });
  it('"en" does not match "eng-XX" or "ena" (prefix must end at a hyphen)', () => {
    expect(pickVoice([v('X', 'ena-XX')], 'en-GB').quality).toBe('none');
  });
  it('online voices are skipped unless allowed (privacy), and that is reported', () => {
    const voices = [v('Online HK', 'zh-HK', false)];
    expect(pickVoice(voices, 'yue-HK')).toEqual({
      voice: undefined,
      quality: 'none',
      remoteSkipped: true,
    });
    expect(pickVoice(voices, 'yue-HK', { allowRemote: true }).voice?.name).toBe('Online HK');
  });
  it('local voices rank above online ones even when online is allowed', () => {
    const voices = [v('Online', 'en-GB', false, true), v('Local', 'en-GB', true)];
    expect(pickVoice(voices, 'en-GB', { allowRemote: true }).voice?.name).toBe('Local');
  });
  it('a preferred voice name wins among equal matches', () => {
    const voices = [v('A', 'en-GB'), v('B', 'en-GB')];
    expect(pickVoice(voices, 'en-GB', { preferredName: 'B' }).voice?.name).toBe('B');
  });
});

describe('speech timeout', () => {
  it('grows with length and shrinks with rate, capped at 30 s', () => {
    expect(speechTimeoutMs('cat', 1)).toBe(4000 + 1350);
    expect(speechTimeoutMs('cat', 2)).toBeLessThan(speechTimeoutMs('cat', 1));
    expect(speechTimeoutMs('x'.repeat(1000), 1)).toBe(30_000);
    expect(speechTimeoutMs('cat', 0)).toBe(speechTimeoutMs('cat', 1));
  });
});

describe('punctuation read aloud (Chinese, golden)', () => {
  it.each([
    ['你好，世界。', '你好 逗號 世界 句號'],
    ['你好嗎？', '你好嗎 問號'],
    ['真好！', '真好 感嘆號'],
    ['注意：明天考試。', '注意 冒號 明天考試 句號'],
    ['蘋果、香蕉、橙。', '蘋果 頓號 香蕉 頓號 橙 句號'],
    ['他說：「早晨。」', '他說 冒號 開引號 早晨 句號 關引號'],
    ['我讀《西遊記》。', '我讀 開書名號 西遊記 關書名號 句號'],
    ['（一）多謝', '開括號 一 關括號 多謝'],
    ['等一等……', '等一等 省略號'],
    ['天氣——很熱。', '天氣 破折號 很熱 句號'],
    ['你好,世界.', '你好 逗號 世界 句號'],
    ['媽媽說"早晨"。', '媽媽說 開引號 早晨 關引號 句號'],
    ['第一；第二。', '第一 分號 第二 句號'],
    ['香港·九龍', '香港 間隔號 九龍'],
    ['『好』', '開雙引號 好 關雙引號'],
    ['〈春〉', '開篇名號 春 關篇名號'],
    ['你好 嗎？', '你好 嗎 問號'],
    ['一，二，三。', '一 逗號 二 逗號 三 句號'],
    ['冇標點', '冇標點'],
    ['3.14 是圓周率。', '3.14 是圓周率 句號'],
  ])('%s', (text, spoken) => {
    expect(speakPunctuation(text, 'yue-HK')).toBe(spoken);
    expect(speakPunctuation(text, 'zh-Hans-CN')).toBe(spoken);
  });
});

describe('punctuation read aloud (English, golden)', () => {
  it.each([
    ['Hello, world.', 'Hello comma world full stop', 'Hello comma world period'],
    ['Is it?', 'Is it question mark', 'Is it question mark'],
    ['Wow!', 'Wow exclamation mark', 'Wow exclamation point'],
    ['Note: no school.', 'Note colon no school full stop', 'Note colon no school period'],
    ['First; second.', 'First semicolon second full stop', 'First semicolon second period'],
    [
      'He said "hi".',
      'He said open quote hi close quote full stop',
      'He said open quote hi close quote period',
    ],
    ['Wait...', 'Wait ellipsis', 'Wait ellipsis'],
    [
      'A (small) cat.',
      'A open bracket small close bracket cat full stop',
      'A open parenthesis small close parenthesis cat period',
    ],
    ["don't stop.", "don't stop full stop", "don't stop period"],
    ['well-known word.', 'well-known word full stop', 'well-known word period'],
    ['U.S.A. is big.', 'U.S.A full stop is big full stop', 'U.S.A period is big period'],
    ['It is 3.14 today.', 'It is 3.14 today full stop', 'It is 3.14 today period'],
    ['At 10:30, go.', 'At 10:30 comma go full stop', 'At 10:30 comma go period'],
    ['1,000 people!', '1,000 people exclamation mark', '1,000 people exclamation point'],
    ['Yes—no.', 'Yes dash no full stop', 'Yes dash no period'],
    [
      '“Quoted” text.',
      'open quote Quoted close quote text full stop',
      'open quote Quoted close quote text period',
    ],
    ['Hello world', 'Hello world', 'Hello world'],
    ['Stop. Go.', 'Stop full stop Go full stop', 'Stop period Go period'],
    [
      'Why? Because!',
      'Why question mark Because exclamation mark',
      'Why question mark Because exclamation point',
    ],
    ['Wait… what?', 'Wait ellipsis what question mark', 'Wait ellipsis what question mark'],
  ])('%s', (text, gb, us) => {
    expect(speakPunctuation(text, 'en-GB')).toBe(gb);
    expect(speakPunctuation(text, 'en-US')).toBe(us);
  });
  it('languages without a table are left unchanged', () => {
    expect(speakPunctuation('Bonjour, le monde.', 'fr-FR')).toBe('Bonjour, le monde.');
  });
});
