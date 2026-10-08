// SPDX-License-Identifier: AGPL-3.0-or-later
// Choosing a device voice for a list language, with a clear answer when there is none.
//
// Cantonese lists try yue-HK → yue → zh-HK → zh-MO (all Cantonese voices on common
// systems). If none exists, Mandarin voices (zh-TW, zh-CN, zh) are offered only as a
// *mismatch*: the UI must say so and suggest recording. Mandarin lists likewise never
// silently fall back to a Cantonese voice.
//
// Privacy: some browsers offer online voices (`localService === false`) that send the
// text to a speech service. They are skipped unless the user allows them.

export interface VoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
  voiceURI?: string;
}

export interface VoiceChoice {
  voice: VoiceInfo | undefined;
  /** 'exact' = the language asked for; 'mismatch' = a different spoken language/dialect. */
  quality: 'exact' | 'mismatch' | 'none';
  /** Online voices exist that would match but are not allowed. */
  remoteSkipped: boolean;
}

/** `en_GB` / `EN-gb` → `en-gb` (lower case, hyphens). */
export const normTag = (t: string): string => t.trim().replace(/_/g, '-').toLowerCase();

const CANTONESE = ['yue-hk', 'yue', 'zh-hk', 'zh-mo', 'zh-hant-hk'];
const MANDARIN_TW = ['zh-tw', 'zh-hant-tw', 'cmn-tw', 'cmn-hant-tw'];
const MANDARIN_CN = ['zh-cn', 'zh-hans-cn', 'cmn-cn', 'cmn-hans-cn', 'zh-sg', 'zh-hans'];

export function isCantoneseTag(tag: string): boolean {
  const t = normTag(tag);
  return t === 'yue' || t.startsWith('yue-') || CANTONESE.includes(t) || t === 'zh-hant-mo';
}

/** Ordered lists of acceptable voice tags: [exact matches, mismatch fallbacks]. */
export function voiceChain(listLang: string): { exact: string[]; mismatch: string[] } {
  const t = normTag(listLang);
  const primary = t.split('-')[0]!;
  if (isCantoneseTag(t))
    return { exact: [t, ...CANTONESE], mismatch: [...MANDARIN_TW, ...MANDARIN_CN, 'zh*'] };
  if (primary === 'zh' || primary === 'cmn') {
    const tw = t.includes('tw') || t.includes('hant');
    const order = tw ? [...MANDARIN_TW, ...MANDARIN_CN] : [...MANDARIN_CN, ...MANDARIN_TW];
    return { exact: [t, ...order, 'zh*!hk'], mismatch: [...CANTONESE] };
  }
  return { exact: [t, `${primary}*`], mismatch: [] };
}

function matches(voiceTag: string, pattern: string): boolean {
  const v = normTag(voiceTag);
  if (pattern === 'zh*!hk') return (v === 'zh' || v.startsWith('zh-')) && !isCantoneseTag(v);
  if (pattern.endsWith('*')) {
    const p = pattern.slice(0, -1);
    return v === p || v.startsWith(`${p}-`);
  }
  return v === pattern;
}

/** Local voices first, then the system default, then by name (stable). */
const rank = (a: VoiceInfo, b: VoiceInfo) =>
  Number(b.localService) - Number(a.localService) ||
  Number(Boolean(b.default)) - Number(Boolean(a.default)) ||
  (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function pickVoice(
  voices: readonly VoiceInfo[],
  listLang: string,
  { allowRemote = false, preferredName }: { allowRemote?: boolean; preferredName?: string } = {},
): VoiceChoice {
  const chain = voiceChain(listLang);
  const usable = voices.filter((v) => allowRemote || v.localService);
  let remoteSkipped = false;
  const find = (patterns: string[]) => {
    for (const p of patterns) {
      const hits = usable.filter((v) => matches(v.lang, p)).sort(rank);
      if (!hits.length && !allowRemote && voices.some((v) => !v.localService && matches(v.lang, p)))
        remoteSkipped = true;
      if (hits.length) return hits.find((v) => v.name === preferredName) ?? hits[0];
    }
    return undefined;
  };
  const exact = find(chain.exact);
  if (exact) return { voice: exact, quality: 'exact', remoteSkipped: false };
  const other = find(chain.mismatch);
  if (other) return { voice: other, quality: 'mismatch', remoteSkipped };
  return { voice: undefined, quality: 'none', remoteSkipped };
}
