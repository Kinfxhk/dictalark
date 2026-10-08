#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Prints release notes for one version, taken from CHANGELOG.md, plus the site checksum,
// the legal notes and the support link.
// Usage: node scripts/release-notes.mjs [version]   (default: root package.json version)
import { existsSync, readFileSync } from 'node:fs';

const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) {
  console.error(`CHANGELOG.md has no section for ${version}`);
  process.exit(1);
}
const rest = changelog.slice(start);
const next = rest.slice(1).search(/^## \[|^\[[^\]]+\]: /m);
const body = (next < 0 ? rest : rest.slice(0, next + 1)).split('\n').slice(1).join('\n').trim();

const lines = [body, ''];
const sumFile = `release/dictalark-site-v${version}.zip.sha256`;
if (existsSync(sumFile)) {
  lines.push(
    '### Static site download',
    '',
    'SHA-256:',
    '',
    '```',
    readFileSync(sumFile, 'utf8').trim(),
    '```',
    '',
  );
}
lines.push(
  '### Please note · 請注意',
  '',
  '- **Automatic marking is only a guide.** Chinese answers are compared character by character, with no Traditional/Simplified conversion; please check answers yourself. 自動批改只供參考；中文逐字比對，不作繁簡轉換，請自行核對。',
  '- **Your data stays on your device.** Lists, results and recordings are kept in your browser (IndexedDB); the app makes no network requests. 詞表、成績及錄音只存於你的裝置，程式不發出網絡請求。',
  '- Dictalark is an independent open-source project and is not affiliated with any other dictation or spelling product or company. 默書雲雀是獨立開源項目，與任何其他默書或串字產品或公司並無關連。',
  '- No ads, no tracking, no paid unlocks. 沒有廣告、沒有追蹤、沒有付費解鎖。',
  '',
  'If Dictalark helps your family, you can support it at https://buymeacoffee.com/kinfxhk · 如果默書雲雀對你的家庭有幫助，歡迎到 Buy Me a Coffee 支持。',
);
process.stdout.write(lines.join('\n') + '\n');
