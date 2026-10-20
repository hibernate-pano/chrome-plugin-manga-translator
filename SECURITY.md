# Security Policy

## Supported Versions

Only the latest published release is supported with security fixes. The
extension is distributed through the Chrome Web Store, and the store always
serves the newest published version to users, so there is no backport
schedule for older versions.

| Version | Supported |
| --- | --- |
| latest published release | ✅ |
| anything older | ❌ |

## Reporting a Vulnerability

Please **do not open a public GitHub issue** for a security problem. A public
issue is visible to everyone, including people who would use the disclosure
before a fix is available.

Instead, report it privately through GitHub's private vulnerability reporting
on this repository:

**Security → Report a vulnerability** on
<https://github.com/hibernate-pano/chrome-plugin-manga-translator/security/advisories/new>

If that route is unavailable to you, open a regular issue that contains only
"security report — please open a private channel" and nothing else.

Please include:

- What the issue is, and which part of the extension is involved.
- Steps to reproduce, ideally with the smallest page that triggers it.
- The impact you believe it has — what an attacker gains.
- The Chrome version and extension version you observed it on.

### What to expect

- An acknowledgement within a few days.
- An assessment of the report, and a decision about whether it is accepted, once
  the report has been reproduced.
- A fix, and a release, for confirmed issues. Release notes will credit the
  reporter unless you ask to remain anonymous.

There is no bug bounty for this project. Reports are still welcome and will be
credited.

## Scope

This project is a browser extension that runs on every page the user visits and
sends images to a Vision LLM provider the user configures. Reports about any of
the following are in scope:

- The extension exposing extension resources or user data to a web page.
- The extension transmitting data anywhere other than to the provider the user
  configured, or to the image host of the page being translated.
- The extension executing or loading code it did not ship with.
- The image-fetch guard (`src/background/image-fetch-guard.ts`) failing to
  refuse a request it is supposed to refuse.
- The extension leaking or mishandling the user's API key.

Not in scope:

- Vulnerabilities in the user's own Vision LLM provider, or in the browser.
- The obfuscation of stored API keys. It is obfuscation, not encryption, and the
  documentation says so. Reports asking for "real" encryption of a key that
  lives in the user's own browser profile will be closed as not-applicable.
- Findings that require the user to have already installed a malicious
  extension with broad permissions.
- Automated scanner output with no demonstrated impact.

## Security-Relevant Design Notes

For anyone reviewing this repository, these are the properties the project
tries to hold, and the checks that enforce them:

- **No developer-operated server.** The extension has no endpoint of its own.
  Image bytes go from the user's browser to the provider the user configured,
  and to the image host of the page being translated. Neither path is a
  developer relay.
- **The content script is not web-accessible.** It is registered as a plain
  static file, so a page cannot `fetch(chrome.runtime.getURL('content.js'))` and
  read the API key obfuscation salt out of the shipped bundle.
  `pnpm release:check` fails the build if it is exposed again, or if the salt
  appears in any web-accessible file.
- **The image fetch is guarded.** `src/background/image-fetch-guard.ts` refuses
  non-`http`/`https` schemes, loopback and private addresses, and requires the
  requester to be the extension itself. `credentials: 'omit'` keeps the user's
  cookies away from the request.
- **Public builds carry no credentials.** `pnpm build:public` strips provider
  API keys and `scripts/check-public-build.mjs` scans both the generated
  config and every emitted file, failing the build if any key survives.
- **The manifest declares no remote code.** The extension pages' CSP is
  `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`, and
  `'wasm-unsafe-eval'` is there only for the bundled Tesseract WASM core.
