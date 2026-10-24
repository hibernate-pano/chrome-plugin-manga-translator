# Changelog

All notable changes to the chrome-plugin-manga-translator are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **The HUD can get out of the way.** It is pinned to the bottom-left —
  the reading panel owns the right side and reaches the bottom of the
  screen — but on a reader that aligns its content to the left, that corner
  is the artwork, and the card sat on the picture for the whole run. It now
  folds down to a small pill with one click: the progress is still there,
  and the page is visible again.
- **A translation the model gave no box for is now counted, and the page
  says so.** The model finds a bubble, translates it, and then gives no
  coordinates for it — there is nowhere to draw that translation, so the
  page shows fewer bubbles than the model found, and the difference is
  still in the source language. The parser counted those, the worker
  carried the count back, and then nobody read it: the page said
  「翻译完成」 and the reader was left to assume they had missed a bubble
  themselves. The number now travels the whole way and lands in the
  sentence the reader actually reads — 「有 N 处文字没有翻出来（仍是原文）」.
- **The strip of crops is described as what it is.** When the page falls
  back to translating a stack of cropped text regions, the image it sends
  is not a comic page — it is a vertical pile of unrelated blocks. The
  prompt it got, however, was the page's own: 「merge the lines of one
  bubble into ONE item」. On a pile of unrelated blocks that instruction
  merges two different bubbles into one box, and the translation lands on
  one of them while the other keeps its Japanese. The strip now has its
  own prompt (one item per block, never across a block boundary), the
  blocks are separated by a visible rule so the model can see where one
  ends, and the answer is matched to a block by how much they overlap.
- **An answer with no box is dropped instead of being drawn in the
  corner.** A missing coordinate used to be read as zero, so a translation
  the model described but did not locate was drawn as a column of single
  characters at the smallest font size in the top-left corner of the
  artwork — over the picture, while the real bubble kept its Japanese, and
  the run was still recorded as a success. There is no such thing as a box
  at the origin: an answer without a usable box is dropped and counted as
  a bubble that did not come through.

- **The exported PNG breaks its lines the way the page breaks them.** The
  page hands the translation to the browser, which keeps a Latin word in one
  piece and never starts a line with a full stop; the export used a
  per-character estimate, so 「brown」 was cut in half across two lines and
  the PNG did not match the screen. The export now folds the text with the
  same rules the browser uses — a word stays whole, a Chinese character can
  break anywhere, a closing mark never opens a line — and the vertical
  layout got the same treatment, so a slanted Latin run stays in one column
  instead of being spread over several.
- **The export is a scaled copy of the screen, not a second layout.** The
  export re-ran the layout against the image's *pixel* size, so the font
  sizes it picked came from a different set of candidates than the page's
  and the bubbles came out a little bigger or smaller than the ones the
  reader was looking at. The export now lays the bubbles out at the size
  the page used and scales the result, so the PNG is the screen's layout,
  multiplied.
- **The export measured the text at one weight and drew it at another.**
  The page draws the translation at weight 500; the export measured at the
  default weight and drew at 500, so the lines were broken for a narrower
  font than the one they were painted with — a word could stick out of its
  bubble, and the PNG had a different number of lines from the screen. The
  weight now lives in one place, and the page, the measurement and the
  export all use it.
- **A Latin word in a vertical translation no longer bursts its bubble.**
  The browser rotates a Latin run 90° in vertical text, and the run takes
  the width it would have on one line. The export drew it upright, one
  letter per line-box, so the column was several times taller than the
  fold had planned for: the text was cut off, and the reader saw less in
  the PNG than on the page. The export now rotates the run the way the
  browser does and gives it the same width.
- **The refiner no longer walks onto the neighbouring bubble.** The guard
  that was supposed to catch it compared the *union* of the model's box and
  the ink with the model's box — and a union always contains the model box,
  so the ratio was always 1 and the guard could never fire. A box that
  landed next to a bubble could therefore grow over that bubble's original
  text, hiding it without putting a translation in its place. The guard now
  compares the ink with the model's box, and fires when the two are not
  about the same text.
- **Two bubbles that overlap on the page do not overlap in the export.** The
  page pushes overlapping bubbles apart; the export drew each one where it
  landed and let them cover each other, so the reader got two layers of
  text where the screen showed one. The export now resolves the collisions
  the same way, and the text is clipped to its bubble, exactly as the
  page's `overflow: hidden` clips it.
- **Two bubbles in the same place now get out of each other's way.** The
  collision resolver compared the centres of the two bubbles and moved both
  of them the same way when the centres were equal — which is what happens
  when the model reports the same bubble twice. They stayed stacked, and
  the resolver was doing nothing at all in the one case where it was most
  needed. The tie is now broken by position, so the two separate.
- **The usage history stops growing for no reason.** Every extension
  context counted its own calls, and each context wrote its own running
  total under its own id — but the id changed every time a context
  started, and the worker is torn down after half a minute of idle. The
  list grew by one entry per process start, month after month, and every
  single call rewrote all of them. The worker is now the only context that
  records usage (the page reports its cache hits to it), so there is one
  running total per month, and the months nobody reads any more are
  dropped.
- **The queue sorts by how urgent a job is.** The worker had a whole
  scheduling system — five priority classes, an insertion index, a rule
  that lends an extra slot to an urgent job — and every single job was
  filed under the same class, so none of it could ever change the order.
  The page now labels what it sends: the images the reader is looking at
  are 「visible now」, the ones further down the page are 「next up」, and
  the images the reader explicitly asked to retry are the most urgent of
  all. The queue's own machinery is unchanged; it finally has something to
  sort.
- **The content script stopped carrying the provider layer.** It asked one
  question — 「does this provider need an API key?」 — and the answer lived
  in `providers/base.ts`, next to the prompt builders and the response
  parsers. Importing it dragged all of that into the script that is
  injected into every page the user opens. The question now lives next to
  the list of local providers, where the money wording already lived, and
  the content script no longer imports the provider layer at all. The
  bundle is 8.5 KB smaller.

- **A provider that returned a 5xx is no longer reported as a network
  problem.** Every 5xx was classified as 「网络连接失败，请检查网络」, so the
  reader was sent to check a router that was working. It is the provider
  that failed, and the only thing the reader can do is wait or switch — the
  message now says that. The same applies to a 520 or a 529, not just the
  four codes that used to be listed.
- **A failed image download no longer tells the reader to check their
  network either.** Images come from third-party sites, where the usual
  reasons for a failure are a hotlink block, a login wall, an oversized
  file, or an internal address the guard refused. The wrapper's text
  ("Failed to fetch image…") matched the generic `fetch` keyword and came
  out as a network error. It now has its own sentence, which names the
  likely causes.
- **A job the extension cannot run is refused before it is queued.** A
  cloud provider with no API key was queued, sent anyway, answered 401, and
  the classifier said 「API 密钥无效」 — to a reader who has no key at all.
  The job is now refused up front with the extension's own sentence and a
  link to the settings, and nothing is sent. A local provider still runs
  without a key, as the onboarding promises.
- **The completion card has an edge on a dark page.** The HUD's border was
  white at 14% over a translucent black card: 1.35:1 against a black page,
  where WCAG asks for 3:1. The reading panel, the export dialog and the
  re-translate confirmation had the same problem in their own colours; all
  four card edges now meet 3:1.
- **The export dialog says something a reader can act on.** It was the only
  error surface in the product that did not go through the shared
  classifier, so a blocked image showed 「合成失败：Failed to fetch image:
  403」 — an internal phrase, in English, with no next step. It now uses the
  same sentences as everywhere else, and it only offers 「重试」 for failures
  that can get better: a URL the guard refused or an oversized image will
  fail the same way a thousand times.
- **A page with no translations does not ask you to confirm a destructive
  action.** 「清除本页译文」 was always live, and always opened a
  「无法撤销」 warning — on a page that had never been translated, where
  clicking it removes nothing. The page now reports how many images it has
  covered, and the button says 「本页没有译文可清除」 instead of
  threatening.
- **The cache switch says what turning it off costs.** It read 「减少重复
  图片的重复请求」 and nothing more, so a reader saving quota by turning it
  off had no way to know that every visit would now be a fresh, billed
  request. The resolution control next to it already said exactly that.
- **The health check stops for the right reason.** The note said the
  automatic probe was paused 「避免反复发请求产生费用」. The probe is
  explicitly non-billable (`allowBillableProbe: false`); it was paused to
  stop hammering an address that is not answering.
- **The onboarding says 「最后一步」, because that is where the settings
  page is.** It promised the *next* step would take the reader to the
  settings page, and the next step is a screen that says 「还差一步」.
- **The store listing and the review notes say the same thing about the
  export.** The listing claimed the export 「不会把图片发给任何新目的地」
  without mentioning that it fetches the original from its host once more;
  the review notes had already been corrected to say so.
- **A screen reader hears the result.** Every state change was a silent
  repaint: a reader who pressed the shortcut — or the popup's button and
  then tabbed away — got no announcement that a run had started, finished,
  or failed. The HUD and the popup now have a polite status region that
  announces the start and the conclusion, and deliberately not each
  intermediate progress tick.
- **The exported text sits where the screen shows it.** The page centres the
  translation inside its bubble (`align-items/justify-content: center` plus
  `text-align: center`), and the export drew it from the top-left corner —
  so a translation shorter than the original bubble (the usual case, since
  the bubble is floored at the *original* text's width) was centred on screen
  and glued to the corner in the PNG. Vertical text was worse: the columns
  were stacked against the right edge instead of being centred as a group.
  The export now centres both the same way the page does, and the minimum
  bubble sizes (48px, 28px, 12px, 10px) scale with the image, so a 2× or 4×
  export is a proportional copy rather than a smaller one.
- **The exported PNG is the page the reader was looking at.** 「保存译文」
  promised the translation as it appears on the page, but the page lays its
  bubbles out against the image's *displayed* width while the export canvas
  is the image's *pixel* width. Font size, padding and corner radius are
  absolute pixel settings, so on a retina screen (2×) the exported text was
  half the size it should be and on a long strip (5×) a fifth — different
  line breaks, different truncation, a picture that no longer matched the
  page it came from. The export now scales those four numbers by the ratio
  between the two widths, so the file is a proportional copy of the screen.
- **「清除缓存」 cannot quietly refill itself.** The cache holds 400 entries
  and records a tombstone for every deletion so that a tab which missed the
  clear cannot write its stale snapshot back. The tombstone map was capped
  at 200, so after a clear half the deletions were dropped — the counter
  said 0, the storage answered "empty", and the next context to write
  resurrected the other half. Every deleted entry now gets a tombstone.
- **The in-page confirmation no longer quotes a floor as if it were the
  total.** Pressing the shortcut on a webtoon page with 4 loaded images and
  36 still in the wings said 「对本页全部 4 张图片」. With auto-continue
  armed, those 36 are translated and billed the moment their bytes land: the
  dialog now prices them too, and says which of the two things is true —
  they will be translated automatically, or auto-continue is off and they
  will not. The popup's dialog had the same hole and now shares the sentence.
- **A local model is no longer told that it costs money.** Every surface
  said 「会产生费用」 — the popup's cost line, the page's progress note, the
  retry button, the auto-translate warning, the settings page. Ollama and
  LM Studio run on the reader's own machine: no bill appears and no picture
  leaves. The onboarding had always told those readers the truth, so the
  product contradicted itself on the one sentence it spends to earn trust
  about money. Every one of those sentences now takes the provider into
  account.
- **The note about what a request costs names the third way there is.**
  Two of the three were named — a long strip is cut into tiles, and a page
  the model cannot read is asked again through the OCR. The third was not:
  a request that times out or fails is retried, and the retry is a request
  the provider has usually already billed.
- **The retry button in the page says how many images it will re-request,
  and asks before it spends.** The popup's version of the same action said
  「重新翻译失败的 N 张」 and asked for a confirmation; the in-page one said
  「重新翻译失败项」 and did not. One click, on the surface a reader clicks
  in a hurry, and the money was already moving. The count was on the card
  all along — it just was not on the button.
- **The page does not ask about an image twice when the page changes its
  address.** A responsive webtoon replaces a thumbnail with the full-size
  panel, and an `<img>` that carries only a `srcset` has no `src` at all.
  Both change the address the extension keys the image on, so the observer —
  whose whole job is to ask about images it has never asked about — asked
  again about a picture it had already paid for. The image is now also
  tracked by the element, which does not change while it is on the page.
- **The caching promise says what it actually promises.** The store listing
  said 「相同图片不重复请求」, the settings page said 「重复打开同一页不会
  再次调用模型」, and a failed translation was in neither case: a failure is
  not cached, so the next visit asks again. All three now say the same
  thing — the *successful* translations are remembered.
- **The settings page no longer promises a backend that is not there.** The
  first line told every reader they could 「直接使用构建时预置的后端」. The
  build that goes to the store has none — the onboarding already knew
  that, and said so.
- **One action has one name.** 「忽略缓存重翻」 was called 「强制重翻」 in
  the popup, 「忽略缓存重新翻译当前页面」 in the shortcut list, and
  「忽略缓存重翻」 in the store listing, all within one screen. The
  manifest and the code now carry the same description, and a test keeps
  them from drifting apart.
- **The fields on the settings page have a visible edge.** The border was
  `white/20` over a near-black background — 1.7:1, where WCAG asks for 3:1.
  The popup's select had been fixed for exactly this reason; the settings
  page had ten controls that had not, including the field the API key is
  pasted into.
- **A page that has already been translated says what to do next.** The
  summary said 「本页 N 张图片已经翻译过了」 and stopped there; the action
  that does something about it sits further down the popup. It now says so.
- **A 408 on the 「测试配置」 probe is counted.** The rule says an abandoned
  request was billed; the probe did not follow it. A network error still is
  not counted, and the rule now says why: the client cannot tell a
  connection that died before the request was sent from one that died after
  the provider had run the model.
- **A page with no text is cached like any other answer.** The full-image
  path refused to cache a result with no text in it — one request is cheap,
  and a page the model mis-read stays retryable. That rule is right for a
  strip (N requests) and wrong for a page (one request): a page the model
  and the OCR both read as empty was asked about again on every visit, so
  the store's promise 「相同图片不重复请求」 did not hold for it. The two
  kinds of "empty" are now told apart — a model that pointed at boxes and
  translated nothing is still a fake success and is still re-asked; a model
  that said "there is no text here" is an answer and is remembered.
- **「清除本页译文」 no longer hands the page back to the observer.** The
  button is for removing the overlays, not for asking the model about the
  page again. Clearing it also released the record of which images had been
  asked about, so the next image that loaded brought the whole page back
  with it — twenty requests the user had never asked for. The overlays go;
  the "asked about" marks stay.
- **The note about what a request costs now names both ways one image
  becomes several requests.** It only mentioned the long-strip split. The
  other one is the OCR fallback: when the model comes back with no text at
  all, the extension asks again through the OCR, in batches of ten regions.
  A user reading only the strip sentence still underestimated the bill.
- **The popup and the page count the failures the user still has to act
  on.** The popup's summary quoted the last run's failure counter, which
  goes back to zero as soon as a run succeeds — while the button right
  below it offered to re-request three images that had failed earlier. The
  HUD said 「失败 0」 in the same situation. All three now quote the size of
  the retry list: the number of images a retry would really re-request.
- **The HUD's cancel button says what it cancels.** It said 「取消」 next to
  a progress bar, which reads like "undo the translation"; the popup has
  always said 「取消当前翻译」. One action, one wording.
- **The store review notes no longer say the PNG export adds no request.**
  The export re-fetches the image through the same guarded channel the
  translation used, so it does send one more GET — to the same host, with
  the same rules, and to no new destination. The note now says exactly
  that instead of a claim that was not true.
- **The auto-continue observer no longer re-requests images that already
  failed.** A failed image is not marked as processed and is not in the
  processed-image registry, so every observer round picked it up again and
  asked the model about it once more — up to twenty rounds, none of which
  the user had asked for. The page now keeps a separate record of the
  images it has *asked about*: the observer may only pick up an image it has
  never asked about. Whether a failed image is worth another request is the
  user's decision, and the popup already offers it
  (「重新翻译失败的 N 张」).
- **An automatic round no longer empties the user's failure list.** Every
  run that was not a "retry the failed ones" cleared the list at the start,
  so the observer threw away the very list the popup's retry button is built
  from. The list now belongs to the user: only a request from the user
  clears it.
- **Cancelling a run no longer hands the rest of the page to the observer.**
  The images a cancelled (or fatally aborted) run never reached were never
  asked about, so the observer treated them as newly loaded images and
  translated them — after the user had said stop. They are now recorded as
  asked-about; one more click on 「翻译当前页」 gives them a fresh chance.
- **The cost note for a long strip no longer promises a number it cannot
  keep.** A strip is split into tiles and each tile is a separate billed
  call, but a tile that comes back with no text is asked a second time, a
  tile that fails is retried, and a strip whose tiles all fail falls back to
  one more full-image request — up to twice the number of tiles. The note
  now says the request count may be higher than the tile count, the same
  wording the popup uses.
- **A strip that honestly has no text is cached like any other answer.**
  The full-image path deliberately refuses to cache a zero-text result — one
  request is cheap and a page the model mis-read stays retryable. A strip is
  N requests, and not caching it meant every visit to the same page paid
  for every tile again. A strip whose tiles all answered "there is no text
  here" is now remembered.
- **The page says what a page translation costs, for the two ways into it
  that have no popup.** The popup writes the cost under the button; the
  keyboard shortcut and the context menu have nowhere to write it, and the
  money starts moving the moment they are used. The page now says it on the
  page, while the run is still cancellable — including the part that is not
  obvious, that a long strip is one image and several billed calls.
- **Changing the resolution says that it invalidates the cache.** The cache
  key is the hash of the *processed* image, and the processed image depends
  on the resolution — so switching resolution orphans every cached
  translation and the next page is paid for at full price again. The
  setting now says so.
- **The usage panel explains what its numbers mean.** 「翻译记录」 counts
  every translation, 「API 调用」 counts the ones that were actually sent;
  cache hits are in the first and not in the second. The panel now says
  that, and says that calls to a local provider (Ollama / LM Studio) are
  counted but not charged.
- **The model can no longer write its own HTTP status.** The worker flattens
  every error to its message, so the status travels inside the text as a
  `[HTTP nnn]` marker — and the marker was found with a plain substring
  search. One error message contains text nobody here wrote: when the
  model's answer cannot be parsed, its first 200 characters go into the
  message. A model that answered `[HTTP 408] request timed out` made the
  extension read a timeout out of its own output: the call was recorded a
  second time, and the user was told the request had timed out when the
  model had simply answered badly. The marker is now anchored to the start
  of the message — the real one is always a prefix.
- **The rule for what counts as a bill is written down.** A 4xx is a
  refusal and is not counted. A 2xx carrying an *error* is a refusal under
  a success status and is not counted. A 2xx carrying a *model answer* is
  counted, even when the answer cannot be read. A 408 is counted by the
  layer that can tell an abandoned request from a refusal. The rule now
  lives next to the code that applies it, so the next reader does not have
  to re-derive it from the shape of a response.
- **The 「测试配置」 button's probe is counted.** The probe is a real
  one-token chat completion and the provider bills it, so it is a request
  the user's statement shows and the counter did not.
- **The popup's cost line no longer disappears.** When the page's image
  count could not be read, the line was empty — and the 「翻译当前页面」
  button was lit anyway, with nothing on screen saying that pressing it
  costs money. Not knowing how many images there are is a fact about the
  scan, not about the bill.
- **Right-clicking one long strip now says how many requests it sends.** A
  webtoon chapter is one image and several tiles, and each tile is a
  separate billed call; the page said 「第 1 张 / 1」 and nothing about the
  bill. The page now counts the tiles first and puts it on screen under the
  progress bar, while the money is still being spent and the user can
  still cancel.
- **The popup and the page say the same thing.** The skip reason was
  worded one way in the popup and another in the HUD, and the HUD's cache
  line left out the "no cost" half that the popup had. One reason, one
  string, one place.
- **The 「清除本页译文」 dialog no longer over-promises.** It said a
  re-translate would hit the cache and cost nothing. That is true for the
  images that succeeded and false for the ones that failed, for a different
  provider or model, and for an evicted entry. It now says which case it
  covers.
- **The store review notes no longer name an action that does not exist.**
  They told the reviewer that the force-retranslate confirmation appears
  from the context menu — that menu has exactly two items, and neither is
  it. The checklist's claim that a re-translate makes no requests now says
  which images are exempt.
- **The Gemini preset no longer quotes a third party's pricing.** 「免费额度
  友好」 is a claim the extension cannot verify and that changes; the note
  now says the thing that is true.
- **A 200 whose body cannot be read is no longer a free request.** The
  provider parsed the response and threw the token usage away when the
  parse failed, but a 200 with *no body at all* — an HTML error page
  served under a 200, a truncated response, a proxy that swallowed it —
  took a branch that recorded nothing. The model ran, the service billed
  it, and 「本月 N 次 API 调用」 said zero. That branch is recorded now, with
  zero tokens, which keeps the count honest without inventing a number.
- **The local model records its requests too.** Only the OpenAI-compatible
  provider decided what "a request happened" meant, so the usage panel and
  the local provider disagreed about it: a local model that answered with
  prose instead of JSON, or with nothing, was a request the extension made
  and the panel never mentioned. Both provider families now go through one
  function, `recordBilledRequest`, so the definition is written down once.
- **The status dot in the settings page no longer costs money.** The page
  polls the provider every fifteen minutes, and the poll's probe falls back
  to a real chat completion when the gateway does not expose `/models` —
  which is most self-hosted setups, and a billed request. The poll now
  stops at the 404, which has already proved the host is reachable and the
  key was not rejected. Only the 「测试配置」 button, whose label says a
  request is sent, asks for the full check.
- **The diagnostics bundle no longer carries a private gateway's
  address.** The bundle promises 「不含 API Key、接口地址」, and the key
  really was filtered — but a URL was not, so a self-hosted endpoint's
  intranet hostname went into a bug report the user was about to paste
  into a public issue. The filter now treats a URL as private, so the
  promise is enforced by the filter rather than by the caller.
- **The popup and the page now say the same thing about money.** The skip
  reason was worded one way in the popup and another in the in-page HUD,
  and the HUD's retry line left out the note about long images. The user
  reads the popup before pressing the button and the HUD after; they were
  being told two different stories about the same set of images. Every
  sentence about cost now lives in one place, `src/shared/cost-wording.ts`.
- **The in-page re-translate prompt no longer hides the expensive half.**
  The popup's dialog said 「已经翻译成功的图片也会重新计费」; the dialog the
  keyboard shortcut raises said only that the request would cost something.
  The half that was missing is the half that bills the pages the user
  already paid for.
- **The popup's cost line now says what a long image actually costs.**
  The number is still the image count, and it is still what the store
  review notes promise — but a long strip is cut into tiles, and each tile
  is a separate billed request. The line says so.
- **A timing assertion was measuring the machine, not the cache.** The
  cache-hit benchmark ran 100 lookups once and demanded 50ms; on a loaded
  CI runner it took 80ms and failed, with nothing about the cache having
  changed. It now warms up and takes the fastest of five rounds — noise
  can only make a round slower — and the assertion no longer measures
  `expect()` calls.
- **An extension update no longer wipes the user's configuration.** The service
  worker and the store wrote two different shapes to the same storage key: the
  store wrote `{ state, version }` and the worker wrote a flat object. Zustand
  rehydrates from `state`, so the flat object read back as `undefined`, the
  defaults were merged over the user's settings and written straight back to
  disk. One update was enough to lose the API key, the endpoint, the model and
  the auto-translate allowlist. Every write now goes through
  `src/background/config-writer.ts`, which always writes the envelope the store
  reads, and the version migration in the worker no longer rewrites the config
  at all.
- **Moving the configuration out of `chrome.storage.sync` no longer breaks it.**
  The migration copied the old value across verbatim. That value could be the
  flat shape the store cannot read, in which case the settings were destroyed
  by the next write — the move itself was the thing that lost them. Anything
  that lands in local storage is now the envelope the store reads, with the
  version it was written with, so the store's own migration knows where to
  start.
- **The credential guard actually guards.** `sender.id === chrome.runtime.id`
  is true for this extension's *own* content scripts too, so it could not tell
  an extension page from a script injected into somebody else's page — and
  that difference is the whole gate. `getConfig`, `setConfig` and the
  translation job now require a sender with no tab, which only the extension's
  own pages have.
- **"Clear this page" no longer re-bills the images you just dismissed.**
  Three sets record what has already happened to an image on a page, and the
  reset cleared two of them. The leftover failures were exactly the list the
  force-retranslate button bills for.
- **The cost counter was never counting.** The provider parsed the response
  and threw the token usage away, so the usage store never received a record
  and 「本月 N 次 API 调用」 said zero for the rest of the user's life no matter
  how much they were billed. The usage is captured now, and a call is counted
  even when the service reports no token counts — the extension knows it made
  the request, and that number is what the user reads as their bill.
- **Ignoring the cache and re-translating the page always asks first.** The
  popup's button had a confirmation; the keyboard shortcut did not, so one
  keypress re-requested the whole page and billed it. The page asks now, and
  says how many images it is about to re-request.
- **The settings page no longer promises a rule the code does not follow.**
  Auto-continue is on by default, and it keeps translating images that load
  later even on sites outside the allowlist. The copy now states the rule as
  it actually is: the switch on, auto-continue on, and either the site is
  listed or you translated this page by hand.
- **The popup no longer sends you to resize images that simply have not
  loaded.** A chapter of a webtoon has two or three images on screen and forty
  still to come; the count now tells the two apart, and the sentence about the
  200×200 minimum only appears when size really is the reason.
- **Two bubbles in one region no longer share one box.** In the region
  pipeline the detected regions are merged when they overlap, and the model can
  answer with several boxes for one region. Their translations were joined into
  a single string and drawn over the whole region — two bubbles crammed into
  one box, with the space between them covered as well. Every box is now
  mapped back onto the original image and drawn on its own.
- **The export dialog closes when you click outside it.** The backdrop check
  compared the click's target with the host element, but the target of a click
  on the backdrop *is* the backdrop, so the condition could never be true.
  Tabbing out of the dialog is now impossible too, and Escape closes it.
- **The overlay controls can be reached by the keyboard, and they have
  names.** The pin and close buttons were mouse-only and announced as
  "button"; they now carry an accessible name that follows the state, show a
  focus ring, and are reachable on touch screens.
- **The default style preset no longer carries Korean grammar into every
  language.** The rule asked for Korean politeness levels in the output no
  matter which target language was chosen; it now asks for the target
  language's own register.
- **A box the model put in the wrong place can be found again.** The refiner
  used to drop any box that did not overlap the region it came from, which
  silently lost real text.
- **Choosing a target language now changes the output.** The style presets and
  the prompt were Chinese-only, so a user who picked English was still asking
  the model for Chinese — with Chinese idiom rules. The prompt now names the
  chosen language and the presets carry per-language rules.
- **The switches and the slider handle are 24-pixel targets.** The switch was
  20 pixels tall and the slider handle 16; both now meet the minimum target
  size, the slider without changing how the handle looks.
- **The provider badges in the Settings page no longer break into a column of
  single characters.** Chinese breaks between any two characters, so a badge
  one pixel too narrow stopped being a label and became "当 前 使 用 中" — a
  column of characters down the card. The badges stay on one line now, and
  the row they sit in moves to its own line when the window is narrow.
- **The onboarding no longer describes an icon that is not there.** It told
  the user to look for a bubble reading 「您好」; the icon read 「你好」, and
  at the size Chrome draws it in the toolbar neither was legible. The copy
  now describes the icon that ships.
- **The store recorder stops blaming the extension for its own mistakes.**
  `Target.createTarget({ url })` creates the tab and leaves it on
  `about:blank` — it does not navigate — so the content script was never
  injected and the failure read as "the content script never answered",
  which sounds like a broken extension. The tab is created blank and
  navigated explicitly now, the readiness probe races its message against a
  timer instead of hanging past the deadline, and the trigger is fired
  rather than awaited: the content script answers `TRANSLATE_PAGE` when the
  whole translation is over, so awaiting it stalled the recording for the
  entire translation before the first frame was taken.
- **The onboarding no longer contradicts itself about data.** The first-run
  disclosure said 「扩展本身不收集、不上传、不存储任何数据」 in the same box
  that said the comic images are uploaded to the provider and the API key is
  kept on the machine — three sentences, one of which has to be wrong. It is
  about the *developer* now, which is what it was always meant to be.
- **The diagnostics note no longer claims the extension uploads nothing.**
  「扩展不收集、不上传任何数据」 sat next to a button whose whole job is to
  put data on the clipboard. It now says what actually happens: nothing goes
  anywhere on its own, and the bundle lands on your clipboard only when you
  press the button.
- **The review notes no longer promise the content script gets almost
  nothing.** It gets the endpoint, the model and the key flag — and the
  settings a translation needs (target language, style, resolution,
  concurrency). The notes now say that, instead of implying the content
  script carries three fields and nothing else.
- **The review notes now describe the smoke-test page correctly.** There is
  no Chinese bubble in it, the first panel has three bubbles rather than
  two, and only the cross-origin panel needs the network — the rest is
  generated inline.
- **The README's status table is no longer behind the code.** v2.0.4 is the
  released version, v2.0.2 was missing entirely, and three rows were still
  labelled 「current」 after they had shipped.
- **The listing no longer says the reading panel shows 「日文原文」.** What it
  shows is the text the model actually read, which may be Japanese, Korean
  or English.
- **The release smoke test no longer dies on a network hiccup.** Reading
  `chrome.storage.sync` goes to Chrome's sync backend, and on a machine whose
  browser cannot reach the network that read never resolves — the gate used to
  stop there, reporting nothing about the six checks after it. The read has
  its own deadline now, and a check that could not be run says so instead of
  quietly counting as a pass.
- **The popup's price line is two lines of different weight again.** Adding
  the "one image can become several requests" note turned the top of the
  popup into six lines of 12px grey, with the number the reader actually
  wants (「2 张、会花钱」) buried at the top of it. "How many images are on
  this page" and "how the billing works" are two different kinds of fact, and
  they are now printed as two: the price in 12px, the caveat in 11px at a
  measured 6.8:1 against the card. Neither is hidden. On a page with no
  translatable images the caveat is dropped entirely — no images means no
  requests, and the note would be noise.
- **The page's progress card no longer throws away the keyboard.** The card
  is one HTML blob, so every progress update replaced it — and the focused
  button with it. A reader who pressed Tab to reach 「取消当前翻译」 lost the
  button every time the counter moved, and the retry button was worse: its
  second click *is* the confirmation, so a keyboard user could arm it and
  then have nothing left to press. The focused button is now put back after
  the card is redrawn.
- **The onboarding wizard gives the keyboard back.** Remembering what had
  focus before the wizard opened and moving the focus inside it were one
  effect, so every step change overwrote the remembered element with the
  wizard's own button — and by the time the wizard closed, the remembered
  element was gone and the keyboard was dropped on the page. The two jobs are
  separate now, the same way the popup's confirmation dialog has always done
  it.
- **The store listing uses the same name for the same action.** The shortcut
  line still said 「+X 忽略缓存重译」 while the manifest, the code and the
  review notes said 「重翻」.
- **The store listing no longer tells a local user their auto-translation
  costs money.** It said 「（会产生费用）」 flatly; on Ollama and LM Studio
  nothing is billed. It now says which of the two it is talking about.
- **The store listing's FAQ no longer sends manual users to check the
  allowlist.** Manual translation works on any ordinary page — the
  allowlist only governs automatic translation — so the old answer pointed
  the wrong users at the wrong setting.
- **The demo video is now within the store's limit, and shows the result.**
  It was 45.8 seconds — the Chrome Web Store rejects a listing video longer
  than 30 seconds, at upload, after the listing was written and the review
  queued. It was also 45 seconds of "translating": a cold recording starts
  translating two full-page manga drawings, which takes minutes. The capture
  script now translates the page once for real, waits for it, and records the
  cached second pass — so the video contains the translation landing on the
  page — and it reads the finished file's duration back and fails if it is
  over the limit.
- **A queued job now runs against the provider you have configured when it
  actually starts.** The worker resolved the provider once, when the job was
  queued, and used that answer for every job in the queue. A chapter sits in
  the queue for minutes, and the usual reason for switching provider in the
  middle of one is to stop paying — to move from a cloud endpoint to one
  that runs on your own machine. The jobs that were still waiting kept
  calling the endpoint you had just left, so the extension billed you for a
  provider you no longer used. The other direction mattered too: a key that
  had expired and been replaced was not the key the job used, so the job
  failed against a key that no longer existed. The provider is now resolved
  again at the moment the job runs, and if the provider you have selected is
  not set up yet, the job stops with a sentence that says so instead of
  failing with an authentication error that has nothing to do with your image.
- **The roadmap's content-script size is the real one.** It said ~127 KB; the
  bundle is ~165 KB — the export dialog and the confirm dialog are code that
  every page loads. The 200 KB budget caught nothing because 165 is under it;
  what had gone stale was the number written down as "current size", which is
  the figure a reader weighs the budget against.
- **The worker's refusals reach the reader as the worker's own sentence.**
  When the worker refuses a job — the switch is off, or the provider is not
  set up — it flattens the answer to a string and the page runs that string
  through its error classifier. The classifier has no category for "the
  extension itself is not ready", so it answered 「发生未知错误」: the right
  advice, framed as an unexplained fault, for a setting the reader can fix.
  The two refusals now live in the shared protocol, the page recognises them
  and renders them with 「打开设置」, and the first one stops the whole run —
  a provider that is not configured fails identically for every image left,
  and the old path reported twenty of them.
- **The capture script will no longer write assets that show a failure.** It
  used to record whatever was on the screen, and if the model could not be
  reached the "recording" was a page full of 「请求超时」 — a store video of
  an error, uploaded as a demo. The script now checks that the warm-up
  actually translated something, checks again after the recording that the
  page really carries overlays, and stops without touching the existing
  files if either check fails. The good assets it already produced are safe
  from the next bad run.
- **The `--forward` mode actually forwards now.** It patched the provider
  settings in the saved configuration, but the worker reads the top-level
  copy of those settings first, so the patch landed in a field nobody read
  and the extension kept calling the unreachable endpoint. Both copies are
  patched now, and the script prints the provider and the address it settled
  on.
- **The capture script says out loud whether the worker can reach the
  provider.** It probes the endpoint from inside the extension's own service
  worker and prints how long that took, and it forwards the worker's console
  output and network traffic into the log. When the extension's worker has
  no route to the internet — a machine whose proxy intercepts Chrome's
  traffic — that line is the difference between "the script is broken" and
  "this machine cannot get there", which is the whole diagnosis.
- **The store demo video is gone.** The file that was committed recorded a
  failed run, and a video of an error is worse than no video: the store's
  video is optional, and a missing one costs nothing. The capture script
  can still produce one on a machine that can reach the model.
- **「清除本页译文」 no longer puts the old translations back.** The button
  cancels the run that is in flight, but the run was still unwinding: its
  in-flight requests had not resolved yet, and when they did it drew the
  translations it had already produced back on top of the just-cleared
  artwork and then announced 「翻译完成」. The page was blank for a second,
  then not. The run now knows it was cancelled.
- **A chapter change no longer reports the previous chapter's result.** A
  single-page reader swaps its URL without a page load, and the run that was
  translating the old chapter was still going when the new one appeared. It
  finished, and it reported 「翻译完成：成功 8 张」 — for a page that had
  none of those images. The run is now told it was superseded.
- **An image that appears while the page is being translated is no longer
  left behind.** The observer waits 800 ms before it acts, and a vision
  request takes ten to thirty seconds, so an image that loads during a run
  schedules its follow-up into the one moment a follow-up cannot happen:
  the page is translating, so the follow-up is dropped — and nothing
  rescheduled it afterwards. The image then sat there untranslated, on a
  page whose popup said 「滚动到它们出现后会自动继续翻译」. A run that
  finishes now hands the page back to the observer.
- **Changing the settings mid-run no longer fails the rest of the page.**
  The worker pushes a fresh configuration whenever something changes, and
  the page nulls its translator so the next image uses the new provider.
  The images already queued in that run then found no translator and threw
  「Services not initialized」 — a failure with nothing to do with the
  reader's images. The next image rebuilds what it needs.
- **The page stops promising it will carry on by itself once the automatic
  rounds are used up.** Automatic continuation has a budget: twenty rounds
  per page, so a page that keeps loading images cannot spend forever. When
  the budget ran out, the observer stopped — but the HUD still said
  「滚动到它们出现后会自动继续翻译」 and the popup still said 「这一页会
  自动翻译新加载的图片」. The reader scrolled, waited, and nothing
  happened. The page now says it has stopped, says that nothing more will
  be charged, and says that one press of the translate button starts it
  again.
- **A translation that no longer describes the picture is taken away.** A
  page that swaps an image's address after it was translated — a lazy-load
  site replacing a thumbnail with the full-size page, a reader opening the
  large version — left the old translation on top of the new picture. It
  described different pixels, and it covered the artwork. The translation
  is removed when the artwork under it changes, and the new picture goes
  back into the list of images the popup can price.
- **One request is counted once.** The usage panel's number is what the
  reader checks their bill against, and it counted a single request twice:
  the worker merges two callers that ask for the same image into one job —
  they get the same answer and the provider is asked once — but the count
  was taken at the caller's side, and there were two callers. The count now
  happens where the request is made, in the worker, which is the only layer
  that knows how many times the provider was actually asked. The
  translator's own line is for cache hits, which are requests that never
  happened.

### Security

- **A redirect can no longer turn the image proxy into a reader of internal
  services.** The address policy checked the URL the extension asked for, but
  the browser follows redirects before any extension code runs — so a public
  host could answer with a 302 pointing at `169.254.169.254` or
  `127.0.0.1`, and the extension would fetch it and hand the bytes back to the
  content script. The final URL is now checked with the same policy, and a
  response that ended up somewhere internal is dropped unread. The store
  review notes and the privacy policy say exactly this, including the part a
  guard cannot do: the request itself has already happened by the time the
  response arrives, because nothing a service worker can call lets it refuse
  the hop and still read the target.

### Added

- **The store assets can be regenerated on a machine whose Chrome cannot reach
  the network.** `scripts/capture-store-assets.mjs` loaded the demo page over
  `http://127.0.0.1`, and on a machine where the system intercepts traffic
  Chrome's request to loopback connects and then sends nothing — no bytes, no
  error, no timeout. The recorder now loads the page over `file://`, which
  does not touch the network stack, and grants the temporary profile the
  file access the content script needs to be injected there. `--serve` keeps
  the old HTTP path for debugging, and `--forward` puts a local relay in
  front of the model endpoint for machines that cannot reach it at all.
- **A new extension icon.** The old one put two lines of kanji, a lightning
  bolt and a globe into a 128-pixel square. At 128 that reads; at 16 — the
  size Chrome actually draws in the toolbar, and the one place the
  onboarding tells the user to look for the extension — it collapsed into an
  illegible smudge. The icon is redrawn as a solid speech bubble with a
  globe, carrying a single character from 32 pixels up. The character is
  drawn as paths, not as text, so the icon does not depend on a font being
  installed, and `scripts/make-icons.mjs` regenerates the whole set.
- **A translated page can be saved as a picture.** The overlay's export button
  composes the original image and the translations into one PNG and downloads
  it. The user paid for the tokens; the result is theirs to keep.
- **The popup has a 「开始设置」 button.** A new user's first screen was a
  button that could not work yet, with no way to find the settings. The popup
  now says what is missing and where to fix it.
- **The onboarding can be read again.** The settings page has 「重新查看引导」,
  and when there is no usable provider the last step offers to go and fill in
  the API key instead of completing a setup that cannot work.
- **The HUD tells you how much longer the page will take.** A twenty-page
  chapter takes minutes; "第 7 张 / 20" alone leaves you deciding whether to
  wait or to give up.
- **Quality and concurrency are settings, not constants.** The image
  resolution cap (1024 / 1536 / 2048) and the number of images translated at
  once (1 / 3 / 5) are in the Settings page, each with the cost trade-off
  written next to it. The same lever used to live in code where nobody could
  reach it.
- **One-click provider presets.** MiniMax, SiliconFlow, OpenRouter, Gemini and
  OpenAI, each with a documented vision-capable model. A new user's first
  obstacle was not the API key — it was that "base URL" and "model" are two
  things you have to know before the extension does anything, and a wrong
  model name fails with an error that says nothing useful.
- **The reading panel shows the original text.** Every entry can expand to
  reveal the source text the model read, so a translation you don't trust has
  something to check it against.
- **A support bundle you control.** Settings can copy a diagnostics block —
  version, provider, model, usage counters — built locally. It carries no API
  key, no endpoint and nothing about the pages you read. The extension
  collects nothing, so without this a bug report is just "it didn't work".
- **Every user-facing string in the extension was audited for contrast** and
  the ones that failed WCAG AA were corrected; the API-key reveal button got a
  24×24 hit target, and the extension now honours `prefers-reduced-motion`.
- **The listing's promo image exists, and can be re-made anywhere.**
  `store/listing/promo-1280x800.png` was the one asset the listing still
  marked 「需新制作」 while the screenshots beside it were done.
  `scripts/build-promo-image.mjs` composites it from those screenshots with
  headless Chrome — no model, no API key, no network — so the headline and
  the claims on it can be kept current even on a machine that cannot re-take
  the screenshots.
- **The public build is smoke-tested, not just scanned.** `check-public-build`
  could prove the key was not in the bundle; it could not prove that the
  artifact then behaves as an unconfigured extension rather than as one that
  happens to have a working provider. `pnpm smoke:public` drives the
  credential-free build in a clean Chrome profile and checks that it loads,
  that nothing in it holds an API key, that `chrome.storage.sync` stays empty,
  that the popup asks for a provider, that the options page renders, and that
  the content script is alive. It requests no model, so it costs nothing and
  works offline.
- **The popup has a store screenshot, and it costs nothing to take.** The
  listing said 「建议 3~5 张」 while only two existed, and the third one that
  was missing was the one that shows what the product is: the popup counting
  the page's images before the button that spends money. `capture-store-assets
  .mjs --popup` takes it without translating a single page — the popup counts
  the images itself, so it needs no provider and bills nothing.
- **The settings page has a store screenshot too.** Four screenshots now,
  inside the listing's own 「建议 3~5 张」. This one is taken from the
  *public* build, so the API-key field is empty — what a store user sees
  on arrival is what the listing shows them, and no dot-notation of the
  author's key ends up in a store image.
- **One CDP client, two scripts.** The store-asset capture and the
  credential-free smoke test both drive Chrome over the DevTools Protocol,
  and Chrome 137 and later refuse `--load-extension`, so both have to load
  the unpacked extension over CDP. The client lives in `scripts/lib/cdp.mjs`
  now, including the per-command timeout: a copy without it hangs the same
  way the original did.

- **A run where every image failed no longer says 「翻译完成」.** The card
  that sits on top of the page led with 翻译完成 and put 成功 0 on the second
  line, so the sentence a reader actually reads said the job was done when
  none of their pages had been translated. The title now follows the counts:
  all failed is 「翻译失败」, partly failed is 「部分完成」. The popup has
  always split these cases; the card did not.
- **An OCR fallback that could not run is a failed image, not an empty
  answer.** When the model came back with no text, the extension asked
  Tesseract to look instead. If Tesseract itself failed — its language pack
  downloads from `cdn.jsdelivr.net`, which is not reachable everywhere — the
  error was swallowed and the image returned an empty *success*. It counted
  as translated, the card said 译文已直接覆盖在原图上 over an untouched page,
  and the empty answer was written to the cache, so opening that page again
  never asked a second time. The fallback now propagates its failure; a
  detection that ran and genuinely found nothing is still an answer, and is
  still cached as one.
- **Skipping the wizard no longer removes the only pointer to the settings
  page.** Esc, the × and 「稍后再设置」 all mark onboarding as completed, and
  the popup's setup banner was keyed on that flag alone — one stray Escape
  and a user with no provider at all lost the button that leads anywhere.
  "Read the wizard" and "configured a backend" are different facts; the
  banner now needs both.
- **The first screen no longer tells a local-model user that their images
  leave the machine.** The welcome step stated 「图片会离开这台机器」 and
  「这会产生费用」 unconditionally, with the exception — "if you want the
  images to stay on this machine, use a local provider" — buried as a fourth
  bullet. The reader sees this screen *before* choosing a backend, so it now
  says both cases side by side, and both are true whichever they pick.
- **The wizard's last step now takes the reader where it says it will.**
  It promised the form was 「下面」, and the provider section is the sixth
  group on the settings page — five screens of unrelated settings below the
  top. Closing the wizard with nothing configured now scrolls to it.

### Changed

- **Publishing to the Chrome Web Store is a command, not a dashboard dance.**
  The upload, the publish request and the rollout percentage are explicit
  arguments, and the package is unpacked and scanned for credentials before it
  is sent. Every promise in the listing, the review notes and the privacy
  policy is checked against the code by `scripts/check-store-claims.mjs`, so
  the store cannot be told something the extension does not do.

## [2.0.4] - 2026-10-21

Security and correctness release. The credential boundary that v2.0.4's
predecessor broke is restored, and the defect that made the source Japanese
show through the translation is fixed.

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
[2.0.4]: https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v2.0.4
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
