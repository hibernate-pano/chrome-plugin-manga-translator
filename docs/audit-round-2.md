# Round 2 audit — what survived round 1, and what was found next

Round 1 (`audit-round-1.md`) listed 26 findings across correctness, money, UX
and visual design. All of them were verified against the source before work
was dispatched, and the ones that were not real were rejected and recorded
there. This document is the second pass: what the round-1 fixes introduced or
left behind, and what a fresh look at the finished product found.

Severity: **P0** = loses money, breaks the product, or lies to the user;
**P1** = major friction or a visible defect; **P2** = polish.

---

## P1 — the store assets could not be regenerated

`scripts/capture-store-assets.mjs` creates the tab it records with
`Target.createTarget({ url: pageUrl })` and waits for the content script to
answer. On Chrome 156 that call creates the target but **does not navigate**:
the navigation history comes back empty, the local server never receives a
request, and the tab stays on `about:blank`.

The symptom pointed in exactly the wrong direction. The readiness probe waits
for `GET_STATE` to come back from the content script, and a content script
that is never injected into a page that does not exist never answers — so the
error said "the content script never answered", which reads as a broken
extension. Nothing in the product was broken; the recorder was.

Two changes:

- The tab is created blank and then navigated with `Page.navigate`, which
  does what the create call did not.
- The readiness probe races `chrome.tabs.sendMessage` against a timer. A
  message whose receiver never answers never settles, so the `await` would
  hang past the deadline and the failure would read as a timeout rather than
  as the thing that actually went wrong.

This is the difference between a store listing that can be refreshed and one
that can only be produced once, on the day it was first produced.

### and then the page could not be fetched at all

With the navigation fixed, the recorder still could not load the demo page.
On the machine this was developed on, every `http://` navigation to
`127.0.0.1` behaved the same way: Chrome opened the socket, sent **zero
bytes**, and never reported an error or a timeout. `file://` and `data:`
loaded in seven milliseconds. It was not the extension, not the content
script, and not the local server — the server logged the TCP connection and
then nothing.

The cause is the machine, not the product: it runs network extensions that
take over traffic (Clash Mi's service extension is sitting in "activated,
waiting for user"), and the request path through them does not complete. But
a tool that only works on a machine with an unremarkable network setup is a
tool that cannot be relied on, so the recorder stopped depending on the
network at all:

- The demo page is loaded over `file://`. It does not touch the network
  stack, so it cannot be intercepted.
- The temporary profile grants the extension "allow access to file URLs".
  Without it Chrome never injects the content script into a `file://` page,
  and the recorder would sit there waiting for a page that cannot exist.
- Chrome is started with `--allow-file-access-from-files`, without which the
  page cannot read the images beside it and the canvas stays tainted — the
  extension would get no pixels to send to the model.
- The extension id is derived from the path the way Chrome derives it,
  because the permission has to be in the profile before Chrome starts and
  the extension is not loaded yet at that point.

`--serve` keeps the old HTTP path for debugging, and `--forward` puts a
local relay in front of the model endpoint for machines whose Chrome cannot
reach it at all.

Two smaller things fell out of the same work:

- The trigger was awaited. The content script answers `TRANSLATE_PAGE` when
  the whole translation is over, so the recorder sat there for sixty
  seconds — through the entire translation — before the first frame was
  recorded. The trigger is a signal, not a result.
- The extension's own error was never surfaced: the recording showed a page
  of Japanese with a "translation failed" HUD, which is worse than no
  screenshot at all. The capture now reports the provider it used and the
  endpoint it was pointed at.

## P1 — the extension icon was illegible where it matters most

The manifest's toolbar icon is drawn by Chrome at 16 CSS pixels. The old icon
put two lines of kanji, a lightning bolt and a globe into that space, and at
16 pixels it collapsed into a black smudge with a blue patch on it — in the
one place the onboarding tells the user to look for the extension.

It also read 「你好」, while the onboarding told the user to look for a bubble
saying 「您好」. A user hunting the toolbar for a bubble that says 「您好」
would not find one.

The icon is redrawn: a solid speech bubble with a globe on its shoulder, and
from 32 pixels up a single character drawn as paths rather than as text, so
the icon does not depend on a font being installed on whoever regenerates it.
`scripts/make-icons.mjs` renders all six sizes from that one source.

## P1 — the provider badges broke into a column of characters

The Settings page's provider card carries three badges: 「当前使用中」,
「连接正常」 and 「文档」. Chinese breaks between any two characters, so a
badge one pixel too narrow stopped being a label and became

```
当
前
使
用
中
```

— one character per line, down the card. It reproduced at 420 pixels wide,
which is a window a user can easily have on a laptop. The badges now stay on
one line, and the row they sit in moves to its own line when the card is
narrow instead of squeezing them.

The same treatment went to the collapsed provider rows and to the popup's
provider name, where a hyphen in `OpenAI-compatible` was an equally easy
place to break.

## P2 — the changelog claimed a menu item that does not exist

The entry about the force-retranslate confirmation said the right-click menu
had been left unguarded. There is no force-retranslate item in the context
menu — it has exactly two entries, 「翻译当前页面」 and 「翻译这张图片」. The
guard was missing from the keyboard shortcut, and the entry now says so.
