# Round 6 audit — does the product promise what the code does?

Rounds 4 and 5 asked about money: what costs, what gets counted, what the
words say. Round 6 asked a blunter question, over every surface the product
speaks from:

> **Where does the product promise something the code does not do?**

The surfaces: the store listing, the privacy policy, the store review notes,
the README, the onboarding wizard, the settings page, the popup. Every claim
was checked against the code that would have to implement it, and the check
was done by reading the implementation, not by reading the documentation.

Most of it holds. That is worth saying plainly: the outbound-request set is
really three kinds, the key really never reaches the content script, the
cache really does avoid a second request, the OCR assets really are bundled
locally, the allowlist really is empty by default, the four shortcuts really
do exist, the Alt-key really does fall back to the original text, the export
really does composite in the browser. The product does not lie about its
capabilities in the way a product usually does.

What it did was lie about its *limits*, in five places. All five are now
fixed, and one of them was a security guarantee the store reviewer would have
relied on.

---

## The table

| Promise (where it is made) | What the code does | Verdict | Severity |
| --- | --- | --- | --- |
| 「页面无法把扩展指向内网服务」 (`docs/store-review-notes-zh.md:38`) | The address policy checked the URL the extension *asked for*. The browser follows redirects before any extension code runs, and the final URL was never re-checked: `redirect: 'follow'` at `src/background/image-fetch-guard.ts:177`, no `response.url` check anywhere in the tree. A public host could answer with a 302 pointing at `169.254.169.254` or `127.0.0.1`, and the bytes came back to the content script. | **false** | **P0** |
| 「扩展本身不收集、不上传、不存储任何数据」 (`src/components/Onboarding/OnboardingApp.tsx:393`) | The extension *does* upload (the bullet above it says the comic images go to the provider) and *does* store (the API key, the translation cache, the usage counters — `src/stores/config-v2.ts`, `src/stores/cache-v2.ts`, `src/stores/usage-store.ts`). The sentence was about the developer, in words that said the extension. | **false** | **P1** |
| 「内容脚本只拿到端点、模型名以及「是否已配置密钥」这一个布尔值」 (`docs/store-review-notes-zh.md:48`, `docs/privacy-policy.md:68`) | The snapshot (`src/shared/content-config.ts:181-245`) also carries `enabled`, `provider`, `targetLanguage`, `translationStylePreset`, `autoContinueEnabled`, `autoTranslateHosts`, `cacheEnabled`, `parallelLimit`, `regionBatchSize`, `translationPipeline`, `fallbackToFullImage`, `maxImageSize`, `overlayStyle`. The credential half of the sentence is true; the whole sentence is not. | **overstated** | **P1** |
| 「扩展不收集、不上传任何数据」 (`src/components/Options/OptionsApp.tsx:1768`) | Nothing is sent anywhere on its own, and the bundle only reaches the clipboard when the button is pressed — but the sentence says the extension uploads nothing, and the extension's whole job is uploading images to the provider the user chose. | **overstated** | **P1** |
| 「中英日韩气泡、4000px 长条漫、跨域图片、应当被跳过的内容」 and 「自包含测试页（图片内联生成，不依赖网络）」 (`docs/store-review-notes-zh.md:73`) | The smoke-test page has Japanese, English and Korean bubbles — no Chinese. Section 3 is a real `<img>` from `upload.wikimedia.org`, so it needs the network. | **false** | **P2** |
| 「It generates its images inline, so it needs no network」 (`docs/chrome-web-store-release.md:345`) | The same page, described the same way, twenty lines after the same document says the cross-origin fixture 「needs a route to `upload.wikimedia.org`」. The document contradicted itself. | **false** | **P2** |
| 「第 1 栏两个气泡」 (`docs/store-review-notes-zh.md:82`) and 「both bubbles in panel 1」 (`docs/chrome-web-store-release.md:370`) | The first panel has three bubbles (two Japanese lines, two Korean lines, one English line). | **false** | **P2** |
| 「译文阅读面板里每条译文都能展开查看识别到的日文原文」 (`docs/store-listing-zh.md:34`) | The panel shows the text the model read, whatever language that was — the OCR set is Korean, Japanese, English and Simplified Chinese. | **overstated** | **P2** |
| 「可用的翻译后端」 (`src/components/Onboarding/OnboardingApp.tsx:406`) | It lists the backends the *build* preloaded, with a green check. Nothing ever checks whether a local backend is running or has its model pulled. | **overstated** | **P2** |
| The version table's three 「current」 rows (`README.md:224-226`) | The released version is v2.0.4; v2.0.2 was missing from the table entirely. | **stale** | **P2** |
| 「A wrong model name fails on the first request with an error that says nothing useful」 (`README.md:74`) | There is a `MODEL_NOT_FOUND` code with its own friendly message and a copyable `ollama pull` command. The sentence described a version of the product that no longer exists. | **stale** | **P2** |

---

## The top five, by how much damage each would do

### 1. The redirect hole (P0)

A store reviewer reads 「页面无法把扩展指向内网服务」 and stops asking. A
security-minded user reads it and stops worrying. Both are wrong.

The shape of the bug: `fetchImageBytes` validates the URL it is given and
then asks the browser to follow redirects. The browser follows them. A public
host that the extension is willing to fetch can answer with a 302 whose
target is the cloud metadata service, and the extension would fetch it and
hand the bytes back to the content script, which uploads them to the provider.
The address policy — `metadata.google.internal`, the private IPv4 and IPv6
ranges, `localhost` — was checked on the *first* URL and nowhere else.

The fix is half technical and half honest:

- the final URL now goes through the same policy, and a response that ended
  up somewhere internal is dropped unread (`src/background/image-fetch-guard.ts`);
- and the documentation says what a guard in a service worker *cannot* do.
  Nothing available to an extension lets it refuse a hop and still read the
  target, so the request to the internal address has already happened by the
  time the response arrives. The policy stops the read; it does not stop the
  ping. The review notes and the privacy policy now say that in as many
  words, which is the only kind of claim that survives a reviewer who tests
  it.

The regression test is in `image-fetch-guard.test.ts`: a response whose final
URL is `169.254.169.254` fails, one that landed on another public host
succeeds, and the body of the blocked one is never read.

### 2. The onboarding contradicting itself (P1)

The first-run disclosure is the one screen a user reads at the moment they
decide to trust the extension with their comic pages. It had four bullets:

> 翻译时……漫画图片会被发送给你选择的服务商 —— 图片会离开这台机器。
> 这会产生费用……
> 扩展本身不收集、不上传、不存储任何数据；API Key 只保存在本机……
> 若希望图片完全不离开本机，请改用本地服务商。

The third bullet is false twice over — the extension uploads (bullet one) and
stores (the API key, in the same sentence). A reader who takes the third
bullet literally and the first one lightly concludes two contradictory things
about the same click. It now says 「扩展开发者不收集、不接收、不存储任何数据」
— the developer, which is what every other surface already said, and what the
code actually does.

### 3. The content-script snapshot (P1)

「内容脚本只拿到端点、模型名以及「是否已配置密钥」这一个布尔值」 is the kind
of sentence a reviewer does not check, because it is obviously about
credentials. It is also, literally, wrong: the content script's snapshot
carries thirteen settings besides the key flag. They are preferences, not
credentials, and nothing leaks — but the sentence as written describes a
smaller thing than the code has. Both documents now say what the snapshot
actually contains.

### 4. The diagnostics note (P1)

「扩展不收集、不上传任何数据。」 — sitting directly above a button whose job
is to put data on the clipboard, in a section whose whole point is 「copy
this and paste it into an issue」. The intent is clear (nothing is sent
anywhere on its own) and the sentence does not say it. It does now.

### 5. The smoke-test page (P2)

The review notes tell the reviewer how to test the product, and three of the
instructions were wrong: a Chinese bubble that does not exist, a first panel
that has three bubbles instead of two, and a page described as needing no
network when one of its four sections is a real cross-origin image. A
reviewer who follows the instructions and counts bubbles concludes that a
translation is missing. Small damage, but it lands on the one document whose
job is to make the review go smoothly.

The release checklist made the same two mistakes about the same page, and
added a third: it says the fixture 「generates its images inline, so it needs
no network」 twenty lines before it says the cross-origin image 「needs a
route to `upload.wikimedia.org`」. A document that contradicts itself about
its own fixture is the one a reviewer is most likely to notice.

---

## The pattern, again

Round 5's finding was that each fix moves the problem one layer down. Round
6's is the same shape one layer out: **the product's own documentation is
now the last place where the truth lives.**

Every surface was checked against the implementation, and the implementation
was right more often than not. The failures were all in the sentences — and
they were failures of a specific kind: a sentence that was true once, about a
version of the code that no longer existed, and that nobody went back to
check. The version table. The error-handling claim. The content-script
snapshot. The smoke-test page's contents.

That is what a promise is: a sentence that will outlive the code it
describes. Two things keep a promise alive:

1. **the code anchor** — `docs/store-claims.md` already checks that the code
   behind each outward-facing claim still exists. It cannot check that the
   claim still means the same thing; the new row for the redirect check is
   the first one that pins a *limit* rather than a capability.
2. **the review** — which is what this round was.

The rule that came out of it, for the next round: **check the sentences that
describe limits and contents, not the sentences that describe features.**
Features get tested by using them. Limits get believed.
