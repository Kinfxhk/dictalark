// SPDX-License-Identifier: AGPL-3.0-or-later
// Mark one typed answer against the expected text and its accepted alternatives.
// A diff is only returned after the independent checker has accepted it.

import { checkAlignment } from '../check/index';
import { align, type Op } from '../compare/index';
import {
  DEFAULT_RULES,
  graphemeKey,
  graphemes,
  hasHan,
  normalize,
  type RuleId,
  type RuleSwitches,
} from '../normalize/index';

export interface MarkResult {
  correct: boolean;
  /** Which target matched or was closest: -1 = the main text, k = accept[k]. */
  target: number;
  distance: number;
  ops: Op[];
  /** Typing differences that were forgiven (e.g. case, curly quote). */
  forgiven: RuleId[];
  /** Invisible zero-width characters were removed from the answer. */
  zeroWidthRemoved: boolean;
}

export class CheckerRejected extends Error {
  constructor(reason: string) {
    super(`internal marking error (checker rejected the diff): ${reason}`);
    this.name = 'CheckerRejected';
  }
}

export function mark(
  expected: string,
  answer: string,
  accept: readonly string[] = [],
  rules: RuleSwitches = DEFAULT_RULES,
): MarkResult {
  const chinese = hasHan(expected);
  const key = (g: string) => graphemeKey(g, rules);
  const na = normalize(answer, rules, chinese);
  const ga = graphemes(na.text);
  let best: (MarkResult & { ga: string[]; ge: string[] }) | undefined;
  const targets = [expected, ...accept];
  for (let t = 0; t < targets.length; t++) {
    const ne = normalize(targets[t]!, rules, chinese);
    const ge = graphemes(ne.text);
    const { distance, ops } = align(ge, ga, key);
    if (!best || distance < best.distance) {
      const forgiven = new Set<RuleId>([...na.changed, ...ne.changed]);
      forgiven.delete('nfc');
      if (rules.case && distance === 0 && ne.text !== na.text) forgiven.add('case');
      best = {
        correct: distance === 0,
        target: t - 1,
        distance,
        ops,
        forgiven: [...forgiven],
        zeroWidthRemoved: na.changed.includes('zero-width'),
        ga,
        ge,
      };
      if (distance === 0) break;
    }
  }
  const r = best!;
  const verdict = checkAlignment(r.ge, r.ga, r.ops, r.distance, key);
  if (!verdict.ok) throw new CheckerRejected(verdict.reason);
  return {
    correct: r.correct,
    target: r.target,
    distance: r.distance,
    ops: r.ops,
    forgiven: r.forgiven,
    zeroWidthRemoved: r.zeroWidthRemoved,
  };
}
