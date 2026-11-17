# Round 15 audit — 失败是双侧的：模型点火，插件浇油

这一轮从 Jasper 的两句话开始：

> 下一步是关于这个翻译软件又快又好的要求：1. 准确度以及翻译速度。2. 出现错误
> 的重试及反馈机制，还可以告诉用户为什么会失败。我觉得失败的概率比较高吧，
> 最近在我用起来，可能是模型的原因，或者是插件的问题，这个都需要深入分析。

本轮是**只读审计**：没有发起模型请求，没有花钱，没有改任何生产代码。结论来自
源码路径推演、现有测试（1527 个全绿）、真实 Chrome 截图与 tesseract.js 7 的
实际输出形状。测试全绿本身不是证据——这一轮恰好发现，最严重的一个准确度问题
被测试里的 mock 形状盖住了（见 §4.1）。

---

## 摘要

1. **失败确实常常由模型触发，但把它放大成「整轮停」的是插件。** 取图 403、
   429、超时、schema 不合，都有可恢复的处理方式；当前代码把它们当成了同一类
   致命错误。
2. **五条确定性链路**（触发条件成立就每次必现）：取图 403 中止整轮、无扩展名
   CDN 被判网络错误、老用户卡在坏掉的 OCR 管线、测试连接不验视觉能力、空答案
   被永久缓存。
3. **准确度的问题大多是静默的**：日文残留、坐标丢失、精修不跑、接缝气泡被切
   开——都不计入 `missingCount`，HUD 照样说「翻译完成」。
4. **速度的主要成本是请求波数，不是本地计算**：并发被硬编码夹在 2–3；长条漫
   每一片重新下载整条图；失败尾延迟可到 181 秒/图。
5. **反馈链断在最关键的一环**：失败只剩一条面向读者的字符串，没有错误码、
   HTTP 状态、尝试次数、原始响应；诊断包里的 `lastError` 永远是 `null`。

---

## 一、失败：五条确定性链路

### 1.1 一张 CDN 图 403，整轮中止（最凶）

**链路：**

```
image-fetch-guard.ts:211   `Failed to fetch image: ${response.status}`
image-processor.ts:407     包装成 "Failed to fetch image via background: ..."
translator.ts:626          catch 后把原始字符串放进 TranslationResult.error
content.ts:1335            new Error(result.error) —— 原始字符串
content.ts:100             FATAL_ERROR_PATTERNS 里的 /\b403\b/
content.ts:2130            isFatalTranslationError(error.message) → abort()
```

**触发条件：** 跨域图片（canvas 被 taint）→ 后台代理取图 → CDN 因防盗链、登录
墙或 UA 策略返回 403。代理请求带的是 `credentials: 'omit'`，也不带页面的
Referer，所以这类 CDN 拒绝它是常见结果。

**用户看到：** HUD 报「这张图片没能取回来」，然后整轮提前结束；剩下的图既没有
翻译，也不在「重新翻译失败的 N 张」里（`content.ts:2204-2210` 把它们标成
「已问过」）。用户体感就是「这插件经常挂」。

**为什么是确定性：** 403 是 HTTP 状态，字符串里一定有 `403`；正则一定命中。

**修法：** 致命判定改用 `parseTranslationError(error).code`，只让
AUTH / RATE_LIMIT / QUOTA / CONFIG_MISSING 中止；`IMAGE_FETCH_ERROR` 永不致命。
取图错误本身已经能给出「站点拒绝下载」的准确建议，不需要中止整页。

### 1.2 无扩展名 CDN 被判成「网络连接失败」

**链路：**

```
background.ts:1075-1079   跨域 URL 必须先过扩展名白名单
                          → 'Image fetch not allowed for this page'
error-handler.ts:586-591   消息里含 "fetch" → NETWORK_ERROR
```

**触发条件：** 跨域图 URL 是 `/image?id=...`、`/img/abc123` 这类没有
`.jpg/.png/.webp` 后缀的地址。大量 CDN 和签名图床都是这种形状。

**用户看到：** 「网络连接失败，请检查网络」——然后真的去查自己的网。这正是
`error-handler.ts:520-526` 注释里想避免、但没覆盖到的那类错误。

**修法：** 跨域代理不再靠扩展名判断，改成「先取，再用 `Content-Type` 和大小
校验」；把这条消息归到 `IMAGE_FETCH_ERROR`，并在文案里点名 host。

### 1.3 老用户卡在 hybrid 管线，而 OCR 在 tesseract.js 7 上恒为空

**链路：**

```
content-config.ts:232-235  持久化的 'hybrid-regions' 被原样接受，没有迁移
translator.ts:1181         走 hybrid 管线
text-detector.ts:187       读 (data as any).words
tesseract.js 7              默认 output = { text: true }，dump 里没有 words
                            （node_modules/tesseract.js/src/worker-script/utils/dump.js:69-92）
→ detectTextRegions() 恒返回 regions: []
→ translator.ts:1321-1327 抛 NoTextDetectedError
→ 有 fallback 则回退整图；关掉 fallback 则每张图直接失败
```

**用户看到：** 每张图先卡一段 OCR（首次还要从 jsdelivr 下载语言包；国内经常
不可达），然后回退；关掉回退的用户每张都失败。

**为什么测试没抓到：** `src/services/text-detector.test.ts:9-42` mock 了
`data.words`，那是 v4/v5 的形状，不是 v7 的。测试测的是一个不存在的输出。

**修法：** 读 `blocks[].paragraphs[].lines[].words`（或
`recognize(image, opts, { blocks: true })`）；「有 text 但解析出 0 region」必须
抛形状错误，绝不能降级成「这页没字」。同时把旧的 `hybrid-regions` 值迁移到
`full-image-vlm`。

### 1.4 测试连接不验模型，也不验视觉能力

**链路：**

```
openai-compatible-base.ts:295-302   GET /models 返回 200 → 「已连接」
openai-compatible-base.ts:365+      404 时的兜底探针是纯文本 "ping"
```

**触发条件：** 模型名拼错但网关的 `/models` 可用；或选了一个纯文本模型；或
`baseUrl` 指向一个会返回 200 但不支持 `image_url` 的聚合网关。

**用户看到：** 设置里「测试连接」成功，然后每一张图都失败（400/404）。404
不在致命列表里，所以 20 张图会各失败一次，看起来像「失败率很高」。

**修法：** `/models` 命中后检查 `config.model` 是否在列表里（归一化前缀）；
显式「测试配置」按钮发一张 1×1 PNG，要求模型返回 JSON，直接验证视觉与
schema。失败文案说「这个模型不接受图片」，而不是「参数错误」。

### 1.5 空答案被当成「这页没字」，永久缓存

**链路：**

```
base.ts:243   "No text found: {"textAreas":[]}"
base.ts:247   "If the image is unreadable or empty, return {"textAreas":[]}"
translator.ts:602-608   answeredNoText = textAreas.length === 0 → 写缓存
translator.ts:574-581   条漫路径同一口径
```

**关键矛盾：** 提示词明确让模型「读不出也返回空数组」。所以空数组既可能是
「这页真的没字」，也可能是「模型没读出来」。缓存却把它当成前者。

**用户看到：** HUD 说「翻译完成」，页面原样；下次打开命中缓存，不会再问。
`missingCount` 是 0，没有任何失败信号。

**修法：** 空答案不写缓存（或写一个短 TTL 的「空」标记）；至少在 HUD 里把
「模型认为这页没有文字」显式说出来，并给单图重试/换模型的入口。

---

## 二、模型侧：真正会触发失败的四件事

模型侧不是无辜的，但它的失败面比想象中窄：

1. **schema 不合**（缺 `textAreas`、纯文本、截断）。`base.ts:341-359` 抛英文
   错误 → `UNKNOWN_ERROR` → 不可重试；`isReaderFacingMessage` 又把英文原文
   过滤掉（`error-handler.ts:131-137`），用户只剩「发生未知错误」。
2. **token 预算**。`MAX_TOKENS = 4096`（`constants.ts:24`）。密集页或多气泡
   页容易被截断；截断被归成 `PARAM_ERROR`，不可重试。推理型模型还会先把预算
   花在 thinking 上；当前只有 MiniMax 分支显式 `thinking: disabled`。
3. **429 / 额度**。额度耗尽和每分钟限流都被归成 429，同一句「请求过于频繁」；
   没有 `Retry-After`，退避固定 1 秒。
4. **日文残留 / 复述原文**。没有任何语言纯度校验，直接算成功。

把这几件和 §1 的放大链放在一起，就能解释「时好时坏」：同一张图重试可能成功，
换一张密集页又失败；失败一次之后，插件决定是否把整页停掉。

---

## 三、重试：现在重什么、该重什么

| 错误 | 现在的行为 | 应该 |
| --- | --- | --- |
| 401/403（provider） | 切片先重试一轮，然后整轮中止 | 不重试，第一张就中止 |
| 403（取图） | **命中致命正则，整轮中止** | 只这一张失败，绝不中止 |
| 404（模型不存在） | 不重试，但每张图各失败一次 | 第一张就中止，直接说模型名不对 |
| 400（参数/不支持图片） | 多半落 `UNKNOWN_ERROR`，每张各失败 | 第一张就中止 + 说人话 |
| 429 | 1 秒后重试 → 仍 429 → 整轮中止 | 读 `Retry-After`，暂停队列，退避后继续 |
| 超时（408） | 90 秒 × 2 = 181 秒 | 只试一次，或切片 45–60 秒 |
| 解析失败 | 重试 1 次 | 保留，并加结构化输出 |
| 取图失败 | 没有自动重试；手动重试必然再失败 | 按原因分类；403/防盗链不提供重试 |
| 切片失败 | **所有失败切片无条件重试**（`translator.ts:902-938`） | 只重试可重试的 |

请求放大最坏情况：3 片条漫 = 3 次首轮 + 3 次切片重试 + 2 次整图回退 = 8 次；
5 片 = 12 次。429 在内容层中止之前，3 个并发还会同时各打一轮。

---

## 四、准确度：五种「假成功」

### 4.1 语言纯度没有校验

`base.ts:413-420` 只要求 `translatedText` 是字符串。模型复述原文、只翻一半、
保留日文拟声词，都会照画不误；不透明覆盖层盖住原文，读者看到的还是日文，系统
认为成功。`preserve-original` 风格要豁免（它故意保留原文拟声词）。

### 4.2 坐标缺失被当成 0，字符串坐标被静默丢弃

- `base.ts:376-380`：`x/y/width/height` 为 `undefined` 是合法的；
  `clampRatio(undefined)` 返回 0（`base.ts:449-454`）。模型漏给 x/y 但有宽高时，
  译文画在左上角。
- 坐标是字符串（`"0.5"`）时整个条目被 `continue` 丢掉，**不计数**
  （`base.ts:381-389`）。
- `base.ts:430-441` 裁剪后 `width/height` 可能变成 0，但没有再丢一次；
  渲染器会给零尺寸框生成最小面板，贴在图片边缘。

### 4.3 像素精修在最常见的两类页面上不跑

`text-box-refiner.service.ts:34` 把分析图长边固定为 1400。8000px 条漫的缩放
系数是 0.175，40px 的字只剩 7px；而字形组件的最小尺寸是 8px
（`text-box-refiner.ts:54,67`），直接被过滤。跨域图绘制到 canvas 会 taint，
`getImageData` 抛错后返回 `null`（`text-box-refiner.service.ts:67-96`）。

结果：**长条漫和 CDN 跨域图——日文最容易露出来的两类页面——精修恰好不工作。**
`ab05243` 声称修掉的问题，在这两类页面上等于没做。

### 4.4 切片接缝上的大气泡被切开

`TILE_HEIGHT = 1152`、`TILE_OVERLAP = 96`（`translator.ts:253-261`）。一个
150–250px 高的竖排气泡跨过切片底边时，上面的切片截掉下半，下面的截掉上半；
去重又保留上面的那份（`translator.ts:329-366`）。`translatedText` 非空，
`missingCount` 不增加。现有测试只覆盖 40px 气泡
（`translator-tiles.test.ts:182-204`）。

### 4.5 部分失败也写缓存，缓存 key 不含提示词版本

`translator.ts:1018-1052` 在部分切片失败但已有译文时返回 `success: true` 并写
缓存；拼图路径缺失 ≤40% 也算成功（`:1362-1365`）。缓存 key
（`translator.ts:774-804`）包含 provider/model/baseUrl/语言/风格/管线版本，但
`HYBRID_PIPELINE_VERSION` / `TILED_PIPELINE_VERSION` 长期固定；提示词改过却没
bump 版本，老缓存会继续命中旧译文。

**可观测性：** 以上五种都不进 `missingCount`。`missingCount` 只覆盖「有框但译文
为空」「切片没回答」「拼图 region 缺失」；漏检、接缝、日文残留、坐标丢弃都不算。
诊断包也没有这些字段（`diagnostics.ts:64-87`）。

---

## 五、速度：三个瓶颈

### 5.1 波数：并发被硬编码夹在 2–3

三层夹子：

```
page-translation-utils.ts:1-14   MIN=2, MAX=3 → 1 变 2，5 变 3
translator.ts:853-856            切片池 Math.min(3, ...)
background.ts:94-97              队列默认 3，请求间隔 500ms
```

UI 提供 1/3/5（`OptionsApp.tsx:93-97`），测试还把 1→2、5→3 写死
（`content.test.ts:258-269`）。20 张普通页从并发 3 的 7 波降到并发 5 的 4 波，
理论上是 1.75×；20 条条漫从 54 波降到 32 波，1.7×。这是最便宜的一刀。

### 5.2 长条漫每一片重新下载整条图

`translateImage` 先对整图做一次 `processImage`（`translator.ts:493`），然后才
判断切片（`:525`）；`translateTile` 对每一片再调一次 `processImage`
（`:1073-1083`）。跨域图走 `processImageViaBackground`
（`image-processor.ts:388-465`），每次都是整图下载 + 解码。

一条 8000px 的条漫 = 1 次整图 hash 编码 + 8 次整图下载与解码。本地开销占这条
路径的 60–80%。这也解释了为什么「翻长条漫特别慢、特别费」。

### 5.3 失败尾延迟

单次超时 90 秒（云端）/120 秒（Ollama），超时被标为可重试，整图路径 2 次尝试
（`translator.ts:1217-1233`）→ 单图 181 秒。切片失败立即重试、全部失败再回退
整图；一条 8 片条漫全超时约 7.5 分钟。20 页全超时约 21 分钟。超时不是致命
错误，所以整章会一直跑下去。

### 5.4 主线程

`canvas.toDataURL` 是同步的（`image-processor.ts:299`），每片一次；像素精修
也是主线程 O(pixels)（`text-box-refiner.service.ts:42-97`）。页面池的 3 个
「并发」图片，模型请求是并行的，编码和精修仍然串行。

---

## 六、反馈：现在能说什么、不能说什么

**已经做到（比多数同类产品好）：**

- 每张图单独记失败原因，HUD 最多列 3 条（`floating-hud.ts:653-671`）；
- 图上红色角标（`failure-badges.ts`）；
- 实时失败数，不用等整轮结束（`content.ts:2118-2128`）；
- 弹窗「重新翻译失败的 N 张」+ 计费说明；
- 错误建议与动作按钮（打开设置、复制 `ollama pull` 命令）。

**缺的：**

- 失败只剩 `message`。`parseTranslationError(error).message` 丢掉了 `suggestion`、
  `action`、`code`、`status`（`content.ts:2098-2101`）。
- 面向读者的过滤器只放行 ≤120 字符且含中文的消息
  （`error-handler.ts:131-137`），英文 provider 原文一律丢弃；`UNKNOWN` 才打
  console。PARSE/PARAM/RATE 的原文在正式构建里既不显示也不记录。
- 诊断包的 `lastError` 永远是 `null`：`OptionsApp.tsx:710-729` 根本没传。
- `background.ts:1002-1009` 的 `detectedRegions/ocrMs/translateMs/retryCount`
  全部硬编码 0，内容脚本也不消费。
- HUD 的致命错误卡没有重试按钮（`floating-hud.ts:617-637`）；fatal 之后未到达
  的图不进 `failedImages`，只被标成「已问过」。
- 失败角标的宿主是 `pointer-events: none`，`.badge` 没恢复 `auto`
  （`failure-badges.ts:43,51-76`），所以 `title` 的原因提示永远出不来。
- 没有从 HUD/弹窗直接复制诊断包的入口，只有设置页。

**目标形态：**

```
FriendlyError { code, category, message, suggestion, retryable, status?, detail? }
ImageFailure  { index, code, category, message, suggestion, status?, attempts, pipeline }
```

`category` 四类：`model`（模型输出/能力）、`provider`（限流/额度/5xx）、
`site`（取图/防盗链）、`extension`（配置/管线/内部）。HUD 主行只放 `message` +
一个类别标记，建议折叠；诊断包放全部字段。这样用户知道「下一步做什么」，支持
知道「到底是哪一类」。

---

## 七、产品与发布

### 7.1 已发布的 2.3.0 有两个 P0 体验 bug

1. **popup 在浏览器缩放 >100% 时破版。** `index.css:29-34` 把 body 写死
   `360×600; overflow:hidden`，`PopupApp.tsx:970` 根节点同样固定。125% 缩放
   （288×480 CSS 视口）时文档和内部面板各出现一条滚动条，「计费张数」整列和
   右上两个按钮被切掉。建议 `min(360px,100vw)` / `min(600px,100vh)`。
2. **首次引导在小窗口/高缩放下按钮不可达。** `OnboardingApp.tsx:258-267`
   的 `fixed inset-0` + `p-8` 没有 `max-height`/`overflow`；640×400 时
   「跳过引导」「稍后再设置」都在屏幕外，且无法滚动。这是首次使用的必经之路。

另：默认主题里 11–12px 的朱红错误文案只有 3.90:1（`PopupApp.tsx:1296` 等），
低于 4.5:1；内容脚本已经知道并绕开了（`floating-hud.ts:901-910`），React 侧
没有。

### 7.2 未发布的三套主题

- **两个花钱的弹窗永远不上主题**：`content.ts:3152-3161` 的
  `applyCurrentTheme()` 只刷 hud/readingPanel/readingAnchors/failureBadges；
  `image-export-dialog.ts:145` 和 `force-retranslate-confirm.ts:94` 在构造时写死
  `DEFAULT_THEME`，两处 `setTheme()` 全仓库没有调用点。分镜黑下打开确认框，
  黑页面中央会弹出一张浅色纸。
- **分镜黑下 5 处对比度不达标**：`color:#fff` on vermilion = 3.56:1
  （`floating-hud.ts:1008,1021`、`failure-badges.ts:65`、
  `image-export-dialog.ts:520`、`force-retranslate-confirm.ts:323`）；
  `#b3261e` on `#0B0B0B` = 3.01:1（`image-export-dialog.ts:467`）。
  `--mt-on-accent` 本来就是为这件事存在的。
- 主题名写死「校正紙」：`OptionsApp.tsx:1548`、`OnboardingApp.tsx:280`。
- 首帧闪白：主题异步读 storage，深色主题用户每次开 popup 会看到一帧校正紙。
- 三套主题目前是同一骨架 + 调色板 + 6 个排版变量，不是三套骨架。如果这是有意
  的 V1，写进文档；如果按批准的方向还有骨架差异，那部分没落地。

### 7.3 发布纪律

`public/manifest.json` 仍是 2.3.0，线上也是 2.3.0，但 `3b70835`/`649ca9c` 在
2.3.0 上架之后又改了界面。**main 的字节和线上包已经不是同一份，版本号却是同一个。**
下次打包前必须升版本（2.4.0）。CHANGELOG 的 2.3.0 条目已经被事后改写成包含三套
主题，而线上 2.3.0 没有这些字节——这条也要修。

商店首图 `store/listing/screenshot-1280x800.png` 仍是旧的深色 HUD，而
`docs/store-release-log.md:44` 写着「Dashboard 手动换成校正紙版」。台账和事实
不符，要重拍并改台账。

---

## 八、行动清单

### P0 — 止血（3–4 天，建议先做）

1. 致命判定改用错误分类；取图错误永不中止整轮；404/400 连续 2 张则中止；
   429 退避继续而不是中止。
2. 测试连接增加「模型存在 + 1×1 视觉探测」。
3. 取图：`currentSrc || src`；去掉扩展名白名单，改 content-type 校验；
   `Image fetch not allowed` 归到 `IMAGE_FETCH_ERROR`；每图取一次字节，切片复用。
4. OCR：修 tesseract.js 7 字段；形状错误硬报；旧 `hybrid-regions` 迁移；
   空数组不写缓存（或短 TTL）。
5. 失败元数据：`ImageFailure` 带 code/status/attempts/suggestion；HUD 显示建议；
   诊断包补 `lastError`、失败列表、pipeline；修硬编码 0。
6. 发布前必修：版本 2.4.0；popup/onboarding 两个缩放 bug；两个弹窗接主题；
   panel 对比度；商店首图与台账；写死的「校正紙」标签。

### P1 — 准确度（3–5 天）

7. 输出硬校验：语言纯度、坐标必填、尺度归一化、零面积丢弃并计数、所有丢弃
   条目计入 `unplacedCount`、切片/拼图透传。
8. `response_format: json_object` / Ollama `format: 'json'`；schema 失败重试一次。
9. 提示词：禁止复述原文、竖排右起阅读顺序、ruby 处理、不要翻页码/水印/
   站点 UI、一气泡一条目、schema 类型说明。
10. 精修覆盖跨域与长条（复用 P0-3 的字节；按切片在原分辨率分析）。
11. `TILE_OVERLAP` 96 → 256。
12. 分辨率默认保持 1024，但把「1536 = 准确度优先」写明；在出现空答案/漏译时
    提示用户调高，而不是静默改默认（那会直接抬费用）。

### P2 — 速度与打磨（按数据决定）

13. OffscreenCanvas 异步编码；精修分块或 `requestIdleCallback`。
14. 并发真正生效（1/3/5/8），本地 provider 默认 1–2；配 429 自适应。
15. 切片渐进渲染；ETA 按请求数而不是图片数。
16. Ollama 去掉每个请求前的两次 `/api/tags`。
17. 失败角标可点击看原因；`missingCount` 在图上画标记。
18. content.js 预算预警（现在 188,519 B / 204,800 B = 92.1%）；`scripts/` 纳入
    覆盖率分母；CI 加 `smoke:public` 与依赖扫描。

---

## 九、审计边界

- 没有发起真实模型请求，没有花任何人的钱。
- 本文件最初提交时没有改生产代码。第八节 P0/P1 的修复从 2026-11-17 开始
  落到 `main`，逐项状态见第十节。
- 失败率的具体比例无法从代码得出。要得出，先做 P0-5（失败元数据）——那之后
  一周的真实数据会比任何推演都准。
- 结论以当前 `main` 为准；2.3.0 线上包与 `main` 的 UI 字节不同，翻译管线相同。

---

## 十、修复记录（2026-11-17）

这一轮的原则：不增加任何一次额外的模型请求。所有"更准"的改动都只改
**收到答案之后怎么读**，不改"问几次"。

### 已完成

| 项 | 落点 | 说明 |
| --- | --- | --- |
| 取图失败不再中止整轮 | `content.ts` `shouldAbortRun` | 按错误码判定：密钥/未配置/额度/来源拦截立即停；模型不存在/参数错连停两次；429 连停三次；取图错误永不中止。 |
| 无扩展名 CDN 放行 | `background.ts` | 去掉扩展名白名单，护栏改为响应 `Content-Type`、大小和私网检查。`/image?id=…` 不再被当成网络错误。 |
| 取图字节复用 | `image-processor.ts` | 背景取图结果缓存为 blob URL（60 秒、最多 4 张），一条 N 片的长条从 N+1 次下载降到 1 次；blob 同源，canvas 不再 taint。 |
| OCR v7 适配 | `text-detector.ts` | `recognize(..., { blocks: true })`，从 `blocks[].paragraphs[].lines[].words` 读词框；有文本却无词框、或两种形状都没有时硬报错，绝不当作"没字"。旧 `words` 形状仍兼容。 |
| 旧 `hybrid-regions` 迁移 | `content-config.ts` | 持久化的旧值统一读成 `full-image-vlm`，老用户不再每张图白跑一次必然失败的 OCR。 |
| 空答案限时 | `translator.ts` + `cache-v2.ts` | "没有文字"只信 24 小时（`EMPTY_ANSWER_TTL_MS`）；真实译文仍永久缓存。过期条目用 tombstone 删除，避免其他标签页合并时复活。 |
| 坐标硬校验 | `providers/base.ts` | 四个坐标必须是有限数字，缺失/字符串一律丢弃并计入 `unplacedCount`；百分比坐标（≥4 且 ≤100）自动除以 100；`originalText` 非字符串安全转换。 |
| 接缝去重留大框 | `translator.ts` `filterOverlapDuplicates` | 同一气泡被上下两片各看到一次时，保留面积更大的那个框，而不是数组里靠前的那个（上片往往只看到被切掉一半的气泡）。 |
| JSON 结构化输出 | 两个 provider | OpenAI 兼容加 `response_format: json_object`，被网关拒绝时自动去掉并记住该端点（每会话最多多一次免费 4xx）；Ollama 加 `format: 'json'`。 |
| 提示词补强 | `providers/base.ts` | 禁止复述原文/加罗马音、竖排右起、忽略 ruby、不翻页码/水印/站点 UI、一气泡一条目、坐标必填；`\n` 转义修正。未 bump 缓存版本，避免强制重翻。 |
| 测试连接查模型名 | `openai-compatible-base.ts` | `/models` 200 时核对配置的模型是否在列表里；不在则给出警告（不判失败，避免别名误伤）。仍未做计费视觉探测。 |
| 失败原因与建议 | `runtime-contracts.ts`、`content.ts`、`floating-hud.ts` | `ImageFailure` 增加 `code/category/suggestion/status`；HUD 每条失败多一行"现在怎么办"。 |
| 诊断计时 | `background.ts` | `totalMs/translateMs` 用真实耗时，`detectedRegions` 用真实区域数，不再是硬编码 0。 |
| 并发真正生效 | `page-translation-utils.ts` | 夹取范围从 2–3 改为 1–5，与设置页的 1/3/5 对齐；默认仍是 3，不改变现有费用。 |
| Ollama 少问两遍 | `ollama.ts` | 校验结果模块级缓存 60 秒（只缓存成功），每张切片不再各发两次 `/api/tags`。 |
| 缩放与主题 | `index.css`、`PopupApp.tsx`、`OnboardingApp.tsx`、两个弹窗 | popup 用 `min(360px,100vw) / min(600px,100vh)`；引导页可滚动；导出弹窗和重翻确认框在打开时接收当前主题。 |

### 明确未做（以及为什么）

- **视觉能力探测**：真正能证明"这个模型看得懂图"的只有一次带图请求。默认
  不发，避免每次「测试连接」都花钱。
- **语言纯度自动重试**：`translatedText === originalText` 可能是 `preserve-original`
  的正常结果，自动重试会直接增加费用。需要先有"未翻译"计数入口。
- **`TILE_OVERLAP` 96 → 256**：接缝处的大气泡问题仍然存在，但加大重叠会让
  每片都更贵；先用失败数据判断值不值得。
- **诊断包 `lastError` / 失败列表**：设置页拿不到当前标签页的内容脚本状态，
  要新增一条跨上下文消息；本轮优先保证页面内反馈。
- **版本号**：仍是 2.3.0。2.3.0 已在商店，下次打包前必须升 2.4.0 并重拍首图；
  本轮没有发布动作。

