// SPDX-License-Identifier: AGPL-3.0-or-later
// A digest of date-dependent results; it must be identical in every machine time zone.
import { addDays, localDay, nextCard, shuffle, type SrsCard } from '../../src/index';

export function digest(): string {
  const out: string[] = [];
  let card: SrsCard | undefined;
  let day = '2026-03-27';
  for (let k = 0; k < 40; k++) {
    card = nextCard(card, k % 7 === 6 ? 'wrong' : 'right', day);
    out.push(`${day}:${card.box}:${card.due}`);
    day = addDays(day, 1 + (k % 3));
  }
  for (const t of [
    Date.UTC(2026, 2, 29, 0, 30),
    Date.UTC(2026, 9, 25, 0, 59),
    Date.UTC(2026, 10, 1, 6, 0),
  ])
    for (const z of ['Europe/London', 'America/New_York', 'Asia/Hong_Kong'])
      out.push(`${t}@${z}=${localDay(t, z)}`);
  out.push(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 4242).join(','));
  return out.join('|');
}
