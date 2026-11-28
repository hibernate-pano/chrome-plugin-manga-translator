# 商店发版台账

每条记录按**证据**写，不按**预期**写。商店 API 有三处「HTTP 200 但事情没成」，
所以这里记的是判据本身（谁说的、说了什么），不是「应该成功了」。

判据速查（`chrome-store-release` skill 的那张表）：

| 证据 | 该写什么 |
| --- | --- |
| upload 回 200 + `uploadState: SUCCEEDED` | 包已进草稿（还要看草稿 `crxVersion`） |
| publish 回 2xx 且 v2 回包带 `publishType` | 已提交审核 |
| 再发一次 publish → 400「in review」 | 确实进了审核队列（自证） |
| 公开页 `Version` 变了 | **已上架** |
| 公开页抓不到版本号 | **还没上架**，不许说已上架 |

## v2.3.3 — 2026-11-28 合并 / **未提审**（等 2.3.2 审核位）

| 发生了什么 | 证据（commit / CI run） | 审核状态 |
| --- | --- | --- |
| OCR worker 迁扩展自身 origin：`chrome.offscreen`（reason `WORKERS`，Chrome 113+）为默认通道，Chrome 110–112 退回页内 blob；删除扩展 origin iframe 通道（每会话令牌在 iframe URL fragment，页面脚本可读）；offscreen 任务串行化、worker 复用；`THIRD-PARTY-NOTICES` 随包（`zip -j`，缺文件拒绝打包）；vite 7.3.8、postcss 8.5.29、vitest 5.1.2、typescript-eslint 8.74.0 升级，NOTICE 版本随 #11 校正 | PR #15 合并 `2c8ea54`（2026-11-28）；PR CI run `46130231552` 5/5；合并后 main push CI run `46132567273` success；依赖 PR #11 `a352aea`、#12 `e79f7d9`、#13 `2431995`、#16 `710b617`、#17 `f934101` | **未提审**；`fetchStatus`（2026-11-28）submitted 仍是 2.3.2 `PENDING_REVIEW`，线上 `PUBLISHED` 2.3.0 |

**结论：代码已在 main，等 2.3.2 审核结束再上传 2.3.3 包。**

## v2.3.2 — 2026-11-27 合并 / **审核中**（线上仍是 2.3.0）

| 发生了什么 | 证据（commit / CI run） | 审核状态 |
| --- | --- | --- |
| 修复 2.3.1 的 Blue Argon 驳回：构建期改写 tesseract.js 三处 CDN 默认值（worker / core / 语言包），四种语言包随包（ZIP 2.78 MB → 11.03 MB）；新增 `checkNoRemoteCode`、`checkTesseractAssetsLocal` 与 `symbol==literal` 锚点；隐私政策出站请求由三类改两类 | PR #14 合并 `bf72dd8`（2026-11-27）；PR CI run `45977171277` 5/5；`release/manga-translator-v2.3.2-public.zip` 11,033,783 B，sha256 `9a8803b8…` | **PENDING_REVIEW**（2.3.2）；`fetchStatus`（2026-11-28）：`published=PUBLISHED` 2.3.0、`submitted=PENDING_REVIEW` 2.3.2、`warned=true` |

**结论：已进入审核队列，尚未上架。提审时的 upload / publish 回包没有写进仓库（这一版之前没有台账记录）。**

## v2.3.1 — 2026-11-17 tag / **被驳回**（Blue Argon：远程托管代码）

| 发生了什么 | 证据（commit / CI run） | 审核状态 |
| --- | --- | --- |
| 2.3.1 提交商店审核后被以 Blue Argon（远程托管代码）驳回：产物里仍有三处可加载的 CDN 脚本地址——`content.js` 里 tesseract.js 的 worker 默认路径、`worker.min.js` 里的 core 默认 URL 与语言包默认前缀。运行时虽会 override，MV3 审查按**静态产物字符串**判定。处置：2.3.2 在构建期改写三处默认值、语言包随包、新增远程代码门禁 | tag `v2.3.1` = `6b9cfc6` → commit `1974d25`（2026-11-17）；三条向量与修复清单见 PR #14 背景与 `evidence/cws-blue-argon/baseline-static-scan.txt`（41 个远程 URL / 3 个 vector）；修复 PR #14 = `bf72dd8` | **REJECTED**（Blue Argon），从未上架；期间线上为 2.3.0。仓库没有 2.3.1 的 CI run 记录 |

**结论：2.3.1 被驳回是 Blue Argon 违规的起点；2.3.2 是针对它的修复版。**

## v2.3.0 — 2026-11-15 提审 / 2026-11-15 **已上架**

校正紙 UI 的第一版。相对 2.2.1 只改界面与文案，不动译文管线、缓存键和配置格式。
版本号升到 2.3.0 是因为字节全变了 —— 新界面绝不能顶着 2.2.1 的版本号发出，
否则又是一次「版本号对、包不对」。

| 项 | 值 |
| --- | --- |
| item id | `llicfmiagjiknidigpdcnogfeheogpfd` |
| 包 | `release/manga-translator-v2.3.0-public.zip`（2 782 324 字节） |
| 包 sha256 | `d6cac40a01b7cbf92cf32183d175d56c8f223140fd9fbfeafc6311b68307773e` |
| 包内核对 | `content.js` 185 193 字节；`setActions` ×2；`hud-retry-failed` ×0；manifest `2.3.0` / 名称 19 字 |
| 构建 | `pnpm package:public` 全链路：`--public-build` 注入 → 三项 source-only gate → `tsc` → `vite build`（`content.js` 180.9 KB / 200 KB）→ 事后 `check-public-build`（25 个文件无凭据）、`check-release-consistency`、`record-source-fingerprint`（178 个输入） |
| 上传前核对 | `publish-to-store.mjs --dry-run`：包无凭据、token 有效、`2.3.0 > 2.2.1`（`live version 2.2.1`） |
| 上传 | `{"crxVersion":"2.3.0","uploadState":"SUCCEEDED"}` |
| 提交审核 | `POST :publish` → `{"publishType":"DEFAULT_PUBLISH","skipReview":false,"blockOnWarnings":false}` |
| 回读状态 | `published=PUBLISHED (2.2.1), submitted=PENDING_REVIEW (2.3.0)` |
| 自证 | 再发一次 publish → **HTTP 400**「You may not edit or publish an item that is in review.」（`NOT_UPDATEABLE`） |
| 线上（2026-11-15 复核） | 公开页 `Version 2.3.0` · `Updated November 15, 2026`；`pnpm store:verify` → **exit 0**：`files differing 0 / missing 0 / extra 0` ⇒ **已上架** |

**结论：已上架，且线上包逐文件核对通过。**

### 这一版还欠着的事

| 事 | 谁做 | 怎么改 |
| --- | --- | --- |
| ~~审核结果~~ | 商店 | 已过：公开页 `Version 2.3.0` |
| ~~线上包核对~~ | 开发者 | 已做：verify exit 0，见上表 |
| **商店截图与宣传图** | 开发者 | Dashboard 手动换成校正紙版：`store/listing/screenshot-*.png`、`promo-small-440x280.png`、`promo-large-1400x560.png`（API 没有 listing 资产端点） |
| 宣传视频 | 开发者 | 可选，需要能连通模型服务的机器 |


## v2.2.0 — 2026-11-11 — **已上架**（线上包早于安全修复，已由 2.2.1 接替提审）

第一版带「本月估算花费」的包。只改了设置页与文档，不动译文管线。

| 项 | 值 |
| --- | --- |
| item id | `llicfmiagjiknidigpdcnogfeheogpfd` |
| 包（提审时） | `release/manga-translator-v2.2.0-public.zip`（2 778 560 字节） |
| 包 sha256（提审时） | `64077aed1f853fc9f3a6ce0e8299c2b245515379596aaa76aa3535b40b0c625a` |
| 上传前核对 | `publish-to-store.mjs --dry-run`：包无凭据、token 有效、`2.2.0 > 2.1.1` |
| 上传 | `{"crxVersion":"2.2.0","uploadState":"SUCCEEDED"}` |
| 提交审核 | `POST :publish` → `{"publishType":"DEFAULT_PUBLISH","skipReview":false,"blockOnWarnings":false}` |
| 公开页（2026-11-14 复核） | `Version 2.2.0` · `Updated November 10, 2026` · **5 users** · **0 ratings** ⇒ **已上架** |
| GitHub | tag `v2.2.0` + Release（zip + sha256） |

**结论：已上架。但线上 2.2.0 不含 2026-11-11 14:12 的安全修复。**

### 为什么同一个版本号会有两个包

提审时上传的是 `64077aed…`，构建于安全修复之前。修复提交 `16575fb`（14:12）
之后，本地又构建了一份 `2e869f…`（2 778 694 字节，14:06:09；`setActions` 在、
`hud-retry-failed` 不在），但**没有重新上传**。台账只记了前一个 sha，公开页又只
报版本号，于是「版本对」被误当成了「包对」。

2026-11-14 直接下载线上 CRX 核对：

| 文件/标记 | 线上 2.2.0 | 本地 2.2.0（修复后重建） |
| --- | --- | --- |
| `content.js` | 178 380 字节 | 178 074 字节 |
| `setActions` | **0** | 2 |
| `hud-retry-failed` | **3** | 0 |
| `<endpoint>` | **0** | 1 |

线上包仍可被页面脚本伪造 HUD 事件触发绕缓存重翻并计费。2.2.1 已接替提审；
在它过审前，线上仍是这个包。

### 这一版还欠着的事

| 事 | 谁做 | 怎么改 |
| --- | --- | --- |
| **两块宣传图上传** | 开发者 | 图已经生成好了（`store/listing/promo-small-440x280.png`、`promo-large-1400x560.png`，均无 alpha、尺寸精确），但商店 API **没有** listing 资产端点，只能在 Dashboard → 商品详情 里手动传 |
| 审核结果 | 商店 | 已过（2026-11-14 复核：公开页 `Version 2.2.0`） |

## v2.2.1 — 2026-11-14 提审 / 2026-11-14 **已上架**

顶替线上 2.2.0 的安全补丁：源码与 2.2.0 相同，外加 `16575fb`（HUD 直接回调
+ 端点脱敏）。只改安全面，不动译文管线、缓存键和配置格式。

| 项 | 值 |
| --- | --- |
| item id | `llicfmiagjiknidigpdcnogfeheogpfd` |
| 包 | `release/manga-translator-v2.2.1-public.zip`（2 778 694 字节） |
| 包 sha256 | `076e0dc22d07f650778986cba0d2824daab6dc3294dd06533f3eae2fdb1eaf99` |
| 包内核对 | `content.js` 178 074 字节；`setActions` ×2；`hud-retry-failed` ×0；`<endpoint>` ×1 |
| 上传前核对 | `publish-to-store.mjs`：包无凭据、token 有效、`2.2.1 > 2.2.0` |
| 上传 | `{"crxVersion":"2.2.1","uploadState":"SUCCEEDED"}` |
| 提交审核 | `POST :publish` → `{"publishType":"DEFAULT_PUBLISH","skipReview":false,"blockOnWarnings":false}` |
| 回读状态 | `published=PUBLISHED (2.2.0), submitted=PENDING_REVIEW (2.2.1)` |
| 自证 | 再发一次 publish → **HTTP 400**「You may not edit or publish an item that is in review.」（`NOT_UPDATEABLE`） |
| 公开页 / 线上 CRX（2026-11-14 复核） | `Version 2.2.1` ⇒ **已上架**；`node scripts/verify-store-build.mjs release/manga-translator-v2.2.1-public.zip` → **exit 0**：`files differing 0 / missing 0 / extra 0`（线上 CRX 的 `manifest.json` 仅多出商店注入的 `update_url`，比较时已归一化） |
| GitHub | tag `v2.2.1` + Release（zip + sha256） |

**结论：已上架，且线上包逐文件核对通过** —— 这正是 2.2.0 漏掉的那一步。

### verify 工具的 update_url 归一化（2026-11-14）

首次对 2.2.1 跑 `store:verify` 报 MISMATCH，唯一差异是 `manifest.json`：线上
CRX 多了 `"update_url": "https://clients2.google.com/service/update2/crx"`。
这是商店签 CRX 时注入的，上传的 ZIP 本来就没有；逐字节比较因此把它当成了
「包被改过」。`hashTree` 现在对 `manifest.json` 先删掉两侧的 `update_url`
再取哈希（`normaliseManifest`，测试见 `scripts/__tests__/store-verify.test.mjs`
的 `hashTree` 一节），其余任何 manifest 改动仍然会被抓到。

### 这一版还欠着的事

| 事 | 谁做 | 怎么改 |
| --- | --- | --- |
| ~~审核结果~~ | 商店 | 已过：公开页 `Version 2.2.1` |
| ~~线上包核对~~ | 开发者 | 已做：verify exit 0，见上表 |
| **两块宣传图上传** | 开发者 | Dashboard → 商品详情 手动传 `promo-small-440x280.png`、`promo-large-1400x560.png`（用 2.3.0 校正紙样式的重生成版） |

## v2.1.1 — 2026-10-25 提审 / 2026-10-27 **已上架**

v2.1.0 的审核提交被取消，这一版顶上去。理由：商店的标题和摘要取自 manifest，
而 v2.1.0 的 manifest 里是「漫画翻译助手」+ 英文摘要；一个界面只有中文的扩展，
商店页上挂着一行英文介绍，而那一栏在 Dashboard 里**没有输入框**（显示为「软件
包中的标题」「软件包中的摘要」）。要改就得改 manifest + 升版本号 + 重新发版。
2.1.0 从没上架过，没人装过它，取消它的审核提交不损失任何东西；而留着它，商店
就要先按旧文案过一轮审，再按新文案过一轮审 —— 两轮审核之间，条目会先以旧标题
上线。

| 项 | 值 |
| --- | --- |
| item id | `llicfmiagjiknidigpdcnogfeheogpfd` |
| 包 | `release/manga-translator-v2.1.1-public.zip`（2 776 045 字节） |
| 包 sha256 | `bb8d2cc5c55e8cfc4576e7940674f471e2b3dd46c8eae0511432a5370992ae71` |
| 取消上一版 | `POST /v2/publishers/{pub}/items/{item}:cancelSubmission` → HTTP 200；随后 `fetchStatus` 报 `submittedItemRevisionStatus.state = CANCELLED`（`crxVersion 2.1.0`） |
| 上传 | `{"itemId":"llicfmiagjiknidigpdcnogfeheogpfd","crxVersion":"2.1.1","uploadState":"SUCCEEDED"}` |
| 提交审核 | `POST /v2/publishers/{pub}/items/{item}:publish` → HTTP 200，`{"publishType":"DEFAULT_PUBLISH","skipReview":false,"blockOnWarnings":false}` |
| 自证 | 再发一次 publish → **HTTP 400**「Publish condition not met: You may not edit or publish an item that is in review.」 |
| 草稿 | `crxVersion: 2.1.1` |
| 公开页（2026-10-25 提审当天） | 抓不到版本号 ⇒ **还没上架** |
| 公开页（**2026-11-11 复核**） | `Version 2.1.1` · `Updated October 27, 2026` · 2.65 MiB · 中文（中国）⇒ **已上架** |
| `fetchStatus`（**2026-11-11 复核**） | `publishedItemRevisionStatus.state = PUBLISHED`，`submittedItemRevisionStatus.state = (none)` ⇒ 没有待审版本，线上就是 2.1.1 |

**结论：已上架。** 2026-11-11 复核时公开页显示 `Version 2.1.1`，
`Updated October 27, 2026` —— 也就是 10-25 提审、10-27 过审上线。
公开页是「线上是哪个版本」的唯一真相（item API 只有 DRAFT 投影）。

> 这条结论是 2026-11-11 才补上的。之前这一节停在「已提交审核，未上架」，
> 而事实是它 10-27 就已经上架了 —— 台账比现实慢了 17 天。商店那侧的 OAuth
> refresh token 也在同一段时间里过期了（见下），所以「复核」这一步既没做，
> 也做不了。

### 上架后的真实数据（2026-11-11 复核，同一次抓取）

| 项 | 值 |
| --- | --- |
| 商店标题 | 漫画翻译助手 - AI 漫画翻译与叠加 |
| 版本 / 更新日期 | 2.1.1 / October 27, 2026 |
| 用户数 | **4** |
| 评分 | **0 out of 5 · No ratings** |

4 个用户、0 个评价 —— 上架 15 天。这不是 bug，是「没人看见它」。
条目没有宣传图块（尺寸对不上），没有评价，而 Chrome 商店的曝光和转化
都吃这两样。

这一版只改 manifest 的 `name` 和 `description`（商店的标题和摘要），不动任何
行为，所以走 patch 号。应用自己的界面不读 manifest 的 `name`：弹窗、设置页、
引导页印的都是各自的标题。

**已确认（2026-11-11）**：公开页上的标题就是「漫画翻译助手 - AI 漫画翻译与叠加」，
取自 2.1.1 的 manifest —— 与「软件包中的标题」显示的一致。

### 这一版还欠着的事

| 事 | 谁做 | 怎么改 |
| --- | --- | --- |
| 商店标题/摘要 | 已做 | 2.1.1 的 manifest 里已经是中文名 + 中文摘要；公开页已显示 |
| 两个宣传图块（440×280 / 1400×560） | 已做（2026-11-11） | `scripts/build-promo-image.mjs` 现在一次出三张；小店块无 alpha 通道，商店拒收带 alpha 的图 |
| 宣传视频 | 开发者 | 可选，需要能连通模型服务的机器 |
| 审核结果 | 已过 | 2026-10-27 上架，公开页 `Version 2.1.1` |
| **商店 OAuth refresh token 过期** | 已修（2026-11-11） | 换 access token 曾报 `invalid_grant`（token 已过期或被吊销），upload / publish / 查状态全都做不了。已用 `pnpm store:authorize` 重新授权，新 token 写回 `~/.config/mcp/mcp.json`（备份 `mcp.json.bak-2026-11-11T04-55-55-848Z`），并当场用 `fetchStatus` 验证通过。**这个 token 还会再过期**，下次发版前先跑 `pnpm store:authorize --check` |

## v2.1.0 — 2026-10-25 — 已提交审核（**未上架**；审核提交已取消，由 v2.1.1 顶替）

| 项 | 值 |
| --- | --- |
| item id | `llicfmiagjiknidigpdcnogfeheogpfd` |
| publisher id | `19d9e44e-bb97-4040-a498-5e53414b1a49`（Jasper Pan） |
| 包 | `release/manga-translator-v2.1.0-public.zip`（2 775 969 字节） |
| 包 sha256 | `3b7587b5c7ab833a984a72907ef09c27674a22f7a10f0d941c4bf908b1027f3a` |
| 上传 | `{"itemId":"llicfmiagjiknidigpdcnogfeheogpfd","crxVersion":"2.1.0","uploadState":"SUCCEEDED"}` |
| 提交审核 | `POST /v2/publishers/{pub}/items/{item}:publish` → HTTP 200，`{"publishType":"DEFAULT_PUBLISH","skipReview":false,"blockOnWarnings":false}` |
| 自证 | 再发一次 publish → **HTTP 400**「You may not edit or publish an item that is in review.」 |
| Dashboard | 条目状态 **待审核**；「提请审核」按钮 disabled；分发页的付款/公开范围/国家三项 radio 全部 disabled |
| 公开页 | 抓不到版本号 ⇒ **还没上架** |

**结论：已提交审核，未上架。** 公开页出现 `Version 2.1.0` 之前，对外只能说
「已提交审核」。

**后来的结局**：这一版的审核提交被 `cancelSubmission` 取消，由 v2.1.1 顶替 ——
原因见上面 v2.1.1 那一节。取消之后 `fetchStatus` 报
`submittedItemRevisionStatus.state = CANCELLED`（`crxVersion 2.1.0`），这一版
从未上架、从未有人装过。

几个当时的判断，记下来免得下次重新想：

- **上传用的包是 `pnpm package:public` 的产物**，不是 `pnpm build` 的：后者
  可能带着 `.env` 里的凭据。`release/*.sha256` 与 zip 同目录。
- **发布类型是 `DEFAULT_PUBLISH`、没带 rollout**。这是第一个版本，安装人数为零，
  按商店默认的 100% 铺开是对的；分批放量是给有存量用户的版本用的。
- **没有 `skipReview`**。首个版本走正常审核。
- **item 在审核期间，上传会被拒（`ITEM_NOT_UPDATABLE`）**，所以一个版本在审的时候
  传不了下一个版本。Dashboard 里也一样：条目状态变成「待审核」之后，标题、摘要、
  说明、类别、语言、付款、公开范围、国家**全部被锁成只读**。
  第 4 张截图是在状态还显示「草稿」时补上去的（那个页面是发布之前加载的，状态是
  旧的），保存成功；之后刷新页面，条目状态变成「待审核」，四张截图都还在。
  换句话说：**先补完截图，再发审核**。

### 这一版还欠着的事

| 事 | 谁做 | 怎么改 |
| --- | --- | --- |
| 商店标题/摘要 | 已做 | v2.1.1 的 manifest 里已经是中文名 + 中文摘要，见上一节 |
| 两个宣传图块（440×280 / 1400×560） | 开发者 | 仓库里的 `promo-1280x800.png` 两个尺寸都对不上，要重新出图。商店不要求 |
| 宣传视频 | 开发者 | 可选，需要能连通模型服务的机器 |
| 审核结果 | 商店 | 通过后公开页会出现版本号，那时才能改口说「已上架」 |

### 产品侧的后端

本扩展**没有开发者的后端**：不收集数据、不发统计、不做中转，所以不存在「后端
被封导致新用户第一件事就失败」这种风险。图片只发往用户自己配置的服务商（默认
端点是 MiniMax，用户自备 Key；也可以换成本地 Ollama / LM Studio）。

老版本兼容：这一版没有改云端数据格式或协议，缓存键也没变，所以不需要在商店页
的 Known Issues 里写「请升级」。
