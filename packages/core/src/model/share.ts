// SPDX-License-Identifier: AGPL-3.0-or-later
// Share one word list as a link, without any server: the list travels in the URL part
// after "#", which browsers never send over the network. Recordings, results and review
// state are never included. Decoding validates exactly like an imported file.

import { base64UrlToBytes, bytesToBase64Url } from './base64';
import { DictalarkError } from './errors';
import { safeJsonParse } from './json';
import { LIMITS } from './limits';
import type { WordList } from './types';
import { isObj, validateList } from './validate';

export const SHARE_VERSION = 1;

export type SharedList = Pick<WordList, 'name' | 'subject' | 'lang' | 'items'>;

/** Compact URL-safe text for a list. Throws `too-large` when the link would be too long. */
export function encodeShare(list: WordList): string {
  const data = {
    v: SHARE_VERSION,
    n: list.name,
    s: list.subject,
    l: list.lang,
    i: list.items.map((it) => {
      const o: Record<string, unknown> = { t: it.text };
      if (it.accept.length) o.a = it.accept;
      if (it.note) o.n = it.note;
      if (it.lang) o.l = it.lang;
      if (it.say) o.s = it.say;
      return o;
    }),
  };
  const out = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(data)));
  if (out.length > LIMITS.shareChars)
    throw new DictalarkError('too-large', { max: LIMITS.shareChars });
  return out;
}

/** Read a shared list. Item ids are fresh (from `newId`); timestamps are `now`. */
export function decodeShare(code: string, newId: () => string, now: string): WordList {
  if (typeof code !== 'string' || code.length > LIMITS.shareChars)
    throw new DictalarkError('too-large', { max: LIMITS.shareChars });
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(code, 'link'));
  } catch (e) {
    if (e instanceof DictalarkError) throw e;
    throw new DictalarkError('not-utf8');
  }
  const raw = safeJsonParse(text);
  if (!isObj(raw) || raw.v !== SHARE_VERSION || !Array.isArray(raw.i))
    throw new DictalarkError('unknown-format');
  return validateList(
    {
      id: newId(),
      name: raw.n,
      subject: raw.s,
      lang: raw.l,
      items: raw.i.map((it: unknown) => {
        if (!isObj(it)) return it;
        return {
          id: newId(),
          text: it.t,
          accept: it.a ?? [],
          note: it.n ?? '',
          lang: it.l,
          say: it.s,
        };
      }),
      createdAt: now,
      updatedAt: now,
    },
    'link',
  );
}
