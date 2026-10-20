# v3 产品硬化：让每个界面说实话，并把 API Key 挡在网页之外

- 时间：2026-10-20 07:44:55 +0000
- 项目：chrome-plugin-manga-translator
- 触发者：Jasper（产品负责人），以 `/goal` 下达的一次完整授权
- 前序日志：`.ai-logs/2026-10-08-152018-github-release-and-privacy-hosting.md`
- 分支：`feat/v3-product-hardening` → PR #9

## 一、对话出发点（用户原始需求与动机）

Jasper 的一条 `/goal` 指令，完整引用如下：

> 你是一个挑剔的专家，你是一个资深的产品总监，你是一个苛刻的用户体验专家。现在呢，就这个产品而言，发挥你所有的思考能力，发挥你的毒舌，发挥你所有的找毛病的地方，来找到这个产品的问题，然后列出来。接下来呢，自我审查一下，看看是不是如此。如果是如此的话呢，你作为这个项目的主要负责人，派 subagent 去修复这些问题，修完之后要进行再次审查，如此迭代。我需要你作为主要的中枢、主要负责人，你调用专家组去审查，你调用各种能力去找问题，然后去修复问题。修复的范围包括不限于功能的增加、模块的调整、UI 的变更、交互的改进、主题的调整、UI 组件位置的调整、各种方面用户体验方向的调整，还有如果这个产品你觉得哪些地方需要调整，功能性的，哪怕是方向性的，你可以自行改动。我给你足够的权限，你把这个产品当成自己的孩子去拓展、去做。我希望你给我一个我可以拿得出的成熟的产品来。你可以充分使用你的各种 skills 和 agent 能力。你是这个项目的负责人，我希望你可以迭代多轮，你自己去设计。我会把你设置成一个最终的目标。我需要的是一个较为标准化的产品。

拆成六条可执行的：

1. 以产品总监 + UX 专家的标准**挑刺**，把问题列出来；
2. **自审**这些结论，不轻信 agent 的报告；
3. 以项目负责人身份**派 subagent 修**；
4. 修完**再审**，迭代；
5. 授权范围极大：功能、模块、UI、交互、主题、组件位置，方向性改动也可以；
6. 交付一个"拿得出手的成熟产品"，多轮迭代。

## 二、执行过程（做了什么、怎么做的）

### 1. 审计与修复分两轮

- 第一轮：产品/UX 维度挑刺（阅读顺序、面板可用性、弹窗诚实度、错误语义、翻译可读性、悬停行为、面板关闭、空译文遮罩、字体大小不重排……），逐条落到代码与测试。
- 第二轮（安全维度复核）：派子 agent 复核第一轮的结论时发现，**"content script 不再持有 API Key"这个说法是假的**——运行时确实不持有，但**构建产物里带着明文 Key**。

这一条是本轮最重要的发现，下面单独展开。

### 2. 凭据隔离（根因修复，不是措辞修复）

**问题的根因**：`scripts/inject-env-config.mjs` 把 Key 注入到 `env-config.generated.ts`；`app-config.ts` 导入它；`content.ts` 导入 `app-config.ts`。于是 `dist/content.js` 里就是明文 Key。上一轮的 commit 标题写着"the content script no longer holds the API key"——**运行时成立，产物上不成立**。

**修法**：把构建期配置劈成两半。

| 文件 | 内容 | 谁可以导入 |
| --- | --- | --- |
| `env-config.generated.ts` | endpoint + model | 任何上下文（不是凭据） |
| `env-credentials.generated.ts` | apiKey | 只有 worker 与扩展自有页面 |

- `app-config.ts`（content script 导入的那个）里的 `apiKey` 改为 `''`；
- 新增 `src/shared/preloaded-config.ts`（特权模块）：持有 `PRELOADED_*` 三份预置配置与从 `app-config.ts` 搬出来的 `normalizeRuntimeAppConfig`；
- `src/stores/config-v2.ts`、`src/background/background.ts`、`OptionsApp.tsx`、`OnboardingApp.tsx` 改指向新模块。

**两道构建闸**（`scripts/check-release-consistency.mjs`）：

- `checkCredentialBoundary()`：走 content script 的**源码导入图**，能到达凭据模块即失败。
  之所以放在源码层而不是只查产物：产物检查发生在"错误已经写进磁盘"之后，晚了。
- `checkNoCredentialsInContentScript()`：产物 `dist/content.js` 里出现构建期 Key 即失败。

两者的**双向**测试都写进了 `scripts/__tests__/check-release-consistency.test.mjs`，包括"type-only import 不算依赖"这一条——`import type` 编译后被擦除，把它算成依赖会训练人绕过闸门而不是修真正的泄漏。

**顺带修的**：`check-public-build.mjs` 原本在 `env-config.generated.ts` 里找 Key，而拆分之后那个文件永远没有 Key——它读的是**一个不再含凭据的文件**，等于没查。改为两个生成文件都读，并补了一条针对凭据文件的测试。

**实测产物**：

```
dist/content.js      无 Key、无混淆 salt、无 chunk 引用（自包含 IIFE）
dist/chunks/crypto-*.js  含 Key —— 只被 background/popup/options 导入，且不在 web_accessible_resources
```

`web_accessible_resources` 仍然只有 `tesseract/*`。

### 3. 冒烟测试：这次真的跑起来了

上一轮结论是"这个环境装不了扩展，只能静态验证产物"。**那个结论当时是对的，这一轮发现它不再成立**：Chrome 137+ 默认禁用 `--load-extension`，但加上 `--enable-unsafe-extension-debugging` 后可以用 CDP 的 `Extensions.loadUnpacked` 装上。Chrome 155 实测成功。

于是本轮把 PR 模板里一直空着的"手动冒烟测试"真正跑了（`docs/chrome-web-store-release.md` 第 1、2、3、4、10 步）：

| 项 | 实测结果 |
| --- | --- |
| 干净 profile 加载 `dist/` | 扩展加载成功，service worker 起来，设置页正常渲染（onboarding + 全部设置项） |
| 服务商连通性 | `PROVIDER_PREFLIGHT` → "OpenAI-Compatible 配置有效"，**证明拆分后构建期 Key 仍能到达 worker** |
| 翻译 fixture | 2 张成功、3 张被过滤；面板里普通页 3 个气泡、长条 4 个气泡，**按阅读顺序排列** |
| 缓存 | 第二次跑显示"缓存 2 · 其中 2 张来自缓存"，重复图片零请求 |
| content script 落在普通网页 | 隔离世界"漫画翻译助手"在 `http://localhost:8000/smoke-test-page.html` 上被创建，HUD 出现，翻译触发并完成 |
| 面板自己的 ✕ | 点击后 host 变 `display: none` + `aria-hidden="true"`（本轮修的 bug，真实浏览器验证通过） |
| 弹窗 | 渲染出完整控件组（翻译当前页、启用、阅读设置、后端、强制重翻、清除、移除、本月调用次数） |

**没能跑的两项，以及为什么**（不是产品缺陷）：

- fixture 里的跨域图需要能连到 `upload.wikimedia.org`。本机当时没有这条路由，图加载成 0×0，在发起任何请求**之前**就被过滤器剔掉，所以后台代理取图路径没被验证到。
- 第 7~9 步（重载后设置留存、白名单自动翻译、公开包要求填配置）需要第二个干净 profile 与公开包。

顺手把踩到的坑写进了 `docs/chrome-web-store-release.md`：`--load-extension` 在 137+ 默认失效；扩展自有页面必须由 Chrome 打开（自动化客户端直接导航 `chrome-extension://` 会被 `ERR_BLOCKED_BY_CLIENT`，看起来像产品坏了其实不是）。

### 4. 构建链上的"外部硬限制要有断言"

延续上一轮"商店字段上限必须落成断言"的教训，本轮把两条外部规则落成构建闸：

- content script 的导入图不得触达凭据模块；
- 产物 `dist/content.js` 不得含构建期 Key。

`docs/store-claims.md` 同步登记了"明文密钥不进 content script"这条对外承诺，锚点指向 `checkCredentialBoundary` / `checkNoCredentialsInContentScript` / `ENV_CREDENTIALS` / `app-config.ts:apiKey: ''`；隐私政策与审核备注都补了对应句子（承诺表 43 条 / 101 锚点，全部机器校验通过）。

### 5. 明确决定不做的事：P2-19（取消时中止 fetch）

审计里提过"点取消后，正在飞的那次请求应该真的中止"。**决定不做**，理由：

- 请求只要**已经发出去**，服务商就照样计费——中止客户端 socket 不会退钱；
- 真正可控的浪费（还没发出去的那批）已经被信号挡住了；
- 为此把 `AbortSignal` 穿过整条凭据链路，风险大于收益。

所以"取消"这个动作的诚实定义是：**不再发起新的请求**，而不是"已经发出去的不算钱"。

## 三、遇到的问题（报错、阻塞、意外行为）

1. **自己写的闸误报**：`checkNoCredentialsInContentScript` 最初用"生成文件里所有长度 ≥ 8 的字符串"当凭据，结果把 provider 名字 `opencode`（8 个字符）当成了 Key，构建直接红。改为**结构化解析** `ENV_CREDENTIALS` 的 JSON，只取 `apiKey` 字段的值。
2. **测试夹具不够真**：新加的闸会让 `scripts/__tests__/check-release-consistency.test.mjs` 里原有的 8 个用例全部失败（夹具里没有 `src/content/content.ts`）。没有把闸改成"文件不存在就跳过"——那样闸就永远不生效。改成给夹具补一棵最小源码树（content script + app-config + env-config + 凭据模块），顺带写出"闸确实能抓住泄漏"的两条反向测试。
3. **ID 手抄错了**：`hkbmnncffkoccfimcenaleepgdok` 我手抄少了一个字符，导致隔离世界筛选始终为空，排查绕了一圈。改成从 `Extensions.getExtensions` 里按路径取 ID，不再手抄。
4. **CDP 打开扩展页被 Chrome 拦**（`ERR_BLOCKED_BY_CLIENT`）。先怀疑是自己扩展的 bug，做了**对照实验**：两个对照扩展（无权限 / 带 `<all_urls>` 权限 + content script）用同样方式加载，页面都正常打开；再用 `chrome.runtime.openOptionsPage()` 让 Chrome 自己打开我们的设置页——**正常渲染**。结论：不是产品缺陷，是"自动化客户端直接导航扩展 URL"这条路被 Chrome 拦了。已写进发布文档。
5. **GitHub 推送一度全挂**（`SSL_ERROR_SYSCALL`）。查下来是本机代理（Clash Verge 的 fake-ip，198.18.0.0/15）当时不通，其他域名正常。等代理恢复后推送成功，没有改任何网络配置。

## 四、最终结果（成功/失败与具体产出）

**状态：成功。**

### 交付物

| 项 | 结果 |
| --- | --- |
| PR | https://github.com/hibernate-pano/chrome-plugin-manga-translator/pull/9 （base `main`，6 commits，113 文件） |
| 凭据隔离 | content script 的导入图 38 个模块，**不含任何凭据模块**；`dist/content.js` 无 Key 无 salt |
| 构建闸 | 源码层 + 产物层两道，双向测试覆盖 |
| 冒烟测试 | 在 Chrome 155 真实跑通，7 项通过，2 项因环境无法执行并已记录原因 |
| 门禁 | `format:check` / `lint:strict` / `type-check` / `test:coverage` / `build` / `release:check` 全绿 |
| 测试 | 871 通过 / 60 文件；覆盖率 85.65% 语句、75.02% 分支、83.94% 函数、86.38% 行；62/64 文件在分母内，2 个显式豁免 |
| 体积 | `dist/content.js` 129.9 KB / 200 KB |
| 承诺表 | 43 条承诺 / 101 个锚点，全部机器校验通过 |

### 仍然存在、必须对用户说清楚的

1. **已发布的 v2.0.3 公开包带走了开发者的私有 HuggingFace 仓库路径**（`hf.co/outsourc-e/...`），作为默认模型写进了包里。已发布产物**撤不回来**。这会在商店用户的第一次"测试配置"时失败（他们拉不到那个模型），也是一次不该发生的私有信息泄露。`build:public` 路径**现在**会清空它（`check-public-build.mjs` 会因 `HuggingFace repository reference` 报错），但 v2.0.3 那一版已经出去了。→ 下一个公开版本必须重发，且提交前务必核对 zip。
2. **商店截图与演示视频仍缺**。本轮第一次有了可用的真实翻译画面（冒烟测试里那两张图），但截图需要 1280×800 / 640×400 的成品图与 30 秒录屏，属用户侧。
3. **`<all_urls>` 是否收紧**仍是产品决策，本轮未擅自改。
4. **隐私政策仍是英文**，而界面与商店文案是中文。自行翻译有引入表述偏差的风险，未擅改。

### 下一轮该做什么（按优先级）

1. 把 v2.0.3 的公开包问题写进 `ROADMAP` 的"已知问题"，并准备 v2.0.4 / v3.0.0 的公开发布（重发前跑 `pnpm build:public` + `pnpm package:public` 的完整终检）。
2. 商店截图 + 录屏——现在有真实翻译画面可以截了。
3. 隐私政策中文化（需要一次人工校对，别由我直接翻）。
4. 剩余的 UX 审计项（如果有）继续迭代。
