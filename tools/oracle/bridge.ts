// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Bridge for the independent Python oracle (tools/oracle/oracle.py): reads cases as JSON
// on stdin, runs them through the real TypeScript code and prints the results as JSON.
// Nothing here computes anything itself.
//   node --import tsx tools/oracle/bridge.ts < cases.json > results.json

import {
  addDays,
  align,
  below,
  dataCodewords,
  makeResults,
  summariseResults,
  type ClassResults,
  type Library,
  qrDataCodewords,
  reedSolomon,
  prng,
  daysBetween,
  dueKeys,
  localDay,
  mark,
  nextCard,
  shuffle,
  validateIntervals,
  type CalendarDay,
  type ItemResult,
  type SrsCard,
} from '../../packages/core/src/index';

interface Cases {
  align: [string[], string[]][];
  mark: { expected: string; answer: string; accept: string[] }[];
  next: {
    card: SrsCard | null;
    result: ItemResult;
    today: CalendarDay;
    intervals: number[];
  }[];
  days: { day: CalendarDay; n: number; other: CalendarDay }[];
  due: { srs: Record<string, SrsCard>; today: CalendarDay }[];
  local: { ms: number; zone: string }[];
  shuffle: { n: number; seed: number }[];
  below: { n: number; seed: number; count: number }[];
  rs: { data: number[]; ec: number }[];
  summary: ClassResults[][];
  results: { lib: Library; ids: string[] }[];
  qrdata: { text: string; v: number; ecc: 'L' | 'M' | 'Q' | 'H' }[];
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (text += c));
    process.stdin.on('end', () => resolve(text));
  });
}

const c = JSON.parse(await readStdin()) as Cases;
/** Run one case; a refused input becomes { error: code }. */
const safe = <T>(f: () => T): T | { error: string } => {
  try {
    return f();
  } catch (e) {
    return { error: (e as { code?: string }).code ?? String(e) };
  }
};
const out = {
  align: c.align.map(([a, b]) => safe(() => align(a, b, (g) => g))),
  mark: c.mark.map((m) =>
    safe(() => {
      const r = mark(m.expected, m.answer, m.accept);
      return { correct: r.correct, target: r.target, distance: r.distance };
    }),
  ),
  next: c.next.map((x) =>
    safe(() => nextCard(x.card ?? undefined, x.result, x.today, validateIntervals(x.intervals))),
  ),
  days: c.days.map((x) =>
    safe(() => ({ added: addDays(x.day, x.n), between: daysBetween(x.day, x.other) })),
  ),
  due: c.due.map((x) => dueKeys(x.srs, x.today)),
  local: c.local.map((x) => localDay(x.ms, x.zone)),
  shuffle: c.shuffle.map((x) =>
    shuffle(
      Array.from({ length: x.n }, (_, i) => i),
      x.seed,
    ),
  ),
  below: c.below.map((x) => {
    const next = prng(x.seed);
    return Array.from({ length: x.count }, () => below(next, x.n));
  }),
  rs: c.rs.map((x) => reedSolomon(x.data, x.ec)),
  summary: c.summary.map((files) => safe(() => summariseResults(files))),
  results: c.results.map((x) =>
    safe(() => makeResults(x.lib, x.ids, 'Pupil', '2026-10-08T00:00:00Z')),
  ),
  qrdata: c.qrdata.map((x) => ({
    cap: dataCodewords(x.v, x.ecc),
    out: safe(() => qrDataCodewords(x.text, x.v, x.ecc)),
  })),
};
process.stdout.write(JSON.stringify(out));
