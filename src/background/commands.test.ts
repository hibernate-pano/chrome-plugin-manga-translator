/**
 * 快捷键选择的回归保护。
 *
 * 这里最要紧的不是"映射对不对"，而是"选的组合 Chrome 自己会不会占用"。
 * Chrome 占用某个组合时不会报错，而是默默拒绝绑定 —— 命令变成没有默认
 * 快捷键，用户按了没反应，扩展看起来就是坏的。这类问题只有从 Chromium
 * 源码的加速键表反推才能提前发现，所以本文件把那份占用清单固化下来。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  COMMAND_CLEAR_OVERLAYS,
  COMMAND_DESCRIPTIONS,
  COMMAND_FORCE_RETRANSLATE,
  COMMAND_IDS,
  COMMAND_SHORTCUTS,
  COMMAND_TOGGLE_READING_PANEL,
  COMMAND_TRANSLATE_PAGE,
  CONTEXT_MENU_TRANSLATE_IMAGE,
  CONTEXT_MENU_TRANSLATE_PAGE,
  createTranslateSingleImageMessage,
  resolveCommandAction,
} from './commands';

/**
 * Chrome 自己占用的 Ctrl/Command+Shift 字母。
 *
 * 来源（Chromium 源码）：
 * - `chrome/browser/ui/accelerator_table.cc`：Windows / Linux / ChromeOS
 *   的加速键表
 * - `chrome/browser/ui/cocoa/accelerators_cocoa.mm`：macOS 的 Cmd 绑定
 * - `chrome/browser/global_keyboard_shortcuts_mac.mm`：macOS 主菜单之外
 *   的 Cmd+Shift 绑定
 *
 * 三处取并集。U 也要算进去：Linux 上 Ctrl+Shift+U 是 IBus 的输入法切换，
 * 虽然不在这三份 Chromium 文件里，但在用户机器上同样会被系统抢走。
 */
const CHROME_RESERVED_SHIFT_CTRL_LETTERS = new Set([
  'A', // Tab 搜索
  'B', // 显示书签栏
  'C', // 开发者工具「检查元素」
  'D', // 收藏所有标签页
  'F', // 查找（macOS 主菜单）
  'G', // 查找上一个
  'H', // 多选
  'I', // 开发者工具
  'J', // 开发者工具控制台 / 下载
  'L', // 垂直标签栏折叠
  'M', // 头像菜单
  'N', // 无痕窗口
  'O', // 书签管理器
  'P', // 打印
  'R', // 强制刷新
  'T', // 恢复已关闭的标签页
  'V', // 粘贴并匹配样式（macOS）
  'W', // 关闭窗口
  'Z', // 重做（macOS）
  'U', // Linux IBus 输入法切换
]);

describe('命令解析', () => {
  it('把每个命令 id 映射到 content script 认识的消息', () => {
    expect(resolveCommandAction(COMMAND_TRANSLATE_PAGE)).toEqual({
      type: 'TRANSLATE_PAGE',
    });
    expect(resolveCommandAction(COMMAND_FORCE_RETRANSLATE)).toEqual({
      type: 'FORCE_RETRANSLATE_PAGE',
    });
    expect(resolveCommandAction(COMMAND_CLEAR_OVERLAYS)).toEqual({
      type: 'CLEAR_ALL',
    });
    expect(resolveCommandAction(COMMAND_TOGGLE_READING_PANEL)).toEqual({
      type: 'TOGGLE_READING_PANEL',
    });
  });

  it('未知命令返回 null，而不是抛异常', () => {
    // chrome.commands.onCommand 也会为用户自己在
    // chrome://extensions/shortcuts 里加的绑定触发，id 一定是我们声明过的，
    // 但未知 id 不该让 service worker 崩掉。
    expect(resolveCommandAction('does-not-exist')).toBeNull();
    expect(resolveCommandAction('')).toBeNull();
  });

  it('每个声明的命令都有描述和快捷键', () => {
    for (const id of COMMAND_IDS) {
      expect(COMMAND_DESCRIPTIONS[id]).toBeTruthy();
      expect(COMMAND_SHORTCUTS[id]).toBeDefined();
    }
  });

  it('命令 id 与快捷键表一一对应', () => {
    // 多一个命令少一个快捷键，都会让 Chrome 侧出现"声明了但没有绑定"
    // 或者"绑定了但 manifest 里没声明"的命令。
    expect(Object.keys(COMMAND_SHORTCUTS).sort()).toEqual(
      [...COMMAND_IDS].sort()
    );
    expect(Object.keys(COMMAND_DESCRIPTIONS).sort()).toEqual(
      [...COMMAND_IDS].sort()
    );
  });

  it('描述非空 —— manifest 里 description 缺失会让 Chrome 拒绝整个 manifest', () => {
    for (const id of COMMAND_IDS) {
      expect(COMMAND_DESCRIPTIONS[id]?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('快捷键选择', () => {
  it('避开了 Chrome 自己占用的 Ctrl/Command+Shift 组合', () => {
    for (const id of COMMAND_IDS) {
      const shortcut = COMMAND_SHORTCUTS[id];
      expect(shortcut).toBeDefined();
      for (const key of [shortcut.default, shortcut.mac]) {
        expect(key).toMatch(/^(Ctrl|Command)\+Shift\+[A-Z]$/);
        const letter = key.split('+')[2] as string;
        expect(CHROME_RESERVED_SHIFT_CTRL_LETTERS.has(letter)).toBe(false);
      }
    }
  });

  it('mac 平台用 Command，default 用 Ctrl', () => {
    // "Command" 出现在 "default" 里会让 Chromium 的 Command::Parse 直接
    // 报 "Command key is not supported"，整个 manifest 装不上。
    for (const id of COMMAND_IDS) {
      const shortcut = COMMAND_SHORTCUTS[id];
      expect(shortcut.default.startsWith('Ctrl+')).toBe(true);
      expect(shortcut.mac.startsWith('Command+')).toBe(true);
    }
  });

  it('四个命令用了四个不同的组合', () => {
    const defaults = COMMAND_IDS.map(id => COMMAND_SHORTCUTS[id]?.default);
    expect(new Set(defaults).size).toBe(COMMAND_IDS.length);
  });

  it('没有用 Chrome 保留的 Ctrl+Shift+T / Ctrl+Shift+R / Ctrl+Shift+N', () => {
    // 这三个是最容易被"顺手"写上去的：恢复标签页、强制刷新、无痕窗口。
    const used = COMMAND_IDS.map(id => COMMAND_SHORTCUTS[id]?.default);
    expect(used).not.toContain('Ctrl+Shift+T');
    expect(used).not.toContain('Ctrl+Shift+R');
    expect(used).not.toContain('Ctrl+Shift+N');
  });

  it('命令数量不超过 Chrome 允许的四个建议快捷键', () => {
    // Chrome 文档：扩展可以有很多命令，但最多只能指定四个建议快捷键。
    expect(COMMAND_IDS.length).toBeLessThanOrEqual(4);
  });
});

describe('右键菜单 id', () => {
  it('两个菜单项的 id 不同', () => {
    expect(CONTEXT_MENU_TRANSLATE_PAGE).not.toBe(CONTEXT_MENU_TRANSLATE_IMAGE);
  });

  it('图片菜单的消息带上被右键的图片地址', () => {
    expect(
      createTranslateSingleImageMessage('https://cdn.example/ch1/p01.jpg')
    ).toEqual({
      type: 'TRANSLATE_SINGLE_IMAGE',
      imageUrl: 'https://cdn.example/ch1/p01.jpg',
    });
  });
});

/**
 * The manifest and the code must say the same thing.
 *
 * `public/manifest.json` is a static file, so the descriptions it carries
 * are a second copy of `COMMAND_DESCRIPTIONS`. The popup shows the code's
 * copy in its shortcut list, and Chrome shows the manifest's copy in
 * `chrome://extensions/shortcuts` — when they drift, the product names the
 * same action two ways in two places the reader can see at once.
 */
describe('manifest 与代码里的命令说明', () => {
  it('每条命令的描述都一样', () => {
    const manifest = JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          '..',
          '..',
          'public',
          'manifest.json'
        ),
        'utf8'
      )
    ) as { commands?: Record<string, { description?: string }> };

    for (const id of COMMAND_IDS) {
      expect(manifest.commands?.[id]?.description).toBe(
        COMMAND_DESCRIPTIONS[id]
      );
    }
  });
});
