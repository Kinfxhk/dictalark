// SPDX-License-Identifier: AGPL-3.0-or-later
// Which secret scan to run. gitleaks when installed; on Linux CI gitleaks is mandatory
// (absence is a failure); elsewhere (e.g. Windows CI, a contributor laptop) a clearly
// labelled FALLBACK pattern scan runs instead and never pretends to be gitleaks.

/** @returns {'gitleaks' | 'fail' | 'fallback'} */
export function secretScanMode({ hasGitleaks, ci, platform }) {
  if (hasGitleaks) return 'gitleaks';
  if (ci && platform === 'linux') return 'fail';
  return 'fallback';
}

/** Patterns for the fallback scan (deliberately conservative). */
export const FALLBACK_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /gh[pousr]_[A-Za-z0-9]{36,}/, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{50,}/, // GitHub fine-grained PAT
  /sk-[A-Za-z0-9_-]{20,}/, // OpenAI/OpenRouter-style keys
  /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // private keys
  /AIza[0-9A-Za-z_-]{35}/, // Google API key
];

/** Line numbers (1-based) in `text` that match a fallback pattern. */
export function fallbackHits(text) {
  const hits = [];
  String(text)
    .split('\n')
    .forEach((line, i) => {
      if (FALLBACK_PATTERNS.some((p) => p.test(line))) hits.push(i + 1);
    });
  return hits;
}
