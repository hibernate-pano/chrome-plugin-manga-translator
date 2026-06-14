# 产品 UX 与用户旅程分析

> 项目：chrome-plugin-manga-translator（Chrome MV3 扩展，AI 翻译网页漫画文字）
> 视角：co-founder / 产品体验顾问
> 评估范围：用户从发现扩展 → 安装 → 首次使用 → 日常使用 → 失败恢复 → 高级功能发现 的全旅程

---

## 用户旅程图

### 阶段 1：发现与安装
| 步骤 | 用户动作 | 触点 | 用户感受 |
|---|---|---|---|
| 1.1 听说/搜索到扩展 | 搜索"漫画翻译插件"等关键词 | Chrome Web Store 描述页 | 看到"AI-powered manga translation"，对效果有期待但不知道准确度 |
| 1.2 装上 | 点"添加至 Chrome" | 默认安装 | 浏览器右上角出现插件图标 |
| 1.3 第一次被引导 | **理论上有 onboarding，实际没有** | `chrome.runtime.onInstalled` 触发 `openOptionsPage()`（`background.ts:121`） | 用户看到一个空荡荡的设置页，三个 provider 卡片 + 一堆输入框，**完全不知道下一步该干啥** |

### 阶段 2：首次配置（最危险的一段）
| 步骤 | 用户动作 | 体验质量 |
|---|---|---|
| 2.1 选 provider | 在三个卡片里点 | 看到"OpenAI-compatible / Ollama / LM Studio"。**关键问题：Options 副标题写"只保留两条直连路径：OpenAI-compatible 与 Ollama"（`OptionsApp.tsx:512`），但 UI 实际给了三个 provider 卡片——自相矛盾**。而且要**点两次卡片才能切换**（`handleProviderSwitch` 双重确认 + 3 秒超时，`OptionsApp.tsx:195-212`） |
| 2.2 填 API Key | 看到 API Key 输入框 | **没有任何"这是什么"的解释**。用户要 API Key 干啥？给谁？会不会被偷？（`OptionsApp.tsx:349-380`） |
| 2.3 选模型 | 看到 Base URL + Model 两个空输入框 | 模型是啥？填错会怎样？硅基流动预设的"qwen3-vl"我听都没听过，不敢点（`OptionsApp.tsx:71-101, 407-440`） |
| 2.4 测试连接 | 点"测试配置"按钮 | **等 30 秒**才能看到对勾（health check polling 30s 一次，`OptionsApp.tsx:184-186`），期间没有任何进度反馈。"健康"小绿点突然亮起来，用户也分不清是这次测试结果还是 30 秒前的结果 |
| 2.5 关掉设置 | 去找漫画页 | **用户此时**还没意识到"启用扩展"和"自动续翻"两个开关都默认开着 |

### 阶段 3：第一次翻译
| 步骤 | 用户动作 | 体验质量 |
|---|---|---|
| 3.1 打开漫画页 | 浏览器自动注入 content script | **自动开始扫描和翻译**（如果 enabled=true）。用户没准备好——突然看到页面里的图被裁剪、替换。**没有任何"即将翻译"的预演** |
| 3.2 点插件图标 | 看 Popup | 看到"翻译当前页面"和"强制重翻"两个按钮，**外加一坨"启用扩展 / 后端切换 / 目标语言 / 状态"信息**。顶部小字写"当前页翻译 / 自动续翻 / 强制重翻"——但 popup 里**根本没有"自动续翻"按钮**（`PopupApp.tsx:239, 380-410`） |
| 3.3 点"翻译当前页面" | 等待 | HUD 出现在右下角，"翻译中... 0/12"。期间**没有任何阶段提示**（OCR/调用 API/渲染），只显示"第 N 张" |
| 3.4 完成 | 看结果 | 2 秒后 HUD 自动消失。**但有些图没被翻译**——用户不知道为什么。日志里说"过滤了 N 张图：尺寸不足/在 header 内/UI 关键词"，**HUD 完全没说** |
| 3.5 翻页/滚动 | 新图出现 | **如果自动续翻开启**，新图会被自动翻译——但用户**没意识到自己开了自动扣费功能** |

### 阶段 4：日常使用
| 步骤 | 体验 |
|---|---|
| 4.1 浏览漫画 | 还行，但因为缓存，用户**不知道哪张是从缓存来的** |
| 4.2 想换 provider | 切到 options → 改 baseUrl → 测试 → 回漫画页 → **看不到效果**（要么用缓存，要么需要"强制重翻"） |
| 4.3 翻译不准 | 没办法调 prompt 模板（"自然中文/尽量忠实/气泡精简"三个预设以外**没自定义入口**，`OptionsApp.tsx:636-649`） |
| 4.4 想看用了多少 token | popup 完全不显示用量（`usage-store` 存在但 popup 不消费） |

### 阶段 5：失败体验（最容易丢用户）
| 失败类型 | 用户看到的 | 真正问题 | 用户的反应 |
|---|---|---|---|
| API Key 错 | HUD 弹红条 "API 密钥无效，请检查配置" | 错误码 AUTH_ERROR | 用户去检查 key，**但不知道是哪个 provider 的 key 错了**——三个 provider 在 popup 上都显示"未配置端点"或空值 |
| Ollama 没启动 | "无法连接到服务器" | OLLAMA_NOT_RUNNING | 建议语是"请检查服务器是否运行，或地址/端口是否正确"——**没告诉用户去终端跑 `ollama serve`** |
| CORS 拦截 | "网络连接失败"或测试配置失败 | OLLAMA_ORIGIN_NOT_ALLOWED | **完全不提"去设置 OLLAMA_ORIGINS 环境变量"**——这是 90% Ollama 用户的第一个坑 |
| 余额耗尽 | "请求过于频繁，请稍后重试" | RATE_LIMIT | 看不出是限流还是没钱（某些平台错误码一样） |
| 模型没下 | "无法连接到服务器" | MODEL_NOT_FOUND | 和 Ollama 没启动的错误信息**完全一样**（看 error-handler.ts）——用户根本分不清 |
| 翻了一半断网 | HUD 停在"翻译中..." | 翻译流程没有断点恢复 | 用户刷页面 → 内容还在（缓存），但**进度信息丢失** |

### 阶段 6：高级功能
| 功能 | 用户能发现吗 |
|---|---|
| Reading Layer（右侧译文面板 + 图上锚点） | **不能**。代码存在但**从未被实例化**（grep 全项目无 `new ReadingLayer()`）。`cache-v2.ts:26` 只在注释里提到。**507 行死代码** |
| 强制重翻 | 能。Popup 第二个按钮，**但需要 hover 才看到 tooltip**（"忽略缓存，重新翻译所有图片"） |
| 缓存开关 | 能。Options 里第三个开关，但**没人告诉用户缓存多大、上限多少、满了会怎样** |
| 竖排文字 | 能。覆盖层样式折叠面板里，但要展开才能看到 |
| 翻译风格 | 能。Options 里下拉，三个预设 |
| 右键菜单"翻译当前页面" | **不能正常工作**。`background.ts:114-118` 创建了 context menu，但**全项目没有任何 `chrome.contextMenus.onClicked` 监听器**——点了没反应 |
| 快捷键 Alt+T/S/O/C | **完全假的**。`UserGuide.tsx:102,113,131-149` 列了四个快捷键，**manifest.json 没有 `commands` 字段，全项目无 `chrome.commands` 注册代码** |
| UserGuide（6 步引导） | **完全不可见**。407 行的 `UserGuide.tsx` 组件**从未被 Popup/Options 引用**（grep 无引用记录） |

---

## 痛点清单

### P0 — 高严重度（影响核心功能或装上就用不了）

#### P0-1：右键菜单"翻译当前页面"是坏的，点了没反应
- **描述**：用户在任何网页右键，浏览器显示一个"翻译当前页面"菜单。点击 → 什么都没发生。
- **触发场景**：在 Popup 关闭 / 沉浸阅读时，用户习惯性右键找入口。
- **严重度**：高。这种"半成品 UI"比"没有"更糟——它告诉用户"这里有功能"，但功能不工作。用户会以为是 bug 报 issue。
- **证据**：
  - `background.ts:113-118` 创建了 context menu
  - `background.ts:1-21` 的 import 区只有 `createAutoTranslateMessage, isTranslationEnabled`，**没有 `onClicked` 监听器**
  - 全项目 grep `chrome.contextMenus` 仅在 `background.ts:114-118` 出现一次
- **改进建议**：要么补上 onClicked 监听（`<- {tabId, menuItemId} => { if menuItemId === 'translatePage' translateActiveTab }`），要么直接从 `onInstalled` 删掉这个 menu 创建。**绝不能留这种"亮但不亮"的死入口**。

#### P0-2：UserGuide 整个引导组件是死代码，新用户无任何 onboarding
- **描述**：扩展装上后，用户被打开一个空白 options 页。没有任何"欢迎 / 怎么开始 / 选哪个 provider"引导。
- **触发场景**：安装后第一秒。
- **严重度**：高。**这是漏斗最大流失点**。`UserGuide.tsx` 定义了 6 步引导（欢迎 / 初始设置 / 翻译模式 / 快捷键 / 高级设置 / 完成），设计很完整——但**没有用**。
- **证据**：
  - `UserGuide.tsx:25-229` 定义完整 6 步
  - 全项目 grep `UserGuide` / `useUserGuide` / `GuideTrigger` / `openGuide` **只在自己文件内出现**（`UserGuide.tsx:16,233,359,364,384,393,402`），**PopupApp 和 OptionsApp 都没引用**
  - `background.ts:121` 在 install 时只 `openOptionsPage()`，没启动引导
- **改进建议**：三选一：
  1. 在 OptionsApp 顶部用 `useUserGuide` 检测首次访问并自动弹出
  2. 把 6 步内容拆成静态"新手指引"区块放进 Options 顶部
  3. 删掉 UserGuide.tsx（407 行）别留死代码
  
  关键是**用户第一次进 options 必须在 5 秒内知道"我要去 OpenAI-compatible 那个卡片填 baseUrl + API Key"**。

#### P0-3：UserGuide 里的快捷键 Alt+T/S/O/C 全是假的
- **描述**：UserGuide 步骤"快捷键"列了 4 个组合键（启用/禁用翻译 Alt+T、翻译选中图像 Alt+S、打开设置 Alt+O、清除翻译 Alt+C），**但用户按了没有任何反应**。
- **触发场景**：看到引导后去按快捷键。
- **严重度**：高。**这是产品信任问题**——用户按 4 次都没反应，下次就不信你写的东西了。
- **证据**：
  - `UserGuide.tsx:102,113,131,137,143,149` 列出快捷键
  - `manifest.json` 全文 45 行**无 `commands` 字段**
  - 全项目 grep `chrome.commands` / `Alt+S` / `Alt+T` **零结果**
- **改进建议**：要么在 `manifest.json` 加 `commands` 字段并实现，要么在 UserGuide 里**改成"即将支持"或直接删掉**。如果要做，参见 Chrome 文档的 `chrome.commands` API。

#### P0-4：ReadingLayer 507 行死代码，用户感知不到"我还有阅读模式"
- **描述**：如果 ReadingLayer 真的工作，用户能享受沉浸式阅读体验（图上编号 + 右侧中文列表 + 双向跳转）。但**它根本没被实例化**。
- **触发场景**：永远不会触发。
- **严重度**：高。这是产品的**差异化卖点**——竞品都没有这功能。但用户根本不知道存在。
- **证据**：
  - `reading-layer.ts:507` 行完整定义
  - grep `ReadingLayer` / `new ReadingLayer` / `reading-layer` 全项目**只在 `cache-v2.ts:26` 注释里出现**（"Structured reading-layer result"），**没有任何 import 也没有任何 new**
  - `content.ts` 没有引用 `reading-layer.ts` 的任何导出
- **改进建议**：要么把 ReadingLayer 接到 content.ts 的 `processSingleImage` 成功路径里（`upsert(img, result.readingResult)`），要么删掉 `reading-layer.ts`。**不能留 507 行假装"已实现"**。

#### P0-5：Popup 文案"自动续翻"是空气功能
- **描述**：Popup 顶部副标题写"当前页翻译 / 自动续翻 / 强制重翻"（`PopupApp.tsx:239`），但 popup **没有"自动续翻"按钮**。用户读到"自动续翻"想点 → 没按钮。
- **触发场景**：用户想开/关自动续翻。
- **严重度**：高。文字承诺了功能，但功能不暴露。
- **证据**：
  - `PopupApp.tsx:239` 写"当前页翻译 / 自动续翻 / 强制重翻"
  - `PopupApp.tsx:380-410` 只有"彻底重置"和"强制重翻"两个按钮
  - "自动续翻"开关**只在 OptionsApp.tsx:593-604 出现**
- **改进建议**：在 Popup 加一个"自动续翻"开关（和现有的"启用扩展"紧挨着），文案同步删掉"自动续翻"三个字——**只列 popup 里实际有的功能**。

---

### P1 — 中严重度（影响体验流畅度）

#### P1-1：三个 provider 切换需要"双重确认"，对小白困惑对熟手多余
- **描述**：点 provider 卡片 → 卡片边框变黄+显示"确认切换？" → 3 秒内再点一次才生效，否则撤销。**这逻辑在用户看来像 bug**。
- **触发场景**：换 provider。
- **严重度**：中。功能可用但很反直觉。
- **证据**：
  - `OptionsApp.tsx:195-212` `handleProviderSwitch` 实现
  - 3 秒 timeout 在 `OptionsApp.tsx:202-211`
- **改进建议**：要么直接点击切换（用 form 提交模式），要么改成显式"切换到 [Provider]？[确认] [取消]"对话框。**不要把状态藏在边框颜色里**。

#### P1-2：Popup 与 Options 对 provider 的描述自相矛盾
- **描述**：Options 主标题副文案"只保留两条直连路径：OpenAI-compatible 与 Ollama"（`OptionsApp.tsx:512`），但 UI 渲染了三个 provider 卡片（包括 LM Studio）。Popup 切换按钮也给了三个。
- **触发场景**：用户读 options 副标题 → 看到 3 个卡片 → 困惑。
- **严重度**：中。文案与 UI 不一致。
- **证据**：
  - `OptionsApp.tsx:510-513` 副标题"只保留两条直连路径"
  - `OptionsApp.tsx:37-69` `PROVIDERS` 数组有 3 项
  - `PopupApp.tsx:39-43` `PROVIDER_OPTIONS` 也有 3 项
- **改进建议**：二选一。
  - 如果 LM Studio 真要保留 → 把副标题改成"OpenAI-compatible / Ollama / LM Studio 三条直连路径"
  - 如果不保留 → 删掉 popup 的 LM Studio 按钮和 options 的 LM Studio 卡片
  - **代码和文案必须一致**。

#### P1-3：翻译失败的错误信息对用户没有可操作性
- **描述**：当 Ollama 没启动、CORS 拦截、模型没下时，HUD 红色卡片显示建议"请检查服务器是否运行"——**没有具体命令、没有排查路径**。
- **触发场景**：配好 provider 但第一次翻译失败。
- **严重度**：中。**这是 80% 早期用户放弃的点**。CORS 拦截对 Ollama/LM Studio 用户是必经的墙。
- **证据**：
  - `error-handler.ts:81-85` CONNECTION_REFUSED 建议"请检查服务器是否运行"
  - `error-handler.ts` 全文 grep 无 `OLLAMA_ORIGINS` / `CORS` / `ollama serve` / `跨域` 任何相关文案
  - `OptionsApp.tsx:58,64` 只说"本地模型，适合隐私优先"——不教怎么启动 Ollama
- **改进建议**：按 error code 给"下一步"按钮：
  - `OLLAMA_NOT_RUNNING` → 按钮"复制 `ollama serve` 命令" + "打开 Ollama 下载页"
  - `OLLAMA_ORIGIN_NOT_ALLOWED` → 按钮"复制 `OLLAMA_ORIGINS=* ollama serve`" + 解释原理
  - `MODEL_NOT_FOUND` → 按钮"复制 `ollama pull qwen2.5vl:7b`"（按用户选定的 model 动态生成）
  - `AUTH_ERROR` → 按钮"打开设置页"（一键跳到对应 provider 卡片）
  
  **让错误信息成为一个"修复入口"**，而不是"抱怨界面"。

#### P1-4：图被过滤时用户不知道为什么
- **描述**：20 张图只翻译了 5 张，HUD 显示"翻译完成 5"，**没说"过滤了 15 张，原因：尺寸不足/位置"**。用户去 issue 区报 bug。
- **触发场景**：图片较密集的章节页。
- **严重度**：中。会让用户觉得"工具不工作"。
- **证据**：
  - `image-filter.ts:24-65` 多条过滤规则
  - `content.ts:312-316` 找不到图时只 `setState({ count: 0 })`，不报告被过滤
  - `floating-hud.ts:135-151` 完成态只显示 translated/failed/cached
- **改进建议**：HUD 完成态加一行小字："已跳过 N 张（尺寸/位置不匹配）"，可点击展开看每张的原因。或者用更友好的方式——**让被跳过的图有一个角标提示**"这张图未翻译，点我"。

#### P1-5：缓存的副作用让用户怀疑"我没换 provider 吗？"
- **描述**：用户用 OpenAI 翻译过一章（质量差），切到硅基流动 Qwen-VL，再看同一章——图上还是 OpenAI 那种僵硬译文。HUD 也没显示"这是缓存"。**用户开始怀疑自己没切成功**。
- **触发场景**：换 provider。
- **严重度**：中。会引导用户做错的事（反复点"切换 provider"按钮）。
- **证据**：
  - `cache-v2.ts:75-79` cache.set 用 `imageHash` 做 key，**不绑 provider**
  - `translator.ts:194` 翻译流程：1) 处理图片 → 2) hash → 3) 查缓存 → 4) 命中则直接用
  - Popup 完成态 `content.ts:64` 有 `cachedCount` 但 HUD 显示"缓存 0"是默认，**用户分不清是 0 还是没留意**
- **改进建议**：
  - HUD 在缓存命中时给译文一个小角标"⚡ 缓存"（hover 显示"5 天前由 OpenAI 翻译"）
  - 或者切 provider 时弹一次提示"已切换到 [X]，是否重新翻译当前页？"
  - **不要让缓存对用户隐形**。

#### P1-6：强制重翻 vs 翻译当前页，差异点藏在 tooltip
- **描述**：两个按钮名字相近（"翻译当前页面" vs "强制重翻"），**实际差异**是"用不用缓存"——这是普通用户最不关心的实现细节。
- **触发场景**：翻译不准，用户想再翻一次。
- **严重度**：中。功能可用，但用户用错按钮（"翻译当前页面"用缓存没生效，又回去点"强制重翻"）。
- **证据**：
  - `PopupApp.tsx:380-410` 两个按钮
  - tooltip 信息在 `PopupApp.tsx:390-393, 405-408`
  - Popup 顶部 `PopupApp.tsx:239` 把两个功能并排写，不解释差异
- **改进建议**：合并为一个按钮"重新翻译"，长按/右键出二级菜单"忽略缓存重翻"。或者把"忽略缓存"作为一个**独立的开关**（"下次翻译忽略缓存" checkbox），不是第二个按钮。

#### P1-7：用户不知道"启用扩展"和"自动续翻"两个开关的差别
- **描述**：Popup 有"启用扩展"开关，Options 有"启用扩展"和"自动续翻"两个开关。三者都会影响"是否翻译"，**没有任何地方说明它们的依赖关系**。
- **触发场景**：用户想关掉自动翻译省 token 钱。
- **严重度**：中。`isTranslationEnabled` 逻辑（`auto-translate.ts:1-19`）是 `enabled && autoContinueEnabled`，但用户**不可能从 UI 反推出这个布尔表达式**。
- **证据**：
  - `PopupApp.tsx:265-276` 启用扩展
  - `OptionsApp.tsx:580-604` 启用扩展 + 自动续翻
  - `auto-translate.ts:18` `return enabled && autoContinueEnabled`
  - 三处文案只说"页面加载后允许自动续翻新出现的图片"（`PopupApp.tsx:268`）——没说清默认是开的
- **改进建议**：把"启用扩展"和"自动续翻"合并为一个开关，叫"页面加载时自动翻译"，tooltip 写"关闭后只在你点击扩展按钮时翻译"。**三态变一态**。

#### P1-8：覆盖层样式（颜色/字号）改完即生效，没撤销机制
- **描述**：在 Options 改背景色或字号，**实时同步到 chrome storage**——没有"应用"按钮，也没有"撤销"。
- **触发场景**：用户调字号试效果。
- **严重度**：中。会留下"我试了但忘了回滚"的脏配置。
- **证据**：
  - `OptionsApp.tsx:692-744` 直接 `setOverlayStyle` 实时生效
  - 全项目无 "撤销/重置样式" 按钮
- **改进建议**：加"恢复默认"按钮（一键回到出厂配色）。比"撤销栈"简单，对用户够用。

---

### P2 — 低严重度（锦上添花）

#### P2-1：HUD 进度条信息密度低，10 张图要等 1 分钟用户不知道等多久
- **描述**：HUD 只显示"第 N 张 / 共 M 张"，没有阶段、没有 ETA。
- **证据**：`floating-hud.ts:117-133` translating 状态
- **改进建议**：用三段进度（扫描/翻译/渲染），或加简单 ETA（"约剩 15 秒"）。

#### P2-2：用量统计有数据但无 UI
- **描述**：`usage-store` 存在（`translator.ts:26` 引用），但 popup 和 options **没有任何地方展示**"今天用了 X token / 调用了 Y 次"。
- **证据**：grep `usage-store` 只在 `translator.ts:26` 出现一次
- **改进建议**：popup 状态卡片里加一行小字"本次翻译：12 次 API 调用 / 3.2k tokens"。

#### P2-3：翻译风格只暴露 3 个预设，没有自定义 prompt
- **描述**：`OptionsApp.tsx:636-649` 给"自然中文/尽量忠实/气泡精简"三选一，进阶用户想精细控制做不到。
- **改进建议**：加"自定义 prompt"输入框（折叠面板里），让用户改 system prompt。

#### P2-4：目标语言没有"自动检测"选项
- **描述**：用户看英汉混排的漫画时，必须选一个目标语，但源语言自动检测没得选。
- **改进建议**：在"目标语言"旁边加"自动检测源语言"开关，调用 VLM 时让它先识别语种再翻译。

#### P2-5：health check 每 30 秒跑 3 个 provider 是浪费
- **描述**：`OptionsApp.tsx:184-186` 30s 一次轮询三个 provider，每次都创建 Provider 实例调用 validateConfig。打开 options 页 10 分钟就调 60 次。
- **证据**：`OptionsApp.tsx:160-178`
- **改进建议**：只对当前 provider 主动检查；改配置时手动触发一次。

#### P2-6：图源是 base64 data-URI 的页面（比如某些看图站）翻译失败但用户不知道为什么
- **描述**：某些漫画站图源是 `data:image/...` 而非 URL，`fetchImageBytesResponse` 不会处理（background.ts:415-457 的 `isValidImageUrl` 会拒 data URI）。`processInParallel` 内部有 `getRealImageSource` 兜底但**用户看不到这个**。
- **改进建议**：在 image-filter 里识别 data URI 时直接走 base64 直传路径，不要绕 fetch。

---

## 隐藏功能盘点

| 功能 | 入口在哪里 | 用户能发现吗 | 建议 |
|---|---|---|---|
| **Reading Layer**（右侧译文面板 + 图上锚点） | **没有**。代码定义了，但从未实例化 | ❌ 完全不能 | 要么接入 content.ts 让它真的工作，要么删代码 |
| **强制重翻** | Popup 右下角第二个按钮 | 🟡 勉强。需 hover 看 tooltip 才知道和"翻译当前页面"的区别 | 加文字说明或合并按钮 |
| **缓存开关** | Options 第三个开关 | 🟡 勉强。**没人解释缓存上限/失效策略** | 加"清空所有缓存"按钮和"已缓存 N 张"计数 |
| **竖排文字** | Options 覆盖层样式折叠面板 | ❌ 折叠面板**默认收起**，用户得手动展开 | 改文案"日文漫画竖向排版时启用（推荐日漫开启）"，或默认展开 |
| **翻译风格预设** | Options 下拉 | 🟢 能看到，但三个预设名字不解释差异 | 鼠标 hover 给示例对比 |
| **右键菜单"翻译当前页面"** | 注册了但坏了 | ❌ 点了没反应 | 修 bug 或删注册 |
| **快捷键 Alt+T/S/O/C** | UserGuide 里写了 | ❌ 完全是假的（无注册） | 删文案或实现 |
| **UserGuide 6 步引导** | 存在但没接入 | ❌ | 接入 Options 顶部做首启弹窗 |
| **用量统计** | `usage-store` 存在 | ❌ 无 UI | 在 Popup 加一行"本次翻译消耗 N tokens" |
| **目标语言自动检测** | 没有任何代码 | ❌ | 加开关 + LLM 提示 |
| **覆盖层样式（背景色/字号）** | Options 折叠面板 | 🟡 默认折叠 | 默认展开 + 加"恢复默认"按钮 |
| **多 provider 健康检查**（绿/黄小点） | Options 卡片右上角 | 🟢 能看到 | 仍可保留 |

---

## 三个最重要改进（如果只能改三处）

### 1. 让"半成品 UI"全部变成"真功能"或全部删掉

**改**：
- 右键菜单：补 onClicked 监听或删注册（`background.ts:113-118`）
- UserGuide.tsx：接入 Options 顶部做首启弹窗，**或者删掉**这 407 行
- UserGuide 里的快捷键：实现 `chrome.commands` 或删文案
- ReadingLayer.tsx：接入 content.ts 让它真的工作，或删掉 507 行
- Popup 顶部"自动续翻"三个字：要么加按钮要么删文字

**为什么**：
- "亮但不亮"的死入口是产品最大的信用债——它会引导用户去做注定失败的事
- 修这些不需要新增功能，只需要"已经写好的代码真的连起来"
- 这一项的 ROI 是最高的

### 2. 给首次使用的用户一个 30 秒到位的引导

**改**：
- 检测 `localStorage.manga-translator-guide-seen` 没设过 → 弹一个 3 步的 modal：
  1. "选一个后端：OpenAI 官方（要 API Key）/ 硅基流动（国内免翻墙）/ Ollama（本地）"
  2. 用户选后 → 跳到 options 预填 baseUrl/model
  3. "现在去你常去的漫画页，点插件图标 → 翻译当前页面"
- 引导走完再开 `enabled` 开关——**避免新用户被动开始扣费**

**为什么**：
- 早期漏斗最大的流失点是"我配了但没用起来"
- 3 步引导能在 30 秒内让用户完成 first successful translation
- 默认关闭 `enabled` 防止"装完就忘"导致的"我被扣了 20 块钱但一张图都没翻译"

### 3. 翻译失败时，错误信息要变成"修复入口"

**改**：按 `TranslationErrorCode` 映射到具体的可执行动作：
- `OLLAMA_NOT_RUNNING` → "打开终端运行 `ollama serve`" 按钮（一键复制）
- `OLLAMA_ORIGIN_NOT_ALLOWED` → "复制 `OLLAMA_ORIGINS=* ollama serve`" + 链接到 Ollama CORS 文档
- `AUTH_ERROR` → "打开对应 Provider 设置"按钮
- `MODEL_NOT_FOUND` → "复制 `ollama pull {当前model}`" 按钮
- `RATE_LIMIT` → 显示"今天已用 N 次，可能触发了限流"链接到 provider 账单

**为什么**：
- 这是 80% 早期用户放弃的点
- 错误信息是"被动的抱怨界面"——改成"主动的修复入口"能直接降低流失
- 实现成本很低，error-handler.ts 已经有完整 `suggestion` 字段，加按钮就行

---

## 附录：发现的代码/产品不一致点

| 类别 | 现象 | 位置 |
|---|---|---|
| 死代码 | `UserGuide.tsx` 407 行未被引用 | `src/components/UserGuide.tsx` |
| 死代码 | `reading-layer.ts` 507 行未被实例化 | `src/content/reading-layer.ts` |
| 半成品 | 右键菜单创建了但没监听点击 | `src/background/background.ts:113-118` |
| 半成品 | 快捷键在文档里但 manifest 没注册 | `UserGuide.tsx:102,113,131-149` |
| 文案矛盾 | Options 副标题"只保留两条"但渲染三个 | `OptionsApp.tsx:512` vs `:37-69` |
| 文案矛盾 | Popup 顶部"自动续翻"但无对应按钮 | `PopupApp.tsx:239` vs `:380-410` |
| 交互反直觉 | 切换 provider 要"双重确认" | `OptionsApp.tsx:195-212` |
| 静默失败 | 图片被过滤 HUD 不报告 | `image-filter.ts:24-65` + `floating-hud.ts:135-151` |
| 副作用不可见 | 缓存命中 HUD 不提示 | `cache-v2.ts:75-79` + `floating-hud.ts:145-150` |
| 静默运行 | health check 30s 轮询 3 个 provider | `OptionsApp.tsx:184-186` |
| 默认危险 | 装上就开 enabled + autoContinue，开始扣费 | `isTranslationEnabled` 逻辑 + 缺 onboarding 关闭 |
