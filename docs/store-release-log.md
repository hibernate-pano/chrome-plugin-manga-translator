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

## v2.1.1 — 2026-10-25 — 已提交审核（**未上架**）

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
| 公开页 | 抓不到版本号 ⇒ **还没上架** |

**结论：已提交审核，未上架。** 公开页出现 `Version 2.1.1` 之前，对外只能说
「已提交审核」。

这一版只改 manifest 的 `name` 和 `description`（商店的标题和摘要），不动任何
行为，所以走 patch 号。应用自己的界面不读 manifest 的 `name`：弹窗、设置页、
引导页印的都是各自的标题。

**还没目视确认的一件事**：Dashboard 上「软件包中的标题」是否已经显示成
`漫画翻译助手 - AI 漫画翻译与叠加`。它的值取自被审版本的 manifest，2.1.1 的
manifest 里就是这个名字，但当时那个 Chrome 窗口正被用来浏览别的条目，没有再
去抢它。下次在 Dashboard 里看一眼就知道。

### 这一版还欠着的事

| 事 | 谁做 | 怎么改 |
| --- | --- | --- |
| 商店标题/摘要 | 已做 | 2.1.1 的 manifest 里已经是中文名 + 中文摘要 |
| 两个宣传图块（440×280 / 1400×560） | 开发者 | 仓库里的 `promo-1280x800.png` 两个尺寸都对不上，要重新出图。商店不要求 |
| 宣传视频 | 开发者 | 可选，需要能连通模型服务的机器 |
| 审核结果 | 商店 | 通过后公开页会出现版本号，那时才能改口说「已上架」 |

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
