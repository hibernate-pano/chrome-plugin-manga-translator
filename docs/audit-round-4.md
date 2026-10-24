# Round 4 audit — verifying the fixes instead of finding new ones

Rounds 1–3 found defects. Round 4 asked a narrower question: **are the round-3
fixes actually true?**

A review that only finds new things is a review of the parts nobody looked at
twice. The most expensive bugs in this product have all been of one kind: a
sentence that says the right thing, or a counter that counts, *except* in the
one case nobody re-read. So round 4 handed two verifiers the diff of round 3
and told them to try to break it.

Each verifier was given the code, not a summary of it, and was asked to
re-derive the claims rather than trust them. What came back is below.

Severity as before: **P0** = loses money, breaks the product, or lies to the
user; **P1** = major friction or a visible defect; **P2** = polish.

---

## The panel

| Reviewer | Brief |
| --- | --- |
| money-verifier | every path where the extension spends the user's money, and every path where it reports what it spent |
| boundary-verifier | the credential boundary, and the privacy promises the diagnostics bundle makes |

## What the panel confirmed

The round-3 fixes held up. Specifically:

- **The master switch is checked where the queue runs it.** Not at enqueue
  time, where a user could turn the extension off and still be billed for
  the jobs already waiting.
- **The monthly bill is an accumulator.** It is no longer capped by the
  500-record log cap, so 「本月 N 次 API 调用」 can exceed 500 and the token
  total with it.
- **A 4xx is still not recorded.** The provider refused; there is nothing to
  bill.
- **The self-write guard can now fire.** The remembered snapshot is a deep
  copy taken before the key is obfuscated in place, so the comparison is
  between two different objects and it matches.
- **The credential boundary still holds.** The verifier recomputed the
  content script's import closure from the source tree — 44 modules — and
  found no path to `env-credentials.generated.ts`, `env-credentials.ts`,
  `preloaded-config.ts` or `utils/crypto.ts`. The built `dist/content.js`
  carries no key literal, no `obf:` prefix and no `ENV_CREDENTIALS`. The
  key lives in the service worker and nowhere else.

## What the panel got wrong

- **The boundary verifier was asked to find a hole in a boundary that does
  not have one.** It did not find one, and it said so plainly, having
  re-derived the closure rather than taking the round-3 claim on trust. A
  verifier that reports a hole it cannot demonstrate is worse than no
  verifier.
- **The money verifier's first instinct was that the 4xx handling was
  wrong.** It is not: a 4xx is the provider declining to charge, and a
  request that was refused must not appear in the bill. The verifier
  checked the distinction itself and reported it as a non-finding.

---

## P0 — one 2xx was still unbilled

### A 200 with no body at all

Round 3 fixed a specific case: a 200 whose body arrives but cannot be
parsed. The usage was being read *after* the parse, so the tokens were
thrown away on exactly the responses that had cost the most.

It left the sibling branch untouched. A gateway that answers **200 with a
body we cannot read at all** — an HTML error page served under a 200, a
truncated response, a proxy that swallows the body — took this path:

```ts
const data = httpResponse.data;
if (!data) {
  throw new Error(`${this.name} API returned no data`);
}
```

No record. The model ran, the service billed it, and the usage panel said
zero. The same class of bug, one branch further down, in the same function,
in the same round that claimed to have fixed it.

The fix is one line — record the request with zero tokens, which keeps the
count honest without inventing a number — and the comment now says why the
branch exists, because the next reader will assume it is a dead branch.

### The local model recorded nothing at all

The same question, asked of the other provider family: **when did the
extension decide a request happened?**

For the OpenAI-compatible path, the answer was "when the translator got a
usage object back". For Ollama, there was no answer — the provider recorded
nothing on any path, not even the success path, and the translator's
`recordUsage` is the only thing that ever wrote an Ollama record.

That had a visible consequence. A local model that answered with prose
instead of JSON, or with nothing, was a request the extension made and the
usage panel never mentioned. Half the providers disagreed with the other
half about what a request is.

Both provider families now route through one function —
`recordBilledRequest` in `src/providers/usage-recording.ts` — so the
definition of "a request happened" is written down once:

- 2xx with a body we cannot read → recorded, zero tokens
- 2xx with an empty answer → recorded
- 2xx with an answer we cannot parse → recorded, with the reported usage
- 4xx → not recorded (the provider refused to charge)
- a success → recorded by the translator, which has the usage

## P1 — three places where the product was not telling the truth

### The health poll could spend money every fifteen minutes

The settings page polls the provider every fifteen minutes to draw a status
dot. The poll calls `testConnection()`, and `testConnection()` has a
fallback: when the gateway does not expose `/models`, it sends a real chat
completion to prove the endpoint works. **That is a billed request.**

So the dot in the corner of the settings page was a request the user never
asked for, repeating every fifteen minutes, on a gateway that does not
implement `/models` — which is most self-hosted setups, the exact setup
where the user is watching a bill.

The probe now takes an explicit permission:

- the background poll passes `allowBillableProbe: false` and stops at the
  404, which has already proved the host is reachable and the key was not
  rejected;
- the 「测试配置」 button passes `allowBillableProbe: true`, because the
  user pressed a button whose label says a request is sent.

The provider's interface says the same thing in its own doc comment, so the
next caller has to decide rather than inherit.

### The diagnostics bundle could carry a private gateway's address

The bundle promises 「不含 API Key、接口地址」. The key was genuinely
filtered — `looksLikeSecret` knew about key prefixes, bearer headers and
long hex blobs — but it knew nothing about URLs. A self-hosted endpoint
lives on an intranet host, and that hostname is exactly the thing a user
does not want in a bug report they are about to paste into a public issue.

The guard now treats a URL as private, so the promise is enforced by the
filter rather than by the caller's good manners.

### The popup and the page said different things

The skip reason read 「太小、不在正文区域，或地址看起来不是漫画页」 in the
popup and 「太小、不在正文区域或不像漫画页」 in the HUD. The retry cost line
in the HUD left out the tiling note that the popup had.

These are the two surfaces the same user reads in the same minute — the
popup says what is about to cost money, the in-page HUD says what it cost.
A reader told "skipped" in one place and "ignored" in another has to work
out whether it is the same set of images.

`src/shared/cost-wording.ts` is now the single home for every sentence that
talks about money, and the popup, the HUD, the confirm dialog and the
in-page re-translate prompt all read from it.

## P2 — the sentence that was missing where it cost the most

The popup's force-retranslate dialog said 「已经翻译成功的图片也会重新计费」.
The **in-page** confirm — the one the keyboard shortcut raises — said
「忽略缓存，对本页全部 N 张图片重新调用 Vision LLM 翻译。会产生额外的 API
调用费用。」 and stopped there.

The half that was missing is the expensive half. A user pressing
Ctrl/⌘+Shift+X was never told that the pages they had already paid to
translate would be paid for again. The popup's button had the sentence; the
keyboard shortcut, which is the path with no button, did not.

The same sentence now appears in both places, from the same constant.

---

## The gap that was not in the code at all

Round 4 also closed a gap in the store listing that no reviewer would find,
because it is not a bug:

```
| 截图 | 1280×800 或 640×400，建议 3~5 张 | 需新制作，见下 |
```

Two screenshots existed. The listing asked for three to five, and the store
reviewer counts assets.

- **A third screenshot** — the popup, staged against a reserved example
  host (`comic.example.com`, RFC 2606) so it shows the page it would act
  on. Taken without translating anything, so it needs no provider and costs
  nothing.
- **A fourth screenshot** — the settings page, taken from the *public*
  build, so the API-key field is empty. What a store user sees on arrival is
  what the listing shows them.
- **`pnpm smoke:public`** — the credential-free package is loaded into a
  clean Chrome profile over CDP and driven through nine checks: the bundle
  carries no credential-shaped string, the extension loads, the service
  worker starts, nothing is in `chrome.storage.local`, `chrome.storage.sync`
  is empty, the popup says the provider is not configured, the settings page
  asks for a key, the page is open in a tab, and the content script answers
  on a page.

The last one existed because a byte scan of the ZIP is not the same claim as
"it works". The scan proves the package has no key in it; the smoke test
proves the package still runs.
