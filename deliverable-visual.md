# 视觉设计与交互细节分析

## 总评

UI 框架和组件库看着齐全（shadcn/ui + Tailwind + Radix + framer-motion），但**实际渲染层完全绕过了它们**。Popup/Options 全用 `bg-slate-950` + `border-white/10` 的内联 Tailwind 硬编码颜色，ThemeProvider/ThemeToggle 是**死代码**——切了主题啥都不会变。HUD 和 Reading Layer 是 Shadow DOM 原生 CSS，**主题切换不会同步到它们**。这导致整个产品"看起来是暗黑，但完全没实现主题"。

最大优点是组件库覆盖广、底层类型（`HudState` / `ContentState`）清晰，最大问题是**设计系统没有落地**——三套独立样式（shadcn token / 硬编码 slate / 原始 CSS）并存。

---

## 一、视觉一致性

### P0 改进

#### 1. **主题系统完全失效** — `PopupApp.tsx:233, 226`、`OptionsApp.tsx:506`、`floating-hud.ts:175-179`、`reading-layer.ts:118`

- **现状**：
  - `theme-provider.tsx` + `theme-toggle.tsx` + `use-theme.ts` 全部存在
  - 但 `grep ThemeToggle src/` 只匹配到定义文件，**零引用**
  - `PopupApp.tsx:233` 写死 `bg-slate-950 text-slate-100`（硬编码暗黑）
  - `OptionsApp.tsx:506` 同样硬编码 `bg-slate-950`
  - `floating-hud.ts:175` 在 Shadow DOM 内写死 `background: rgba(0,0,0,0.75)`
  - `reading-layer.ts:118` 写死 `background: rgba(15, 23, 42, 0.94)`
- **问题**：
  - 用户在设置里点"浅色"——没反应，UI 永远是黑的
  - 主题切换按钮在所有界面都不存在（既不显示也不生效）
  - 系统设置成浅色，扩展照样黑屏——违反 Chrome 扩展的"follow system"约定
- **方案**：
  1. `tailwind.config.js` 已经定义了 `darkMode: ["class"]`，但需要在 `<html>` 上加 `class="dark"`（theme-provider 已经在做）
  2. `index.css:18-70` 已经定义了完整的 `--background`/`--foreground` HSL tokens（亮色和暗色两套），Popup/Options 应该改用 `bg-background text-foreground` 等 token
  3. 把 `bg-slate-950` → `dark:bg-slate-950 bg-white` 之类的双模式类名
  4. HUD 的颜色改成从 `chrome.storage.sync` 读 `manga-translator-theme`，通过消息传到 content script
  5. Reading Layer 同上：监听主题消息，重建 Shadow DOM 内的 CSS
  6. 在 Options 头部加一个 `<ThemeToggle />` 入口（"ThemeToggle" 已写好但未挂载）

#### 2. **shadcn 设计 Token 是死代码** — `index.css:18-70` vs 实际页面

- **现状**：`index.css` 定义了 `--background`/`--primary`/`--ring`/`--destructive` 等十几组 HSL token，`tailwind.config.js` 也配好了 `bg-background`/`text-primary` 等映射。但 `PopupApp.tsx` 和 `OptionsApp.tsx` **零使用**，全部用 `slate-`/`white/[0.03]` 硬编码
- **问题**：
  - shadcn 组件库（`button.tsx`、`card.tsx`、`switch.tsx`、`select.tsx`）和实际页面**视觉脱节**
  - 改主题要改两套地方
  - 招新人会困惑：到底用 `bg-card` 还是 `bg-white/[0.03]`
- **方案**：
  1. 硬约束：**只允许** `bg-card`/`bg-popover`/`bg-background`/`bg-muted` 之一 + 半透明（`bg-card/80`）作为卡片/容器
  2. 把 `border-white/10` 替换为 `border-border` 或 `border-white/10 dark:border-white/10`
  3. 文字层一律 `text-foreground`/`text-muted-foreground`/`text-card-foreground`
  4. 危险色用 `text-destructive`/`bg-destructive/10`（已经定义好）
  5. 写一条 ESLint 规则禁止直接用 `slate-`/`white/[0.x]`（可选）

#### 3. **三套按钮样式并存** — Popup、Options、shadcn Button

- **现状**：
  - `PopupApp.tsx:373` 用 `<button className="... bg-cyan-600 hover:bg-cyan-500">`
  - `OptionsApp.tsx:491` 用 `<button className="... bg-white/[0.03] hover:bg-white/[0.07]">`
  - `theme-toggle.tsx:91` 用 `<Button variant='ghost'>`（shadcn）
  - 同一个 "次要按钮"，三个地方三种 padding (`py-2` / `py-3`)、三种圆角 (`rounded-md` / `rounded-lg`)、三种 hover
- **问题**：看上去像三个设计师做的
- **方案**：
  1. 把 `bg-cyan-600` 改用 `bg-primary` + 给 cyan 加 `data-[variant=accent]:bg-cyan-600` 之类的变体
  2. 次要按钮统一走 shadcn `Button variant="outline" size="sm"`
  3. 选定一套 8/12/16/20 圆角 token：sm=6px md=8px lg=12px

### P1 改进

#### 4. **HUD 文字与深色背景的对比度** — `floating-hud.ts:200-219`

- **现状**：
  - `.hud-sub { color: rgba(255,255,255,0.7) }` → 在 `rgba(0,0,0,0.75)` 上对比度约 8.5:1，OK
  - `.hud-suggestion { color: rgba(255,255,255,0.6) }` → 6.8:1，AAA 边缘
  - `.hud-cancel { color: rgba(255,255,255,0.6) }` → 同上
- **问题**：白底深色背景的页面，HUD 叠加上去是黑色半透明 + 白字，**白底页面会看不清**
- **方案**：
  1. 检测宿主页面背景色（用 `window.getComputedStyle(document.body).backgroundColor`）
  2. 自动切换 HUD 主题：浅色宿主用 `bg-white/90 text-slate-900`，深色宿主用现在的样式
  3. 或者直接用高对比度：深色背景 + `color: #fff`（100%），加 `text-shadow: 0 1px 2px rgba(0,0,0,0.5)`

#### 5. **Health Check 状态点无文字提示** — `OptionsApp.tsx:326-333`

- **现状**：
  ```jsx
  <span className={`h-2 w-2 rounded-full ${health === 'healthy' ? 'bg-emerald-400' : 'bg-amber-400'}`}
        title={health === 'healthy' ? '连接正常' : '连接异常'} />
  ```
- **问题**：8px 圆点 + 仅 hover title 提示。色盲用户分不清绿/橙；键盘焦点不到这
- **方案**：
  1. 加 `aria-label="OpenAI-compatible 连接正常"` / `role="status"`
  2. 或者把圆点+文字组合：`● 连接正常`（文字跟色同步）
  3. 错误状态换成 `bg-destructive`（已经在 token 里），不要单独用 `amber-400`

---

## 二、信息密度

### P0 改进

#### 1. **OptionsApp 759 行一刀切展开** — `OptionsApp.tsx:505-756`

- **现状**：整个 Options 页只有一个 320px 侧栏 + 右侧 3 张完整 Provider 卡片。所有字段（API Key、Base URL、Model、API 预设、本地模型列表、测试按钮、测试结果）**同时渲染**。窗口高度 800px 时至少要滚动 2 屏
- **问题**：
  - 第一次配置时扑面而来一堆 input，不知道先填哪个
  - 滚动找 API Key 输入框
  - LM Studio 卡片（用户根本没用）的 Ollama 模型列表也会渲染
- **方案**：
  1. Provider 卡片用 `<details>` / Radix Accordion，**默认只展开当前选中的那个**。LM Studio 用户日常只看 LM Studio
  2. 每个 Provider 卡片内再分"基础"和"高级"两段折叠
  3. 第一次访问时高亮当前 Provider 卡片（边框 + "← 从这里开始"），其他折叠
  4. 上方的"基础行为"侧栏（580-632 行）独立成 Tab 1，Provider 配置成 Tab 2，"覆盖层样式"成 Tab 3（用 shadcn `Tabs`，已写好但没用）

#### 2. **Provider 切换"两次点击确认"违反直觉** — `OptionsApp.tsx:195-212, 290-294`

- **现状**：
  ```jsx
  onClick={() => handleProviderSwitch(providerType)}  // 第一次：进入 pending
  // ring-2 ring-yellow-500/50 + 文字"确认切换？"
  // 3 秒不点就回退
  ```
- **问题**：
  - 用户从 OpenAI 切到 Ollama：第一次点击**没切换**，3 秒内再点才真的切
  - 3 秒的倒计时是隐式的——光标移开可能就错过
  - 如果用户在 3 秒内点击其他 Provider，旧 pending 不会取消（看代码 `setTimeout` 里只清自己那个）
- **方案**：
  1. 直接用 shadcn `<AlertDialog>` / `<ConfirmDialog>`（`feedback.tsx:232` 写好但没接入）
  2. 第一次点击：弹 dialog "切换到 Ollama？当前 API Key 不会保存"
  3. 或者：第一次点击**就切换**，undo 5 秒内可点 "撤销"（参考 Gmail 删邮件的 undo toast）

### P1 改进

#### 3. **Reading Layer 360px 宽，竖排中文两行就满了** — `reading-layer.ts:115`

- **现状**：`#panel { width: 360px }` 固定。中文翻译平均 12-20 字/气泡，360px 只能装 8-10 字/行
- **问题**：
  - 一段翻译可能 5-8 行，可视区要滚很多
  - 用户阅读原图时视线在左，眼睛在 Reading Layer 和原图间反复横跳
- **方案**：
  1. 改成可拖拽宽度（用 splitter），最小 320px，最大 560px
  2. 提供"折叠/展开"按钮，只显示气泡编号 + 翻译首行，hover 才展开
  3. 在原图旁边叠加紧凑译文 tooltip（参考沉浸式翻译的"双语对照"），让用户不用移眼

#### 4. **Popup 顶部 header 信息冗余** — `PopupApp.tsx:233-262`

- **现状**：
  ```
  Manga Translator            [Ollama]  [⚙]
  当前页翻译 / 自动续翻 / 强制重翻
  ```
  360px 宽下，标题 + 描述 + provider 徽章 + 设置按钮挤一行，provider 徽章里的图标 + 文字占 80px
- **问题**：副标题"当前页翻译 / 自动续翻 / 强制重翻"是产品简介，对老用户没价值；`Ollama` 徽章在 Popup 里和下面"当前后端"卡片里的 `Ollama` 重复
- **方案**：
  1. 副标题删除（或者改成 "上次更新：xx 分钟前" 这种动态信息）
  2. provider 徽章改成缩写 / 圆点+首字母：`O` / `OAI` / `LM`
  3. 设置按钮保持，但用 `aria-label="打开设置"` 替代图标

---

## 三、状态反馈

### P0 改进

#### 1. **"彻底重置 / 强制重翻" 无确认** — `PopupApp.tsx:380-410`

- **现状**：
  - "彻底重置"按钮：直接 `sendToContent({ type: 'CLEAR_ALL' })`，**会清掉所有缓存+所有覆盖层**
  - "强制重翻"按钮：直接 `FORCE_RETRANSLATE_PAGE`，**忽略缓存重发所有图片到 VLM**（可能烧掉几十块 API 钱）
- **问题**：误点一下，缓存清空，几十张图片重翻译，账单起飞
- **方案**：
  1. 用 `feedback.tsx` 里的 `ConfirmDialog`（已经写好）
  2. 危险按钮改用 `bg-destructive` 配色（已定义），hover 时 `bg-destructive/90`
  3. 强制重翻的 dialog 文案： "将忽略缓存重新翻译全部 X 张图片，预计消耗 ¥XX 元额度"
  4. Popup 太挤放不下 dialog 的话，弹一个 inline 二次确认：按钮变成 "确定要清除吗？[取消] [确认]"

#### 2. **Provider 切换的"3 秒确认"完全没动画/无障碍提示** — `OptionsApp.tsx:195-212`

- **现状**：
  - 第一次点击：border 变黄 + 文字变 "确认切换？"
  - 3 秒后无操作：回退
  - **没有 toast、没有 aria-live、没有声音**
- **问题**：
  - 屏幕阅读器用户：完全不知道发生了什么
  - 视觉用户：3 秒短到可能误判"刚点的没生效"
  - 第二次点击的判断完全在代码里（看 `if (pendingProvider)`），前端没显示倒计时
- **方案**：
  1. 加倒计时：把 "确认切换？" 替换为 "再次点击确认 (3)"，每秒 -1
  2. 包一个 `aria-live="polite"` 区域："请点击再次确认切换到 Ollama"
  3. 或者用 `ConfirmDialog`（见 P0-2.2）

#### 3. **HUD 完成后 2 秒自动消失，但失败时不消失也没关闭按钮** — `floating-hud.ts:86-95`

- **现状**：
  ```js
  if (state.failedCount > 0) {
    // 注释说"等待用户操作"，但代码里没渲染关闭按钮
  } else {
    setTimeout(() => update({ status: 'hidden' }), 2000);
  }
  ```
- **问题**：
  - 全部成功：2 秒就消失——长页面（100+ 张图）用户没看到就消失
  - 有失败：HUD 卡在右下角，**用户必须点"重新翻译失败项"**，但失败已经定位的话只能点 X 关闭——X 不存在
- **方案**：
  1. 全部成功时：2 秒 → 5 秒，并把数字（成功 X / 失败 Y / 缓存 Z）保留显示
  2. 有失败时：HUD 显示 5 秒后自动折叠成一个角标（比如失败数 `!2`），用户主动点开看详情
  3. 加关闭按钮 X，hover 时显示，点击就 hidden

#### 4. **Options 健康检查 loading 没有任何指示** — `OptionsApp.tsx:161-178`

- **现状**：
  ```js
  useEffect(() => {
    void performHealthCheck();
    healthCheckTimerRef.current = setInterval(() => void performHealthCheck(), 30000);
  }, [performHealthCheck]);
  ```
- **问题**：
  - 30 秒轮询，无 UI 提示
  - 第一次进 Options，圆点是 `unknown`（不显示），实际请求在飞
  - 用户根本不知道"我在等你检查连接"
- **方案**：
  1. `providerHealth` 加一个 `'checking'` 状态，圆点转圈（`animate-pulse` 或小 spinner）
  2. 在 Provider 卡片右侧"测试配置"按钮位置加一行 "上次检查：30 秒前"
  3. 用户编辑完 Base URL/Model 立即触发检查（不只靠轮询）

### P1 改进

#### 5. **Popup 状态文本切换过快** — `PopupApp.tsx:163-189`

- **现状**：HUD 报 `STATE_UPDATE`，Popup 2 秒后回 idle（177-181）
- **问题**：用户刚点完"翻译当前页面"，Popup 立刻变 "准备就绪"——他们要等 HUD 才看得到
- **方案**：
  1. complete 状态保留 5-8 秒再回 idle
  2. 或者直接 "准备就绪" 改为 "翻译完成 X 张"，跟 HUD 同步

#### 6. **进度条是数字+百分比，没有"已完成/总共"细节** — `floating-hud.ts:124-132`

- **现状**：
  ```
  翻译中...
  ████████░░░░░░  (60%)
  第 12 张 / 18
  [取消]
  ```
- **问题**：
  - 用户不知道"第 12 张"是当前正在翻译还是已经完成
  - 失败数 0 时 HUD 不显示
  - 长任务（20+ 张）没有 ETA
- **方案**：
  1. 加"已用 45 秒" 标签
  2. 进度条加渐变，已完成部分用 emerald-400，正在处理用 cyan-500（双段视觉）
  3. 失败数 > 0 时进度条尾部加红色小条

---

## 四、可访问性 (a11y)

### P0 改进

#### 1. **所有 input/button 没有 focus ring** — `PopupApp.tsx:270-275, 316-326, 369-377`、`OptionsApp.tsx:585-590, 598-603, 611-616, 686-689`

- **现状**：
  - Popup/Options 里的 checkbox 用 `<input type="checkbox" className="h-4 w-4 rounded border-white/20 bg-slate-900">`，**没有 focus-visible 样式**
  - `<select>` 用 `outline-none`，无焦点提示
  - `<button>` 大部分用 `transition` 但没 `focus-visible:ring-1 focus-visible:ring-ring`
- **问题**：键盘用户完全看不到焦点在哪
- **方案**：
  1. 全部用 shadcn 的 `Input`/`Switch`/`Button` 组件——它们已经定义了 `focus-visible:ring-1 focus-visible:ring-ring`
  2. 实在要保留原生 input，加 `focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950`

#### 2. **HUD 错误状态没有关闭按钮 + 无 aria-live** — `floating-hud.ts:152-163`

- **现状**：
  - 错误信息：红色卡片 + 标题 + 消息 + 建议
  - **没有关闭按钮**、没有 `role="alert"`、没有 `aria-live="assertive"`
- **问题**：
  - 用户看到错误就不知道怎么关
  - 屏幕阅读器不会主动播报错误
- **方案**：
  1. 加 `role="alert" aria-live="assertive"`
  2. 加关闭按钮 X（参见 P0-3.3）
  3. 用 `tabindex="0"` 让键盘能聚焦到 HUD 整体

#### 3. **Reading Layer 入口按钮无 aria-label** — `reading-layer.ts:366-385`

- **现状**：
  ```html
  <div class="entry" data-entry-id="...">
    <span class="entry-index">3</span>
    <span>区域翻译</span>
    <div class="entry-text">...翻译内容...</div>
  </div>
  ```
- **问题**：
  - 屏幕阅读器只读"3 区域翻译 翻译内容..."，用户不知道点这个会跳到原图
  - 没用 `<button>` 用 `<div>`，键盘 Tab 不到
- **方案**：
  1. 改成 `<button>` 而不是 `<div>`，原生键盘可访问
  2. 加 `aria-label="跳转到第 3 段翻译：{entry.translatedText.slice(0,30)}..."`
  3. `details > summary` 加 `aria-expanded`（浏览器默认有，确认一下）

#### 4. **Provider 卡片用 div + role="button" 模拟按钮** — `OptionsApp.tsx:281-289`

- **现状**：
  ```jsx
  <div role='button' tabIndex={0}
       onClick={() => handleProviderSwitch(providerType)}
       onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') ... }}>
  ```
- **问题**：
  - role="button" 加在 div 上比 `<button>` 弱很多
  - 卡片里还有链接（`文档` `<a>`）和 input，键盘 Tab 顺序混乱
  - 没有 aria-pressed 表明"当前选中"
- **方案**：
  1. 卡片外壳改用 `<button type="button">`，内部 input/link 用 `event.stopPropagation()` 阻止冒泡
  2. 加 `aria-pressed={provider === providerType}`
  3. 或者：卡片外壳 `<div>`，内部右上角放一个明确的"切换"按钮

### P1 改进

#### 5. **HUD/Slider 没有键盘可访问的 focus 环** — `floating-hud.ts` 全文

- **现状**：Shadow DOM 内的 `<button id="cancel-btn">` 只有 hover 颜色变化
- **问题**：键盘 Tab 过去看不到焦点
- **方案**：
  1. `.hud-cancel:focus-visible, .hud-retry:focus-visible { outline: 2px solid #67e8f9; outline-offset: 2px; }`
  2. 加 `aria-label="取消翻译"`（虽然文案是"取消"）

#### 6. **Overlay style 颜色选择器不显示对比度提示** — `OptionsApp.tsx:692-727`

- **现状**：用户可以随便改 overlay 背景色和文字色，**没有任何对比度警告**
- **问题**：用户把背景改成 #000、文字改成 #111，渲染出来啥都看不见，但 chrome 扩展照常工作
- **方案**：
  1. 实时算 WCAG 对比度，显示在颜色选择器旁边
  2. 对比度 < 4.5 时显示 ⚠ 提示，建议改色
  3. 给一个"恢复默认"快捷按钮

---

## 五、交互模式

### P0 改进

#### 1. **Switch 和 checkbox 混用** — `PopupApp.tsx:270-275` vs `OptionsApp.tsx:585-590`

- **现状**：
  - "启用扩展"在 Popup 和 Options 都是 `<input type="checkbox" className="h-4 w-4">` 原生 checkbox
  - 同一份代码，两边样式略不同（Popup 有 `rounded border-white/20 bg-slate-900`，Options 没）
  - shadcn 写好了 `Switch` 组件（`switch.tsx`），**从未被引用**
- **问题**：用户以为两个地方是同一个开关，但视觉/手感不同
- **方案**：
  1. Popup/Options 的"启用扩展""自动续翻""缓存结果""竖排文字" 全部改用 shadcn `<Switch>`
  2. 配色用 token：`data-[state=checked]:bg-cyan-500` 之类保持品牌色
  3. 删掉原生 input checkbox 写法

#### 2. **Popup tooltip 用 group-hover 模拟** — `PopupApp.tsx:381-393, 395-409`

- **现状**：
  ```jsx
  <div className='group relative'>
    <button>...彻底重置</button>
    <div className='absolute ... opacity-0 group-hover:opacity-100 ...'>
      清除所有覆盖层+缓存+状态
    </div>
  </div>
  ```
- **问题**：
  - 触屏设备没 hover，提示永远不显示
  - 键盘 focus 不触发（`:focus-within` 才能）
  - Popup 360px 宽，tooltip `whitespace-nowrap` 容易撑出去边界
- **方案**：
  1. 用 Radix `Tooltip` 组件（已经有 `@radix-ui/react-tooltip` 依赖，需要装）
  2. 或者：直接在按钮里加描述文字（Popup 空间够的话），不用 tooltip
  3. 删除这些 tooltip 改成"?" 图标 + popover

#### 3. **HUD 进度条没法主动取消到桌面** — `floating-hud.ts:130, 152-163`

- **现状**：
  - translating 状态有"取消"按钮
  - error 状态**无任何按钮**
  - complete（无失败）2 秒后自动消失
- **问题**：用户如果想"先停一下别动"，唯一办法是刷页面
- **方案**：
  1. error 加"重试"按钮（如果有重试逻辑）
  2. 所有状态加 X 关闭按钮
  3. 翻译中状态：除了"取消"按钮，再加"最小化到角标"按钮（小图标）

### P1 改进

#### 4. **Slider 无实时预览** — `OptionsApp.tsx:730-744`

- **现状**：调整 min/max 字号，只看到数字变化，**没看到真实 overlay 的样子**
- **问题**：用户不知道 12-32px 在漫画上是啥效果
- **方案**：
  1. Slider 旁边加一个 mini preview：拿当前 backgroundColor/textColor/minFontSize 渲染一行 "预览文字"
  2. 拖动时实时更新

#### 5. **Options 上"测试配置"按钮 disabled 时无解释** — `OptionsApp.tsx:484-499`

- **现状**：
  ```jsx
  <button onClick={...testProvider(providerType)} disabled={testingProvider === providerType}>
  ```
- **问题**：
  - 当 testing 别的 Provider 时，当前按钮没 disabled 但也没 spinner
  - 用户以为没反应
- **方案**：
  1. 把"测试配置"按钮改成全卡片显示测试中状态：加一行"测试中..."在卡片顶部
  2. 或者：所有 Provider 卡片同时显示"测试中..."，结束后统一刷新

#### 6. **Provider 帮助链接用 `<a target="_blank">`** — `OptionsApp.tsx:335-344`

- **现状**：
  ```jsx
  <a href={meta.helpUrl} target='_blank' rel='noreferrer' ...>文档 <ExternalLink /></a>
  ```
- **问题**：
  - Options 是 options 页，**点 `_blank` 打开新标签**——在扩展里"打开新标签"会被 Chrome 拦截提示
  - 弹窗里跳转更卡
- **方案**：
  1. 改成 `<button onClick={() => chrome.tabs.create({ url: meta.helpUrl })}>`
  2. 或者用 `chrome.runtime.openOptionsPage` 风格引导用户去 settings

#### 7. **首次进入 Options 没有任何 onboarding** — `OptionsApp.tsx:527-574`

- **现状**：
  - 写了一个"开始使用"卡片（528-574），**只在所有 provider 都没配置时显示**
  - 给两个快捷按钮"使用 OpenAI-compatible" / "使用 Ollama"
  - 但卡片**有动画**吗？没有，**它会在用户填了一个字段后立刻消失**——用户可能没看清
- **问题**：onboarding 一闪而过，新用户抓不到
- **方案**：
  1. 改成 step-by-step：第一次进只显示 Step 1 "选 Provider"；选完才显示 Step 2 "填配置"；填完才显示 Step 3 "测试"
  2. 用 shadcn `<Stepper>` 或者自定义 progress dots
  3. 或者：第一次配置后保留一个 5 秒的"完成！"toast

---

## 6 个最值得做的优化（按性价比排序）

按 **用户感知 × 实施成本** 排序：

### 1. **危险操作加二次确认**（30 分钟，巨幅体验提升）
- **位置**：`PopupApp.tsx:380-410`
- **动作**：把"彻底重翻"和"彻底重置"用 `ConfirmDialog` 包裹，参考 `feedback.tsx:232`
- **原因**：误点烧钱 + 误操作无法回退，是当前最大的"信任危机"风险点
- **具体**：
  ```jsx
  <button onClick={() => setShowConfirm('force')}>强制重翻</button>
  {showConfirm === 'force' && (
    <ConfirmDialog type="danger" title="强制重翻" 
      message={`将忽略缓存重新翻译 ${total} 张图片。`}
      onConfirm={handleResetAndRerun} onCancel={() => setShowConfirm(null)} />
  )}
  ```

### 2. **三处 Checkbox 统一成 Switch**（1 小时，视觉一致性大幅提升）
- **位置**：`PopupApp.tsx:265-275`、`OptionsApp.tsx:580-617, 679-690`
- **动作**：所有 "启用扩展 / 自动续翻 / 缓存结果 / 竖排文字" 改用 shadcn `<Switch>`
- **原因**：shadcn Switch 写了没人用，相同概念 4 个地方 4 种样式
- **具体**：
  ```jsx
  <Switch checked={enabled} onCheckedChange={setEnabled} 
    className="data-[state=checked]:bg-cyan-500" />
  ```

### 3. **删除 Popup 副标题 + 简化徽章**（15 分钟，立刻清爽）
- **位置**：`PopupApp.tsx:233-262`
- **动作**：删掉"当前页翻译 / 自动续翻 / 强制重翻" 副标题；徽章改成缩写 `O`/`OAI`/`LM`
- **原因**：副标题对老用户零价值；徽章+卡片双重显示 provider
- **具体**：
  ```jsx
  <div className="text-sm font-semibold">Manga Translator</div>
  {/* 删除下面那行 mt-1 text-xs text-slate-400 */}
  ```

### 4. **HUD 失败状态加关闭按钮 + 延长成功展示**（30 分钟，反馈更友好）
- **位置**：`floating-hud.ts:86-95, 130, 152-163`
- **动作**：
  - 自动消失时间 2s → 5s
  - error 卡片加 X 按钮
  - complete 卡片加 "查看" 链接（点击展开）
- **原因**：失败后 HUD 卡死，成功后 2s 抓不住

### 5. **Provider 切换改成显式 confirm dialog**（1 小时，操作符合预期）
- **位置**：`OptionsApp.tsx:195-212, 290-294`
- **动作**：删除 `handleProviderSwitch` 的"两次点击"逻辑，改用 ConfirmDialog
- **原因**：3 秒隐式倒计时是反人类设计
- **具体**：第一次点击直接 `setProvider(providerType)` + 弹 toast "已切换到 Ollama (5s 内可撤销)"

### 6. **所有 input/button 加焦点环**（30 分钟，a11y 大幅改善）
- **位置**：`PopupApp.tsx` + `OptionsApp.tsx` + `floating-hud.ts` 全文
- **动作**：加 `focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950`
- **原因**：键盘用户完全无法操作当前 UI
- **具体**：写一个公共的 `.focus-ring` utility class，统一引用

---

## 附：参考思路（不照搬）

- **沉浸式翻译**：右下角浮动 icon 栏的"显隐 / 重译 / 复制"三按钮紧凑布局，可以借鉴给 HUD。但他们的"双语对照"在漫画上会让画面更挤，本项目不适合。
- **彩云小译**：视频悬浮字幕的进度条样式（已用/正在/未完成三段）很清晰，可以借鉴给 HUD 进度条。
- **YouTube 双字幕**：原文字幕 vs 译文字幕在视频下方分行，本项目的"图上编号 + 右侧阅读层"已经是这思路的本地化，但 **360px 偏窄** 是问题（见 P1-3）。

## 设计原则（项目级）

1. **shadcn 组件优先**：能用 `<Button>` `<Switch>` `<Tabs>` `<Alert>` `<Tooltip>` 就用，不要 `<button className="...">` 自己拼
2. **颜色走 token**：不用 `slate-950` / `white/[0.03]`，用 `bg-background` / `bg-card` / `border-border` + 半透明 `bg-card/80`
3. **状态先想到四态**：loading / success / error / empty，每次新增 UI 问自己——空状态是什么样？
4. **危险操作先 dialog**：清缓存、删配置、强翻，先想"怎么让用户撤销"
5. **键盘第一公民**：每个交互都要 Tab 一下，焦点环不能省
