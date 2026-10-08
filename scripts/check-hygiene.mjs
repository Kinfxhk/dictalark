#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Repository hygiene gate for Dictalark:
//  - required notice, community and policy files exist, and README keeps its statements;
//  - the web UI never loads anything from another origin and never calls the network
//    (recordings and word lists stay on the device);
//  - other dictation/spelling products' names never appear in the UI, engine, examples or
//    docs (README's factual comparison section is the only exception);
//  - sample word lists stay small, CC0 and self-written (no textbook / syllabus lists);
//  - the independent diff checker never imports the diff engine (also enforced by ESLint);
//  - tests never assert against hard-coded OS-specific paths;
//  - the AGPL section 13 source link and the CSP stay in the page.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { findHardcodedPathAssertions } from './lib/path-assert.mjs';
import { COMPETITORS, TEXTBOOK_MARKERS, NETWORK_APIS } from './lib/hygiene-rules.mjs';

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && existsSync(f) && !/-mutant-/.test(f));

const problems = [];
const read = (f) => readFileSync(f, 'utf8');
const REPO = 'https://github.com/Kinfxhk/dictalark';

for (const required of [
  'LICENSE',
  'NOTICE',
  'THIRD_PARTY_NOTICES.md',
  'README.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  '.gitattributes',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/config.yml',
]) {
  if (!existsSync(required)) problems.push(`missing required file: ${required}`);
}
if (existsSync('LICENSE') && !read('LICENSE').includes('GNU AFFERO GENERAL PUBLIC LICENSE'))
  problems.push('LICENSE is not the AGPL text');
if (existsSync('.gitattributes') && !/^\* text=auto eol=lf$/m.test(read('.gitattributes')))
  problems.push('.gitattributes must contain "* text=auto eol=lf"');

if (existsSync('README.md')) {
  const readme = read('README.md');
  const needles = {
    'https://buymeacoffee.com/kinfxhk': 'Buy Me a Coffee link',
    [REPO]: 'repository link',
    'not affiliated': 'English not-affiliated statement',
    並無關連: 'Chinese not-affiliated statement',
    'stay on your device': 'English privacy statement (recordings stay on the device)',
    只存於你的裝置: 'Chinese privacy statement',
    'only a guide': 'English automatic-marking disclaimer',
    只供參考: 'Chinese automatic-marking disclaimer',
    'AI-assisted development': 'AI-assisted development policy link',
    'no ads': 'commitments (no ads)',
    不會有廣告: 'Chinese commitments',
    'CODE_OF_CONDUCT.md': 'Code of Conduct link',
  };
  for (const [needle, what] of Object.entries(needles))
    if (!readme.includes(needle)) problems.push(`README.md lacks the ${what} ("${needle}")`);
}
if (existsSync('CONTRIBUTING.md') && !/## AI-assisted development/.test(read('CONTRIBUTING.md')))
  problems.push('CONTRIBUTING.md lacks the "AI-assisted development" policy section');

// --- No other products' names in UI / engine / examples / docs. ----------------------------
const BRAND_FILES = files.filter(
  (f) =>
    /^packages\/(web|core|cli)\/(src|public)\//.test(f) ||
    f === 'packages/web/index.html' ||
    /^examples\//.test(f) ||
    /^docs\/.*\.md$/.test(f) ||
    f === 'README.md' ||
    f === 'CHANGELOG.md',
);
for (const f of BRAND_FILES) {
  if (/\/licenses\//.test(f)) continue;
  if (!/\.(ts|html|css|json|csv|webmanifest|svg|md)$/.test(f)) continue;
  const m = read(f).match(COMPETITORS);
  if (m) problems.push(`${f}: other product name "${m[0]}" must not appear here`);
}

// --- Sample word lists: small, CC0, self-written. -------------------------------------------
for (const f of files.filter((x) => /^examples\//.test(x))) {
  if (statSync(f).size > 8 * 1024) problems.push(`${f}: sample lists must stay under 8 KB`);
  const text = read(f);
  const m = text.match(TEXTBOOK_MARKERS);
  if (m) problems.push(`${f}: looks like a textbook/syllabus list ("${m[0]}")`);
  if (/\.json$/.test(f) && !text.includes('CC0-1.0'))
    problems.push(`${f}: sample list must declare "CC0-1.0"`);
}

// --- The checker must not import the diff engine. -------------------------------------------
for (const f of files.filter((x) => /^packages\/core\/src\/check\/.*\.ts$/.test(x))) {
  for (const m of read(f).matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    if (/(^|\/)compare(\/|\.ts$|$)/.test(m[1]) || /^\.\.(\/index(\.ts)?)?\/?$/.test(m[1]))
      problems.push(`${f}: the independent checker must not import "${m[1]}"`);
  }
}

// --- Tests must not assert hard-coded OS paths. --------------------------------------------
for (const f of files.filter(
  (x) => /\.(test|spec)\.(ts|mjs|js)$/.test(x) && !x.startsWith('test/scripts/fixtures/'),
)) {
  for (const hit of findHardcodedPathAssertions(read(f)))
    problems.push(`${f}:${hit.line}: hard-coded path assertion "${hit.literal}" (use node:path)`);
}

// --- The web UI must not load third-party resources or call the network. --------------------
const ALLOWED_LINKS = [REPO, 'https://buymeacoffee.com/kinfxhk', 'https://www.gnu.org/licenses/'];
const WEB_FILES = files.filter(
  (f) => /^packages\/web\/(src|public)\//.test(f) || f === 'packages/web/index.html',
);
for (const f of WEB_FILES) {
  if (/\/licenses\//.test(f) || !/\.(ts|html|css|json|webmanifest|js|svg)$/.test(f)) continue;
  const text = read(f);
  for (const m of text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)) {
    const url = m[0];
    if (url.startsWith('http://www.w3.org/')) continue; // XML namespaces, not loads
    if (!ALLOWED_LINKS.some((a) => url.startsWith(a)))
      problems.push(`${f}: external URL not allowed in the web UI: ${url}`);
  }
  if (/(src|srcset)\s*=\s*["']https?:/i.test(text) || /url\(\s*["']?https?:/i.test(text))
    problems.push(`${f}: loads a resource from another origin`);
  if (/\.ts$/.test(f)) {
    const m = text.match(NETWORK_APIS);
    if (m) problems.push(`${f}: network API "${m[0]}" is not allowed (privacy promise)`);
  }
}

const PAGE = 'packages/web/index.html';
if (existsSync(PAGE)) {
  const html = read(PAGE);
  if (!/http-equiv="Content-Security-Policy"[^>]*default-src 'self'/s.test(html))
    problems.push(`${PAGE}: missing CSP meta with default-src 'self'`);
  if (/connect-src\s+[^;"]*(https?:|\*)/.test(html))
    problems.push(`${PAGE}: CSP connect-src must not allow other origins`);
  if (!html.includes('id="source-link"'))
    problems.push(`${PAGE}: missing footer source link (AGPL section 13)`);
}

if (problems.length) {
  console.error('Repository hygiene check FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.info(`Repository hygiene check passed (${files.length} files).`);
