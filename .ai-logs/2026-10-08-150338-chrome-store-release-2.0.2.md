# Chrome 商店上架准备与 v2.0.2 发布

- 时间：2026-10-08 15:03 +0800
- 项目：chrome-plugin-manga-translator
- 触发者：Jasper（产品负责人）

## 一、对话出发点（用户原始需求与动机）

用户此前要求对久未关注的项目做深入体检、修复边角问题、提交推送并更新 tag。进入本阶段后，用户已确认 Chrome Web Store 开发者账号**已注册、已付费、已有其他插件在生产上架**，因此不需要注册或付款，只需要在现有账号下**新增一个插件条目**。

用户明确要求：**自己手动上传**，我只负责把"除点击按钮以外的所有事"做完。补充背景是构建用的 `.env` 里两个 LLM Key 已失效，届时由用户自己配置，无需恢复构建期注入。

原始动机可归结为：让这个扩展具备可提交审核的完整状态，且避免因为材料缺失或产物错误导致被拒。

## 二、执行过程（做了什么、怎么做的）

### 1. 产物核查（发现关键问题）

- 比对 `release/manga-translator-v2.0.1-public.zip` 的时间戳（19:05:49）与 git 提交历史。
- 发现该 zip 构建于 `b60f271`（19:06:02）之前，而 `c32d31f`（21:00:30）修复的两个运行时缺陷**不在包内**：
  - `src/stores/config-v2.ts` —— storage 监听器绕过了防御性合并
  - `src/services/translator.ts` —— `translateImages` 空控制器崩溃
- 解压检查另发现 zip 混入了 macOS 的 `.DS_Store`。

### 2. 打包脚本加固

`scripts/package-extension.mjs`：
- `zip -qr` 增加 `-x '*.DS_Store' -x '__MACOSX/*'`，排除系统垃圾文件。
- 新增"产物新鲜度校验"，打包前拒绝 `dist/` 与当前源码不匹配的情况。

### 3. 新鲜度校验的两次迭代（重要教训）

- **第一版用 mtime 比较**，在自测中暴露两类真实缺陷：
  - 我用 `touch` 把 `src/services/translator.ts` 设成 2030 后，正常构建被永久拦截；
  - 只看 `dist/manifest.json` 时，manifest 时间新但 JS 过期仍会放行。
- **结论：时间戳不可靠**（`git checkout`、`touch`、时钟偏差、归档保留未来日期都会同时造成误判和漏判）。
- **改为内容指纹**，新增：
  - `scripts/source-fingerprint.mjs` —— 对 `src/`、`public/` 及关键配置文件做内容哈希，缓存写入 `node_modules/.cache/`（不进入 dist，不会被打包）
  - `scripts/record-source-fingerprint.mjs` —— 构建结束时记录指纹
  - `package.json` 的 `build` / `build:public` 末尾追加记录步骤
  - `scripts/__tests__/source-fingerprint.test.mjs` —— 正反两个方向的行为断言

### 4. 商店材料撰写与逐条事实核对

新增：
- `docs/store-listing-zh.md` —— 名称（19 字符 / 限 45）、简短说明（66 字符 / 限 132）、详细说明、分类语言、资产要求
- `docs/store-review-notes-zh.md` —— 单一功能说明、权限理由、数据收集声明、审核员测试步骤、常见质疑问答

写文案时对照代码逐条核对，**纠正了两处会误导审核员的表述**：
- `alarms` 原写成"定时清理翻译缓存"，实际 `src/background/background.ts` 是翻译开启期间的 service worker 保活唤醒（每 0.5 分钟重新读取并发配置）；缓存的 `clear` 是用户手动操作。
- `activeTab` 经 `rg` 核查**代码零引用**，未编造理由，改为如实说明（详见问题 3）。

### 5. 移除未使用的 `activeTab` 权限

- 临时从 `public/manifest.json` 移除后跑 `pnpm build`，类型检查无依赖、代码零引用，功能安全。
- 用 `git checkout -- public/manifest.json` 恢复原格式后只删一行，避免 JSON 重排造成 12 增 5 删的格式噪音。
- 同步更新 `docs/chrome-web-store-release.md` 英文清单与审核备注。

### 6. 版本与变更记录

- 版本 `2.0.1` → `2.0.2`（`package.json`、`public/manifest.json` 两处硬编码，由 `check-release-consistency.mjs` 强制一致）
- `CHANGELOG.md` 新增 2.0.2 条目，发布日期修正为 2026-10-08（初稿误写 10-06）

### 7. 验证

按 AGENTS.md 规定的完整 CI 链执行，退出码 0：

```
pnpm format:check && pnpm lint:strict && pnpm type-check && pnpm test:coverage && pnpm build && pnpm release:check
```

- 526 个测试全部通过（47 个文件）
- 覆盖率：语句 78.95%、分支 70.44%、函数 77.54%、行 79.52%（阈值 70%）
- coverage scope：49/53 进入分母，4 个显式豁免
- `content.js` 130.5 KB / 200 KB 预算
- `pnpm package:public` 生成 `release/manga-translator-v2.0.2-public.zip`，23 个文件扫描无凭据
- 独立解压终检：30 个文件、`.DS_Store` 0 个、无 `sk-`/`Bearer` 凭据、SHA256 与 `.sha256` 一致

## 三、遇到的问题（报错、阻塞、意外行为）

1. **`npx prettier` 报错**：`require() cannot be used on an ESM graph with top-level await`。原因是调用了全局 prettier 2.8.8，与项目 prettier 3.8.3 及 tailwind 插件不兼容。改用 `./node_modules/.bin/prettier` 解决。
2. **环境禁止 `rm -rf`**：`rm -rf` 类命令被策略拒绝。改由 `vite build` 自行清理 `dist/`。
3. **`activeTab` 是"声明但未使用"的权限**：最初我写了一段听起来合理的用途解释，随即意识到给审核员一个编造理由比诚实标注"未使用"风险更高（审核员一旦验证即失去信任）。改为如实描述并最终移除该权限。
4. **freshness 校验第一版（mtime）双向失效**：见"执行过程 3"，属于本次最大的自我纠错。已用内容指纹替代并补充测试。
5. **新增测试的断言写反**：`expect(recorded === null).toBe(fingerprintSourceChanged().changed)` 在"有记录但源码已变"时不成立。重写为不依赖构建时机的确定性用例——先记录指纹确认 fresh，再改源码确认 stale。
6. **ESLint 报 `statSync` 未使用**：`no-unused-vars`，从 `source-fingerprint.mjs` 删除该导入。
7. **CHANGELOG 日期错误**：初稿写 2026-10-06，实际发布日为 2026-10-08，已修正。
8. **`write_file` 工具不可用**、`apply_patch` 因 hunk 内空行报 `invalid hunk`：改用 heredoc 与 python 脚本完成大段 Markdown 写入。

## 四、最终结果（成功/失败与具体产出）

**状态：成功。**

### 代码改动

| 文件 | 类型 |
| --- | --- |
| `scripts/package-extension.mjs` | 修改：排除 `.DS_Store`、新增内容指纹新鲜度校验 |
| `scripts/source-fingerprint.mjs` | 新增：源码内容指纹 |
| `scripts/record-source-fingerprint.mjs` | 新增：构建结束记录指纹 |
| `scripts/__tests__/source-fingerprint.test.mjs` | 新增：正反方向行为测试 |
| `package.json` | 修改：版本 2.0.2、构建链追加记录步骤 |
| `public/manifest.json` | 修改：版本 2.0.2、移除未使用的 `activeTab` |
| `CHANGELOG.md` | 修改：新增 2.0.2 条目 |
| `docs/chrome-web-store-release.md` | 修改：权限清单与 `activeTab` 说明 |
| `docs/store-listing-zh.md` | 新增：商店中文文案 |
| `docs/store-review-notes-zh.md` | 新增：审核备注 |

### 上传产物

`release/manga-translator-v2.0.2-public.zip`
- 2.7 MB，30 个文件
- SHA256：`6c30765d985f2dd8d09626c855ae46c745ce73a19a3ab4949aacfb25b9e20336`
- 无 API 凭据、无 `.DS_Store`、包含 21:00 的两个运行时修复
- 权限：`storage`、`contextMenus`、`alarms` + `host_permissions: <all_urls>`

### 仍需用户完成（无法由代码替代）

1. **隐私政策托管**：Chrome 商店要求可公开访问的 https URL，`docs/privacy-policy.md` 内容已就绪但需渲染成公开页面。
2. **商店截图**：需 1280×800 或 640×400，3~5 张，仓库内没有。
3. **产品决策：是否收紧 `<all_urls>`**：`<all_urls>` + 后台取图 + WASM 是最高拒审风险组合。文案与备注已针对性说明理由，但是否收窄属于产品决策，未替用户决定。

### 后续动作

按用户指令执行 commit → push → 更新 tag（`v2.0.2`）。
