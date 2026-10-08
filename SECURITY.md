# Security policy

Dictalark is a static web application. Everything happens in your browser: it makes
**no network requests** after the page has loaded, has no accounts and no telemetry,
and keeps word lists, results and recordings only in your browser's IndexedDB
(deletable with one button). The bundled local server (`npm start`) only serves
static files and binds to `127.0.0.1` by default. The page ships a Content Security
Policy that blocks loading anything from other origins; the only extra source it
allows is `blob:` media, which is how your own recordings are played back.

Imported word lists are treated as untrusted: they are size-, count- and
depth-limited, schema-validated (prototype keys such as `__proto__` are rejected),
and text is only ever rendered as plain text. CSV exports neutralise spreadsheet
formulas.

Please report vulnerabilities privately through GitHub's "Report a vulnerability"
(security advisories) on <https://github.com/Kinfxhk/dictalark> rather than in a
public issue.
