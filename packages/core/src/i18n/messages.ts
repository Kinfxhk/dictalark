// SPDX-License-Identifier: AGPL-3.0-or-later
// Bilingual error messages (English, Traditional Chinese for Hong Kong).

import type { DictalarkError, ErrorCode } from '../model/errors';

export type Locale = 'en' | 'zh-HK';

type Msg = (p: Readonly<Record<string, string | number>>) => string;

const MB = (n: string | number | undefined) => `${Math.round(Number(n ?? 0) / 1024 / 1024)} MB`;

export const ERROR_MESSAGES: Record<ErrorCode, Record<Locale, Msg>> = {
  'too-large': {
    en: (p) => `The file is too large (limit ${MB(p.max)}).`,
    'zh-HK': (p) => `檔案太大（上限 ${MB(p.max)}）。`,
  },
  'not-utf8': {
    en: () =>
      'The file is not UTF-8 text (it may be Big5). Save it again as "CSV UTF-8" and retry.',
    'zh-HK': () => '檔案不是 UTF-8 文字（可能是 Big5）。請另存為「CSV UTF-8」後再試。',
  },
  'bad-json': {
    en: () => 'This is not a valid Dictalark file (JSON could not be read).',
    'zh-HK': () => '這不是有效的默書雲雀檔案（無法讀取 JSON）。',
  },
  'forbidden-key': {
    en: (p) => `The file contains a forbidden key "${p.key}" and was rejected.`,
    'zh-HK': (p) => `檔案含有不允許的欄位「${p.key}」，已拒絕匯入。`,
  },
  'too-deep': {
    en: () => 'The file is nested too deeply and was rejected.',
    'zh-HK': () => '檔案結構層數過多，已拒絕匯入。',
  },
  'bad-number': {
    en: () => 'The file contains an invalid number.',
    'zh-HK': () => '檔案含有無效數字。',
  },
  'bad-shape': {
    en: (p) => `Unexpected content at ${p.path} (expected ${p.expected}).`,
    'zh-HK': (p) => `${p.path} 的內容不正確（應為 ${p.expected}）。`,
  },
  'unknown-format': {
    en: () => 'This is not a Dictalark export file.',
    'zh-HK': () => '這不是默書雲雀的匯出檔。',
  },
  'future-schema': {
    en: (p) =>
      `This file was made by a newer Dictalark (format ${p.found}; this version reads up to ${p.supported}). Please update.`,
    'zh-HK': (p) =>
      `此檔案由較新版本的默書雲雀建立（格式 ${p.found}，本版本最多支援 ${p.supported}），請先更新。`,
  },
  'missing-schema': {
    en: () => 'The file has no format version.',
    'zh-HK': () => '檔案缺少格式版本。',
  },
  'too-many-lists': {
    en: (p) => `Too many word lists (limit ${p.max}).`,
    'zh-HK': (p) => `詞表太多（上限 ${p.max} 個）。`,
  },
  'too-many-items': {
    en: (p) => `Too many entries (limit ${p.max}).`,
    'zh-HK': (p) => `項目太多（上限 ${p.max} 個）。`,
  },
  'text-empty': {
    en: (p) => `Empty text at ${p.path}.`,
    'zh-HK': (p) => `${p.path} 的文字是空的。`,
  },
  'text-too-long': {
    en: (p) => `Text at ${p.path} is too long (limit ${p.max} characters).`,
    'zh-HK': (p) => `${p.path} 的文字太長（上限 ${p.max} 個字元）。`,
  },
  'text-control-char': {
    en: (p) => `Text at ${p.path} contains invisible control characters.`,
    'zh-HK': (p) => `${p.path} 的文字含有隱形控制字元。`,
  },
  'bad-id': {
    en: (p) => `Invalid identifier at ${p.path}.`,
    'zh-HK': (p) => `${p.path} 的識別碼無效。`,
  },
  'duplicate-id': {
    en: (p) => `Duplicate identifier "${p.id}" in ${p.path}.`,
    'zh-HK': (p) => `${p.path} 有重複的識別碼「${p.id}」。`,
  },
  'bad-lang': {
    en: (p) => `Invalid language code at ${p.path} (use e.g. en-GB, yue-HK, cmn-Hans-CN).`,
    'zh-HK': (p) => `${p.path} 的語言代碼無效（例如 en-GB、yue-HK、cmn-Hans-CN）。`,
  },
  'bad-date': {
    en: (p) => `Invalid date at ${p.path}.`,
    'zh-HK': (p) => `${p.path} 的日期無效。`,
  },
  'bad-enum': {
    en: (p) => `Invalid value at ${p.path} (allowed: ${p.allowed}).`,
    'zh-HK': (p) => `${p.path} 的值無效（可用：${p.allowed}）。`,
  },
  'csv-empty': {
    en: () => 'No words found in the file.',
    'zh-HK': () => '檔案內找不到任何詞語。',
  },
  'csv-no-text-column': {
    en: () => 'Choose which column holds the words.',
    'zh-HK': () => '請選擇哪一欄是詞語。',
  },
  'csv-unterminated-quote': {
    en: (p) => `A quotation mark is not closed (from row ${p.row}).`,
    'zh-HK': (p) => `引號未有關閉（由第 ${p.row} 行開始）。`,
  },
  'recording-too-long': {
    en: (p) => `Recordings are limited to ${p.max} seconds; recording stopped.`,
    'zh-HK': (p) => `每段錄音上限 ${p.max} 秒，已自動停止。`,
  },
  'recording-empty': {
    en: () => 'Nothing was recorded. Check the microphone and try again.',
    'zh-HK': () => '沒有錄到聲音，請檢查咪高峰後再試。',
  },
  'storage-full': {
    en: () =>
      'Storage on this device is full. Nothing was changed; delete some recordings and retry.',
    'zh-HK': () => '此裝置的儲存空間已滿。資料沒有改動；請刪除部分錄音後再試。',
  },
};

export function errorMessage(e: DictalarkError, locale: Locale): string {
  return ERROR_MESSAGES[e.code][locale](e.params);
}
