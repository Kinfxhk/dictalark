// SPDX-License-Identifier: AGPL-3.0-or-later
// Patterns used by check-hygiene.mjs (kept separate so they can be unit-tested).

/** Other dictation / spelling products: only README's comparison section may name them. */
export const COMPETITORS =
  /dictation\s*easy|默書易|默書啦喂|spelling\s*shed|spelling\s*city|spellingcity|spellzone|squeebles|edshed|vocabulary\.com|dictation\.io|quizlet|anki\b/i;

/** Signs that a sample list was copied from a textbook, syllabus or exam paper. */
export const TEXTBOOK_MARKERS =
  /textbook|課本|教科書|教育局|\bEDB\b|學習字詞表|wordlist from|syllabus|課程綱要|\bunit\s*\d+\b|第\s*[一二三四五六七八九十\d]+\s*課|出版社|publisher|past paper|考試卷|\bTSA\b|\bHKDSE\b|cambridge (young|english)|oxford (phonics|reading)/i;

/** Network APIs that the browser UI must never use (privacy promise). */
export const NETWORK_APIS =
  /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|new\s+EventSource|RTCPeerConnection|importScripts\s*\(\s*['"]https?:/;
