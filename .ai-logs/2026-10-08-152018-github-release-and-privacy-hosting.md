# 补发 GitHub Release 与托管隐私政策

- 时间：2026-10-08 15:20:18 +0800
- 项目：chrome-plugin-manga-translator
- 触发者：Jasper（产品负责人）
- 前序日志：`.ai-logs/2026-10-08-150338-chrome-store-release-2.0.2.md`

## 一、对话出发点（用户原始需求与动机）

前一轮我完成 commit / push / `v2.0.2` tag 后，提出一个待决定项：`v2.0.1` 当时建了 GitHub Release 并附公开 zip，`v2.0.2` 尚未建。我给了两个选项（建 / 不建）。

用户回复：**"补上，把你能做的都做了，剩下的我来。"**

意图明确为两条：
1. 补建 GitHub Release，与 `v2.0.1` 保持一致；
2. 在"剩余待办"（隐私政策 URL、商店截图）中，凡是能由我完成的都推进到底，只把必须由用户本人完成的留下。

动机是解除 Chrome Web Store 提交前的全部可自动化阻塞项。

## 二、执行过程（做了什么、怎么做的）

### 1. 补建 GitHub Release

- 先读 `v2.0.1` Release 的结构以保持一致：两个附件（zip + sha256），正文分 Removed / Fixed / Added / Verification / Artifacts。
- 确认 `gh` 已认证为 `hibernate-pano`，scope 含 `repo`。
- 按相同结构创建 `v2.0.2` Release 并上传两个附件。
- **实测校验**：从 GitHub 下载远端 `zip.sha256`，与本地文件比对，两者均为
  `6c30765d985f2dd8d09626c855ae46c745ce73a19a3ab4949aacfb25b9e20336`，一致。

### 2. 隐私政策托管（先找最短路径，再新建）

按第一性原理"能复用就不新建"：

- 枚举用户的公开仓库与 Vercel 项目，发现已有 4 个 Vercel 站点在跑，`vercel` CLI 已认证为 `hibernate-pano`。
- 在其他插件仓库中搜索隐私政策文件，找到唯一先例：
  `chrome-plugin-one-tab` 的 `src/legal/privacy.html`。

**但该先例实测不可用**（详见问题 1），因此没有复制这个模式。

最终选择 **GitHub Pages 直接渲染 `docs/privacy-policy.md`**，理由：
- 单一事实源，改 Markdown 即改线上内容，不存在 HTML 副本漂移（这正是本次会话一路在修的"产物与源码不同步"问题）；
- 不引入新的账号或服务；
- 仓库本身已是公开，无新增信息暴露面；
- 免费、稳定、可撤销。

执行：
- `gh api -X POST .../pages` 启用 Pages，源 `main` / 目录 `/docs`。
- 轮询构建状态，35 秒后 `built`，对应 commit `7a4ae6e`。

### 3. 托管后的实测验证（不只看状态码）

因为我刚发现先例是"200 但正文为空"，所以对本项目做了内容级验证：

- HTTP 200
- title 正确：`Privacy Policy for Manga Translator (漫画翻译助手) | chrome-plugin-manga-translator`
- 命中正文关键句：`API Key`×1、`chrome.storage.local`×4、`jsdelivr`×2、`credentials: 'omit'`×1、`Key takeaway`×1（这是文档最后一节，证明未截断）、`Changes to This Policy`×1
- 非 GitHub Pages 的 404 兜底页

### 4. 顺带修复的三个问题

- `docs/store-listing-zh.md` 中隐私 URL 行原先写着"见 `docs/store-launch-tasks.md`「隐私政策托管」一节"——**该文件根本不存在**，是我此前写下的断链。已替换为真实 URL。
- 补 `docs/index.md`，否则站点根路径 `https://hibernate-pano.github.io/chrome-plugin-manga-translator/` 返回 404。
- 更新 `docs/chrome-web-store-release.md`：填入真实 URL，并从 "Assets Still Required" 中移除已完成项。
- 写了个链接检查脚本遍历 `docs/*.md`，确认相对链接全部有效。

## 三、遇到的问题（报错、阻塞、意外行为）

1. **你已有的隐私政策 URL 实际是坏的**（非本项目，但值得知道）：
   `https://tapstack-two.vercel.app/legal/privacy` 返回 HTTP 200，`<title>` 却是 `TapStack · 网页版`，正文关键词"隐私权政策"命中 **0**。
   根因：源文件放在 `chrome-plugin-one-tab` 的 `src/legal/privacy.html`，而 Vite 只会把 `public/` 下的文件原样复制到构建产物，`src/` 里的 HTML 是源码而非静态资源，所以它从未被部署，线上拿到的是 SPA 外壳。
   **影响**：该插件在 Chrome 商店填写的隐私政策 URL 打开后看不到隐私政策。属于待修问题，本轮未擅自改动该仓库。
2. **zsh 把 `source[branch]=main` 当通配符**，报 `no matches found`。给 `-f` 参数加单引号解决。
3. **断链**：见执行过程 4。
4. **"隐私"、"不收集" 关键词命中 0**一度像是渲染失败。排查后确认是这份政策**本身用英文写的**，且 `Children's Privacy` 中的撇号被 Jekyll 转义为 `&#39;` 导致字面匹配失败。改用文档英文原句（`Key takeaway` 等）复验，确认内容完整。
5. **站点根路径 404**：`docs/` 无 index。已补 `docs/index.md`。

## 四、最终结果（成功/失败与具体产出）

**状态：成功。**

### 已完成

| 项目 | 结果 |
| --- | --- |
| GitHub Release | https://github.com/hibernate-pano/chrome-plugin-manga-translator/releases/tag/v2.0.2 ，未草稿、非预发布，含 zip + sha256 两附件，远端摘要与本地一致 |
| 隐私政策 URL | https://hibernate-pano.github.io/chrome-plugin-manga-translator/privacy-policy.html （HTTP 200，正文已实测） |
| GitHub Pages | 已启用，源 `main` / `docs`，构建对应 commit `7a4ae6e` |
| 文档断链 | 已修复，全量相对链接校验通过 |
| 站点首页 | 已补 `docs/index.md` |

### 待提交

本轮改动（Release 说明不入库；文档与 Pages 配置相关改动需入库）：
`docs/store-listing-zh.md`、`docs/chrome-web-store-release.md`、`docs/index.md`、本日志。

### 仍需用户完成（无法由我替代）

1. **商店截图**：需 1280×800 或 640×400，建议 3~5 张。仓库内没有。生成真实翻译截图必须先有可用的模型 Key（当前 `.env` 中两个 key 均已失效，用户已说明届时自行配置）。
2. **产品决策：是否收紧 `<all_urls>`**：`<all_urls>` + 后台取图 + WASM 是最高拒审风险组合，文案与审核备注已针对性说明理由，但是否收窄属产品决策。
3. **隐私政策语言**：现为英文（准确、完整、已复核）。商店文案与产品界面是中文，若希望政策也中文化，属于需用户拍板的内容决策——自行翻译有引入隐私声明表述偏差的风险，未擅自改写。
