import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OnboardingApp } from './OnboardingApp';
import { useAppConfigStore } from '@/stores/config-v2';

/**
 * The store keeps a single shared instance across the test runner, so each
 * test must reset the persisted slice to a known initial state. The Zustand
 * `persist` middleware reads chrome.storage.local which is also shared —
 * the global `beforeEach` in src/test/setup.ts wipes that for us.
 */
function resetStore() {
  useAppConfigStore.setState({
    enabled: false,
    provider: 'openai-compatible',
    onboardingCompleted: false,
    openaiCompatible: {
      apiKey: '',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    },
    ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llava' },
    lmStudio: { apiKey: '', baseUrl: 'http://localhost:1234/v1', model: '' },
    // The `providers` map is a separate field from the three top-level
    // ones, and it is the one the wizard asks about. Leaving it alone would
    // make the test depend on whatever the build's .env happened to
    // preload.
    providers: {
      'openai-compatible': {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      },
      ollama: { apiKey: '', baseUrl: 'http://localhost:11434', model: 'llava' },
      'lm-studio': {
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        model: '',
      },
    },
  } as never);
}

describe('OnboardingApp', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders when onboardingCompleted is false', () => {
    render(<OnboardingApp />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/欢迎使用漫画翻译助手/)).toBeInTheDocument();
  });

  it('does not render when onboardingCompleted is true', () => {
    useAppConfigStore.setState({ onboardingCompleted: true } as never);
    const { container } = render(<OnboardingApp />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders even when onboardingCompleted is true if forceOpen', () => {
    useAppConfigStore.setState({ onboardingCompleted: true } as never);
    render(<OnboardingApp forceOpen />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('advances through welcome and ready steps', async () => {
    const user = userEvent.setup();
    // A user who already has a key: the wizard's last step is then just
    // "enable it".
    useAppConfigStore.setState({
      providers: {
        ...useAppConfigStore.getState().providers,
        'openai-compatible': {
          ...useAppConfigStore.getState().providers['openai-compatible'],
          apiKey: 'sk-test-key',
        },
      },
    } as never);
    render(<OnboardingApp />);

    // Step 1: welcome → next
    expect(screen.getByText(/欢迎使用漫画翻译助手/)).toBeInTheDocument();
    expect(screen.getByText(/已预置的后端/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /下一步/ }));

    // Step 2: ready → finish
    expect(
      screen.getByRole('heading', { name: '准备就绪' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /完成并启用翻译/ }));

    const state = useAppConfigStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.enabled).toBe(true);
  });

  /**
   * The wizard used to end with 「完成并启用翻译」 whether or not there was
   * anything to translate with. That left an enabled extension with no
   * provider behind it, and the popup's primary button dead.
   */
  it('sends the user to the API key form when there is no provider', async () => {
    const user = userEvent.setup();
    render(<OnboardingApp />);

    await user.click(screen.getByRole('button', { name: /下一步/ }));

    const button = screen.getByRole('button', { name: /去填写 API Key/ });
    expect(button).toBeInTheDocument();

    await user.click(button);

    // The wizard gets out of the way, and the extension is NOT turned on.
    expect(screen.queryByRole('dialog')).toBeNull();
    const state = useAppConfigStore.getState();
    expect(state.enabled).toBe(false);
  });

  it('skip dismisses the modal without enabling translation', async () => {
    const user = userEvent.setup();
    render(<OnboardingApp />);

    await user.click(screen.getByRole('button', { name: /稍后再设置/ }));

    const state = useAppConfigStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.enabled).toBe(false);
  });

  it('Escape key dismisses the modal (acts like skip)', async () => {
    const user = userEvent.setup();
    render(<OnboardingApp />);

    await user.keyboard('{Escape}');

    const state = useAppConfigStore.getState();
    expect(state.onboardingCompleted).toBe(true);
    expect(state.enabled).toBe(false);
  });

  /**
   * The wizard used to listen for Enter on `window`, so a stray Enter in a
   * field on the settings page *behind* the modal advanced it — and on the
   * last step that finished it, which enables the extension and starts
   * billing. The user's focus was simply somewhere else.
   */
  it('ignores Enter typed into a field behind the modal', async () => {
    const user = userEvent.setup();
    render(
      <>
        <input aria-label='背景输入框' />
        <OnboardingApp />
      </>
    );

    const background = screen.getByLabelText('背景输入框');
    background.focus();
    await user.keyboard('{Enter}');

    // The wizard is still on step one and the extension is still off.
    expect(screen.getByText(/欢迎使用漫画翻译助手/)).toBeInTheDocument();
    const state = useAppConfigStore.getState();
    expect(state.onboardingCompleted).toBe(false);
    expect(state.enabled).toBe(false);
  });

  it('puts the keyboard on the primary action', async () => {
    render(<OnboardingApp />);

    // The primary button is focused, so Enter activates *that* and not
    // something on the page behind the modal.
    const primary = screen.getByRole('button', { name: /下一步/ });
    expect(primary).toHaveFocus();
  });

  it('gives the focus back when it closes', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    render(<OnboardingApp />);
    expect(screen.getByRole('button', { name: /下一步/ })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: /稍后再设置/ }));

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('gives the focus back after it has walked through a step', async () => {
    // 「记住焦点」和「把焦点放到主按钮上」以前是同一个 effect，于是每换
    // 一步就把记住的那个元素覆盖成弹窗里那颗按钮。等向导关掉，记住的
    // 是一个已经不存在的按钮 —— 键盘被丢在页面上，而不是还给打开它的那
    // 一颗。
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    render(<OnboardingApp />);
    await user.click(screen.getByRole('button', { name: /下一步/ }));
    await user.click(screen.getByRole('button', { name: /稍后再设置/ }));

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  /**
   * The one screen the user reads at the moment they turn the extension on
   * has to say where the images go and that it costs money. A dismissible
   * banner on the settings page is not enough.
   */
  it('says where the images go and what it costs — for both kinds of backend', () => {
    // This screen appears before the user has picked a provider, so it
    // cannot branch on "the current backend". The statements are written as
    // conditions instead: the cloud clause and the local clause are side by
    // side, and both are true whichever one the reader ends up choosing.
    render(<OnboardingApp />);

    expect(screen.getByText(/数据流向与费用/)).toBeInTheDocument();
    expect(screen.getByText(/用云端服务时/)).toBeInTheDocument();
    expect(screen.getByText(/图片会离开这台机器/)).toBeInTheDocument();
    expect(screen.getByText(/产生费用/)).toBeInTheDocument();
    expect(screen.getByText(/用本地服务（Ollama/)).toBeInTheDocument();
    expect(screen.getByText(/图片不离开这台机器/)).toBeInTheDocument();
    expect(screen.getByText(/扩展开发者不收集/)).toBeInTheDocument();
  });

  /**
   * "翻译会调用你配置的服务商并产生费用" 对一个在本地跑 Ollama 的人是
   * 两句都错的假话：图片根本不出这台机器，也没有服务商来计费。
   */
  it('tells a local-backend user that the images stay on the machine', async () => {
    useAppConfigStore.setState({ provider: 'ollama' } as never);
    render(<OnboardingApp />);

    await userEvent.click(screen.getByRole('button', { name: /下一步/ }));

    expect(screen.getByText(/图片不会离开本机/)).toBeInTheDocument();
    expect(screen.getByText(/不产生服务商费用/)).toBeInTheDocument();
    expect(screen.queryByText(/图片内容会离开你的浏览器/)).toBeNull();
  });

  /**
   * 云端后端必须把「图片原样上传」和「按它的规则计费」说在按下按钮
   * 之前 —— 而不是只留在一块可以关掉的横幅里。
   */
  it('tells a cloud-backend user that the images are uploaded and billed', async () => {
    useAppConfigStore.setState({
      provider: 'openai-compatible',
      providers: {
        ...useAppConfigStore.getState().providers,
        'openai-compatible': {
          ...useAppConfigStore.getState().providers['openai-compatible'],
          apiKey: 'sk-test-key',
        },
      },
    } as never);
    render(<OnboardingApp />);

    await userEvent.click(screen.getByRole('button', { name: /下一步/ }));

    expect(screen.getByText(/图片内容会离开你的浏览器/)).toBeInTheDocument();
    expect(screen.getByText(/按该服务的计费规则产生费用/)).toBeInTheDocument();
    expect(screen.getByText(/如果页面内容敏感/)).toBeInTheDocument();
  });

  /**
   * `aria-modal` 说背景是惰性的，但没说这个对话框是关于什么的。读屏
   * 落在对话框上时，它应该被描述成"这一步在讲什么"。
   */
  it('describes the dialog with the step it is on', async () => {
    useAppConfigStore.setState({
      providers: {
        ...useAppConfigStore.getState().providers,
        'openai-compatible': {
          ...useAppConfigStore.getState().providers['openai-compatible'],
          apiKey: 'sk-test-key',
        },
      },
    } as never);
    render(<OnboardingApp />);

    const dialog = screen.getByRole('dialog');
    const describedBy = dialog.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const description = document.getElementById(describedBy as string);
    expect(description).not.toBeNull();
    expect(description?.textContent).toContain('数据流向与费用');

    // 换一步，描述也跟着换。
    await userEvent.click(screen.getByRole('button', { name: /下一步/ }));

    const next = screen.getByRole('dialog');
    const nextId = next.getAttribute('aria-describedby');
    expect(nextId).not.toBe(describedBy);
    const nextDescription = document.getElementById(nextId as string);
    expect(nextDescription?.textContent).toMatch(/图片内容会离开你的浏览器/);
  });
});

/**
 * The shortcuts and the right-click menu are two entrances to the extension
 * that the UI used to never mention. The onboarding is where the user learns
 * what the extension can do, so it belongs here too.
 */
describe('OnboardingApp 快捷键与右键菜单', () => {
  it('names the shortcuts and the right-click menu on the ready step', async () => {
    render(<OnboardingApp />);

    await userEvent.click(screen.getByRole('button', { name: /下一步/ }));

    expect(screen.getByText(/翻译这张图片/)).toBeInTheDocument();
    expect(screen.getByText(/Shift\+Y/)).toBeInTheDocument();
  });
});

/**
 * WCAG 1.4.3 的对比度，测试自己算。
 *
 * 引导弹窗是深色的（slate-900）。辅助文字如果用 slate-500/600，
 * 读屏之外的人基本看不清 —— 而「按 Esc 可跳过」是整个弹窗里唯一
 * 的一句提示。tailwind 的调色板值写在这里：数字比"看着还行"可靠。
 */
const SLATE: Record<string, string> = {
  'slate-400': '#94a3b8',
  'slate-500': '#64748b',
  'slate-600': '#475569',
  'slate-900': '#0f172a',
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  const [r = 0, g = 0, b = 0] = linear;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

/**
 * 调色板里没有的颜色就是测试没算过 —— 宁可报错，也不要用一个默认值
 * 把一个真实的对比度问题放过去。
 */
function slateColor(name: string): string {
  const value = SLATE[name];
  if (!value) {
    throw new Error(`对比度表里没有 ${name}`);
  }
  return value;
}

/** bg-white/5 铺在 slate-900 上之后的实际底色。 */
function overWhite5(base: string): string {
  const channels = [1, 3, 5].map(i => parseInt(base.slice(i, i + 2), 16));
  return `#${channels
    .map(c =>
      Math.round(0.05 * 255 + 0.95 * c)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/**
 * 深色弹窗上的文字必须读得清。
 *
 * slate-600 在 slate-900 上是 2.36:1，slate-500 是 3.07:1 ——
 * 两条都低于 4.5:1 的正文门槛。slate-400 是 6.97:1。
 */
describe('OnboardingApp 文字对比度', () => {
  it('「按 Esc 可跳过」在弹窗底色上读得清', () => {
    render(<OnboardingApp />);

    const hint = screen.getByText('按 Esc 可跳过');
    const textClass = hint.className
      .split(/\s+/)
      .find(name => name.startsWith('text-slate-'))
      ?.replace('text-', '');
    expect(textClass).toBeDefined();
    const ratio = contrast(
      slateColor(textClass as string),
      slateColor('slate-900')
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('步骤条上没走到的那一步读得清', () => {
    render(<OnboardingApp />);

    // 第二步还没走到，它的序号画在一个半透明的浅色底上。
    const pending = screen.getByText('2');
    const textClass = pending.className
      .split(/\s+/)
      .find(name => name.startsWith('text-slate-'))
      ?.replace('text-', '');
    expect(textClass).toBeDefined();
    const ratio = contrast(
      slateColor(textClass as string),
      overWhite5(slateColor('slate-900'))
    );
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
