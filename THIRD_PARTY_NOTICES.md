# Third-party notices

Dictalark is licensed under AGPL-3.0-or-later. The core (`packages/core`) and the
browser UI (`packages/web`) have **no third-party runtime dependencies**: the word-list
model, CSV/JSON reader and writer, answer normalisation, grapheme diff and its
independent checker, spaced repetition, shuffle, dictation player, QR code encoder, class pack and results
files and the UI are original code written for this project. Speech comes from the Web Speech API and
recording from MediaRecorder, both built into your browser; grapheme splitting uses
`Intl.Segmenter`.

The full dependency list with licences is produced by `npm run check:licenses`,
which also enforces an AGPL-3.0-compatible allowlist in CI (it fails closed on
unknown or malformed licence expressions).

## Development-only tools (not shipped)

Vite, Vitest, fast-check, Playwright, axe-core (`@axe-core/playwright`, MPL-2.0),
jsQR (Apache-2.0, used only to read back test QR codes), ESLint, Prettier, TypeScript and
tsx are used only to build and test Dictalark. The Python oracle (`tools/oracle/`) uses
only the Python standard library.
MPL-2.0 is accepted for development tooling only.

## Code of Conduct

`CODE_OF_CONDUCT.md` is the Contributor Covenant 3.0 (CC BY-SA 4.0), see the
attribution at the end of that file.

## Secret scanning

CI runs [gitleaks](https://github.com/gitleaks/gitleaks) (MIT), downloaded at a
pinned version with retries and checked against its published SHA-256 checksums.
It is not part of the repository or of any release artefact.
