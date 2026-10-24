# Round 3 audit — the expert panel, and what survived contact with the code

Round 1 (`audit-round-1.md`) and round 2 (`audit-round-2.md`) were reviews of
the product by hand. Round 3 was different: an expert panel was assembled and
each member was asked for the worst they could find, with file and line, and
told to walk the failure paths rather than trust the passing tests.

That produced more than a hundred candidate findings. This document records
what came out of them, because the interesting part is not the number but the
ratio: **roughly a third of the findings were already fixed by the time they
were reported**, and another third rested on a fact the code had settled
earlier. What survived is written up below — nineteen defects, three of them
P0, and every one of the three about the product telling the user the wrong
thing about money.

Severity: **P0** = loses money, breaks the product, or lies to the user;
**P1** = major friction or a visible defect; **P2** = polish.

> Round 4 took this round's diff and tried to break it. Two of the fixes
> here did not hold, and one of them was a P0 in the same function, one
> branch further down. See [round 4](audit-round-4.md).

---

## The panel

| Reviewer | Brief |
| --- | --- |
| architect | correctness and architecture |
| ux-director | interaction and truthfulness |
| visual-designer | visual system and accessibility |
| product-strategist | capability and direction |
| cred-audit | the credential boundary |
| audit-round-2-correctness | the money paths, second pass |
| audit-round-2-ux | the money paths in the UI, second pass |
| audit-money | billing and configuration |

Several findings were reported independently by two reviewers. The
force-retranslate cost estimate was reported three times, from three
directions, and it is the sharpest example of what the panel is for: three
reviewers looking at the same string found three different reasons it was
wrong.

## What the panel got wrong

This is the part worth keeping, because a review that never says "this is
wrong" is not a review.

- **A third of the findings were already fixed.** The visual designer
  reported that `--primary` was pure white, that `<summary>` had no focus
  ring, that there was no `prefers-reduced-motion`, and that the confirm
  dialog's focus restore was destroyed by a parent re-render. All four had
  been fixed in the same round the review was commissioned. The auditor had
  audited a tree that had already moved.
- **The credential gate was reported as a hole and was not one.** The
  architect reported that `sender.id === chrome.runtime.id` lets any content
  script read the plaintext key. By the time the finding was read, the gate
  had already been changed to one that only the extension's own pages pass,
  and the credential auditor's independent walk of the import graph found no
  path from the content script to any credential module.
- **The onboarding was reported as missing where the listing says it is.**
  The product strategist read the listing's 「在弹窗中点「开始设置」」 as
  "the wizard must appear in the popup". The popup has that button; it opens
  the settings page, where the wizard is. The promise was being kept.
- **The "capability gaps" list was mostly a list of things already built.**
  Export to PNG, provider presets, a diagnostics bundle, a version footer,
  keyboard shortcuts, original text in the reading panel, style prompts that
  respect the target language, quality and concurrency controls — all of
  these were reported as missing, and all of them existed in the tree.

The lesson is not that the panel was bad. It is that a review is only
worth as much as the verification that follows it, and that verification
has to be re-run against the tree that will actually ship.

---

## P0 — the product was telling the user the wrong thing about money

### The force-retranslate estimate counted images, and billed requests

`src/components/Popup/popup-state.ts` said 「对本页全部 N 张图片重新调用
Vision LLM 翻译（约 N 次计费调用）」. N was the number of images. A long
strip is tiled: `computeTiles` cuts anything taller than 2200 pixels into
1152-pixel pieces, and each piece is a separate request to the provider.
An 800×10625 vertical strip — one chapter of one site — is ten tiles and
ten billed calls, and the dialog said "about 1".

The word 「调用」 was doing two jobs in the same product. The usage panel
counted requests; the dialog counted images. A user who read 「8 次」 and
then watched the monthly counter jump by 48 had no way to reconcile them.

The number of images stays — that is what the review notes promise the
reviewer ("how many images will be re-requested") — and the tiling is now
stated separately, so the user can tell that a strip costs more requests
than it has pictures.

### The popup said a listed site would not auto-translate, and it did

`describeAutoTranslate` had a branch for "this site is on your list but
auto-continue is off", and it read 「本站已加入自动翻译名单，但「自动续翻」
是关的，所以不会自动翻译。」 — with a button that would turn auto-continue
on.

That was false, and the false part was expensive. The worker's
`shouldAutoTranslatePage` checks the master switch and the allowlist; it
reads `autoContinueEnabled` and does not use it. A listed site is
translated, whole page, on every navigation, whether or not auto-continue
is on. The user was told they were not being charged, and they were.

The two switches govern different things and the copy had merged them:
the allowlist is about *whether the page gets translated when it opens*,
auto-continue is about *whether images that appear later get translated
too*. The copy now says both, separately, and the button is 「关闭本站自动
翻译」 — which is the action that actually stops the spending. The old
button did not fix the problem; it opened another bill.

The settings page was already right, and `docs/store-listing-zh.md` had
promised 「不会出现开关都关着却仍在自动翻译的情况」 — a promise the popup
was breaking on the same screen the promise described.

### The worker checked the master switch once, at the queue

The worker checked the switch before enqueuing a job and never again. A
chapter sits in the queue for minutes — one job per tile, a vision model
that takes ten to thirty seconds each — and the user can turn the
extension off while it waits. The jobs kept starting.

The code above the check said it plainly: 「The background worker is the
last place before the request... 'off' has to mean off all the way down, or
the extension bills the user for a switch they turned off.」 The check is
now where the comment says it is.

---

## P1 — the numbers the user reads were not the numbers the extension knew

### A lazy-loaded comic page was told it was too small

`sizeUnknown` required `naturalWidth === 0` **and** `width === 0`. Any page
that sets a CSS width on its images — `width:100%`, which is most comic
readers — gives a not-yet-loaded image a layout width of 800 and a height
of 0. That is not "unknown size"; it is "unknown height", and the size
rule read the zero as "too small".

Forty real pages went into the skipped bucket. The popup said 「已跳过 37 张
（太小…）」, the pending counter stayed at zero, and the HUD never once said
"images are still loading". The user was told, in detail, that thirty-seven
pages would never be translated.

The fix looks at intrinsic size only. When one dimension is known and the
other is not, the known one is judged and the unknown one is not.

### The monthly bill stopped growing at 500

`MAX_RECORDS = 500` capped the detail records, and the monthly summary ran
on the capped array. 「本月 N 次 API 调用」 could therefore never exceed
500, and the token total was capped the same way. A week of webtoon reading
breaks that number.

The summary is now an accumulator that the record cap does not touch; the
detail list is still capped, because it is a log and not a bill.

### Failed, retried and abandoned requests were not billed to the user

The extension recorded a call only when the whole call succeeded. Three
cases billed the user and recorded nothing:

- A retry fired two requests and recorded one.
- A 200 whose body failed to parse cost the provider its tokens and cost
  the extension its record — the usage was read *after* the parse.
- A 30-second timeout meant the client gave up while the server finished
  and charged for it.

The distinction that matters: a 4xx is the provider refusing to charge, and
a 4xx is not recorded. A request that was delivered and then abandoned was
charged, and is recorded.

### The self-write guard could never fire

`rememberSelfWrite` copied the config fields and kept the **nested
objects by reference**, and `obfuscateAllApiKeys` rewrites the key in
place. So the remembered snapshot was obfuscated along with the original,
and the comparison against the de-obfuscated candidate never matched.

The guard exists for one reason, and the code says so: 「the user types an
API key, the hydration write's echo arrives a moment later carrying the
previous (empty) value, and the key silently reverts.」 It was dead code.

### The green light was not a light

The settings page showed 「连接正常」 next to a provider card. The check
behind it was `validateConfig()`, which for an OpenAI-compatible backend
means "the key is a non-empty string of at least twenty characters". A
revoked key, a wrong base URL and a model that does not exist all pass it.
The 「测试配置」 button next to it did a real probe, and reported the
truth — so the card contradicted itself.

### The count of failed images was not the count that would be re-billed

The popup quoted `failedCount`, the failures from the last run. What would
actually be re-billed is the set of images still marked failed, and the two
diverge exactly when a run is aborted: the images that were never reached
go back into the failed set without entering the count. Twenty images
failed on a bad key; the user fixed the key, retried, hit the same error on
the first image — and the button said "1".

---

## P2 — polish worth doing

- The HUD used blue where the product is cyan; its progress bar and retry
  button were the only blue things in a cyan interface.
- The HUD's cancel button was about 24×14 pixels, and it is the control a
  user reaches for to stop a translation that is spending money.
- The HUD's card had no border, so on a dark page it was a black rectangle
  on a black background, at 1.00:1.
- The confirm dialog let Tab walk out of it when focus was somewhere else.
- The slider's focus ring was 1 pixel, the only one in the extension.
- The reading panel's body text was 12 pixels, smaller than the popup's
  helper text.
- The onboarding had `aria-modal="true"` and no focus trap.
- Two lines of the onboarding were at 2.36:1 and 3.31:1 contrast.
- The API-key reveal button was a 16×16 target.
- The diagnostics bundle named an unrecognised endpoint by its hostname,
  which put a private gateway's address into a bug report the user was
  about to paste into a public issue.

---

## The product gap that was closed by writing

The one thing the panel found that no amount of reviewing would have found
was the listing's own asset table:

```
| 特色大图 | 1280×800 或 640×400 JPG/PNG | 需新制作，见下 |
| 截图     | 1280×800 或 640×400，建议 3~5 张 | 需新制作，见下 |
```

The screenshots had existed for weeks. The row above them had not been
touched since before they were made.

`scripts/build-promo-image.mjs` now composes the promo image from the two
screenshots with headless Chrome. It needs no model, no API key and no
network — only the local files — so the headline and the claims on it stay
current even on a machine that cannot re-take the screenshots, which is a
real condition on some hosts.

Headless Chrome on macOS writes the screenshot and then reports the display
link teardown as a non-zero exit. The script checks for the file instead of
the exit code, and renders to a scratch path before copying, so a run that
dies half-way cannot leave a truncated image where the listing expects a
finished one.
