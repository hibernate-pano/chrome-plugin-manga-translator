# Changelog

All notable changes to the chrome-plugin-manga-translator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **The public package no longer ships the developer's private model
  repository.** The public build path blanks the whole Ollama provider entry,
  so the package falls back to the public defaults in `src/shared/app-config.ts`
  (`http://localhost:11434` + `llava`) instead of pointing every store user at
  a HuggingFace repository they cannot pull. `check-public-build.mjs` fails the
  build if a repository-shaped model reference reaches `dist/`. The packages
  published as v1.3.3 through v2.0.3 still carried it — those releases cannot
  be withdrawn, so v2.0.4 replaces them.
- **The content script is no longer web-accessible, so a web page can no

- **The content script is no longer web-accessible, so a web page can no
  longer read the API key obfuscation salt.** CRXJS cannot register a content
  script directly: for every file in `content_scripts[].js` it emits a loader
  whose whole body is `import(chrome.runtime.getURL('content.js'))`, and a
  dynamic import of an extension URL from a page context is refused unless the
  target is exposed to that page. That put `content.js` into
  `web_accessible_resources` for every site, and the bundle carries the salt
  and the XOR routine that uses it — so any page could fetch the bundle and
  reverse a stored `obf:` key back into plaintext. The build now bundles the
  content script into a self-contained IIFE and registers it as a plain static
  file, which Chrome injects itself, so it never has to be reachable from a
  page. `pnpm release:check` fails the build if `content.js` reappears in
  `web_accessible_resources`, or if the salt shows up in any web-accessible
  file under any name.
- **The content script no longer holds the API key at all.** It used to read
  the whole configuration out of `chrome.storage.local` and deobfuscate the
  key itself, so the plaintext key lived in the heap of a script that is
  injected into every page the user visits — and every translation request
  carried the key, the endpoint and the model name from the page to the
  worker. The key now stays in the worker: the content script asks for a
  redacted configuration snapshot that says *whether* a key is configured,
  never *what* it is, and the worker resolves the provider, the endpoint and
  the model from its own configuration, ignoring whatever a request claims.
  A request that asks for a different endpoint than the one the user
  configured is refused, so a request from another extension cannot spend
  the user's key against a gateway of the attacker's choosing.
- **The built package no longer carries the obfuscation salt.** The salt and
  the routine that uses it are only in the worker's bundle now, and the
  build fails if they show up in the content script.
- **The build-time API key no longer reaches the content script's bundle.**
  The previous entry claimed the content script no longer held the key, and
  at runtime that was true — but the *bundle* still carried it. The key was
  injected at build time into `env-config.generated.ts`, which
  `app-config.ts` imported, which the content script imported: so the
  plaintext key was compiled into `dist/content.js` and shipped to every
  page the user opened. The build-time configuration is now split in two:
  `env-config.generated.ts` carries the endpoint and the model, and
  `env-credentials.generated.ts` carries the key. The key half is imported
  only by the service worker and the extension's own pages; the content
  script's import closure cannot reach it. Two build guards now hold that
  line: the build fails if the content script's import graph can reach a
  credential module, and it fails if a key turns up in the built
  `dist/content.js`.

### Fixed

- **The source Japanese showed through the translation.** The translation is
  drawn on top of the original text, so the panel has to cover it exactly —
  and it did not. A vision model is good at saying "there is text around
  here" and bad at saying where the edges are: measured against a manga
  panel with known ground truth, its box was off by up to 25px vertically
  and 80px horizontally, and it often covered only the first line of a
  two-line bubble. Asking the model more carefully did not help — thirty
  measured calls with six different prompt wordings produced the same
  spread, and a fixed padding is blind to which way the box was wrong (at
  +28px the worst sample still leaked 17% of the ink). The pixels know
  where the ink is, though, so the box is now snapped to the real extent of
  the glyphs before the panel is drawn: the ink is found by connected-component
  analysis, bubble outlines and panel borders are told apart from letters by
  their ink density, and the panel is grown to reach the text the model
  missed. The refined box matched the ground truth exactly on the panel
  that was measured.
- **The translation panel was 94% opaque, so the source text still showed
  through it.** Even with the box in the right place, the panel's own
  6% transparency let the original Japanese sit under the Chinese at a
  contrast of 7:1 — four times the threshold for readable text, so the
  panel looked like a half-finished translation. The default is now opaque.
  A user who had not touched the setting gets the new default on upgrade;
  a user who chose their own background keeps it.
- **A double `dispose()` left the "show original" key stuck on.** The
  renderer releases a shared window listener when it is disposed, and the
  release was not idempotent: disposing twice took the live-renderer count
  below the number of renderers that were still alive, and the
  `show-original` class stayed on `<body>` for the rest of the page's
  life. Two test-hygiene bugs were hiding it — a failing assertion leaked
  a renderer, and the integration suite never disposed its renderers at
  all — so the leak was invisible to the suite that should have caught it.
- **The build was red on `main`.** Two tests in `src/shared/preloaded-config.test.ts`
  asserted that the preloaded provider settings mirror the build-time
  environment exactly. They do not: when the build has no `.env` — which is
  the case in CI, and for anyone who clones the repository — the endpoint
  and the model fall back to the defaults in `@/shared/app-config`, so the
  settings carry `https://api.minimaxi.com/v1` rather than an empty
  string. The assertion passed on a developer's machine, where a `.env`
  exists and the two agree, and failed everywhere else. The tests now
  assert the contract that actually holds: the preloaded settings follow
  the build-time environment when there is one, and the defaults when
  there is not.
- **Almost every translation was drawn at the minimum font size.** The
  layout asked how big the font could be for the whole text to fit on a
  *single* line, and used that as the starting point for a downward
  search. For anything longer than a line that answer collapses onto the
  10px floor, so a speech bubble with room to spare was still drawn at
  10px and had to be squinted at. The layout now asks the question the
  reader cares about — how big can it be while it still fits — and answers
  it by trying the sizes from the top down. A typical bubble got 60% more
  readable text, and nothing that used to fit got smaller.
- **Hovering a translation made it nearly invisible.** The overlay faded
  to 15% opacity the moment the mouse was over it, which is exactly when
  the reader is trying to select the text. The product already has a way
  to see the original — hold Alt — so the fade had no reason to exist.
- **A translation that did not fit was cut off without a word.** The
  overlay clipped the text and said nothing, so a missing last line looked
  like a complete sentence. Cut-off overlays now carry an ellipsis.
- **An empty translation covered the bubble with an empty box.** A model
  that returns nothing for a bubble used to put an opaque, empty rectangle
  over the artwork. Empty translations are now left alone.
- **Changing the font size did not change the translations already on the
  page.** The setting only applied to the images translated afterwards, so
  the user made the text bigger, looked at the page, saw no difference and
  concluded the setting was broken. The overlays that are on the page are
  re-laid out now.
- **The bubbles of one image were listed in the order the model returned
  them.** The reading panel inherits that order, so an image with six
  bubbles could show them shuffled. They are now ordered the way the page
  reads — top to bottom, and right to left for vertical manga.
- **The reading panel had no way to be taken off the page.** Collapsing
  it left a header bar behind, and the only other way out was a keyboard
  shortcut no document mentioned. The panel has a close button now, and
  the popup has a matching switch.
- **The reading panel was 85% of a phone screen.** Its width was a fixed
  320px. It is now as wide as the screen allows.
- **The progress HUD sat underneath the reading panel.** Both were pinned
  to the right, and the panel is tall enough to reach the bottom of the
  screen, so the progress bar and the cancel button were covered by it.
  The HUD moved to the left.
- **The number badge was hidden behind the reading panel.** It was pinned
  to the top-right corner of the image — the corner the panel covers. It
  moved to the left, and it now stays on screen while a tall page is
  being read instead of scrolling away with the image's top edge.
- **Removing a translation left the reading panel and the badge behind.**
  The panel kept listing a translation that was no longer on the page, and
  the badge still claimed the image was translated.
- **The panel's teaser could leave a stranded full stop.** The cut fell
  wherever the character count said, and the body sometimes began with a
  lone "。". The teaser now stops at a sentence mark.
- **The onboarding described the extension icon as "a cyan star".** It is
  a speech bubble that says "您好". The onboarding now describes what is
  actually on the toolbar, and says where to find the icon if it is not
  pinned there.

- **The release guard could deadlock the build it was supposed to protect.**
  `pnpm build` runs `check-release-consistency.mjs` both before and after Vite,
  and the script inferred its phase from whether `dist/` existed. A `dist/`
  left over from an earlier build was therefore judged as if it were the new
  one — so the fix that removes `content.js` from `web_accessible_resources`
  could never be applied: the guard failed on the stale artifact and blocked
  the very build that would have produced the fixed one. The same root cause
  had a quieter face: with no `dist/` at all, every artifact check took its
  "not built yet" branch and returned success, so a build that produced
  nothing was reported as a clean release. The phase is now stated explicitly
  (`--source-only` before the build), and the artifact pass insists the
  artifact exists.
- **The release freshness guard could not be satisfied on a working
  machine.** `src/shared/env-config.generated.ts` is regenerated from the
  developer's local `.env` on every build, so it tracked the machine rather
  than the repository: changing a key in `.env` changed the fingerprint, and
  `package-extension.mjs` then refused to package a bundle that was in fact
  current. The generated file is now excluded from the fingerprint. A private
  build's embedded credentials were never a property of the source tree, and
  `check-public-build.mjs` is what decides whether credentials may ship.
- **The reading panel swallowed clicks on the page.** Its host element was a
  320px-wide fixed rectangle with `pointer-events: auto`, so even with the
  panel collapsed to a header bar, an invisible block of that size sat over
  the page's right margin and ate clicks on whatever was underneath. The host
  is now a shrink-to-fit wrapper that does not capture clicks; only the
  panel's own pixels do, and a collapsed panel is as wide as its header.
- **The reading panel's placeholder never went away.** It read "translations
  will appear here" while the list of translations was right underneath it.
  It is now hidden once there is something to show, and comes back when the
  entries are cleared.
- **A cancelled translation was reported as a failed one.** Cancelling
  aborted the in-flight workers, and their throws were counted as failures —
  so the user was told "failed 12 images" about images that had never
  failed, and the "retry the failed images" button offered to re-translate
  them.
- **The floating HUD could not be dismissed.** An error card, or a
  completion card reporting failed images, stayed pinned to the bottom-right
  of the page for the rest of its life. Both now carry a close button.
- **The confirmation dialog was not actually modal.** It declared
  `aria-modal="true"` but let `Tab` walk out of it, so a keyboard user
  ended up focused on popup controls hidden behind the overlay. Focus is now
  trapped inside the dialog and returned to the button that opened it.
- **The overlay style only applied to the tab it was changed in.** The
  renderer picked the user's colours and font sizes up from a
  `chrome.storage.onChanged` event, which only reaches a tab that was
  already open when the setting changed. Every new page fell back to the
  built-in defaults, and a tab that had not translated anything yet threw
  the change away entirely. The renderer now reads the style it was given
  when it is created, so the setting follows the user from page to page.
- **The public packages carried a private model repository.** The public
  build blanked the provider keys but kept the Ollama model, which in the
  maintainer's own `.env` is a HuggingFace repository path. It shipped in
  the public zips v1.3.3 through v2.0.3, and it became the default model
  for every store user — a model they cannot pull, so their first
  connection test failed on a model that does not exist for them. The
  public build now leaves the whole Ollama entry empty (falling back to
  `http://localhost:11434` and `llava`), and the public-build guard
  rejects any model that names a repository instead of a model.
- **"Retry the failed images" re-translated the whole page.** The button
  sent the force-retranslate message, which clears every image on the page
  and re-requests all of them, ignoring the cache — so a page with three
  failures was billed for every image on it. The retry now re-runs only the
  images that actually failed, the button says how many those are, and the
  confirmation names the cost.
- **The popup could grow past Chrome's height limit.** Expanding the
  reading settings made the popup 708px tall against a 600px ceiling, and
  the buttons at the bottom were cut off with no way to scroll to them. The
  popup now scrolls.
- **Four popup buttons failed silently.** Translation, retry, clear and
  cancel let their errors escape, so a request that never reached the page
  looked exactly like a request that did. They now report what went wrong.
- **The result of a translation disappeared after two seconds.** The
  success and failure counts, the reason for the failures and the retry
  button were wiped before the user had read them. They stay until the next
  run.
- **The primary button and the switch failed WCAG AA.** White on
  `cyan-600` is 3.68:1 — and 2.43:1 while hovered — against the 4.5:1 that
  WCAG 1.4.3 asks for, and the unchecked switch was at 1.32:1, which made
  it look like a smudge rather than a control. The button is now `cyan-700`
  with a darker hover, and the switch's off state is a mid grey that can be
  told apart from both the card and the knob.
- **The vertical-text switch did nothing.** The setting was copied into the
  renderer's style and then never read, so a user who turned it on for
  Japanese manga got the same horizontal layout as everyone else — the one
  switch in the settings that changed nothing at all. Vertical text is now
  laid out as columns: the text runs down the height of the overlay and the
  columns stack across the width, the way the page it replaces is read.
- **The onboarding wizard switched the extension off when you dismissed
  it.** Pressing `Esc` (or "later") turned the extension off, so a user who
  had already configured and enabled it lost their settings without being
  told. Dismissing the wizard no longer touches the on/off switch.
- **The provider was named by its protocol, not by its service.** The popup
  called the OpenAI-compatible slot "cloud API" while the header next to it
  named the service the user is actually billed by. Both now name the
  service.
- **Protocol payloads were shown to the reader as if they were
  explanations.** An unclassified error came out as "unknown error: HTTP 500
  {"error":...}", which reads like a log line rather than something a
  person can act on. Our own messages still come through; provider
  payloads now go to the console.
- **Two tabs translating at the same time made the token count too low.**
  Every extension context keeps its own copy of the usage history, and the
  last one to write replaced the whole list. Two tabs translating at once
  therefore erased each other's entries, and the monthly total reported
  fewer tokens than the user had actually been billed for. Writes now merge
  into the stored history instead of replacing it, and a deletion in one
  tab is no longer undone by a stale write from another.
- **The on-page HUD failed WCAG AA on its error card.** The explanation
  text sat at 2.83:1 against the card, and the close button at 3.08:1 with
  a 22×22px hit area. The text is now 4.87:1, the button 4.53:1 with a
  32×32px target, and the same pass fixed the muted subtitle, the action
  buttons, the progress bar and the message line.
- **The reading panel's grey text failed WCAG AA.** The empty-state and
  per-entry messages sat at 3.22:1 on the panel's dark surface. They are
  now 5.97:1.
- **The reading panel repeated the first line of every entry.** The
  preview line and the body both started at the same sentence, and the
  preview was cut at 36 characters — more than the panel can show, so the
  two did not even line up. The preview is now cut to what fits and the
  body picks up where the preview stopped, so the text reads once and
  nothing is lost.
- **The focus ring was cyan everywhere except on the page.** The reading
  anchors used a yellow ring, the only other focus colour in the
  extension. It is now the same cyan as the rest.
- **The store listing promised things the extension does not do.** The
  short description said the artwork was preserved, the listing promised
  an "automatic stitching" of long images, and the privacy policy said
  the OCR fallback could be turned on by hand — none of which is true:
  the overlay covers the text bubble it replaces, the long-image
  pipeline tiles and maps coordinates back without producing an image,
  and the OCR fallback is chosen by the provider, not by a setting. The
  wording now matches the code, and the real capabilities that were
  missing from the listing — translating a single image from the
  context menu, the keyboard shortcuts, the reading panel — are in it.
- **The privacy policy did not name the default provider.** The listing
  and the review notes both said the extension ships pointed at
  MiniMax, while the third-party list in the privacy policy did not
  mention it. A reviewer comparing the two documents would have found
  the contradiction. The policy now names it.
- **The reading panel listed the bubbles in the order the model noticed
  them.** The vision model returns the speech bubbles in whatever order it
  saw them, which is not the order a reader reads them. A page with six
  bubbles showed them shuffled: the reader had to hunt for the sentence
  that continued the one above. The bubbles are now sorted into reading
  order — top to bottom and left to right, or right to left for vertical
  manga.
- **The reading panel renumbered itself at the end of every batch.** The
  entries were inserted in completion order and only re-sorted into
  reading order once the run finished, so a reader working through the
  list while it was still running had the entries jump to new numbers
  under their finger, and the image badges changed with them. Each entry
  now goes to the position it belongs to the moment it arrives, and the
  numbers never move again.
- **The panel's own ✕ button did nothing.** It asked the host to take the
  panel off the page, but nothing was listening, so the button appeared
  to work and left the panel exactly where it was. The panel is now
  really hidden, and the popup's button follows the change.
- **Deleting a translation from the image left it in the panel and on the
  badge.** The ✕ on the overlay removed the overlay only. The reading
  panel still listed the sentence, and the badge still said the image
  was translated — three views of the same page telling three different
  stories.
- **The popup never said that a page was translating itself.** Three
  switches decide whether new images are translated without being asked
  for, but the page arms itself on a fourth condition the popup could
  not see: the user translating the page by hand. The result was a page
  translating and billing with every switch in the popup reading "off".
  The page now reports whether it is armed, and the popup says so in
  plain words, with a button to stop it.
- **Turning the extension off did not stop the requests already on their
  way.** The popup promised "关闭后不会请求任何模型", but a batch that was
  already running kept sending images to the provider after the switch was
  flipped, so the user watched the bill grow after turning everything off.
  The run is now stopped at the next image boundary, every image asks the
  switch once more before it is sent, and the popup says plainly that the
  requests already sent cannot be taken back.
- **A failed image was reported as "skipped".** The "skipped" count mixed
  two different things: images that are too small or badly placed and will
  never be translated, and images that were already translated and cost
  nothing this time. A user could not tell which was which, so the two
  are counted and reported separately.

### Added

- **Every promise in the store documents is checked against the code.**
  `docs/store-claims.md` records each promise with the code that backs
  it, and `scripts/check-store-claims.mjs` fails the build in both
  directions: the code behind a promise must still exist, and the
  documents must still make the promise. Renaming a symbol or quietly
  rewording a document now breaks the build instead of reaching the
  store review.


- **"Translate this image" now works.** The context menu item sent its
  message to a content script that had no handler for it, so the menu entry
  did nothing at all. The content script now resolves the URL back to the
  image on the page — matching the resolved URL, then the URL without its
  query string, then the file name — and translates that one image, without
  touching or billing for the rest of the page.
- **A keyboard shortcut toggles the reading panel.** The command was
  declared in the manifest and dispatched by the service worker, but no
  content script received it. The panel can now be hidden entirely (not just
  collapsed), and it is created on demand, so the shortcut works before the
  first translation.
- **The popup can now refresh the page for you.** When a page was opened
  before the extension was installed, the popup said "please refresh the
  page and try again" and left the user to work out which key to press.
  There is a button now.
- **The popup says whether the page is translating itself, and can stop
  it.** The reading settings now carry one line that answers the only
  question that matters about auto-translation: is this page spending my
  money on its own? When the answer is yes, the line says so in plain
  words and offers a button that stops it — either for this page only, or
  for the whole site if the site is on the auto-translate list.
- `LICENSE` (MIT), `CODE_OF_CONDUCT.md` and `SECURITY.md`.
- GitHub issue templates for bug reports, feature requests and provider
  connection problems, plus a pull request template.
- CI runs on `ubuntu-latest` and `macos-latest` against Node 20 and 22.
- CI now produces the uploadable release package (`release/*.zip` plus its
  SHA-256) on tag pushes, not just on `main` pushes.

### Changed

- **The privacy disclosure now matches what the extension actually does.** The
  store listing, the review notes and the privacy policy said the extension
  "collects no user data" as an unqualified statement, while the extension
  sends the comic images it translates to the provider the user configured.
  That is a transfer of website content to a third party, and the Chrome Web
  Store data-usage disclosure has to say so. All three documents now state
  that the developer collects, receives and stores nothing, and that the
  website content goes to the provider the user chose, under that provider's
  own policy. `docs/store-listing-zh.md` carries the disclosure table to copy
  into the store form.
- **The store listing no longer promises a text-eraser feature.** The listing
  advertised "文字擦除：可用识别结果遮盖原文". There is no such feature: the
  renderer draws an opaque rectangle over the bubble and places the
  translation on it. The listing now describes that.
- **The review notes no longer ask the reviewer to open the test page over
  `file://`.** The background worker's image fetch refuses any protocol other
  than `http`/`https`, and Chrome does not inject content scripts into
  `file://` pages by default, so the reviewer would have concluded the
  extension was broken. The notes now use `python3 -m http.server` and
  mention the "Allow access to file URLs" toggle as an alternative.
- **The extension has one theme, and it is the dark one.** The theme
  provider accepted `light` and `system`, but every surface in the popup and
  the options page is painted with hard-coded dark colours while the switch
  and the slider read the semantic CSS variables — so a light theme produced
  a half-black, half-white page with an invisible switch. Rather than ship
  half of a design that does not exist, the light branch is gone: the
  palette now lives on `:root` (so the first paint is dark instead of
  flashing white), the native scrollbars and form controls follow
  `color-scheme: dark`, and the focus ring is one colour everywhere.

### Removed

- **The `server/` Python backend is gone.** It was frozen at v0.7.0 and
  scheduled for removal in v1.0; nothing in the extension has referenced it
  since. It was a second, parallel implementation of the same product (its
  own cache store, its own provider clients, its own OCR pipeline), which
  meant every change to the extension's translation pipeline had to be
  reasoned about twice — and twice it was not, which is how the two drifted
  apart. A local copy of the credentials it used is at
  `~/Code/Demos/chrome-plugin-manga-translator-server.env.bak`; the Python
  source is in the git history if it is ever needed again.
- **The ManhwaRead site adapter.** `src/content/site-adapters.ts` carried a
  per-site adapter for one comic site, but the adapter was never passed to
  any of the three `isTranslatableImage` call sites, so the code it guarded
  never ran. The generic path already handles lazy-loaded images through
  `currentSrc`, `data-src` and `srcset`, which is what every site actually
  needs.
- **~100 exports that nothing imported.** Every symbol that had no importer
  outside its own module was either deleted or un-exported, depending on
  whether it was still used inside its own file. The visible symptom was
  the theme provider: it exported a `useTheme` hook and a React context
  that no component ever read, so the theme was written to the document and
  then thrown away.
- **Two configuration fields that only ever held one value.** `readingMode`
  and `renderMode` were configurable, but `readingMode` had exactly one
  value (`panel`) and the `anchors-only` half of `renderMode` was never
  implemented. The translation cache key keeps both slots as constants so
  that removing them does not invalidate every user's cached translations.

### Fixed

- **The popup and the content script no longer keep separate copies of the
  same message protocol.** The popup had its own copy of the
  popup-to-content message union, and it had already drifted: it was
  missing `TRANSLATE_SINGLE_IMAGE`, which the content script handled. The
  protocol, the page-state shape and the list of supported page URLs now
  live in `@/shared/runtime-contracts` and `@/shared/app-config`, so the
  compiler — not a comment — keeps the three sides in agreement.
- **A third local provider would have been treated as needing an API key.**
  The config store hard-coded the list of keyless local providers
  (`ollama`, `lm-studio`) in a second place, away from the provider
  definitions it was meant to mirror. The store now asks the provider
  module, so adding a local provider cannot silently break it.

## [2.0.3] - 2026-10-08

Submission-blocking metadata fix found during the Chrome Web Store package audit.

### Fixed

- **The manifest description was 40 characters over Chrome's limit.** Chrome
  documents `description` as maximum 132 characters and lists it under "Keys
  required by Chrome Web Store"; it had shipped at 172 since v0.3.3 without
  anything objecting because no check ever counted them. Rewritten to 118
  characters, keeping the two things that distinguish this extension: in-place
  rendering, and preserving the original artwork.

### Added

- `check-release-consistency.mjs` now validates Chrome Web Store field limits
  (`name` <= 45, `description` <= 132) and fails the build. This class of defect
  now surfaces locally and in CI instead of at upload time.


## [2.0.2] - 2026-10-08

Store-readiness release. No user-facing behaviour changes.

### Removed

- **The unused `activeTab` permission.** Nothing in the extension referenced
  it: the content script is injected through `host_permissions`, and the popup
  reads tab metadata with `chrome.tabs.query`, which does not require it. An
  undeclared purpose permission is an invitation for a reviewer to ask what it
  is for, so it is gone rather than defended.

### Fixed

- **Packaging could ship a stale ZIP.** A release artifact built before two
  later bug-fix commits sat in `release/` looking upload-ready, with a
  matching `.sha256` that made it look verified. `package-extension.mjs` now
  refuses to package a `dist/` whose contents do not match the source tree,
  compared by content fingerprint rather than mtime (mtimes lie: a `touch`,
  a `git checkout`, or a clock skew will both hide a stale build and block a
  good one — an earlier mtime-based attempt at this check managed both).
- **`.DS_Store` was packaged into the artifact.** macOS regenerates it in
  `dist/` on most builds and `zip -qr` swept it in. It is now excluded.


## [2.0.1] - 2026-10-06

### Fixed

- **Publishing workflow.** CI now runs for `v*` tag pushes so a release tag is
  built and artifact-scanned before upload, instead of only being created
  locally.

A full audit of the 2.0.0 reliability work. Every fix below is paired with a
test that fails without it, and the ones that changed behaviour were confirmed
by mutation rather than by reading.

### Fixed

- **The retry button never retried.** `TranslateImageJobRequest` carried
  `forceRefresh` all the way to the worker, but the job queue collapsed on
  `pageKey` without reading it, so a retry on an image whose job was still in
  flight resolved to the very result it was meant to discard.
- **One corrupt setting discarded all the others.** `mergeProvider` called
  `.trim()` straight on stored values, so a hand-edited `apiKey: 123` threw
  inside zustand's `merge` and aborted hydration for the whole snapshot —
  language, concurrency and the enabled flag silently reverted to defaults.
- **Art-only webtoon strips were billed twice.** An empty tiled result was
  reported as a pipeline failure and fell through to a second, full-image
  request that could only return the same nothing.
- **One click armed auto-translation for the life of the tab.** The observer
  re-entered `translatePage` on every batch of new images with no bound, each
  time rebuilding the translator and re-paying. Follow-up runs now draw from a
  budget that an explicit request refills.
- **The allowlist was broader than it looked.** Ports were stripped, so
  `localhost:8080` also authorised `localhost:22`; `*.com` passed validation and
  matched every .com site on the internet. The popup switch also compared hosts
  with a plain `includes`, so a `*.example.com` entry showed as off while the
  worker was actively translating the page, and switching it off removed nothing.
- **Overlay re-layout ran on every resize event.** Each pass re-ran collision
  resolution with per-character text measurement, so drag-resizing a long
  chapter was a measurement storm per event; it now coalesces to one frame.
- **A disposed renderer was handed back out.** `getRenderer()` cached the
  instance but `dispose()` never cleared the cache, so any page that
  re-initialised after teardown — a bfcache restore, or an error path followed by
  another translate — got a renderer with no `ResizeObserver` and no resize
  listener, and overlays quietly stopped following the art.
- **The worker's own claims were wrong.** `chrome.alarms` does not hold a worker
  open — it schedules wake-ups for one already restarted — and the documented
  minimum period is 0.5 minutes, so the authored 0.34 was clamped and the "~20s"
  it described never happened. The period is now 0.5 and the comment says what
  actually keeps in-flight jobs reachable.

### Security

- **Vestigial `web_accessible_resources` pruned — and the prune itself fixed.**
  The bundler listed the content script's chunks as web-accessible before they
  were inlined; after inlining, `content.js` referenced none of them but the
  declarations stayed, leaving the key-obfuscation chunk, the config store and
  the React vendor readable by any page. Pruning them the first way was
  wrong and shipping-blocking: the content script Chrome registers is a CRXJS
  loader that does `import(chrome.runtime.getURL('content.js'))`, so dropping
  `content.js` made the extension fail to start on every page — silently, because
  the loader swallows the rejection into `console.error`. The rule is now
  "keep what the source declares plus whatever a built file resolves through
  `getURL()`", and `pnpm release:check` fails if a runtime-loaded path is ever
  missing again. `content.js` is retained; the seven vestigial chunks are not.
- **An explicit `content_security_policy`** is declared; previously there was
  none at all.
- **Plaintext base URLs are warned about.** The API key travels as a Bearer
  header, so typing `http://api.example.com` sent the credential in the clear
  with nothing saying so. https and loopback http (Ollama, LM Studio) stay
  unaffected.
- The unreachable `JOB_QUERY_STATUS` message branch is removed.

### Fixed

- **A partially-failed tiled run reported success and stopped retrying.** The
  first cut of the double-billing fix counted "not null" as answered, but
  `processInParallel` writes `undefined` for slots it never ran, and a
  `translateTile` that throws returns `null`. So three failed tiles plus one
  honest empty answer returned `success: true` with zero areas: the full-image
  fallback was skipped, three quarters of the chapter was never translated, the
  image was marked processed so it was not retried, and the user saw a blank page
  with no error. Only a run where every tile answered may now be treated as
  "genuinely no text".
- **The content script kept a disposed renderer.** `cleanup()` called
  `renderer.dispose()` but left the module reference set, and
  `ensureServicesInitialized` only re-creates when it is null — so the next run
  on the same page got a renderer with no observer and no resize listener,
  exactly the symptom the dispose-clearing in `getRenderer()` was meant to
  remove. The reference is nulled on cleanup now.
- **A forced retry finishing first unmapped the job it replaced.** Dedup is now
  a per-key stack rather than a single slot, so a duplicate arriving while the
  original still runs collapses onto it instead of paying for a third request.
- **The popup could not create a port-scoped allowlist entry.** `hostFromUrl`
  returned the bare hostname, so a dev reader on `localhost:8080` stored
  `localhost` — which covers every port on the machine, the widening the port
  rules exist to prevent. Non-default ports are preserved.
- **Legacy allowlist entries were stuck.** `removeAutoTranslateHost` compared
  against `normalizeHostEntry(host)`, so once a rule tightened (a `*.com` the old
  normaliser accepted is now refused) the entry could be seen and offered for
  removal but never actually removed. Falls back to the raw value.

### Tests

- `background-auth.test.ts` added, covering the sender-authorisation boundary
  and the image proxy's sender scoping — including that an extension page is
  refused the fetch primitive and that a cross-origin non-image URL is not
  treated as a general fetch proxy. Verified by mutation: relaxing the sender
  check fails four of them.
- The new pipeline test pins the partial-failure case above; the dedup stack test
  fails without the stack fix.

### Changed

- **Privacy policy corrected.** It claimed the OCR language-model download was
  "the only network request the extension makes that is not directed at the
  vision provider" — false, the image proxy fetches arbitrary page CDNs on your
  behalf — described reversible XOR with a bundle-shipped salt as protection
  against other extensions, and said the OCR engine ships fully locally while
  the traineddata in fact comes from jsdelivr. All three now describe the code.
- **Coverage now counts the service worker.** Vitest 0.34 only scores files a
  test imported, so the worker, both app shells and all three UI primitives were
  *absent* rather than 0%, and an 81% pass hid 2147 untested lines including the
  entire sender-authorisation boundary. `background.ts` gained nine tests, the
  primitives gained their own, and `scripts/check-coverage-scope.mjs` now fails
  the build unless every `src/` file is in the report or explicitly exempted.
- **The build guard scripts are linted.** `eslint --ext` omitted `.mjs`, so every
  script that can fail a build was outside the gates; covering them immediately
  surfaced three dead `eslint-disable` directives and a rule violation.
- **Documented pre-PR gate matches CI.** AGENTS.md and README prescribed
  `pnpm lint && pnpm test:run`, which pass on a tree CI would reject.
- The worker no longer exposes `JOB_QUERY_STATUS`, which had a handler and types
  but no caller in any context.

### Tests

Five tests could not fail. `Font Size Calculation` re-implemented
`calculateFontSize` in its own body and asserted against that copy, so deleting
the production function changed nothing; it now imports the real one and is
verified to fail when the CJK width weighting is removed. Four more asserted
only a count, or a state sampled after the work had settled, or merely that
rendering did not throw.

### Removed

293 lines of code with no importer anywhere — including the selector hooks
AGENTS.md advertised as idiomatic, the translator singleton every caller
bypassed, and three friendly-error accessors.

## [2.0.0] - 2026-10-05

Reliability, security and build-integrity work.

### BREAKING

- **Automatic page translation is off by default and opt-in per site.** In
  1.3.x, turning the extension on translated every navigation in every tab. From
  2.0.0 a page is only translated unprompted when its host is on the new
  `autoTranslateHosts` allowlist (empty by default). Existing users who relied on
  automatic translation must re-add their manga/webtoon sites — from the popup
  ("auto translate this site") or the Options page. Manual translation (popup
  button, context menu) is unchanged and still works on any site. This is the
  reason for the major bump: it is a user-visible behaviour change.

### Security

- The `autoTranslateHosts` allowlist (see BREAKING) gates both auto-translate
  entry points — `tabs.onUpdated` and the content script's `READY` — through a
  single `shouldAutoTranslatePage(config, url)` check with boundary-aware host
  matching (`example.com` does not match `notexample.com`). Previously both paths
  fired on the master switch alone, with `<all_urls>` and no site control.
- **The background image proxy is no longer an open fetcher.** Requests are now
  sender-scoped (extension pages refused, cross-origin limited to image-shaped
  URLs), private address ranges are blocked (including CGNAT, `0.x`, `224+`,
  IPv4-mapped IPv6), credentials are omitted, and responses are bounded by
  timeout, `content-length` and a byte cap.
- **The public-build credential guard was inert.** Its regex looked for
  `apiKey:\s*"..."` while the generated file is JSON-shaped (`"apiKey": "..."`),
  so it matched nothing and always reported success. It now scans both the
  generated source and the emitted `dist/` bundle, at both the pre-build and
  post-build stages, and CI scans the artifact before upload.
- **The theme preference no longer syncs.** It was written to
  `chrome.storage.sync`, contradicting the privacy policy and re-introducing
  what the background worker deletes on startup. Now `storage.local`.
- `web_accessible_resources` no longer exposes `icons/*`; only the Tesseract
  worker files the content script actually loads remain.

### Fixed

- **Config storage feedback loop.** The persisted snapshot was compared to the
  full runtime store by key count (19 vs 42, the difference being action
  functions), so it always reported a change: every write re-triggered
  `onChanged`, which re-applied the snapshot, which wrote again — unbounded. It
  also pushed `obf:`-obfuscated API keys back into memory, so the provider layer
  sent garbage and every cloud call failed auth. Comparison is now by value over
  a shared `PERSISTED_CONFIG_FIELDS` whitelist, and snapshots are deobfuscated
  before being applied.
- **Stale echo reverting edits.** `persist` writes asynchronously, so an older
  write's `onChanged` could arrive after a newer edit and overwrite it — a typed
  API key silently became its previous value (reproduced at ~4 runs in 10).
  Self-writes are now recognised by payload and dropped.
- **Ollama / LM Studio endpoints were discarded.** `normalizeRuntimeAppConfig`
  read the stored Ollama settings and then dropped them via `void ollamaSource`,
  so anything typed in Settings was reverted on the next echo.
- **The Settings "test connection" button lied for cloud providers.** It called
  `validateConfig`, which only checks that a key is present and long enough, so
  a wrong base URL, revoked key or nonexistent model all reported success. A new
  optional `testConnection()` probes the endpoint (`/models`, falling back to a
  one-token chat completion) and reports auth, URL and model problems distinctly.
  `validateConfig` stays network-free because the content script's preflight runs
  under the page's CORS rules.
- **Overlays drifted on resize.** They were positioned from the image box
  captured at render time with no re-layout, so any window resize or responsive
  reflow left the text off the artwork (the reading anchors already repositioned;
  the overlays did not). A shared `ResizeObserver` plus a window-resize fallback
  now re-lays them out, and `dispose()` releases both.

### Changed

- **Content script bundle ~366 KB to ~127 KB.** `manualChunks` lumped React and
  ReactDOM together, and the post-build rebundler (not minifying) inlined all of
  ReactDOM into a bundle that uses no React. The two are separate chunks now and
  the rebundler minifies. A 200 KB budget is enforced by the build and CI.
- **MV3 service worker stays alive during long translations** via an
  `alarms`-based keepalive (only while translation is enabled), and the job map is
  capped at 500 terminal records instead of growing for the worker's lifetime.
- **Coverage threshold is real.** It was configured in the nested
  `coverage.thresholds.global` shape that Vitest 0.34 ignores, so the documented
  70% never applied. Moved to the top-level keys 0.34 reads, and CI runs
  `test:coverage`. Verified by setting an impossible limit and confirming the run
  fails.
- **Base64 encoding no longer uses `btoa` plus per-byte string concatenation**
  (quadratic on multi-megabyte strips, and unreliable under jsdom). A table
  encoder is pinned against Node's `Buffer` reference output in tests.
- **Tesseract language data no longer comes from `npm.elemecdn.com`**, an
  unofficial third-party mirror that contradicted the privacy policy and failed
  wherever that host is blocked. Leaving `langPath` unset uses the library's own
  canonical source. The non-SIMD core pair (unreachable, since an explicit
  `corePath` is passed) was removed, taking the OCR payload from 13.8 MB to
  6.6 MB; `minimum_chrome_version` is pinned to 110.
- **Quality gates are enforced.** `.husky/` had no hook files, so `lint-staged`
  never ran; a `pre-commit` hook now exists. `format:check` covers the whole
  repository, and CI runs format, lint, type-check, coverage, build, the size
  budget and a credential scan.

### Removed

- ~1500 lines of dead code (font-style-matcher, validation, provider-strategy,
  content/image-fetch, content/page-context, the empty `src/types/`, unused
  stores/services barrels, ten unused shadcn primitives) and their tests, which
  had tested the mocks rather than the code.
- 15 unused dependencies (13 Radix packages, zod, react-hook-form,
  @hookform/resolvers, framer-motion, tailwindcss-animate,
  class-variance-authority). `dependencies` went from 29 to 10.
- The fabricated per-token price table in `usage-store.ts`. It priced every
  `openai-compatible` endpoint at $0.005/$0.015 per 1K tokens — wrong for MiniMax,
  SiliconFlow, OpenRouter and any self-hosted endpoint — omitted `lm-studio`
  entirely, and was never rendered. Removed rather than shipped.
- `fix-typescript-errors.sh` (a `sed` script that rewrote source in place),
  `build.sh` (a broken duplicate of `pnpm build`), and the dead `resetRenderer()`
  singleton helper (which leaked its resize listeners).

### Documentation

- `AGENTS.md` described a different project: TanStack Query, React Hook Form,
  Zod, Framer Motion, `src/api/` and `src/hooks/`, none of which were ever
  installed or imported. Corrected, and `docs/architecture-notes.md` added to
  record the contracts that are easy to break (config round-trip, bundle budget,
  image-proxy gating, worker lifetime, OCR core selection).
- `ARCHITECTURE.md`, `README.md`, `CONTRIBUTING.md`, the privacy policy, the Web
  Store checklist and the `ROADMAP.md` performance budget were synced to the code.
  The deprecated `server/` directory's run scripts moved into `server/` so the
  extension's `scripts/` is extension-only, and its README states plainly that
  the extension has no references to it.
- CHANGELOG version dates that read `2026-XX-XX` were filled from git history,
  and the missing 1.3.1 / 1.3.2 entries added.

## [1.3.3] - 2026-09-13

### Fixed

- **Long-strip tiling regression**: the content script marked tall images as
  viewport crops, which bypassed the v1.2+ tiled pipeline and could leave the
  lower portions of a webtoon image permanently untranslated.
- **CORS tile cropping**: the background image-fetch fallback now applies the
  requested `cropRegion` before compression, so protected CDN images no longer
  send the entire strip for every tile.
- **Duplicate page runs**: `READY` and `tabs.onUpdated` can no longer start two
  page translations concurrently during initial page load.
- **Tiled usage accounting**: token usage from every tile attempt is recorded,
  including quality-gate retries.

### Added

- Runtime-editable provider API keys, Base URLs, and models.
- `pnpm build:public`, which strips provider keys from `.env` and verifies that
  the generated bundle contains no API keys.
- Release consistency check so `package.json` and `manifest.json` versions
  cannot silently drift.

### Changed

- **MiniMax-M3 fast mode**: Manga translation requests now explicitly disable
  thinking, use `reasoning_split`, and send M3's `max_completion_tokens` field.
  This avoids spending the completion budget on `<think>` output and materially
  reduces response latency.
- Version and release documentation now track v1.3.3.
- CI and Corepack use pnpm 12.4.1 with explicit trusted build scripts.

## [1.3.2] - 2026-08-23

### Fixed

- Tiled translation results are written to the translation cache again. A
  successful tiled run previously returned its result without caching it, so
  revisiting the same page re-billed every tile.

## [1.3.1] - 2026-08-23

### Changed

- Tile translation runs concurrently (cap 3) instead of sequentially. A long
  webtoon strip translated noticeably faster, bounded by the configured
  parallel limit.

## [1.3.0] - 2026-08-23

### Added

- **P1 — Auto-degradation chain**: if the full-image path reports success
  but yields zero translated areas (a "false success" where the VLM failed
  to read the image), the translator now automatically retries via the
  Tesseract hybrid pipeline (detect regions → translate crops). This is the
  last-mile fallback so a page never silently shows blank translations.
- **P1 — Korean OCR language**: Tesseract default languages now include
  `kor` (plus jpn/eng/chi_sim), so the hybrid fallback can actually read
  Korean webtoon text instead of blanking.
- **P2 — Korean-aware prompts**: the translation prompt and the `natural-zh`
  style instruction now handle Korean source text — 반말 → casual Chinese,
  -요/-습니다 → polite Chinese, and Korean webtoon slang (ㅋㅋ → 哈哈哈,
  ㅠㅠ → 呜呜). Also added an explicit anti-hallucination rule: never invent
  bubbles.
- **P2b — Token-truncation detection**: `parseVisionResponse` now detects
  JSON that was cut off mid-output (unbalanced braces/brackets) and throws
  a clear "response was cut off" error instead of a generic parse failure.
  Raised `MAX_TOKENS` from 2048 to 4096 so large fallback pages are less
  likely to hit the ceiling.

## [1.2.0] - 2026-08-23

### Added

- **Tiled (sliding-window) pipeline for long webtoon strips**: instead of
  downscaling an 800×10000px strip to a 3000px thumbnail (which shrinks
  dialogue into illegible smudges), long images are split into overlapping
  ~1152px tiles with 96px seams. Each tile is translated as a crisp,
  near-1:1 crop — small text stays legible, output stays under the token
  ceiling, and a single model failure no longer nukes the whole page.
  - New `cropRegion` option in `image-processor.ts` (`compressImage` /
    `processImage`) to slice the ORIGINAL image by pixel coordinates.
  - `translator.ts` now auto-tiles when `naturalHeight >= 2200` and
    aspect ratio `>= 2.2`. Tile results are mapped back to original image
    coordinates, merged, and overlap-deduplicated.
  - Tile quality gate: a tile that yields no text is retried once before
    being accepted; if every tile returns empty the caller falls back to
    the classic full-image path.
  - Tiled results do not write to the hash cache when the whole page
    produced nothing; cache key now includes `tiled-v1` so pre-tiled hash
    caches are invalidated on upgrade.

### Fixed

- **Korean-manhwa (webtoon) "sometimes can't translate"**: the root cause
  was the whole-strip downscale to 3000px + the 2048-token completion
  ceiling. Tiling addresses both: legible crops and per-tile token budgets.

## [1.1.0] - 2026-08-23

### Added

- **`.env`-injected provider credentials**: new build step
  `scripts/inject-env-config.mjs` reads MiniMax / OpenCode credentials from
  `.env` (project root, or up to 3 levels up, or `MT_ENV_FILE`) and emits the
  gitignored `src/shared/env-config.generated.ts`. Every `pnpm` script
  (`build`, `dev`, `test*`, `type-check`) runs the injector first.
- **Zero-config first-run**: the extension now ships with a pre-configured
  default backend — **MiniMax M3** (primary) with **OpenCode · DeepSeek V4
  Flash** (backup) — so personal installs need no manual API key / base URL /
  model setup.
- **Preset quick-switch in Options**: provider cards now include the two
  env-injected presets, plus the existing OpenAI / SiliconFlow / OpenRouter
  presets. Clicking a preset fills base URL + model + API key in one click.
- **Onboarding simplified to 2 steps**: removed the provider picker (default
  is baked in); step 1 shows the configured default backend and step 2
  confirms + enables.

### Security

- API keys live **only** in the user's `.env` (gitignored). The generated
  `env-config.generated.ts` absorbs them at build time into `dist/` but is
  itself gitignored — the keys never enter the source tree or git history.
- Chrome Web Store publish credentials (CLIENT_ID / SECRET / REFRESH_TOKEN /
  ITEM_ID) from the user's `.env` are intentionally **NOT** injected anywhere.
  Those must never be compiled into the extension or committed.

### Changed

- `pnpm-workspace.yaml`: switched `ignoredBuiltDependencies` →
  `onlyBuiltDependencies` (pnpm 11 strict-by-default policy).

## [1.0.0] - 2026-08-23

The first stable release of Manga Translator. Four phases of focused work
that took the project from "working but unpositioned" to "focused,
ethically guarded, OSS-ready".

### Headline

- Ships with `enabled=false` by default. Users must complete the onboarding
  modal before any translation runs. Closes the silent-billing risk.
- Reading-mode side panel + numbered image anchors (the differentiator).
- Errors are repair menus, not complaints. Copy-the-shell-snippet buttons
  for the common Ollama / model / CORS issues.
- English-first docs, frozen legacy backend, 3500+ lines of dead code removed.

### Stability

- `type-check`: 0 errors
- `lint:strict`: 0 warnings, 0 errors
- `vitest`: 302 tests pass (was 278 at v0.3.4; +24 new tests for onboarding,
  reading panel, anchors, HUD staged progress, copy-command actions)
- `vite build`: clean production build, content bundle ~332 KB unminified,
  ~27 KB gzipped

### Migration from v0.3.x

- v0.3.x → v1.0.0: existing users are NOT re-prompted through onboarding
  (v2 → v3 persisted-config migration sets `onboardingCompleted=true`
  automatically). They get the new reading panel + improved error UX
  immediately on upgrade.
- `server/` Python backend is no longer maintained. Users with that path
  configured should switch to `OpenAI-compatible` or `Ollama` in Settings
  → Backend. The direct paths cover every case.

## [0.7.0] - 2026-08-23

### Added

- **English-first README**: international positioning with quick start,
  backend comparison table, and project structure overview.
- **`ARCHITECTURE.md`**: contexts diagram, message protocol, translation
  pipeline, state layout, reading-mode internals, error contract,
  privacy/security notes.
- **`CONTRIBUTING.md`**: code layout, dev setup, conventions, "how to add a
  new provider / error code / UI component", and explicit anti-patterns.
- **`ROADMAP.md`**: 90-day plan, what we are NOT doing, open questions,
  performance budget.

### Deprecated

- **`server/` directory frozen**: the Python OCR-first backend is no longer
  maintained. The plugin's `full-image-vlm` pipeline handles all the cases
  this server used to handle. The server directory will be removed in v1.0.
  See `server/README.md` for the deprecation notice and migration guidance.

## [0.6.0] - 2026-08-23

### Added

- **Copy-command actions carry the runnable command**
  (`src/utils/error-handler.ts`): `ErrorAction` now has an optional
  `command` field separate from `suggestion`. `copy-command` buttons copy
  the command, not the human-readable explanation. Wired to:
  - `OLLAMA_NOT_RUNNING`     -> `ollama serve`
  - `OLLAMA_ORIGIN_NOT_ALLOWED` -> `OLLAMA_ORIGINS=chrome-extension://* ollama serve`
  - `MODEL_NOT_FOUND`        -> `ollama pull <model>` (model name substituted
    at render time from the active provider's config)
  - `CONNECTION_REFUSED`     -> `curl -v http://localhost:11434/api/tags`
- **Staged HUD progress**: distinct `scanning` state with candidate
  count + `translating` phase indicator ('translating' | 'rendering').
- **Cache-hit visibility**: HUD `complete` state now shows how many
  translations came from the cache (`其中 N 张来自缓存`).
- **Filtered-image reporting**: HUD `complete` state reports how many
  images on the page were skipped due to size / position / duplication
  (`已跳过 N 张（尺寸/位置不匹配）`).

### Changed

- **`processSingleImage`** (`src/content/content.ts`): now accepts an
  optional `onCacheHit` callback so the calling site can count cache hits.
- **`ContentState.scanning`**: gains `candidateCount?: number` so the
  scan-stage HUD can tell the user how many images will be translated.
- **`ContentState.translating`**: gains `phase?: 'translating' | 'rendering'`
  so future phases (e.g. post-processing) can be surfaced.
- **`ContentState.complete`**: gains `skippedCount?: number` so the HUD
  can report filtering without re-scanning.
- **`scanImages()`** (new internal helper): returns total / filter-skipped /
  duplicate-skipped / translatable counts so callers don't need to redo
  the pass.

## [0.5.0] - 2026-08-23

### Added

- **Reading mode side panel** (`src/content/reading-panel.ts`): right-side
  floating panel that lists every translated image in reading order. Each
  entry shows the image's 1-based index, a preview of the first translated
  bubble, and the full list of translations when the image has 2+ bubbles.
  Click an entry to scroll the matching image into view + flash highlight
  it for 1.2s. Collapsible header. Auto-resets with `clearAll`.
- **Numbered image anchors** (`src/content/reading-anchors.ts`): a small
  cyan badge anchored at the top-right of every translated image. Clicking
  a badge dispatches `reading-anchor-click`, which scrolls the matching
  panel entry into view + flashes it. Repositioned on scroll and resize.

### Changed

- **Content script integration** (`src/content/content.ts`): after a
  successful single-image translation, `processSingleImage` now upserts
  into the panel and anchors in addition to rendering overlays. `clearAll`
  resets both. The panel and anchors are lazily created on first
  translation and reused for the lifetime of the page.

## [0.4.0] - 2026-08-23

### Added (in progress)

- **First-run onboarding modal** (`src/components/Onboarding/OnboardingApp.tsx`):
  a 3-step modal that appears in the Options page when
  `onboardingCompleted === false`. Steps: welcome + data-flow disclosure →
  provider picker (OpenAI-compatible / Ollama / LM Studio) → ready + finish.
  Keyboard support: `Enter` advances, `Escape` skips. The `Skip` / `Escape`
  path marks onboarding as completed without enabling translation, so users
  who want to configure later are not pestered again.
- **`onboardingCompleted` config flag** (`RuntimeAppConfig`): persisted via
  the existing `chrome.storage.local` adapter and partialised in the Zustand
  store. Defaults to `false` for new installs.
- **`setOnboardingCompleted` store action** (`config-v2.ts`): imperative
  setter for the onboarding flow.

### Changed (in progress)

- **Product positioning in README**: extended usage section to cover the
  3-step onboarding; updated Provider list to include LM Studio alongside
  OpenAI-compatible and Ollama.
- **Persisted config version** (`config-v2.ts`): bumped from `2` to `3`.
  v2 → v3 migration marks `onboardingCompleted: true` for existing users so
  they are not re-prompted after upgrade. New installs (no persisted state)
  see the modal as designed.

### Removed

- **Redundant "First-time usage guide" panel** in OptionsApp. The inline
  quick-pick panel duplicated the new onboarding step 2 (provider picker)
  and conflicted with it. The onboarding modal is now the single, consistent
  entry path for new users.
- **Dead UI components** (~2459 lines) removed from `src/components/ui/`:
  `accessibility`, `animated-container`, `dropdown-menu`, `feedback`,
  `layout`, `navigation`, `radio-group`, `select`, `spinner`, `tabs`,
  `textarea`. None of these had any importers anywhere in `src/`; they
  were speculative library code shipped as "亮但不亮" UI surface area.
- **Dead utility modules** (~1051 lines) removed from `src/utils/`:
  `batch-translation-manager`, `manga-translation-prompt`,
  `ocr-provider-selector`. None had any importers.

### Security & ethics

- The extension now ships with `enabled=false` and `onboardingCompleted=false`.
  Until the user finishes the onboarding (or explicitly skips), the extension
  will not run any VLM translation and the user will not be billed. This
  closes the prior gap where a fresh install could start charging API costs
  before the user understood what they had just installed.

## [0.3.4] - 2026-06-01

### Added

- **CI pipeline** (`.github/workflows/ci.yml`): every push to `main` and every
  PR runs `pnpm install --frozen-lockfile`, `pnpm lint:strict`,
  `pnpm type-check`, `pnpm test:run`, and `pnpm build` with a pnpm cache.
  Main-branch runs upload the built `dist/` as a 7-day artifact for
  manual smoke-testing.
- **README product positioning**: replaced the "two direct paths" intro
  with a section that names the target user, the unsuitable use cases,
  and the default translation pipeline (`full-image-vlm`).
- **CHANGELOG.md**: this file. Future releases document here.

### Changed

- **Cleaned 35 pre-existing lint warnings** so the CI gate can run
  `lint:strict` (`--max-warnings 0`). Any new warning now fails CI.
  - `scripts/copy-tesseract.js`: 3 `console.log` calls annotated
    with `eslint-disable` (intentional build-script output).
  - `src/background/{background,job-queue}.ts`: 2 non-null assertions
    replaced with explicit checks.
  - `src/content/config-snapshot.ts`: `Record<string, any>` →
    `Record<string, unknown>`, with property accesses switched to
    bracket notation to satisfy `noPropertyAccessFromIndexSignature`.
  - `src/content/site-adapters.test.ts`: 1 non-null assertion
    replaced with a null-check + cast.
  - `src/services/text-detector.ts`: `Record<string, any>` → `unknown`,
    the one remaining `any` cast localised with `eslint-disable`.
  - `src/services/image-processor.test.ts`: introduced a
    `MockCanvasContext` helper type and `buildCanvasContextMock()`
    factory; 21 `as any` casts on Image / canvas mocks became
    `as unknown as typeof Image` / `as unknown as CanvasRenderingContext2D`.
- **CI gate upgraded**: workflow now runs `pnpm lint:strict` (was
  `pnpm lint`). With zero warnings in the tree, the strict gate is
  the new floor.

### Removed

- **`coverage/` from git**: 671 generated test-coverage files removed
  via `git rm --cached`; `coverage/` is now in `.gitignore`.
  Coverage can still be generated locally via `pnpm test:coverage`
  for inspection.

## [0.3.3] - 2026-06-01

### Fixed (P0 — must-have for v0.3.1 → v0.3.3 upgrade path)

- **CORS fallback image proxy** (`image-processor.ts:317`): was reading the legacy
  `response.base64` field while the background handler now returns `imageBase64`,
  causing every CORS-tainted image to fail with a misleading "Unknown error".
  Tests have been updated and a regression-guard test added.
- **Zustand persist upgrade migration** (`config-v2.ts`): v0.3.1 users upgrading
  had their `providers` map silently replaced with the old shape
  (`{ openai, ollama }`), so `providers['openai-compatible']` and
  `providers['lm-studio']` were `undefined` and the Options / Popup UI threw
  `TypeError` on every render. Added `version: 2` + `migrate` + custom `merge`
  that rebuilds the three new provider entries from the legacy shape.
- **Background sender trust boundary** (`background.ts:198-208`): any content
  script running in any tab could call `getConfig` (receiving deobfuscated API
  keys) or `setConfig` (overwriting the configuration). Sensitive actions
  (`getConfig`, `setConfig`) now require `isExtensionOrigin`; job / fetch
  endpoints still accept content scripts.

### Fixed (high)

- **`preserveFormat` is no longer a dead default** (`image-processor.ts`):
  the field was advertised and defaulted to `true` but never read, so PNG
  images silently lost the alpha channel. Removed the field.
- **API key obfuscation field list** (`utils/crypto.ts`): `processAllApiKeys`
  only matched the literal field name `apiKey`, so a future provider field
  (e.g. `accessToken`) would bypass obfuscation. Now backed by a
  `SENSITIVE_KEYS` Set with a `registerSensitiveKey` extension hook.
- **Options UI copy and presets** (`OptionsApp.tsx`):
  - Subtitle updated from "two direct paths" to "three direct paths" to
    reflect the addition of LM Studio.
  - Removed the DeepSeek `deepseek-chat` API preset (text-only model, no
    Vision — UX trap).
- **LM Studio routing inconsistency** (`translation-transport.ts:104`):
  `resolveRequestedPath` was only branching on `'ollama'`, so LM Studio
  fell through to `plugin-direct` while `runtime-contracts.ts` routed it
  to `ollama-direct`. The two functions now agree.
- **LM Studio API key requirement** (`app-config.ts:250`): `allowApiKey: true`
  was inconsistent with Ollama and showed a useless API key input in the
  LM Studio card. Set to `false`.
- **Test coverage** (regression guards):
  - `translation-transport.test.ts`: +5 tests (explicit `requestedPath`,
    background-no-response, job-envelope flatten, pageKey fallback chain,
    lm-studio routing).
  - `content.test.ts`: +5 tests for the previously-untested `handleMessage`
    switch (`GET_STATE`, `CANCEL_TRANSLATION`, `CLEAR_ALL`, unknown type,
    `TRANSLATE_PAGE` keep-open semantics).
  - `provider-direct-client.test.ts`: +3 tests (happy-path `pipeline` value,
    unknown provider rejection, invalid style preset rejection).
  - `image-processor.test.ts`: regression guard that the old `base64` field
    is no longer accepted.

### Changed

- **Default `translationPipeline`** (`app-config.ts:101`): was
  `hybrid-regions` (requires Tesseract.js OCR), now `full-image-vlm` to
  match the documented default in `CLAUDE.md`. Most users never installed
  Tesseract, so the previous default silently disabled translation.
- **`pageKey` for translation jobs** (`translator.ts:308-320`): was set to
  `metadata.imageKey`, which collapsed every image on a page into a single
  job slot. Now derived from `pageUrl || window.location.href`. Background
  page-level dedup now works as designed.
- **Two-protocol background dispatcher** is now explicitly documented in
  `background.ts` and `CLAUDE.md`:
  - Action-based (`{ action, ... }`): legacy, used by image proxy and
    Popup/Options config read/write.
  - Type-based (`{ type: 'JOB_*', ... }`): new, used by translation
    transport with job-queue semantics.

### Added

- **CHANGELOG.md**: this file. Future releases will document here.
- **`.env` gitignore patterns** (`.gitignore`): `.env`, `*.env`, and
  `server/.env` are now ignored. Prevents accidental secret commits.

### Removed

- **`PROVIDER_INFO` constant** (`providers/index.ts`): exported but had zero
  importers; the Options and Popup UI ship their own per-provider display
  arrays. Replaced with a `ProviderDisplayInfo` type-only stub for future
  reuse.
- **`nvidia` legacy provider key** (`app-config.ts`, `config-v2.ts`): no
  provider implementation exists; it only added dead migration branches.
- **`product-readiness.ts` and its test**: pre-existing v0.3.2 deletion;
  the `file://` semantics it guarded were re-implemented inline. (See
  separate commit.)

## [0.3.2] - 2026-05-31

### Changed

- Consolidated direct provider flows: removed `claude`, `deepseek`,
  `siliconflow`, and `dashscope` providers; only `openai-compatible` and
  `ollama` remain. Added LM Studio as a third option.
- Replaced the ad-hoc `{ action: 'translateImage' }` message with a
  structured `JOB_TRANSLATE_IMAGE` job envelope using
  `src/shared/runtime-contracts.ts`.
- Removed the hover-to-select image translation mode; replaced with
  `FORCE_RETRANSLATE_PAGE`.
- Image processor: added `viewportCrop` and `shouldPreserveTallMangaPage`
  to handle very long manga pages without losing aspect ratio.
- Config store: added `autoContinueEnabled`, `renderMode`,
  `translationPipeline`, `overlayStyle`, `translationStylePreset`, and
  related setters.
- New `provider-direct-client.ts` for direct (non-server) provider calls.

[0.3.3]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.3.3
[0.3.2]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.3.2
[2.0.3]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v2.0.3
[2.0.2]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v2.0.2
[2.0.1]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v2.0.1
[2.0.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v2.0.0
[1.3.3]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v1.3.3
[1.3.2]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v1.3.2
[1.3.1]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v1.3.1
[1.3.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v1.3.0
[1.2.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v1.2.0
[1.1.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v1.1.0
[1.0.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v1.0.0
[0.7.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.7.0
[0.6.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.6.0
[0.5.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.5.0
[0.4.0]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.4.0
[0.3.4]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v0.3.4
