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
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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
    // 画质与并发也要回到初始值：上一个用例改过它们，不然这一页的
    // 说明文字会跟着上一个用例的选择走。
    maxImageSize: 1024,
    parallelLimit: 3,
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

/**
 * Tailwind's spacing scale, in CSS pixels (1 = 0.25rem).
 */
const SPACING_PX: Record<string, number> = {
  '0': 0,
  '0.5': 2,
  '1': 4,
  '1.5': 6,
  '2': 8,
  '2.5': 10,
  '3': 12,
  '3.5': 14,
  '4': 16,
};

/**
 * The size of a button's clickable area, in CSS pixels.
 *
 * jsdom has no layout engine, so the size cannot be measured — only the
 * class list can. The button's box is its icon's box plus the padding
 * around it, which is exactly what the user has to hit.
 */
function clickableSize(button: HTMLElement): { width: number; height: number } {
  const classes = button.className.split(/\s+/);
  const paddingClass = classes.find(
    name => name.startsWith('p-') && !/^p[xy]-/.test(name)
  );
  const padding = paddingClass ? (SPACING_PX[paddingClass.slice(2)] ?? 0) : 0;
  const icon = button.querySelector('svg');
  const iconClasses = icon?.getAttribute('class')?.split(/\s+/) ?? [];
  const size = (name: string) => {
    const found = iconClasses.find(entry => entry.startsWith(`${name}-`));
    return found ? (SPACING_PX[found.slice(name.length + 1)] ?? 0) : 0;
  };
  return {
    width: size('w') + padding * 2,
    height: size('h') + padding * 2,
  };
}

describe('OptionsApp 点击目标', () => {
  beforeEach(() => {
    resetStore();
  });

  it('显示/隐藏 API Key 的按钮有 24×24 以上的点击区域', async () => {
    // WCAG 2.5.8 (AA): a target has to be at least 24×24 CSS pixels. The
    // button used to be a bare 16×16 icon, and it sits in the corner of a
    // text field where the eye has to land.
    await renderOptions();

    const toggle = screen.getByRole('button', { name: '显示 API Key' });
    const { width, height } = clickableSize(toggle);
    expect(width).toBeGreaterThanOrEqual(24);
    expect(height).toBeGreaterThanOrEqual(24);
  });
});

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

describe('OptionsApp 画质与并发', () => {
  beforeEach(() => {
    resetStore();
  });

  it('分辨率可选，并且写进 store', async () => {
    const user = userEvent.setup();
    await renderOptions();

    const select = screen.getByRole('combobox', {
      name: '图片分辨率上限（短边像素）',
    });
    expect(select).toHaveValue('1024');

    await user.selectOptions(select, '2048');

    expect(useAppConfigStore.getState().maxImageSize).toBe(2048);
  });

  it('换了分辨率就把"更贵"这件事说清楚', async () => {
    const user = userEvent.setup();
    await renderOptions();

    // 选 1024 的时候不该拿"最贵"的话吓唬人。
    expect(
      screen.getByText(/标准档：大多数漫画页都能读清/)
    ).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole('combobox', { name: '图片分辨率上限（短边像素）' }),
      '2048'
    );

    expect(screen.getByText(/费用可能翻两三倍/)).toBeInTheDocument();
  });

  it('说清楚改分辨率会让缓存失效', async () => {
    await renderOptions();

    // 缓存的 key 是处理后图片的 hash，而处理后的图片取决于分辨率。改了
    // 分辨率，之前缓存的译文就再也命中不了——用户会以为自己只是调了个
    // 画质，下一页却又要付一次全价。这句话必须自己说，不等用户发现。
    expect(
      screen.getByText(/改分辨率会让已经缓存的译文失效/)
    ).toBeInTheDocument();
  });

  it('并发数可选，并且写进 store', async () => {
    const user = userEvent.setup();
    await renderOptions();

    const select = screen.getByRole('combobox', { name: '同时翻译的图片数' });
    expect(select).toHaveValue('3');

    await user.selectOptions(select, '1');

    expect(useAppConfigStore.getState().parallelLimit).toBe(1);
  });
});

describe('OptionsApp 服务商预设', () => {
  beforeEach(() => {
    resetStore();
  });

  it('点一下就把地址和模型填好', async () => {
    const user = userEvent.setup();
    await renderOptions();

    await user.click(screen.getByRole('button', { name: /SiliconFlow/ }));

    const settings =
      useAppConfigStore.getState().providers['openai-compatible'];
    expect(settings?.baseUrl).toBe('https://api.siliconflow.cn/v1');
    expect(settings?.model).toBe('Qwen/Qwen2.5-VL-72B-Instruct');
  });

  it('当前配置命中某个预设时，那个预设是按下的状态', async () => {
    await renderOptions();

    // 必须在渲染之后改：renderOptions 会先把 store 重置成测试用的初始值。
    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      baseUrl: 'https://api.siliconflow.cn/v1',
      model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    });

    const preset = await screen.findByRole('button', { name: /SiliconFlow/ });
    expect(preset).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('OptionsApp 关于与支持', () => {
  beforeEach(() => {
    resetStore();
  });

  it('显示当前版本号', async () => {
    const runtime = chrome.runtime as unknown as {
      getManifest?: () => { version: string };
    };
    runtime.getManifest = () => ({ version: '2.1.0' });

    await renderOptions();

    expect(screen.getByText('2.1.0')).toBeInTheDocument();
  });

  it('复制出来的诊断信息里有设置，但绝不含 API Key 和接口地址', async () => {
    const user = userEvent.setup();
    // userEvent.setup() 自己会往 navigator.clipboard 上装一个只读的桩，
    // 必须在它之后再换成可写的那个，否则写进去的是桩而不是我们的 mock。
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await renderOptions();

    // 必须在渲染之后改：renderOptions 会先把 store 重置成测试用的初始值。
    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      apiKey: 'sk-test-0123456789abcdef',
    });

    await user.click(screen.getByRole('button', { name: '复制诊断信息' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0]?.[0] ?? '');

    // 报障贴到公开 issue 里的东西，不能带凭据。
    expect(copied).not.toContain('sk-test-0123456789abcdef');
    expect(copied).not.toContain('api.openai.com');
    // 但要够用：能看出用的哪个后端、有没有 Key。
    expect(copied).toContain('"hasApiKey": true');
  });

  it('自建端点的主机名不会跟着诊断信息走', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await renderOptions();

    // 必须在渲染之后改：renderOptions 会先把 store 重置成测试用的初始值。
    useAppConfigStore.getState().updateProviderSettings('openai-compatible', {
      baseUrl: 'https://gateway.mycorp.internal/v1',
    });

    await user.click(screen.getByRole('button', { name: '复制诊断信息' }));

    const copied = String(writeText.mock.calls[0]?.[0] ?? '');
    // 诊断信息会被贴到公开 issue 里，而主机名说的是报告人自己的公司网络。
    expect(copied).not.toContain('mycorp.internal');
    expect(copied).toContain('OpenAI 兼容（自建端点）');
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

    // 轮询失败不弹错误框，也不弹模态框。
    expect(
      screen.queryByRole('alertdialog', { name: /连接/ })
    ).not.toBeInTheDocument();
    // 但原因要留在页面上：红点只说"有问题"，不说是谁的问题。
    // 它就写在圆点旁边，不是横幅。
    const reason = screen.getByText(/ECONNREFUSED/);
    expect(reason).toBeInTheDocument();
    expect(reason.closest('[role="alertdialog"]')).toBeNull();
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

/**
 * 那个绿点说的是"连得上"，不是"这串字符长得像 Key"。
 *
 * `validateConfig()` 对 OpenAI 兼容后端只能看字符串：Key 被吊销、地址
 * 写错、模型名不存在，它一律回答"配置有效"。圆点以前问的是它，所以一个
 * 被吊销的 Key 照样显示"连接正常" —— 而那是用户唯一能看到的健康信号。
 */
describe('OptionsApp 连接状态是真的探出来的', () => {
  beforeEach(() => {
    resetStore();
    vi.mocked(createProvider).mockClear();
  });

  it('Key 被吊销时不再显示"连接正常"', async () => {
    vi.mocked(createProvider).mockResolvedValueOnce({
      validateConfig: async () => ({ valid: true, message: '配置有效' }),
      testConnection: async () => ({
        valid: false,
        message: 'MiniMax 拒绝了该 API 密钥（401）',
      }),
    } as never);

    await renderOptions();

    expect(await screen.findByText('连接异常')).toBeInTheDocument();
    expect(screen.queryByText('连接正常')).toBeNull();
  });

  it('把服务商说的失败原因摆在圆点旁边', async () => {
    vi.mocked(createProvider).mockResolvedValueOnce({
      validateConfig: async () => ({ valid: true, message: '配置有效' }),
      testConnection: async () => ({
        valid: false,
        message: 'MiniMax 拒绝了该 API 密钥（401）',
      }),
    } as never);

    await renderOptions();

    expect(await screen.findByText(/拒绝了该 API 密钥/)).toBeInTheDocument();
  });

  /**
   * 探一次是要花钱的，而钱只花在用户点了按钮的时候。
   *
   * 网关不提供 /models 时，"探一次"会真的生成一个词。自动探测每 15 分钟
   * 跑一轮，替用户确认一件他没要求确认的事，账单上就多出一串请求。所以
   * 轮询只问便宜的答案，只有「测试配置」按钮才被允许花那一次。
   */
  it('自动探测不许花钱，手动「测试配置」才许', async () => {
    const testConnection = vi.fn(
      async (_options?: { allowBillableProbe?: boolean }) => ({
        valid: true,
        message: '连接正常',
      })
    );
    vi.mocked(createProvider).mockResolvedValue({
      validateConfig: async () => ({ valid: true, message: '配置有效' }),
      testConnection,
    } as never);

    await renderOptions();

    await waitFor(() => {
      expect(testConnection).toHaveBeenCalled();
    });
    expect(testConnection.mock.calls[0]?.[0]).toEqual({
      allowBillableProbe: false,
    });

    await userEvent.click(screen.getByRole('button', { name: '测试配置' }));

    await waitFor(() => {
      expect(
        testConnection.mock.calls.some(
          call => call[0]?.allowBillableProbe === true
        )
      ).toBe(true);
    });
  });

  /**
   * 探一次是要花钱的：网关不提供 /models 的时候，探测会真的生成一个词。
   * 而一个坏掉的配置不会自己变好 —— 它要用户去改 Key 或地址。所以失败
   * 一次就把自动探测关掉，而不是每 15 分钟替用户确认一件他还没改的事。
   */
  it('探不通就不再自动重试，等用户自己来测', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(createProvider).mockResolvedValue({
        validateConfig: async () => ({ valid: true, message: '配置有效' }),
        testConnection: async () => ({ valid: false, message: '无法连接' }),
      } as never);

      await renderOptions();
      await act(async () => {
        await Promise.resolve();
      });
      expect(vi.mocked(createProvider)).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      });

      // 半小时过去了，一次额外的请求都没有。
      expect(vi.mocked(createProvider)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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

describe('OptionsApp 自动翻译站点', () => {
  beforeEach(() => {
    resetStore();
  });

  it('一直说清楚"在名单里"意味着会自己花钱', async () => {
    // 以前关于费用的警告只挂在"不在名单里"的那句话上，于是真正会自己
    // 扣费的那一类——名单里的站点——反而没有警告。这条提示常驻在列表
    // 旁边，名单空不空都在。
    await renderOptions();

    const note = screen.getByText('名单里的站点会自己花钱');
    expect(note).toBeVisible();
    const text = note.parentElement?.textContent ?? '';
    expect(text).toContain('产生费用');
    expect(text).toContain('*.example.com');
    expect(text).toContain('子域名');
  });

  it('说清楚右键菜单也是一个入口', async () => {
    // 右键菜单以前界面上一个字都没有：用户看到"翻译当前页面"，不知道它
    // 同样要花钱。
    await renderOptions();

    expect(screen.getByText(/翻译这张图片/)).toBeVisible();
  });
});

/**
 * 设置页对"什么时候会花钱"和"我能去哪里"的承诺。
 *
 * 这些文案是对外说明，也是用户判断要不要花钱的唯一依据。写错了不是文案
 * 问题——用户是照着它做决定的。
 */
describe('OptionsApp 花费与引导', () => {
  it('says what the master switch really does', async () => {
    await renderOptions();

    // 弹窗上写的是「关闭后不会请求任何模型」，设置页以前写的是「允许页面
    // 进入自动翻译体系」——读起来像是关了还能手动翻。
    expect(screen.getByText(/关闭后不会请求任何模型/)).toBeInTheDocument();
  });

  it('says that auto-continue costs money', async () => {
    await renderOptions();

    expect(screen.getByText(/自动继续翻译（会产生费用）/)).toBeInTheDocument();
  });

  /**
   * 以前这里写的是「关掉它只能翻到当前这一屏」——那是假的。弹窗的
   * 「翻译当前页面」本来就会把已加载的图整页翻完，白名单命中的站点更是
   * 打开页面就整页翻。关掉的只是"后面加载出来的图"。
   */
  it('自动续翻的说明说对了它到底管什么', async () => {
    await renderOptions();

    const copy = screen.getByText(/页面内后续图片出现时自动继续翻译/);
    expect(copy.textContent).not.toContain('只能翻到当前这一屏');
    expect(copy.textContent).toContain('就不会再自动翻后面加载出来的图');
    expect(copy.textContent).toContain('已加载的图');
  });

  /**
   * 顶部那段说明是整个产品里唯一明说"图片会离开这台机器"的地方。关掉
   * 它不该是永久的 —— 高级区里留了一个入口。
   */
  it('关掉的数据流向说明可以再调出来', async () => {
    const user = userEvent.setup();
    await renderOptions();

    await user.click(screen.getByRole('button', { name: '关闭告知' }));
    expect(
      screen.queryByRole('heading', { name: '数据流向说明' })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '高级' }));
    await user.click(
      screen.getByRole('button', { name: '重新显示数据流向说明' })
    );

    expect(
      await screen.findByRole('heading', { name: '数据流向说明' })
    ).toBeInTheDocument();
  });

  it('关闭按钮是叉号，不是向下的箭头', async () => {
    await renderOptions();

    // 一个向下的箭头是"折叠"，不是"关闭"。这段说明后面没有可展开的内容。
    const close = screen.getByRole('button', { name: '关闭告知' });
    const icon = close.querySelector('svg');
    expect(icon?.getAttribute('class')).toContain('lucide-x');
    expect(icon?.getAttribute('class')).not.toContain('chevron');
  });

  it('does not claim that sites outside the list cost nothing', async () => {
    await renderOptions();

    // 以前这里写的是「其他站点需要你手动点一下按钮，避免把不相关页面的图片
    // 发给模型并产生费用」——可手动点过之后，本页后续加载的图片会自动接着
    // 翻，一样花钱。
    const note = screen.getByText(/只有列表中的站点会在打开页面时自动翻译/);
    expect(note.textContent).toContain('自动接着翻');
    expect(note.textContent).toContain('同样会产生费用');
  });

  it('offers a way to read the wizard again', async () => {
    const user = userEvent.setup();
    await renderOptions();

    await user.click(screen.getByRole('button', { name: '重新查看引导' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/欢迎使用漫画翻译助手/)).toBeInTheDocument();
  });

  it('scrolls to the provider section when the wizard closes with nothing configured', async () => {
    // The wizard's last step says the reader will find the form "below".
    // The provider section is the sixth group on this page, so "below" is
    // really "five screens down". Closing the dialog used to leave them at
    // the top with nothing pointing at it.
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;

    try {
      const user = userEvent.setup();
      await renderOptions();

      await user.click(screen.getByRole('button', { name: '重新查看引导' }));
      await user.click(screen.getByRole('button', { name: '稍后再设置' }));

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('links to where the API key comes from', async () => {
    await renderOptions();

    const links = screen.getAllByRole('link', { name: /获取 API Key/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute(
      'href',
      expect.stringContaining('http') as unknown as string
    );
  });
});
