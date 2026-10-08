# Contributing to Dictalark

Thank you for helping. Dictalark exists so that every family can practise dictation
and spelling for free, offline, without ads and without handing children's data to
anyone. Fair marking, privacy and legal cleanliness matter as much as features.

## Clean-room rule (mandatory)

1. **Do not copy code, UI, text, icons, colours, sounds or word lists** from any
   commercial or open-source dictation, spelling or flash-card product. Edit
   distance, grapheme segmentation and Leitner boxes are general, published ideas;
   write them from scratch. Please do not paste or translate code from other apps,
   including permissively licensed ones, so the provenance of every line stays clear.
2. Work only from general knowledge and the written descriptions in this
   repository. Do not use screenshots or recordings of other products as templates.
3. **No textbook, syllabus or exam lists.** Sample lists must be written by you for
   this project and released under CC0-1.0. Do not add lists from school textbooks,
   government learning word lists, exam papers or other apps
   (`npm run check:hygiene` looks for tell-tale markers and size limits).
4. **No trademarks as branding.** Other products are never named in the UI, engine
   strings, examples or docs.
5. **Third-party code** must be an npm dependency under an AGPL-3.0-compatible
   licence. Do not paste snippets of unknown origin, including from Q&A sites or AI
   tools.

## Privacy rule

Dictalark makes **no network requests** after the page loads. Word lists, results and
recordings live only in the browser's IndexedDB. Do not add analytics, crash
reporting, remote fonts, CDNs, cloud text-to-speech or any other network call. ESLint,
the hygiene script, the Content Security Policy and an end-to-end test that records
every request all enforce this.

## Correctness rule

Every marking diff shown to a learner must be accepted by the independent checker in
`packages/core/src/check/`, which must never import `compare/` (ESLint and the hygiene
script enforce this). A change to normalisation or comparison needs golden tests,
property tests and a mutation test showing that a deliberately broken version is
caught. Edit distances are cross-checked against an exhaustive breadth-first oracle on
short strings (`test/oracle/`). Never weaken the checker to make a change pass. Chinese
is compared character by character: never add Traditional/Simplified conversion or
variant merging to the default rules, because that would mark wrong characters right.

## Cross-platform rule

CI runs on Linux and Windows. Start child processes with `process.execPath` (see
`scripts/lib/proc.mjs`), build paths with `node:path`, and never assert against a
hard-coded path string. Text files are checked out with LF everywhere
(`.gitattributes`). Calendar dates are local calendar days (`YYYY-MM-DD`), never
millisecond arithmetic, and tests run in several time zones.

## AI-assisted development

**How this project is made:** Dictalark is written with AI coding agents working under
the maintainer's direction. Most of the code, tests and documentation in this
repository were drafted that way and then checked by the same gates that apply to every
contribution: the clean-room rules above, the independent checker, golden, property,
oracle and mutation tests, the licence allowlist, the hygiene check and the secret
scan. We say this openly because a policy that pretended otherwise would be useless.

You may use AI tools for your contribution too, on these conditions:

1. **Review it yourself.** Read every line you submit and be able to explain why it is
   correct. You are responsible for it exactly as if you had typed it. Check golden-test
   expectations by hand; do not let a tool write both a rule and its expected answers
   without your own check.
2. **No reproduction of other work.** Do not ask an AI tool to reproduce, translate or
   paraphrase code, UI text, word lists or screenshots from other apps, textbooks or
   exam papers, and do not paste such material into prompts. If a tool tells you its
   output matches existing code (or shows a licence or attribution), do not use it.
3. **DCO covers all of it.** Your sign-off (below) certifies that you have the right to
   submit the whole contribution, including AI-assisted parts.
4. **Disclose it.** Say in the pull request which AI tools you used and for what. The
   pull request template asks for this. Disclosure is not a mark against a
   contribution; it helps reviewers know where to look harder.
5. **The gates do not move.** AI-assisted or not, every marking rule needs golden,
   property and mutation tests, and the checker is never weakened.

## Developer Certificate of Origin

All commits must be signed off (`git commit -s`), certifying the
[Developer Certificate of Origin 1.1](https://developercertificate.org/): you wrote the
change or otherwise have the right to submit it under AGPL-3.0-or-later.

## Development

```bash
npm ci
npm run check      # lint, format, typecheck, tests, licences, hygiene, secrets
npm run test:e2e   # headless browser tests (Chromium)
```

`packages/core` must stay **pure**: no I/O, no clock, no `Math.random()`, no network
(ESLint enforces this). Use the seeded PRNG in `shuffle/` and pass "today" in.

## Licence

By contributing you agree that your contribution is licensed under AGPL-3.0-or-later.
