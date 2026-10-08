#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Secret scan (cross-platform). Preferred: gitleaks (https://github.com/gitleaks/gitleaks,
// MIT) over the git history and the working tree. See lib/secret-mode.mjs for when the
// FALLBACK pattern scan is allowed.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fallbackHits, secretScanMode } from './lib/secret-mode.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
process.chdir(root);

const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
const mode = secretScanMode({
  hasGitleaks: probe.status === 0,
  ci: Boolean(process.env.CI),
  platform: process.platform,
});

if (mode === 'gitleaks') {
  console.info(`Running gitleaks ${probe.stdout.trim()} on git history...`);
  const run = (args) => spawnSync('gitleaks', args, { stdio: 'inherit' }).status;
  if (run(['git', '--redact', '--no-banner', '--exit-code', '1', '.']) !== 0) process.exit(1);
  console.info('Running gitleaks on the working tree...');
  const dirArgs = ['dir', '--redact', '--no-banner', '--exit-code', '1'];
  if (run([...dirArgs, '--config', '.gitleaks.toml', '.']) !== 0) process.exit(1);
  console.info('Secret scan passed (gitleaks).');
  process.exit(0);
}

if (mode === 'fail') {
  console.error('Secret scan FAILED: gitleaks is required on Linux CI but was not found.');
  process.exit(1);
}

console.warn('WARNING: gitleaks not found; running the FALLBACK pattern scan (less thorough).');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
  encoding: 'utf8',
})
  .split('\0')
  .filter(
    (f) =>
      f &&
      f !== 'scripts/secret-scan.mjs' &&
      f !== 'scripts/lib/secret-mode.mjs' &&
      !f.endsWith('package-lock.json'),
  );
let found = 0;
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\0')) continue; // binary
  for (const line of fallbackHits(text)) {
    console.error(`${f}:${line}: looks like a secret`);
    found++;
  }
}
if (found) {
  console.error('Secret scan FAILED (fallback).');
  process.exit(1);
}
console.warn(`Secret scan passed (FALLBACK patterns only, ${files.length} files; not gitleaks).`);
