// SPDX-License-Identifier: AGPL-3.0-or-later
// Duplicate detection when typing or importing a list. Texts are compared after NFC,
// trimming, collapsing spaces and (for Latin letters only) ignoring case, so
// "Receive" and "receive " are flagged, while 「羣」 and 「群」 are NOT (they are different
// characters; merging them is the parent's call).

export function duplicateKey(text: string): string {
  return text
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/** Groups of indices (each group ≥2, in order of first appearance) whose texts collide. */
export function findDuplicates(texts: readonly string[]): number[][] {
  const groups = new Map<string, number[]>();
  texts.forEach((t, i) => {
    const k = duplicateKey(t);
    if (!k) return;
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  return [...groups.values()].filter((g) => g.length > 1);
}
