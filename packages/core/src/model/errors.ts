// SPDX-License-Identifier: AGPL-3.0-or-later
// Every rejection carries a stable code and parameters; the UI shows it in English and
// Traditional Chinese through i18n/messages.ts.

export type ErrorCode =
  | 'too-large'
  | 'not-utf8'
  | 'bad-json'
  | 'forbidden-key'
  | 'too-deep'
  | 'bad-number'
  | 'bad-shape'
  | 'unknown-format'
  | 'future-schema'
  | 'missing-schema'
  | 'too-many-lists'
  | 'too-many-items'
  | 'text-empty'
  | 'text-too-long'
  | 'text-control-char'
  | 'bad-id'
  | 'duplicate-id'
  | 'bad-lang'
  | 'bad-date'
  | 'bad-enum'
  | 'csv-empty'
  | 'csv-no-text-column'
  | 'csv-unterminated-quote'
  | 'recording-too-long'
  | 'recording-empty'
  | 'storage-full'
  | 'recordings-full'
  | 'mic-denied'
  | 'mic-unavailable';

export class DictalarkError extends Error {
  readonly code: ErrorCode;
  readonly params: Readonly<Record<string, string | number>>;
  constructor(code: ErrorCode, params: Record<string, string | number> = {}) {
    super(`${code}${Object.keys(params).length ? ' ' + JSON.stringify(params) : ''}`);
    this.name = 'DictalarkError';
    this.code = code;
    this.params = params;
  }
}

export const isDictalarkError = (e: unknown): e is DictalarkError => e instanceof DictalarkError;
