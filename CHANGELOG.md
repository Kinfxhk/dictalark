# Changelog

All notable changes to Dictalark are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
