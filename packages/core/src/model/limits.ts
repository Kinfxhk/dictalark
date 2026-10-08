// SPDX-License-Identifier: AGPL-3.0-or-later
// Hard limits (design §2.1). The UI and every importer enforce them; tests cover each.
export const LIMITS = {
  /** Word lists in one library. */
  lists: 200,
  /** Items in one list. */
  itemsPerList: 200,
  /** Characters (Unicode code points) in one item's text, accepted answer or note. */
  itemChars: 120,
  /** Accepted alternative answers per item. */
  acceptPerItem: 10,
  /** Characters in a list name. */
  nameChars: 80,
  /** Seconds of recording per item; recording stops automatically. */
  recordingSeconds: 30,
  /** Bytes of all recordings together. */
  recordingBytesTotal: 200 * 1024 * 1024,
  /** Bytes of one imported file (JSON or CSV/TSV). */
  importBytes: 2 * 1024 * 1024,
  /** Nesting depth of an imported JSON file. */
  jsonDepth: 12,
  /** Practice attempts kept per list (oldest are dropped). */
  attemptsPerList: 100,
} as const;
