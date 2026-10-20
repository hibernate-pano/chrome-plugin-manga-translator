/**
 * 设置页的无障碍回归测试。
 *
 * 这一页此前是整个扩展里唯一没有任何测试的文件。一轮无障碍实测发现：
 * 8 个 input 全部没有可访问名称（读屏只会念"编辑，纯文本"）、两个字号滑块
 * 的 aria-label 是 Radix 默认的英文 "Minimum" / "Maximum"、折叠面板收起后
 * 里面的控件仍然能被 Tab 选中、标题层级也从 h1 直接跳到 h3 再回到 h2。
 *
 * 这里把三条修复钉住：控件有中文名字、折叠区收起即消失、标题层级不跳级。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import OptionsApp from './OptionsApp';
import { useAppConfigStore } from '@/stores/config-v2';
import { useTranslationCacheStore } from '@/stores/cache-v2';
import { createProvider } from '@/providers';

/**
 * 后端探测会真的去连 OpenAI / Ollama / LM Studio。测试里把它换成固定实现：
 * 这里要验的是页面结构，不是网络。
 */
vi.mock('@/providers', () => ({
  createProvider: vi.fn(async () => ({
    validateConfig: async () => ({ valid: true, message: '连接正常' }),
    testConnection: async () => ({ valid: true, message: '连接正常' }),
  })),
}));

// Radix 的 Slider 用 ResizeObserver 量轨道宽度，jsdom 没有这个 API。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver =
  globalThis.ResizeObserver ??
  (ResizeObserverStub as unknown as typeof ResizeObserver);

function resetStore(backgroundColor = 'rgba(240, 240, 235, 0.94)') {
  useAppConfigStore.setState({
    enabled: false,
    provider: 'openai-compatible',
    // 关掉首次引导弹窗，否则它会盖住整页。
    onboardingCompleted: true,
    autoTranslateHosts: [],
    overlayStyle: {
      backgroundColor,
      textColor: '#111111',
      minFontSize: 10,
      maxFontSize: 22,
      verticalText: false,
    },
    providers: {
      'openai-compatible': {
        apiKey: '',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o',
      },
      ollama: {
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llava',
      },
      'lm-studio': {
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        model: '',
      },
    },
  } as never);
}

async function renderOptions(backgroundColor?: string) {
  // 先让 store 的持久化 hydration 落地，再覆盖测试需要的状态，
  // 否则 hydration 会把下面的覆盖值冲掉。
  await act(async () => {
    await Promise.resolve();
  });
  resetStore(backgroundColor);
  const view = render(<OptionsApp />);
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

describe('OptionsApp 可访问名称', () => {
  beforeEach(() => {
    resetStore();
  });

  it('给每一个输入控件都起了中文名字', async () => {
    await renderOptions();

    // 这些控件以前只有 placeholder 或共用一个 label，读屏念出来是
    // "编辑，纯文本"，或者两个控件同名分不清谁是谁。
    expect(screen.getByLabelText('自动翻译站点')).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: '目标语言' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: '翻译风格' })
    ).toBeInTheDocument();
    expect(screen.getByLabelText('接口地址（Base URL）')).toBeInTheDocument();
    expect(screen.getByLabelText('模型（Model）')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key（密钥）')).toBeInTheDocument();

    expect(
      screen.getByRole('switch', { name: '启用扩展' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: '自动续翻' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: '缓存结果' })
    ).toBeInTheDocument();
  });

  it('颜色输入框和色值输入框各有各的名字', async () => {
    const user = userEvent.setup();
    await renderOptions();
    await user.click(screen.getByRole('button', { name: '覆盖层样式' }));

    expect(screen.getByLabelText('背景色')).toBeInTheDocument();
    expect(screen.getByLabelText('背景色选择器')).toBeInTheDocument();
    expect(screen.getByLabelText('文字颜色')).toBeInTheDocument();
    expect(screen.getByLabelText('文字颜色选择器')).toBeInTheDocument();
  });

  it('字号滑块的两个手柄有中文名字和读得出来的值', async () => {
    const user = userEvent.setup();
    await renderOptions();
    await user.click(screen.getByRole('button', { name: '覆盖层样式' }));

    const min = screen.getByRole('slider', { name: '字号下限' });
    const max = screen.getByRole('slider', { name: '字号上限' });

    // Radix 默认给的是英文 "Minimum" / "Maximum"。
    expect(min).not.toHaveAttribute('aria-label', 'Minimum');
    expect(max).not.toHaveAttribute('aria-label', 'Maximum');
    expect(min).toHaveAttribute('aria-valuetext', '10 号字');
    expect(max).toHaveAttribute('aria-valuetext', '22 号字');
  });
});

describe('OptionsApp 折叠面板', () => {
  beforeEach(() => {
    resetStore();
  });

  it('按钮声明了展开状态和它控制的面板', async () => {
    await renderOptions();

    const toggle = screen.getByRole('button', { name: '覆盖层样式' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'overlay-style-panel');

    const panel = document.getElementById('overlay-style-panel');
    expect(panel).not.toBeNull();
  });

  it('收起时里面的控件既不在页面里，也选不中', async () => {
    await renderOptions();

    // 收起状态下这些控件必须彻底不在 DOM 里：只靠 max-h-0 / opacity-0
    // 隐藏的话，它们照样能被 Tab 选中，读屏也会念出来。
    expect(screen.queryByLabelText('背景色')).toBeNull();
    expect(screen.queryByLabelText('背景色选择器')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(
      screen.queryByRole('switch', { name: '竖排文字' })
    ).not.toBeInTheDocument();
  });

  it('展开后控件出现，按钮状态跟着翻转', async () => {
    const user = userEvent.setup();
    await renderOptions();

    const toggle = screen.getByRole('button', { name: '覆盖层样式' });
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('背景色')).toBeInTheDocument();
    expect(
      screen.getByRole('slider', { name: '字号下限' })
    ).toBeInTheDocument();
  });
});

describe('OptionsApp 标题层级', () => {
  beforeEach(() => {
    resetStore();
  });

  it('从 h1 一路到 h2，中间没有跳级', async () => {
    await renderOptions();

    const headings = screen.getAllByRole('heading');
    const levels = headings.map(heading => Number(heading.tagName.slice(1)));

    expect(levels[0]).toBe(1);
    for (let index = 1; index < levels.length; index += 1) {
      const previous = levels[index - 1] ?? 0;
      const current = levels[index] ?? 0;
      // h1 → h3 这种跳级会让读屏的标题导航少一层。
      expect(current - previous).toBeLessThanOrEqual(1);
    }
  });

  it('主要分区都在标题列表里', async () => {
    await renderOptions();

    const texts = screen
      .getAllByRole('heading')
      .map(heading => (heading.textContent ?? '').trim());

    expect(texts).toContain('基础行为');
    expect(texts).toContain('目标语言');
    expect(texts).toContain('翻译风格');
    expect(texts).toContain('翻译后端');
    expect(texts).toContain('本月用量');

    // 用可访问名称（而不是 textContent）来查：折叠面板的副标题是
    // aria-hidden 的，不该混进标题的名字里。
    expect(
      screen.getByRole('heading', { name: '覆盖层样式' })
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '高级' })).toBeInTheDocument();
  });
});

describe('OptionsApp 背景色预览', () => {
  beforeEach(() => {
    resetStore();
  });

  it('预览按真实存储值渲染，而不是一个假的 #f0f0eb', async () => {
    const user = userEvent.setup();
    await renderOptions();
    await user.click(screen.getByRole('button', { name: '覆盖层样式' }));

    const picker = screen.getByLabelText('背景色选择器');
    // 色块是两层：底下是棋盘格（background-image），上面是真实颜色
    // （background）。要认的是上面那一层。
    const swatch = Array.from(
      picker.parentElement?.querySelectorAll('span[style]') ?? []
    ).find(node => (node.getAttribute('style') ?? '').includes('background:'));

    expect(swatch?.getAttribute('style')).toContain(
      'rgba(240, 240, 235, 0.94)'
    );
  });

  it('取色器的值跟着存储值走', async () => {
    const user = userEvent.setup();
    await renderOptions('rgba(0, 0, 0, 0.5)');
    await user.click(screen.getByRole('button', { name: '覆盖层样式' }));

    expect(screen.getByLabelText('背景色选择器')).toHaveValue('#000000');
  });

  it('取色只改 RGB，透明度留在原地', async () => {
    const user = userEvent.setup();
    await renderOptions('rgba(240, 240, 235, 0.94)');
    await user.click(screen.getByRole('button', { name: '覆盖层样式' }));

    fireEvent.change(screen.getByLabelText('背景色选择器'), {
      target: { value: '#112233' },
    });

    expect(screen.getByLabelText('背景色')).toHaveValue(
      'rgba(17, 34, 51, 0.94)'
    );
  });
});

describe('OptionsApp 连接状态探测', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(createProvider).mockClear();
  });

  it('只探测当前选中的后端', async () => {
    await renderOptions();

    // 用户只可能用一个后端。另外两个的探测是白跑的网络请求，
    // 还会让用户在自己没配的服务上看到"连接失败"。
    expect(createProvider).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createProvider).mock.calls[0]?.[0]).toBe(
      'openai-compatible'
    );
  });

  it('切换后端时立刻探一次新的那个', async () => {
    const user = userEvent.setup();
    await renderOptions();
    vi.mocked(createProvider).mockClear();

    await user.click(screen.getByRole('button', { name: /Ollama/ }));
    await user.click(screen.getByRole('button', { name: '切换' }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(createProvider).toHaveBeenCalled();
    expect(vi.mocked(createProvider).mock.calls[0]?.[0]).toBe('ollama');
  });

  it('探测失败时保持安静，不往用户脸上顶错误横幅', async () => {
    vi.mocked(createProvider).mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await renderOptions();

    // 轮询失败只影响标题旁边那个小圆点，不产生错误提示。
    expect(screen.queryByText(/ECONNREFUSED/)).toBeNull();
    expect(
      screen.queryByRole('alertdialog', { name: /连接/ })
    ).not.toBeInTheDocument();
  });

  it('手动点测试配置时才把错误说清楚', async () => {
    const user = userEvent.setup();
    await renderOptions();

    // 挂载时那一次探测先吃掉，再让后面的调用失败 —— 这样失败的是
    // 用户手动点的那一次。
    vi.mocked(createProvider).mockRejectedValue(new Error('ECONNREFUSED'));

    await user.click(screen.getByRole('button', { name: '测试配置' }));

    expect(await screen.findByText('ECONNREFUSED')).toBeInTheDocument();
  });
});

describe('OptionsApp 清空翻译缓存', () => {
  beforeEach(() => {
    resetStore();
    useTranslationCacheStore.getState().clear();
  });

  it('按钮藏在高级折叠区里', async () => {
    await renderOptions();

    // 平时不该有"清空缓存"这种按钮让人随手点。
    expect(screen.queryByRole('button', { name: '清空翻译缓存' })).toBeNull();

    const toggle = screen.getByRole('button', { name: '高级' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'advanced-panel');
  });

  it('展开后能点开，并且写明了后果', async () => {
    const user = userEvent.setup();
    await renderOptions();

    await user.click(screen.getByRole('button', { name: '高级' }));

    const button = screen.getByRole('button', { name: '清空翻译缓存' });
    expect(button).toBeInTheDocument();
    expect(screen.getByText(/重新调用你配置的模型服务/)).toBeInTheDocument();
  });

  it('清空前要二次确认，确认后缓存被清空', async () => {
    const user = userEvent.setup();
    useTranslationCacheStore
      .getState()
      .set('hash-1', { success: true, textAreas: [] }, 'openai-compatible');

    await renderOptions();
    await user.click(screen.getByRole('button', { name: '高级' }));
    await user.click(screen.getByRole('button', { name: '清空翻译缓存' }));

    // 确认框里必须把"会产生费用"的后果说清楚。
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('产生费用');

    // 还没确认，缓存还在。
    expect(useTranslationCacheStore.getState().has('hash-1')).toBe(true);

    await user.click(screen.getByRole('button', { name: '清空缓存' }));

    expect(useTranslationCacheStore.getState().has('hash-1')).toBe(false);
    expect(screen.getByText('翻译缓存已清空。')).toBeInTheDocument();
  });

  it('取消确认就不会清空', async () => {
    const user = userEvent.setup();
    useTranslationCacheStore
      .getState()
      .set('hash-2', { success: true, textAreas: [] }, 'openai-compatible');

    await renderOptions();
    await user.click(screen.getByRole('button', { name: '高级' }));
    await user.click(screen.getByRole('button', { name: '清空翻译缓存' }));
    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(useTranslationCacheStore.getState().has('hash-2')).toBe(true);
  });
});
