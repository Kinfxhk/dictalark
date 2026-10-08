# Changelog

All notable changes to Dictalark are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-10-08

Optional extras from what users of other dictation apps ask for (P2). 根據用戶需要再加的功能。

### Added

- **QR code for share links**, drawn on this device by Dictalark's own encoder (byte
  mode, versions 1–40, error correction M, falling back to L for long links), with
  **Save QR code (.svg)** for printing. Lists too long for a QR code get a note instead.
  Every test symbol is read back by an independent decoder (jsQR, a test-only
  dependency); 14 deliberately broken encoders are all caught.
- **Class lists by file** (Class page): teachers save a **class pack**; pupils open it
  with a preview (new / updated / already up to date), and a later pack updates their
  copies instead of doubling them; pupils save a **results file** (counts per practice
  and how often each word was missed, never what they typed); teachers open many results
  files for a summary per list (tries, best, latest, all right last time, most missed
  words) and a CSV. No accounts, no server. Results files can be edited by pupils, so the
  page says they are for practice feedback, not for marks.
- **Independent Python oracle** (`tools/oracle/oracle.py`, standard library only, run by
  `npm run oracle` and in CI on Linux and Windows): many thousands of random cases for
  answer marking (typing rules, accepted answers), word alignment (its own Damerau/OSA
  distance and a rebuild of both strings from the steps), review-box days, calendar
  arithmetic (days outside 2000–2999 must be refused), local day in a time zone, the due
  list order, the seeded shuffle, QR Reed–Solomon error correction and data codewords,
  and the class results summary, compared with what the app computes.

### Changed

- **The last word now gets its writing time too**: after its last reading, Dictalark
  waits the "pause between words" before showing the results, as it does for every other
  word (before, the results appeared at once, so the last word could not be written or
  typed after hearing it). **Next**, or Enter when typing, finishes sooner.
- The README screenshot is now taken from the live site.

### Not done (with reasons)

- **Reading words from a photo (OCR)** stays deferred: it is a large piece of work and
  needs a model whose code, weights and training data all have clear licences compatible
  with the AGPL, downloaded only on request and never uploading pictures. No such model
  has been checked yet.

## [0.2.0] - 2026-10-08

Improvements from what users of other dictation apps ask for most. 根據其他默書 app
用戶最常提出的需要而改進。

### Added

- **Read as** (讀出文字): each word can have its own spoken text, used only by the voice.
  When a device voice reads a character with the wrong sound, type a character with the
  right sound; marking always uses the word itself. Also a `say` / `讀法` CSV column.
- **Per-word language** can now be chosen in the list editor (it existed in files only).
- **Full backups with recordings**: "Back up everything" now saves recordings too
  (schema 2, base64 in the JSON file). Importing restores them, following any list that
  gets a new id. v0.1 backups (schema 1) still import.
- **Start from item N**, and **Continue from item N** on the results page after
  finishing early (same shuffle number, same order).
- **Passage mode**: items are split at punctuation and each part is read on its own.
  Items can now hold up to 500 characters.
- **Names for punctuation marks**: replace the built-in spoken names, one per line.
- **Voices page**: every voice the browser offers, with language and on-device/online;
  try each and choose one per language. Online voices can only be tried when allowed.
- **Share a list as a link**: the list travels after `#` (never sent to a server), is
  previewed, and is added only when asked. Recordings and results are not included.
- **Keep storage**: Dictalark asks the browser for persistent storage
  (`navigator.storage.persist()`) and shows whether it was granted. A dismissible backup
  reminder appears after 20 changes or 14 days (never during a dictation).

### Changed

- The JSON backup file name is now `dictalark-backup-YYYY-MM-DD.json`.
- Item text, accepted answers and notes may be up to 500 characters (was 120).

### Fixed

- Recording lengths measured by the browser's fractional clock are saved as whole
  milliseconds, so backups with recordings import again (found by the new e2e test
  before release).

### Tests

- Property tests: controls (stop, next, previous, repeat, pause) always cancel a reading
  in progress; nothing is read after stop; a paused dictation never reads by itself.
- Backup, share-link and base64 parsers refuse hostile input. 18 deliberate mutants
  (14 unit, 4 browser) were all caught by the new tests.

### Not in this version

- QR codes for share links (a link can be turned into a QR code with any QR tool);
  class/teacher features; photo (OCR) input; more interface languages.

## [0.1.0] - 2026-10-08

First release. 首個版本。

### Added

- **Word lists**: make lists by typing or pasting, or import CSV/TSV (English or
  Chinese headers, UTF-8 only, spreadsheet formulas neutralised) and Dictalark JSON
  backups. Other accepted answers, notes and a per-word reading language.
- **Your own recordings** per word (up to 30 s each), stored only in this browser and
  always preferred over a device voice.
- **Device voices** with a careful choice: Cantonese lists look for yue-HK / yue /
  zh-HK / zh-MO voices; a different language or dialect is never used silently (a
  Mandarin list never silently uses a Cantonese voice). Online voices are off unless
  you allow them. With no voice and no recording, the parent reads aloud and presses
  "I have read it aloud".
- **Dictation player** (paper, typing or flash cards): readings per word, pauses,
  countdown, speed, reproducible shuffle, hide words, read punctuation aloud; pause,
  back, repeat, skip and finish at any time. Built as a pure state machine with
  model-based tests.
- **Fair automatic marking** for typed answers: grapheme-level optimal string
  alignment showing substitutions, missing and extra letters and swapped neighbours;
  every diff is re-checked by an independent checker before it is shown. Forgiven
  differences (capitals, curly quotes, dashes, spaces, full-width letters, final full
  stop for English) are named. Chinese is compared character by character with no
  Traditional/Simplified conversion. Every mark can be overruled.
- **Review**: wrong words come back on a five-box Leitner schedule counted in calendar
  days (the same result in every time zone).
- **Printing**: answer sheet, answer key and score sheet.
- Three small **self-written CC0 sample lists** (English, Cantonese, Mandarin).
- English and Traditional Chinese (Hong Kong) interface, light and dark themes, large
  text; works offline after the first visit (service worker); JSON backup and
  "delete all data on this device".
- Command line: `convert` (CSV/TSV → JSON) and `validate`; a loopback static server and a
  container image.

### Privacy and safety

- No network requests, no accounts, no ads, no tracking; strict Content Security Policy
  (`connect-src 'self'`). End-to-end tests fail on any request to another site or any
  non-GET request.
- Imported files are size- and depth-limited and validated field by field; keys such as
  `__proto__` are refused.

### Not in this version (planned for v0.2)

- Recordings in backups (v0.1 backups contain lists, results and the review schedule).
- Sharing a list by link or QR code; class/teacher features; more interface languages.
