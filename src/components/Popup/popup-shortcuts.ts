/**
 * 快捷键的显示方式。
 *
 * 四个命令在 `public/manifest.json` 里注册了，界面上却没有一个字——用户
 * 装了扩展以后只能自己去 `chrome://extensions/shortcuts` 里碰运气。弹窗
 * 现在把四个快捷键常驻列出来，键位用 `<kbd>` 排版。
 *
 * 这里只放纯函数：manifest 里的写法（`Ctrl+Shift+Y`）和用户看到的写法
 * （`⌘ + Shift + Y`）之间差一个平台判断，做成纯函数才能被测试直接断言。
 */

/** 是不是 macOS。Command 键在 mac 上是 ⌘，在别处是 Ctrl。 */
export function isMacPlatform(userAgent: string): boolean {
  return /mac/i.test(userAgent);
}

/**
 * 把 manifest 里的快捷键写法拆成一段一段的按键。
 *
 * `Ctrl+Shift+Y` → `['Ctrl', 'Shift', 'Y']`，
 * mac 上的 `Command+Shift+Y` → `['⌘', 'Shift', 'Y']`。
 */
export function formatShortcutKeys(
  shortcut: string,
  isMac: boolean = false
): string[] {
  return shortcut.split('+').map(part => {
    if (part === 'Command' || part === 'Ctrl') {
      return isMac ? '⌘' : 'Ctrl';
    }
    return part;
  });
}
