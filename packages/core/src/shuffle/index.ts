// SPDX-License-Identifier: AGPL-3.0-or-later
// Seeded shuffle: the same seed always gives the same order, so a parent and a child on
// different devices can check answers in the same order. PRNG: a 32-bit "splitmix"-style
// mixer stepped by a Weyl sequence (written for this project; public-domain technique).

export const MAX_SEED = 999_999;

/** Returns a function giving uniform 32-bit unsigned integers. */
export function prng(seed: number): () => number {
  let state = (Math.trunc(seed) ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** Uniform integer in [0, n) without modulo bias (rejection sampling). */
export function below(next: () => number, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) throw new RangeError('bad range');
  const limit = 2 ** 32 - (2 ** 32 % n);
  for (;;) {
    const x = next();
    if (x < limit) return x % n;
  }
}

/** Fisher–Yates shuffle into a new array. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const next = prng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = below(next, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function validateSeed(seed: unknown): number {
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > MAX_SEED)
    throw new RangeError(`seed must be a whole number 0–${MAX_SEED}`);
  return seed;
}
