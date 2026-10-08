// SPDX-License-Identifier: AGPL-3.0-or-later
export * from './voices';
export * from './punctuation';

/** Seconds a device voice may take for `text` before we stop waiting for "end". */
export function speechTimeoutMs(text: string, rate: number): number {
  const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
  return Math.min(30_000, Math.round(4000 + (450 * [...text].length) / r));
}
