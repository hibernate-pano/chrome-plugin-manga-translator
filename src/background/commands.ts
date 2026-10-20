/**
 * 键盘快捷键与右键菜单的 id，以及它们各自产生的消息协议。
 *
 * 这里只放常量和纯函数：`public/manifest.json` 的 `commands` 段声明了每一个
 * 命令 id，service worker 收到 `chrome.commands.onCommand` 后用
 * `resolveCommandAction` 把它翻译成 content script 已经认识的消息。纯函数
 * 让这段映射可以直接被测试断言，不必启动浏览器。
 *
 * ============================ 快捷键怎么选的 ============================
 *
 * Chrome 自己占了一部分 Ctrl/Command+Shift 组合。冲突的绑定 Chrome 会
 * 直接拒绝，命令退化成"没有默认快捷键"（用户得自己去
 * chrome://extensions/shortcuts 手动分配）—— 表现和"快捷键坏了"一样。
 *
 * 冲突清单来自 Chromium 源码：
 *
 * - `chrome/browser/ui/accelerator_table.cc`：Windows / Linux / ChromeOS
 *   的加速键表（`EF_PLATFORM_ACCELERATOR` 在非 mac 上就是 Ctrl）
 * - `chrome/browser/ui/cocoa/accelerators_cocoa.mm`：macOS 的 Cmd 绑定
 * - `chrome/browser/global_keyboard_shortcuts_mac.mm`：macOS 主菜单之外
 *   的 Cmd+Shift 绑定
 *
 * 三处取并集，被 Chrome 占用的字母是 A B C D F G H I J L M N O P R T V W Z，
 * 剩下 E K Q S U X Y 可用（U 还要避开 Linux IBus 的 Ctrl+Shift+U 输入法
 * 切换）。本扩展取了其中四个。
 *
 * 另外两个 manifest 层面的硬约束（写错 Chrome 会拒绝整个 manifest）：
 *
 * 1. 每个命令必须有非空 `description`。
 * 2. `Command` 只能出现在 `"mac"` 键下，不能出现在 `"default"` 里 ——
 *    Chromium 的 `Command::Parse` 遇到 default 里的 `Command` 会报
 *    "Command key is not supported"。`"default"` 写 `Ctrl+Shift+X`，
 *    Chrome 在 macOS 上会自己转成 Command，所以这里两个平台各写一份。
 *
 * `commands.test.ts` 里留了同一份占用清单做回归保护 —— 哪天有人图省事
 * 写回 Ctrl+Shift+T，测试会立刻失败，而不是等到用户发现快捷键根本不触发。
 */

/** 翻译当前页面上的所有可翻译图片。 */
export const COMMAND_TRANSLATE_PAGE = 'translate-page';

/** 忽略缓存重新翻译当前页面。 */
export const COMMAND_FORCE_RETRANSLATE = 'force-retranslate';

/** 清除当前页面上本扩展画出的所有译文覆盖层。 */
export const COMMAND_CLEAR_OVERLAYS = 'clear-overlays';

/** 显示 / 隐藏译文阅读面板。 */
export const COMMAND_TOGGLE_READING_PANEL = 'toggle-reading-panel';

/** 右键菜单项：翻译当前页面。 */
export const CONTEXT_MENU_TRANSLATE_PAGE = 'translatePage';

/** 右键菜单项：只翻译右键点中的那一张图片。 */
export const CONTEXT_MENU_TRANSLATE_IMAGE = 'translate-image';

/** 扩展声明过的全部命令 id。 */
export type CommandId =
  | typeof COMMAND_TRANSLATE_PAGE
  | typeof COMMAND_FORCE_RETRANSLATE
  | typeof COMMAND_CLEAR_OVERLAYS
  | typeof COMMAND_TOGGLE_READING_PANEL;

/**
 * 每个命令的建议快捷键。
 *
 * `default` 覆盖 Windows / Linux / ChromeOS（Chrome 在 macOS 上也会把
 * default 里的 Ctrl 解释成 Command，但这里显式写一份 `mac`，避免依赖
 * 这层隐式转换）。
 */
export interface CommandShortcut {
  default: string;
  mac: string;
}

/**
 * 命令 id → 快捷键。
 *
 * 选字母的依据见文件头的说明：全部避开 Chrome 自己占用的组合。
 * - Y：Chrome 不占用，网页几乎不用，"Y" 取"开始/是的"之意
 * - X："re-Xecute"，重新执行一遍
 * - E："Erase"，清除覆盖层
 * - S："Side panel"，右侧阅读面板
 */
export const COMMAND_SHORTCUTS: Readonly<Record<CommandId, CommandShortcut>> = {
  [COMMAND_TRANSLATE_PAGE]: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
  [COMMAND_FORCE_RETRANSLATE]: {
    default: 'Ctrl+Shift+X',
    mac: 'Command+Shift+X',
  },
  [COMMAND_CLEAR_OVERLAYS]: { default: 'Ctrl+Shift+E', mac: 'Command+Shift+E' },
  [COMMAND_TOGGLE_READING_PANEL]: {
    default: 'Ctrl+Shift+S',
    mac: 'Command+Shift+S',
  },
};

/**
 * 命令 id → 描述。
 *
 * manifest 的 `description` 是必填项（Chromium 的 `Command::Parse` 会因为
 * 缺失或空串直接拒绝整个 manifest），这些文案会显示在
 * `chrome://extensions/shortcuts` 里。
 */
export const COMMAND_DESCRIPTIONS: Readonly<Record<CommandId, string>> = {
  [COMMAND_TRANSLATE_PAGE]: '翻译当前页面',
  [COMMAND_FORCE_RETRANSLATE]: '忽略缓存重新翻译当前页面',
  [COMMAND_CLEAR_OVERLAYS]: '清除当前页面的译文覆盖层',
  [COMMAND_TOGGLE_READING_PANEL]: '显示或隐藏译文阅读面板',
};

/**
 * 快捷键最终要送达 content script 的消息。
 *
 * 前三种 content script 已经实现（见 `src/content/content.ts` 的
 * `PopupToContentMsg`）；`TOGGLE_READING_PANEL` 是新协议，content script
 * 侧待接入。
 */
export type CommandAction =
  | { type: 'TRANSLATE_PAGE' }
  | { type: 'FORCE_RETRANSLATE_PAGE' }
  | { type: 'CLEAR_ALL' }
  | { type: 'TOGGLE_READING_PANEL' };

const COMMAND_ACTIONS: Readonly<Record<string, CommandAction>> = {
  [COMMAND_TRANSLATE_PAGE]: { type: 'TRANSLATE_PAGE' },
  [COMMAND_FORCE_RETRANSLATE]: { type: 'FORCE_RETRANSLATE_PAGE' },
  [COMMAND_CLEAR_OVERLAYS]: { type: 'CLEAR_ALL' },
  [COMMAND_TOGGLE_READING_PANEL]: { type: 'TOGGLE_READING_PANEL' },
};

/** manifest 里声明的每一个命令 id，顺序即 `commands` 段的顺序。 */
export const COMMAND_IDS = [
  COMMAND_TRANSLATE_PAGE,
  COMMAND_FORCE_RETRANSLATE,
  COMMAND_CLEAR_OVERLAYS,
  COMMAND_TOGGLE_READING_PANEL,
] as const;

/**
 * 命令 id → 消息。未知命令返回 `null`（调用方直接忽略）。
 */
export function resolveCommandAction(command: string): CommandAction | null {
  return COMMAND_ACTIONS[command] ?? null;
}

/**
 * 右键"翻译这张图片"使用的消息。
 *
 * `imageUrl` 是 Chrome 认定的被右键图片地址，它可能是缩略图，也可能是
 * CDN 的另一个尺寸变体，和页面里 `img.src` 不一定一致，所以 URL 原样
 * 传过去，由 content script 按最接近的 img 匹配。
 */
export type TranslateSingleImageMessage = {
  type: 'TRANSLATE_SINGLE_IMAGE';
  imageUrl: string;
};

export function createTranslateSingleImageMessage(
  imageUrl: string
): TranslateSingleImageMessage {
  return { type: 'TRANSLATE_SINGLE_IMAGE', imageUrl };
}

/**
 * content script 不会注入这些页面，命令发过去也只会得到
 * "Receiving end does not exist"，所以直接不执行。
 *
 * 与 `src/components/Popup/popup-state.ts` 的 `isSupportedPageUrl` 保持
 * 同一份协议清单；这里独立一份是因为 background 层不应该反向依赖
 * components 层（那会把 React 拖进 service worker 的依赖图）。
 */
const UNSUPPORTED_PROTOCOLS = [
  'chrome:',
  'chrome-extension:',
  'edge:',
  'about:',
  'moz-extension:',
  'file:',
];

export function isSupportedPageUrl(url?: string): boolean {
  if (!url) {
    return false;
  }
  return !UNSUPPORTED_PROTOCOLS.some(protocol => url.startsWith(protocol));
}

/**
 * 右键菜单的 `documentUrlPatterns`。
 *
 * 用了匹配模式之后，菜单项根本不会出现在非 http(s) 页面上（chrome://、
 * 扩展页、about:blank 都不匹配），这是第一道过滤；点击时的
 * `isSupportedPageUrl` 判断是第二道，两道都留着。
 */
export const SUPPORTED_PAGE_URL_PATTERNS = ['http://*/*', 'https://*/*'];
