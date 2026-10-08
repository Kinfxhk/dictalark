<!-- Thank you! Please fill in every section; delete hints in brackets. -->

## What and why

[What does this change and which issue does it address?]

## Checklist

- [ ] `npm run check` passes (lint, format, typecheck, tests, licences, hygiene, secret scan).
- [ ] UI changes: `npm run test:e2e` passes.
- [ ] **Checker:** every marking diff is still accepted by the independent checker in
      `packages/core/src/check/`, and the checker was **not** weakened.
- [ ] **Tests:** golden cases checked by hand, property tests, and a mutation test showing a
      deliberately broken version is caught.
- [ ] **Privacy:** no network requests, analytics, remote fonts or CDNs were added.
- [ ] New interface strings exist in both `en` and `zh-HK`.
- [ ] **Clean room:** no code, text, UI, screenshots or word lists copied from other apps,
      textbooks or exam papers (CONTRIBUTING.md).
- [ ] Commits are signed off (`git commit -s`, DCO).

## AI assistance

- [ ] I did not use AI tools for this change.
- [ ] I used AI tools: [which tools, and for what]. I reviewed every line and can explain it,
      and I did not ask the tool to reproduce other projects' code or text.
