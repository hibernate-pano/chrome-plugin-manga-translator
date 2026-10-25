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

## v2.1.0 — 2026-10-25 — 已提交审核（**未上架**）

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
| 商店标题/摘要 | 开发者 | 商店这两栏取自 `public/manifest.json`，没有输入框。要改就改 manifest + 升版本号 + 重新发版 |
| 两个宣传图块（440×280 / 1400×560） | 开发者 | 仓库里的 `promo-1280x800.png` 两个尺寸都对不上，要重新出图。商店不要求 |
| 宣传视频 | 开发者 | 可选，需要能连通模型服务的机器 |
| 审核结果 | 商店 | 通过后公开页会出现版本号，那时才能改口说「已上架」 |

### 产品侧的后端

本扩展**没有开发者的后端**：不收集数据、不发统计、不做中转，所以不存在「后端
被封导致新用户第一件事就失败」这种风险。图片只发往用户自己配置的服务商（默认
端点是 MiniMax，用户自备 Key；也可以换成本地 Ollama / LM Studio）。

老版本兼容：这一版没有改云端数据格式或协议，缓存键也没变，所以不需要在商店页
的 Known Issues 里写「请升级」。
