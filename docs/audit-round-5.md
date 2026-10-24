# Round 5 audit — two verifiers, one product

Round 4 asked "are the round-3 fixes true?". Round 5 asked the same question
about round 4, and got a different kind of answer: **the fixes held, and the
next layer down was still wrong.**

That is the shape of this product's defects. Each fix moves the problem one
layer down the stack — from the provider to the worker, from the worker to
the content script, from the content script to the wording. Every round finds
the next layer.

Two verifiers ran over the tree:

| Reviewer | Brief |
| --- | --- |
| money-verifier | every path where a request costs money, and every path that reports what it cost |
| wording-verifier | every sentence in the product that talks about money, cost, caching or request counts |

Both were given the code and told to re-derive, not to trust the previous
round's write-up. Both found something real.

---

## What the verifiers confirmed

- **The accounting is now one record per billed request.** The provider
  records the 2xx paths the translator cannot see; the translator records
  successes and abandoned 408s; a 4xx is recorded by neither. No path
  double-counts.
- **The credential boundary is intact** (re-confirmed in round 4): 45 modules
  in the content script's closure, no path to any credential module.
- **The page-level cost disclosure is complete and consistent.** The count
  line, the tiling note, the retry note, the force-retranslate note and the
  auto-translate notice all agree with each other.
- **「已经翻译成功的图片不会重来」 is true** — the retry path re-requests
  only the images still marked failed.
- **The two contexts merge correctly.** The provider records in the service
  worker and the translator records in the content script — two separate
  in-memory stores persisting to the same key. The accumulators are
  per-context and the storage adapter does read-merge-write, so two contexts
  each recording one call produce two calls, not one and not two-per-request.
  This was checked by running it, not by reading it.

---

## P0 — the model could write its own status code

### `[HTTP 408]` in the model's answer was read as a real status

The worker flattens every error to its message before handing it back, so
the HTTP status has to travel *inside* the message. It does, as a
`[HTTP nnn]` marker — and the marker used to be found with a plain substring
search.

One error message contains text nobody here wrote. When the model's answer
cannot be parsed, `parseVisionResponse` puts the model's first 200
characters into the message:

```
Failed to parse Vision LLM response: {error: [HTTP 408] request timed out, retry later}
```

A model that answered that would have made the extension read a 408 out of
its own output, and conclude the provider had abandoned the request. That
has two consequences, both wrong:

- the translator records the call as an abandoned one — **a second record
  for one request**, so the bill reads high;
- and the user is told the request timed out, when the real problem is that
  the model answered badly.

The marker is now **anchored to the start of the message**. The real marker
is always a prefix — `formatHttpStatusMessage` puts it first, and nothing
prepends anything to a provider's message on the way back — so a marker
that is not at the front is not ours.

The regression test is a cross-layer one: a real provider, a real 2xx, a
model answer carrying the literal string, and the usage store at the end. It
fails without the fix (two records) and passes with it (one).

### A 2xx that carries an error is a refusal, and now the rule says so

After round 4, the 2xx paths split four ways: no body → recorded; empty
answer → recorded; unparseable answer → recorded; **an error body → not
recorded**. The last one was right, but it was right by accident — it fell
out of the shape of the response, not out of a rule.

The rule is now written down where the recording happens:

- a 4xx is not recorded — the provider refused;
- a 2xx that carries an *error* is not recorded — the service is reporting a
  refusal under a success status;
- a 2xx that carries a *model answer* is recorded, even when the answer
  cannot be read;
- a 408 is recorded by the translator, the layer that can tell an abandoned
  request from a refusal.

### The 「测试配置」 probe was a request the bill never showed

The button's probe is a real chat completion with a one-token reply, and the
provider bills it. It recorded nothing, so every manual configuration check
was a request the user could see on their statement and not in the counter —
and the counter is exactly what they are watching when they press it. The
probe records now.

---

## P1 — three places where the product was quiet about money

### The popup's cost line vanished when the count was unknown

`describeImageCount(null)` returned an empty string, and the popup renders
the cost paragraph only when that string is non-empty. The count is unknown
when the content script has not reported a scan — and the 「翻译当前页面」
button is enabled anyway.

So the popup could show a lit button to spend money with no sentence
anywhere near it saying that it costs money. Not a wrong number: no number
at all, in the one place the product exists to tell the user what a press
will cost.

The count being unknown is a fact about the scan, not about the bill. The
line now says so, and the tiling note goes with it.

### One right-click on a long strip was ten requests, and the page said "1"

The context menu's 「翻译这张图片」 sounds like one picture. On a webtoon it
is one picture and many requests: the strip is cut into tiles, and each tile
is a separate billed call. The HUD said 「第 1 张 / 1」 — true about images,
silent about the bill.

The page now computes the tile count before it starts and puts it on
screen, under the progress bar:

> 这张图是长条，会拆成 10 片分别请求（10 次调用费用）

The translation takes tens of seconds, so the sentence is on screen while the
money is being spent, and the user can still cancel.

### The diagnostics bundle could carry a private gateway's address

Round 4's fix, verified in round 5. The bundle promises 「不含 API Key、接口
地址」; the key was filtered, a URL was not. A self-hosted endpoint lives
on an intranet host, and that hostname says more about the person filing
the issue than they meant to.

---

## P2 — drift, and one claim the product could not back

- The HUD re-worded the skip reason in a second place, 120 lines from the
  one that used the shared constant. One reason, one string, now.
- The HUD said 「N 张来自缓存」 and the popup said 「N 张来自缓存（没有产生
  费用）」. The money claim lived in the popup while the user was looking
  at the HUD when the run ended. Both say it now.
- The popup's 「清除本页译文」 dialog promised that re-translating would hit
  the cache and cost nothing. It is true for the images that succeeded and
  false for the images that failed (they were never cached), for a
  different provider or model (different cache key) and for an evicted
  entry. The sentence now says which case it covers.
- The Gemini preset called the service 「免费额度友好」. That is a pricing
  claim about a third party, which the product cannot verify and which
  changes. The note now says the thing that is true — that the
  OpenAI-compatible endpoint has to be enabled in the console.
- The review notes told the store reviewer that the force-retranslate
  confirmation appears 「无论从弹窗按钮、右键菜单还是快捷键触发」. There is
  no force-retranslate item in the context menu — it has exactly two items.
  A reviewer who follows that sentence finds nothing. The notes now say
  where the confirmation actually appears, and the checklist's claim that a
  re-translate makes no requests now says which images are exempt.

---

## The pattern

Five rounds, and the same shape every time:

1. The product says something about money.
2. Somebody fixes the sentence.
3. The sentence turns out to be attached to a *layer* — the provider, the
   worker, the content script — and the layer above it has its own copy.
4. The next review finds the copy.

The fix for that is not another round of sentence-writing. It is that the
**rules now live next to the code that implements them**: the accounting
rule in `usage-recording.ts`, the cost wording in `cost-wording.ts`, the
status marker next to the function that writes it. A rule written down once
in the place that enforces it is a rule the next reviewer can check, instead
of a sentence the next reviewer has to re-derive from five surfaces.
