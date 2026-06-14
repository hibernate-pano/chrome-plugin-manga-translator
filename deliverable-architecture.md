# 架构 + 安全隐私分析

> 项目：chrome-plugin-manga-translator v0.3.2 (Chrome Manifest V3 扩展)
> 角色：架构师视角，关注长期可维护性和安全风险
> 阅读范围：25+ 关键文件（background/content/stores/utils/providers/components/manifest）

## 关键发现速览

| 风险类别 | 高 | 中 | 低 |
|---|---|---|---|
| 架构 | 6 个完全死代码文件 (~2150 行)；store 同步潜在死循环；processedImages 内存泄漏；状态机状态风暴 | ErrorBoundary 重复实现；auto-translate 重新触发链路冗余；transport 单实现却暴露 set/reset API | 已修好的 v1 残留（hybrid-regions 留作可选项，符合 CLAUDE.md 决策） |
| 安全 | API key 以 XOR 混淆形式存 chrome.storage.sync（同步到 Google 账户，盐硬编码）；host_permissions + content_scripts 都用 <all_urls>（跨域图片必需，缺的是告知） | 没有隐私告知；web_accessible_resources 暴露 tesseract/* 任意页面可读 | 默认 Provider baseUrl 暴露给用户（其实合理） |

---

## 一、架构

### 1. 状态机

#### 1.1 [中] 双重锁冗余（isTranslating + currentState）

**证据**：`src/content/content.ts:285-296`

```typescript
if (isTranslating) {
  console.warn('[ContentScript] 翻译已在进行中（锁保护）');
  return;
}
if (
  currentState.status === 'translating' ||
  currentState.status === 'scanning'
) {
  console.warn('[ContentScript] 翻译已在进行中');
  return;
}
```

两个互斥条件守住同一个不变量："翻译已在进行中就退出"。`isTranslating` 模块级变量在 `translatePage` 入口置 true、finally 块置 false（content.ts:298, 384）。`currentState.status` 也在同一处维护。

**风险**：单一来源原则被破坏。两条状态线理论上永远一致，但任何一处漏改（比如 finally 块异常路径或 abort 路径）就出现 "isTranslating=false 但 currentState.status='translating'" 的卡死状态。当前实现恰好一致，但脆弱。

**建议**：删 `isTranslating`，只检查 `currentState.status`。`abortController` 已经够作为"是否在跑"的信号。属于"应该改"。

#### 1.2 [中] 并发回调中 setState 触发状态+消息风暴

**证据**：`src/content/content.ts:341-346`

```typescript
onItemComplete: completed => {
  current = completed;
  if (currentState.status === 'translating') {
    setState({ status: 'translating', current, total, currentImageIndex });
  }
},
```

`processInParallel` 多个并发任务，每个完成都触发 `setState` → `sendToBackground(STATE_UPDATE)` → popup 重新 render。N 张图 = N 次跨进程消息 + popup 重渲染。消息频率会随 `parallelLimit` 放大。

**建议**：状态更新加节流（`requestAnimationFrame` 或 100ms debounce），最后一并发送。或只发 "translating→translating with new current" 的 diff。属于"应该改"。

#### 1.3 [中] `CONFIG_UPDATED` 消息无人接收

**证据**：`src/components/Popup/PopupApp.tsx:295`

```typescript
void chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED' }).catch(() => undefined);
```

`background.ts:199-241` 的 switch 只处理 `JOB_TRANSLATE_IMAGE` / `JOB_QUERY_STATUS` / `STATE_UPDATE` / `READY` / `FETCH_IMAGE_BYTES` / `HUD_CANCELLED`，**`CONFIG_UPDATED` 没有任何分支处理**。content.ts:481 `handleStorageChange` 是用 `chrome.storage.onChanged` 监听，不监听 message。

**风险**：Popup 切换 provider 时，content 完全不知道，auto-translate 还在用旧 provider 配置。属于"应该改"，P1。

**建议**：要么 Popup 也改走 `chrome.storage.sync.set`（让 content 的 `handleStorageChange` 自然收到），要么 background 加一个 `CONFIG_UPDATED` 转发逻辑。

#### 1.4 [中] Popup/Content 消息类型重复定义

**证据**：`src/components/Popup/PopupApp.tsx:17-29` 重新定义 `ContentState` 和 `PopupToContentMsg`，与 `src/content/content.ts:46-65` 同名类型不 import。

**风险**：类型漂移——Popup 端类型少了 `currentImageIndex` 和 `suggestion` 字段（content.ts:60-65 有，PopupApp.tsx:17-22 没有）。运行时如果 content 发 `suggestion`，Popup 把它吞了；error 状态少渲染一行建议。属于"应该改"。

**建议**：把 `PopupToContentMsg` / `ContentToPopupMsg` / `ContentState` 提到 `src/shared/runtime-contracts.ts`（已经有部分消息契约在那里），Popup 直接 import。

#### 1.5 [低] auto-translate 重复触发链

**证据**：`src/content/content.ts:222-233, 481-505` + `src/content/auto-translate-observer.ts:8-20`

```typescript
// auto-translate-observer.ts
if (!enabled || !hasPendingImages) return false;
return status === 'idle' || status === 'complete' || status === 'error';
```

观察者触发 → debounce 800ms → `maybeAutoTranslateNewImages` → 若条件满足 → `translatePage()`。问题在于：

1. `findTranslatableImages()`（content.ts:154-161）已经过滤掉 `processedImages` 里的，所以即便在 `complete` 状态触发，也只是再扫一遍——不会重复翻译。**这是好的**。
2. 但 `handleStorageChange` 启用时也调 `autoTranslateScheduler.schedule()`（content.ts:500），加上 observer 自己的 schedule，可能出现短时间内多次 schedule。debounce 800ms 会合并，最终只跑一次。**也是好的**。

**结论**：链路是合理防御性编码，无 bug。无需改。

### 2. 错误处理

#### 2.1 [高] **六个 utils/stores 组件完全死代码（约 2150 行）**

通过 grep 验证 `external imports = 0`：

| 文件 | 行数 | 死代码原因 |
|---|---|---|
| `src/utils/api-error-messages.ts` | 394 | 整个 `UserFriendlyAPIError` / `parseAPIError` 体系，无人 import。`error-handler.ts` 是实际使用的版本 |
| `src/utils/code-quality-checker.ts` | 457 | `performFullCheck` / `quickQualityCheck` 全部是空实现（detectTypeIssues 返回 []），且无人调用 |
| `src/stores/persistence.ts` | 481 | `ChromeStorageAdapter` / `LocalStorageAdapter` / `PersistenceManager` / `MigrationManager` / `BackupManager` / `EncryptionUtil` 整库无人使用。**特别讽刺**：`EncryptionUtil.encrypt` 注释写"简单的Base64编码"——和真正在用的 `crypto.ts` 的 XOR obfuscation 是两套完全不同的实现 |
| `src/stores/product-metrics.ts` | 244 | `useProductMetricsStore` 整个 store + `track/getSummary/getReport` API 零外部 import。`track` 事件是定义者，调用方 grep 不到 |
| `src/components/ErrorBoundary.tsx` | 202 | 整个 ErrorBoundary 组件零 import。实际用的是 `src/components/ui/error-boundary.tsx` |
| `src/components/providers/QueryProvider.tsx` + `src/hooks/query-client.ts` | 24 + 158 | popup.tsx / options.tsx 都没用 `<QueryProvider>`。`@tanstack/react-query` + `react-query-devtools` 全部白引 |

**风险**：~2150 行死代码 + 一个被引入但完全没用的 5MB 依赖（`@tanstack/react-query` + devtools）。维护者改 `error-handler.ts` 永远不会意识到 `api-error-messages.ts` 里有另一套错误码体系，已经完全分叉；改 Options UI 时也不会注意到 `product-metrics.ts` 定义了一堆产品事件但没人发。属于"必须修"。

**建议**：
1. 立即删除 6 个文件（含 package.json 的 `@tanstack/react-query`、`@tanstack/react-query-devtools` 依赖）
2. 给 ESLint 加 `no-unused-import` / `no-unused-vars` 规则（CLAUDE.md 说"禁止非空断言 !"，但 unused 没禁）让死代码进不来

#### 2.2 [中] retryWithBackoff 使用率低、参数偏激进

**证据**：`src/services/translator.ts:394, 532` 共两处使用，都是 `retryWithBackoff(fn, 2, 1000)` = 最多 3 次尝试，baseDelay 1s。

```typescript
// translator.ts:407
const fallbackResponse = await retryWithBackoff(
  () => this.callTranslationTransport(...),
  2,     // 失败后重试 2 次 = 总 3 次
  1000   // baseDelay 1s
);
```

**风险**：图片翻译是 LLM 调用，单次 2-30s，重试 3 次 = 可能 1-2 分钟。`error-handler.ts:486-492` 的逻辑是：只有 `retryable=true` 的错误才重试，但 `AUTH_ERROR`/`CONFIG_MISSING` 等已经在第一次就会 throw，OK。但 `RATE_LIMIT` 错误重试 1s 后立刻重发，会**立刻被再次 429**——指数退避 baseDelay=1s 实际只 sleep 1s, 2s, 不会绕过限流。

**建议**：retryable 错误分类 + 区分重试策略：RATE_LIMIT 用更长 baseDelay（5s+）。属于"应该改"。

#### 2.3 [中] 静默失败多

`background.ts:214, 235, 410, 510` 多处 `.catch(() => undefined)` 静默吞错；`content.ts:425, 575` 同样。

**风险**：扩展 reload、service worker 死亡、tab reload 等场景下的真实失败无法被任何指标捕获。`product-metrics.ts` 跟踪 `translate_failed` 事件但只在 content 端，background 的失败不入库。

**建议**：在 background 入口处加一个统一的"消息失败计数器"，写到 console.warn 至少。属于"可以等"，v0.3 阶段不用做。

### 3. 消息协议

#### 3.1 [中] sender 校验只有一行

**证据**：`src/background/background.ts:189-195`

```typescript
const isExtensionOrigin = sender.id === chrome.runtime.id;
const isContentScript = !!sender.tab?.id;
if (!isExtensionOrigin && !isContentScript) {
  sendResponse({ success: false, error: 'Unauthorized sender' });
  return;
}
```

**风险**：来自外部 web 页面（通过 `chrome.runtime.sendMessage`）的消息 `sender.id` 是 undefined（web 消息不带 id），所以会落到"既非扩展也非 content"分支被拒。**这条防线有效**。但**`getConfig` / `setConfig` / `FETCH_IMAGE_BYTES` / `fetchImage` 这几个 action 任何人调都能调**——外部恶意页面如果能拿到 `chrome.runtime.sendMessage` 权限就能读取用户 API key 配置。

实际上外部 web 页面**不能**调 `chrome.runtime.sendMessage` 触达扩展（除非扩展用 `externally_connectable`），所以这层防线是 Chrome 给的。**OK，可以不动**。但建议在 manifest 加 `externally_connectable: { matches: [] }` 显式拒绝外部连接（默认就是空，但写出来更明确）。

#### 3.2 [低] `chrome.runtime.sendMessage` 失败处理不一致

`content.ts:423-431` 包了 try/catch + .catch，OK。
`background.ts:214, 235` 用了 `void ... .catch(() => undefined)`，OK。
`components/Popup/PopupApp.tsx:295` 也是 `.catch(() => undefined)`，OK。

但 `background.ts:497-511` 整个块是 `void` + 多层 `.catch(() => undefined)` 嵌套——错误丢得最彻底。

**结论**：协议本身完整，类型在 `runtime-contracts.ts` 定义好。属于"可以等"。

### 4. 状态管理

#### 4.1 [高] **store 同步潜在死循环**

**证据**：3 个地方写 `chrome.storage.sync`：

```typescript
// config-v2.ts:138 (Zustand persist middleware 自动调)
await chrome.storage.sync.set({ [name]: parsedValue });

// background.ts:164 (setConfig 主动写)
await chrome.storage.sync.set({ [CONFIG_STORAGE_KEY]: cloned });

// config-v2.ts:336-363 (setupStorageChangeListener 监听 onChanged)
useAppConfigStore.setState((state) => ({
  ...state,
  ...newState,
}));
```

调用链：
1. 用户在 Popup 改 provider → `setProvider(...)` 改 store
2. Zustand persist middleware 写 `chrome.storage.sync`
3. 触发 `chrome.storage.onChanged` → background 的 listener 调用 `syncQueueLimit`（line 65-74，只关心 parallelLimit，不会死循环），**且** config-v2 的 listener 收到变更后 `useAppConfigStore.setState(...)`（line 355-361）
4. `setState` 改 store → Zustand persist 又写 chrome.storage.sync → onChanged → 回到 3

**风险**：第 3 步的 setState 用 `{...state, ...newState}` 是浅合并，如果 `newState` 跟当前 state 完全相同，Zustand 默认不触发重新写入（它有 equality 优化）。但**浅合并不能保证引用相等**，如果 store 里某个嵌套对象（比如 `providers.openaiCompatible`）结构不同就会重复 set。

实际上目前能跑通，说明 Zustand 的中间件有去重，但**这是一个隐藏的脆弱性**——任何人加新字段时容易踩。

**建议**：删除 `config-v2.ts:330-364` 的 `setupStorageChangeListener`。Zustand persist 自己已经管好 store ↔ storage 同步，不需要外部再监听。**属于"必须修"**——这是"会变成大坑"那类。

#### 4.2 [中] 4 个 Zustand store 都有重复的 chromeLocalStorage adapter

每个 store（cache-v2、usage-store、product-metrics）都自己写一份 chromeLocalStorage 适配器。`config-v2.ts` 写自己的 `chromeStorage` 适配器。4 份。

**建议**：抽到 `src/stores/chrome-storage.ts` 一个文件，每个 store 引一次。属于"应该改"。

#### 4.3 [中] `transport` 单实现却暴露 set/reset

**证据**：`src/services/translation-transport.ts:126-140`

```typescript
let defaultTransport: TranslationTransport = new ChromeRuntimeTranslationTransport();
export function setDefaultTranslationTransport(transport: TranslationTransport) { ... }
export function resetDefaultTranslationTransport() { ... }
```

只有一个实现（`ChromeRuntimeTranslationTransport`），`set/reset` 没人用。属于"应该改"——属于上面 2.1 死代码一部分，但功能无害。

### 5. 代码组织

#### 5.1 [中] `processedImages` / `failedImageKeys` Set 永久在内存

**证据**：`src/content/content.ts:84-85, 364, 414-416`

```typescript
const processedImages: Set<string> = new Set();
const failedImageKeys: Set<string> = new Set();
```

只在 `clearAll()`（content.ts:412-413）和 `cleanup()`（content.ts:572-573）清空。用户长会话、连续翻几十页后这个 set 越来越大，直到 tab 关闭。**轻微内存泄漏**。

**建议**：超过 N 条后淘汰（用 LRU）。或者以页面 `chapterId` 为 key 分桶，切换 chapter 时清空。属于"可以等"。

#### 5.2 [中] v1 残留：hybrid-regions 管线仍可用

**证据**：`src/services/translator.ts:362-477` 完整保留 hybrid-regions 翻译流程（detectTextRegions → crop → batch → translate）。`shared/app-config.ts:77` `translationPipeline: 'hybrid-regions' | 'full-image-vlm'` 默认 `hybrid-regions`，但 CLAUDE.md 说"默认 full-image-vlm"。

**问题**：CLAUDE.md 和 `shared/app-config.ts:101` 不一致——README/CLAUDE 说默认 `full-image-vlm`，代码默认是 `hybrid-regions`。这是文档和代码漂移。

**建议**：对齐 `translationPipeline` 默认值到 `full-image-vlm`。属于"应该改"，P2。

#### 5.3 [低] types/ 几乎被完全 bypass

**证据**：`src/types/index.ts:8-17` 是 re-export 桥，从 `providers/base` 引入 5 个类型，从 `services/reading-result` 引入 3 个。但 `providers/base.ts` 自己已经 export 了同样的类型。`types/index.ts` 是"什么都没做"的转发层。

**建议**：删除 `types/index.ts` 或真的把"全局 UI 类型"放进去（目前里面只有 `Theme` / `Language` 等没被引用的类型）。属于"可以等"。

### 6. 测试

#### 6.1 [高] `content.test.ts` 没测 content.ts

**证据**：`src/content/content.test.ts`（70 行）只测了：
- `clampPageTranslationConcurrency`（from `page-translation-utils`）
- `extractPersistedConfigState` / `getEnabledFromConfig` / `getOverlayStyleFromConfig`（from `config-snapshot`）

**没有测** `content.ts` 的状态机——`translatePage` / `cancelTranslation` / `setState` / `handleMessage` 全部裸奔。

**风险**：状态机一旦回归（比如重构后没改对应测试），CI 不会报警。属于"必须修"——CLAUDE.md 说 PR 前必须 `pnpm test:run` 通过，但测的是边缘 utils，不是核心。

**建议**：加 `translatePage` 的状态机测试。`isTranslating` 锁 + `setState({ status: 'translating' })` + finally 清理，核心场景能 1 小时内补出来。

#### 6.2 [中] test/setup.ts mock 不完整

**证据**：`src/test/setup.ts:42-58`

```typescript
const chromeMock = {
  storage: { sync: ..., local: ... },
  runtime: { id, sendMessage, onMessage: ... },
};
```

缺 `chrome.tabs`、`chrome.tabs.query`、`chrome.tabs.sendMessage`、`chrome.contextMenus`、`chrome.storage.onChanged`。background.test / content.test / PopupApp.test 要测消息流就会 break。

**建议**：补齐 mock 矩阵。属于"应该改"。

#### 6.3 [中] 没有 e2e

CLAUDE.md 提到 `smoke-test-page.html` 但项目里没找到（grep 0 结果）。v0.3 不做 e2e 可以理解，但 content.ts 的运行时依赖 chrome 消息 + DOM mutation observer，必须真跑一遍才能验证。属于"可以等"。

---

## 二、安全隐私

### 1. 权限使用

#### 1.1 [中] **`host_permissions: ["<all_urls>"]` + `content_scripts.matches: ["<all_urls>"]`**

**证据**：`public/manifest.json:12-14, 33-37`

```json
"host_permissions": ["<all_urls>"],
"content_scripts": [{ "matches": ["<all_urls>"], "js": ["src/content/content.ts"] }]
```

**风险**：扩展能注入并读取**任何网页**的所有图片 URL + DOM 内容。隐私敏感用户看到 `<all_urls>` 也会犹豫，且没有任何告知说"图片数据会发到哪个 Provider"。

**现状要求**：
- `content_scripts.matches: ["<all_urls>"]` 是必要的（任何漫画站都可能），**OK**
- `host_permissions: ["<all_urls>"]` **必需**——background.ts:459-486 `fetchImageBytesResponse` 是跨域图片翻译的核心 CORS-bypass 路径：content 端 fetch 受页面 CORS 限制时，background 用 `host_permissions` 拿到跨域权限去拉图片字节，**删除会 100% 破坏 v0.3.2 跨域漫画图片的翻译**。不要删。

**真正缺的是告知**：
1. **Options 顶部加隐私告知 banner**：用户首次进 Options 时显示一段说明，列出
   - 启用 openai-compatible 时图片会发到云端（具体 baseUrl）
   - 切换到 Ollama / LM Studio 时图片完全本地
   - API key 会被 Google 账户同步（详见 §2.1/2.2）
2. **改用 `optional_host_permissions` + `activeTab` 模式**（Chrome MV3 推荐写法）：
   - 默认不授予 host permissions
   - 用户在 Options 显式"启用跨域图片拉取"时通过 `chrome.permissions.request({ origins: ['<all_urls>'] })` 动态申请
   - 对应 `action.default_popup` 用 `activeTab`（用户主动点击图标时获取当前 tab 权限）
   - 这样 Chrome Web Store 审核会标"按需申请权限"——是加分项

**风险等级**：[中]（权限声明本身合理，缺的是告知和按需申请）。属于"应该改"。

#### 1.2 [低] `scripting` / `contextMenus` 实际使用

- `scripting`：manifest 声明了，**代码里搜不到调用**（grep 0 命中）。属于"可以等"——死权限。
- `contextMenus`：background.ts:113-118 创建了菜单 `translatePage`，但**没有 `chrome.contextMenus.onClicked.addListener`**！菜单点了无反应。属于"必须修"——要么实现 handler，要么从 manifest 删权限。

### 2. 敏感数据

#### 2.1 [高] **API key 以 XOR 混淆形式存储在 chrome.storage.sync（详见 §2.2）**

**证据**：`src/stores/config-v2.ts:104-145` Zustand persist 用 `chromeStorage` adapter 写 sync，调 `obfuscateAllApiKeys` 做 XOR 混淆（config-v2.ts:14, 118, 132 引用 `obfuscateAllApiKeys` / `deobfuscateAllApiKeys`）。`background.ts:18, 157, 163` 同样调 `obfuscateAllApiKeys` / `deobfuscateAllApiKeys`。

```typescript
// config-v2.ts:137-138
if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
  await chrome.storage.sync.set({ [name]: parsedValue });
}
```

**风险**：`chrome.storage.sync` **会同步到 Google 账户**（用户登录 Chrome 的话）。虽然 key 本身以 `obf:af5c8d...` 混淆形式存储（防不了 GitHub 阅读者，但防一般 storage 窥探），但 sync 出去的字节流是 obfuscated 形式——攻击者拿到 Google 同步数据后解 `obf:` 即可还原明文（见 §2.2）。如果用户账号被盗，攻击者能在 `chrome://settings/syncSetup` 看到所有设备同步的扩展配置 → 用同一份源码解出 API key。

#### 2.2 [高] **crypto.ts 是 XOR obfuscation，不是加密**

**证据**：`src/utils/crypto.ts:7-31`

```typescript
const SALT = 'manga-translator-salt';  // 硬编码在源码中

export function obfuscateApiKey(key: string): string {
  // ...
  const charCode = latin1Key.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length);
  // ...
  return `obf:${hex}`;
}
```

**真相**：
1. 盐 `"manga-translator-salt"` 硬编码在源码里——所有人都能解
2. XOR 不是加密算法（密码学上称为"无害的混淆"）
3. `unescape(encodeURIComponent(key))` 是 base64 之前的标准做法，但和加密无关

**结论**：API key 在 sync 里是 `obf:af5c8d...` 格式，**任何人从 GitHub 拿到源码就能 decode**（这层防的是其他扩展偷 storage 内容，不防 GitHub 阅读者）。

**建议**：
- **v0.3 必须修**：要么改用 `chrome.storage.local`（不跨设备同步），要么加一个真正需要用户密码才能解密的 layer（PBKDF2 + 用户输入）
- **短期可接受**：现状是"防懒人不防专家"，对 v0.3 demo 够用。但**必须在 Settings UI 加显著提示"API key 会被同步到你的 Google 账户"**，让用户有知情权

属于"必须修"。

#### 2.3 [中] 图片上传目标

- **默认 Provider（openai-compatible）**：baseUrl 默认 `https://api.openai.com/v1`（`shared/app-config.ts:27`），用户翻页时图片会 base64 编码发到这里
- **可切到 Ollama / LM Studio**：完全本地（`localhost:11434` / `localhost:1234/v1`）

**风险**：用户第一次用默认配置翻译时，**没有任何告知**说"图片会上传到 OpenAI"。CLAUDE.md 提到"AI-powered manga translation" 但不写明云端。

**建议**：Options 页面 Provider 切换时，openai-compatible 选项旁加一个明显的 badge "云端" + tooltip 解释。属于"应该改"。

### 3. CSP

#### 3.1 [中] manifest 没设 CSP，但 Chrome MV3 默认足够

**证据**：`public/manifest.json` 全文 45 行，无 `content_security_policy` 字段。

**现状**：Chrome MV3 强制 CSP `script-src 'self'; object-src 'self'`，不允许 inline script。`popup.html` / `options.html` 用 `<script type="module" src="...">` 引用外部文件，OK。

**风险**：低。但 Vite build 如果自动注入 inline script（hot reload 模式下会有），prod build 应该没事。建议在 manifest 显式声明 CSP 强化防御。

**建议**：

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self';"
}
```

属于"应该改"，P2。

### 4. 第三方依赖

#### 4.1 [中] `tesseract.js@7.0.0` 是 2025-09 发布的新主版本

**证据**：`package.json:61-62`、CLAUDE.md 没提、`scripts/copy-tesseract.js` 在 build 前拷贝 5 个 wasm 文件

- `tesseract.js 7.0.0` 2025-09 发布，是 5.x → 7.x 跳版本（实际主版本）
- `@crxjs/vite-plugin@2.4.0` 已 EOL（2023 最后更新）
- `vitest@0.34.6` 还在 0.x，但功能稳定
- `vite@4.5.14` 已老，5/6 都出来了

**风险**：tesseract.js 7.x 还在快速迭代，可能有 API 破坏。`scripts/copy-tesseract.js` 硬编码文件路径 `tesseract.js/dist/worker.min.js`，升级时会 break。

**建议**：
- 把 tesseract 锁在 7.0.x 不升
- 或彻底切到 web llm + 直接 VLM 处理（CLAUDE.md 提的 full-image-vlm 默认值已经隐含这个方向）

#### 4.2 [中] 过期依赖：`@crxjs/vite-plugin@2.4.0`

EOL。Chrome MV3 扩展官方推荐用 `vite-plugin-web-extension` 之类。属于"可以等"——能用就行。

#### 4.3 [中] `@tanstack/react-query` 完全未使用

dead dep（见 2.1）。删除能省 5MB 安装体积。

### 5. 隐私告知

#### 5.1 [高] **首次使用没有任何告知**

**证据**：`background.ts:120-125`

```typescript
if (details.reason === 'install') {
  void initializeDefaultSettings();
  void chrome.runtime.openOptionsPage();
}
```

`initializeDefaultSettings` 只写默认 config，**没有任何"你的图片会被发送到 X，请确认"的 dialog**。

**建议**：
- 在 Options 页面顶部加一个"首次使用"banner，列出数据流向（"你翻译的图片会发到 X"）
- 文案至少 1 段 100 字解释

属于"应该改"，**chrome Web Store 隐私政策问卷**会卡这个。

#### 5.2 [低] 远程图标 / CDN

`public/icons/*` 全是本地。`text-detector.ts:96` 有一个 langPath 指向 `https://npm.elemecdn.com/@tesseract.js/langs/dist/`——但这是 tesseract worker 的语言包下载，**不会泄露用户访问的 URL**（请求里没有 referer）。OK。

---

## 必须修的 3 件事

1. **API key 加密是假加密，且自动同步到 Google 账户**（src/utils/crypto.ts + src/stores/config-v2.ts）
   现状：XOR 混淆 + 硬编码盐，API key 以 `chrome.storage.sync` 形式随用户 Google 账户同步。
   建议：① 短期内切到 `chrome.storage.local`（不跨设备但更安全）；② Options 页面 Provider 配置旁加显眼警告；③ 在 Options 顶部加首次使用告知 banner 说明数据流向。
   风险：用户账号被盗 → 攻击者从同步数据拿到明文 API key。

2. **`contextMenus` 菜单点了无反应 + `scripting` 死权限**
   建议：① 要么实现 `chrome.contextMenus.onClicked` 监听器（点击菜单触发对应 tab 的 `TRANSLATE_PAGE`），要么从 manifest 删 `contextMenus` 权限；② 同步删除 `scripting` 权限（代码里 0 调用）。`host_permissions` 保留（跨域图片拉取必需，详见 §1.1）。

3. **6 个完全死代码文件 + 1 个 store 同步潜在死循环**（共 ~2150 行）
   建议：① 立即删除 6 个死文件：`src/utils/api-error-messages.ts`、`src/utils/code-quality-checker.ts`、`src/stores/persistence.ts`、`src/stores/product-metrics.ts`、`src/components/ErrorBoundary.tsx`、`src/components/providers/QueryProvider.tsx` + `src/hooks/query-client.ts` + `src/hooks/use-theme.ts`；② 删除 `config-v2.ts:330-364` 的 `setupStorageChangeListener`（避免 store 写 → sync 写 → onChanged → store 写的潜在循环）；③ package.json 删除 `@tanstack/react-query` 和 `@tanstack/react-query-devtools`；④ 加 ESLint `no-unused-import` 规则防再进。

---

## 应该改的 5 件事

| # | 类别 | 问题 | 建议 |
|---|---|---|---|
| 1 | 状态机 | `isTranslating` + `currentState` 双重锁 | 删 `isTranslating` |
| 2 | 状态机 | `CONFIG_UPDATED` 消息无人处理，Popup 切 provider 后 content 不知情 | 改走 chrome.storage.sync.set |
| 3 | 状态机 | processInParallel 回调 setState 频率 = 并发数 × N | 加 100ms 节流 |
| 4 | 错误 | retryWithBackoff 对 RATE_LIMIT 退避太短（1s） | 区分错误类型，RATE_LIMIT 至少 5s |
| 5 | 测试 | content.test.ts 不测 content.ts | 补状态机测试，2 小时内能写完 |
| 6 | 类型 | PopupApp.tsx 重新定义 ContentState/PopupToContentMsg 而不 import | 提到 src/shared/runtime-contracts.ts |
| 7 | 错误 | 4 个 store 重复 chromeLocalStorage adapter | 抽到 src/stores/chrome-storage.ts |
| 8 | 隐私 | 首次安装无数据流向告知 | Options 顶部 banner |
| 9 | 文档 | CLAUDE.md 说 default 是 full-image-vlm，代码默认是 hybrid-regions | 对齐 shared/app-config.ts:101 |
| 10 | CSP | manifest 未显式声明 CSP | 加 `content_security_policy.extension_pages` |

---

## 可以等的事（v0.4+ 再考虑）

- `processedImages` Set 内存增长 → LRU 淘汰
- 跨标签页的 store 同步 race condition（多 tab 同时改 config）
- transport 的 set/reset API（只有一个实现）
- e2e 测试
- `types/index.ts` 删或重写
- 静默失败上报到 background
- @crxjs/vite-plugin 2.x 升级

---

## 总结

| 维度 | 评价 |
|---|---|
| 架构 | 模块边界基本清晰，但死代码 2150+ 行是负债；核心状态机实现合理但缺乏测试覆盖；store 同步有个潜在死循环（修起来 5 分钟） |
| 安全 | API key 假加密 + 同步 Google 账户是最大风险；权限声明有不一致（contextMenus 菜单点了无反应、scripting 死权限），host_permissions 本身合理缺告知；隐私告知缺失。都是 Web Store 审核会卡的项 |
| 测试 | 70% 阈值对 v0.3 够用，但 content.ts 状态机裸奔是隐患 |
| 整体判断 | **这是 v0.3 早期项目，能用但不耐操**。上面"必须修 3 件事"加起来半天工作量，能把"会变成大坑"的问题一次性清掉。 |
