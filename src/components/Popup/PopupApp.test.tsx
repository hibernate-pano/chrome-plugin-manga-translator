import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useAppConfigStore } from '@/stores/config-v2';
import type { ContentState } from '@/shared/runtime-contracts';
import { contrastRatio, surfaceColor, type Rgb } from '@/test/contrast';

import PopupApp from './PopupApp';

const TAB = {
  id: 7,
  url: 'https://example.com/manga/chapter-1',
  active: true,
  windowId: 1,
};

const tabsMock = {
  query: vi.fn(),
  get: vi.fn(),
  sendMessage: vi.fn(),
  reload: vi.fn(),
  onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
  onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
};

function installTabsMock(): void {
  tabsMock.query.mockResolvedValue([TAB]);
  tabsMock.get.mockResolvedValue(TAB);
  tabsMock.sendMessage.mockResolvedValue(undefined);
  tabsMock.reload.mockResolvedValue(undefined);
  Object.assign(globalThis.chrome, {
    tabs: tabsMock,
    windows: { WINDOW_ID_CURRENT: -2 },
  });
}

/**
 * Put the extension into the state a user would be in right after setup:
 * the master switch on and a provider that has a key.
 *
 * The store is written directly rather than through storage: the persisted
 * store rehydrates once, when the module is first imported, which happens
 * before any test body runs.
 */
function configureExtension(): void {
  useAppConfigStore.setState(state => ({
    enabled: true,
    // A user who has been through the wizard. Without this the first-run
    // card is on screen in every test, which is not the state most of them
    // are about.
    onboardingCompleted: true,
    provider: 'openai-compatible',
    // The store is global, so a test that puts a site on the allowlist has
    // to hand it back: otherwise the next test inherits a page that is
    // billed on every open.
    autoTranslateHosts: [],
    autoContinueEnabled: true,
    providers: {
      ...state.providers,
      'openai-compatible': {
        ...state.providers['openai-compatible'],
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M3',
      },
    },
  }));
}

/**
 * The popup's own `chrome.runtime.onMessage` listener.
 *
 * The content script publishes its state on that channel, and the popup is
 * the only place that turns it into what the user sees.
 */
function latestStateUpdateListener():
  | ((message: { type: string; state?: ContentState }) => void)
  | undefined {
  const calls = vi.mocked(chrome.runtime.onMessage.addListener).mock.calls;
  return calls.at(-1)?.[0] as unknown as
    | ((message: { type: string; state?: ContentState }) => void)
    | undefined;
}

/** The popup's own background. */
const SLATE_950: Rgb = [2, 6, 23];
/** The disabled primary button's fill. */
const SLATE_800: Rgb = [30, 41, 59];

/**
 * The Tailwind shades the popup uses, as the colours they paint.
 *
 * A test that pins a class name only catches the exact string somebody
 * edited. A test that computes the contrast ratio catches the thing the
 * class name stands for — and it fails when the shade is swapped for a
 * darker one, which is how the number got low in the first place.
 */
const SHADES: Record<string, Rgb> = {
  'text-slate-300': [203, 213, 225],
  'text-slate-400': [148, 163, 184],
  'text-slate-500': [100, 116, 139],
  'text-slate-600': [71, 85, 105],
  'disabled:text-slate-400': [148, 163, 184],
  'disabled:text-slate-500': [100, 116, 139],
  'border-slate-500': [100, 116, 139],
  'border-slate-600': [71, 85, 105],
};

/**
 * The colour an element paints in one of `classes`, on `backdrop`.
 *
 * The first class the element actually carries wins, so the list is ordered
 * from the most specific to the least.
 */
function paintedColor(
  element: Element,
  classes: string[],
  backdrop: Rgb
): Rgb | undefined {
  for (const name of classes) {
    if (!element.classList.contains(name)) {
      continue;
    }
    if (name === 'border-white/20') {
      return surfaceColor('rgba(255, 255, 255, 0.2)', backdrop);
    }
    const solid = SHADES[name];
    if (solid) {
      return solid;
    }
  }
  return undefined;
}

describe('PopupApp', () => {
  beforeEach(() => {
    installTabsMock();
    configureExtension();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('offers the setup step to a user who has never configured anything', async () => {
    // The store listing tells the reviewer to click 「开始设置」 in the popup.
    // Until now the popup had no such button: a new user got a dead
    // 「翻译当前页面」 and a sentence telling them to go configure MiniMax
    // somewhere else.
    useAppConfigStore.setState({ onboardingCompleted: false } as never);

    render(<PopupApp />);

    const setup = await screen.findByRole('button', { name: /开始设置/ });
    expect(setup).toBeVisible();
  });

  it('does not offer the setup step to a user who is already set up', async () => {
    render(<PopupApp />);

    await screen.findByRole('button', { name: '翻译当前页面' });

    expect(screen.queryByRole('button', { name: /开始设置/ })).toBeNull();
  });

  it('keeps offering the setup step to a user who dismissed the wizard without configuring', async () => {
    // Esc / the × / 「稍后再设置」 all mark the wizard as completed. The
    // banner used to be keyed on that flag alone, so one stray Escape made
    // the only pointer to the settings page disappear — for a user who had
    // no provider at all. "Read the wizard" and "configured" are different
    // facts, and the banner needs the second one.
    configureExtension();
    useAppConfigStore.setState(state => ({
      onboardingCompleted: true,
      providers: {
        ...state.providers,
        'openai-compatible': {
          ...state.providers['openai-compatible'],
          apiKey: '',
        },
      },
    }));

    render(<PopupApp />);

    expect(
      await screen.findByRole('button', { name: /开始设置/ })
    ).toBeVisible();
  });

  it('offers a refresh when the page has no content script yet', async () => {
    // The page was already open when the extension was installed, so the
    // content script never ran in it. The popup could only tell the user to
    // refresh; now it can also do it for them.
    tabsMock.sendMessage.mockRejectedValue(
      new Error('Could not establish connection.')
    );

    render(<PopupApp />);

    const refreshButton = await screen.findByRole('button', {
      name: /刷新页面/,
    });

    await userEvent.click(refreshButton);
    expect(tabsMock.reload).toHaveBeenCalledWith(TAB.id);
  });

  it('does not offer a refresh on a page the extension can reach', async () => {
    tabsMock.sendMessage.mockResolvedValue({
      state: { status: 'idle' },
    });

    render(<PopupApp />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /翻译当前页面/ })
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: /刷新页面/ })
    ).not.toBeInTheDocument();
  });

  it('announces the result to a screen reader', async () => {
    // 弹窗里的状态变化以前只是屏幕上一块文字换了内容，读屏软件一个字都
    // 不念。翻译结束（尤其是有失败的那几张）就是用户等的那句话。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'complete', count: 37, failedCount: 3 },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const status = await screen.findByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    // 念的是同一句结论，不是「翻译完成」这种笼统说法。
    expect(status.textContent).toContain('37');
  });

  it('announces that a run has started', async () => {
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'translating', current: 2, total: 12 },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('正在翻译');
  });

  it('offers to retry the images a fatal error left behind', async () => {
    // 一章翻到第 8 张时密钥过期，整轮夭折：12 张没翻成的图还在页面的重试
    // 名单里，而弹窗只给一张错误卡片。读者修好密钥以后，最想要的就是
    // "把那 12 张翻掉" —— 数字弹窗手里就有，却不给入口。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: {
              status: 'error',
              message: 'API 密钥无效',
              suggestion: '在设置页填好 API Key，再翻一次这一页。',
              retryTargetCount: 12,
            },
          });
        }
        if (msg.type === 'FORCE_RETRANSLATE_FAILED') {
          return Promise.resolve({ success: true, count: 12 });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const retryButton = await screen.findByRole('button', {
      name: /重新翻译失败的 12 张/,
    });
    expect(retryButton).toBeInTheDocument();
  });

  it('says when a cancel failed while the page was still translating', async () => {
    // 翻译中按下「取消当前翻译」而取消没有送到（页面刚跳转、扩展刚重载）：
    // 错误必须看得见。错误提示以前只画在"没有任务在跑"的那一支里，于是
    // 用户以为已经停下来了，页面却还在翻，还在计费。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'translating', current: 2, total: 12 },
          });
        }
        if (msg.type === 'CANCEL_TRANSLATION') {
          return Promise.reject(new Error('页面已失效'));
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const cancelButton = await screen.findByRole('button', {
      name: /取消当前翻译/,
    });
    await userEvent.click(cancelButton);

    const failure = await screen.findByText(/操作失败/);
    expect(failure).toBeVisible();
  });

  it('retries only the failed images, and says how many', async () => {
    // The old button re-translated the whole page, so three failures on a
    // page of forty images cost the user forty translations. The content
    // script now has a scoped path, and the popup has to use it.
    // script now has a scoped path, and the popup has to use it.
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'complete', count: 37, failedCount: 3 },
          });
        }
        if (msg.type === 'FORCE_RETRANSLATE_FAILED') {
          return Promise.resolve({ success: true, count: 3 });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const retryButton = await screen.findByRole('button', {
      name: /重新翻译失败的 3 张/,
    });

    await userEvent.click(retryButton);

    // The confirmation has to name the cost, because it is the user's money.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/只重新翻译失败的 3 张图片/);
    expect(dialog).toHaveTextContent(/产生费用/);

    await userEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      const sent = tabsMock.sendMessage.mock.calls.map(call => call[1]);
      expect(sent).toContainEqual({ type: 'FORCE_RETRANSLATE_FAILED' });
    });
    // The whole-page retry must not be triggered by the failed-image retry.
    const sent = tabsMock.sendMessage.mock.calls.map(call => call[1]);
    expect(sent).not.toContainEqual({ type: 'FORCE_RETRANSLATE_PAGE' });
  });

  it('reports a failure of the scoped retry instead of doing nothing', async () => {
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'complete', count: 10, failedCount: 2 },
          });
        }
        if (msg.type === 'FORCE_RETRANSLATE_FAILED') {
          return Promise.resolve({ success: false });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const retryButton = await screen.findByRole('button', {
      name: /重新翻译失败的 2 张/,
    });
    await userEvent.click(retryButton);
    await userEvent.click(await screen.findByRole('button', { name: '重试' }));

    expect(await screen.findByText(/重试失败/)).toBeInTheDocument();
  });

  it('tells an allowlisted site that it is translated on every page open', async () => {
    // 白名单里的站点每次打开都会整页自动翻译并计费——跟「自动续翻」无关。
    // 弹窗以前说的是"「自动续翻」关着，所以不会自动翻译"，那是假的，
    // 而且它给的按钮「打开自动续翻」会再多开一条扣费的来源。
    useAppConfigStore.setState({
      autoTranslateHosts: ['example.com'],
      autoContinueEnabled: false,
    } as never);
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'idle', autoContinueArmed: false },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const warning =
      await screen.findByText(/每次打开它的页面都会自动翻译整页图片/);
    expect(warning).toBeVisible();
    expect(warning.closest('details')).toBeNull();
    // 「自动续翻」关着，只影响打开之后新出现的图片。
    expect(screen.getByText(/新出现的图片不会自动翻译/)).toBeVisible();

    // 唯一能按的按钮是"把这个站从名单里去掉"。
    expect(
      screen.queryByRole('button', { name: /打开自动续翻/ })
    ).not.toBeInTheDocument();
    const removeButton = await screen.findByRole('button', {
      name: '关闭本站自动翻译',
    });
    expect(removeButton).toBeVisible();

    await userEvent.click(removeButton);

    await waitFor(() => {
      const sent = tabsMock.sendMessage.mock.calls.map(call => call[1]);
      expect(sent).toContainEqual({ type: 'DISARM_PAGE_AUTO_TRANSLATE' });
    });
  });

  it('says when the page is translating on its own, and offers to stop it', async () => {
    // 三个开关都关着，但用户刚手动翻译过这一页：页面照样在自动翻译。
    // 弹窗以前只摆开关，不说结果，用户以为不会扣费。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: {
              status: 'idle',
              autoContinueArmed: true,
              readingPanelVisible: false,
            },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const warning = await screen.findByText(
      /这一页会自动翻译新加载的图片（会产生费用）/
    );
    // 这条提示必须"看得见"，而不只是"在 DOM 里"。
    //
    // 它以前住在折叠的 <details> 里：jsdom 的 getByText 照样能找得到，
    // 于是测试一直是绿的，而用户根本看不到这条唯一的扣费警告。折叠的
    // <details> 会让里面的内容变成不可见，toBeVisible() 才抓得住这个回归。
    expect(warning).toBeVisible();
    expect(warning.closest('details')).toBeNull();

    const stopButton = screen.getByRole('button', { name: /本页不再自动翻译/ });
    await userEvent.click(stopButton);

    await waitFor(() => {
      const sent = tabsMock.sendMessage.mock.calls.map(call => call[1]);
      expect(sent).toContainEqual({ type: 'DISARM_PAGE_AUTO_TRANSLATE' });
    });
  });

  it('says how much longer the page will take', async () => {
    // 一页二十张图的时候，"还要多久"比"到第几张"更有用——没有它，用户只能
    // 盯着进度条猜是不是卡住了。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: {
              status: 'translating',
              current: 7,
              total: 20,
              etaSeconds: 45,
            },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const status = await screen.findByText(/翻译中 7\/20/);
    expect(status).toHaveTextContent('约 45 秒');
  });

  it('stays quiet about auto-translation when the page has not answered', async () => {
    // 页面还没回答之前，弹窗不能说"不会自动翻译"——那也是一种撒谎。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({ state: { status: 'idle' } });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /翻译当前页面/ })
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/会继续产生费用/)).not.toBeInTheDocument();
  });

  it('refuses to re-translate while the page is still translating', async () => {
    // 「强制重翻」会等当前这一轮跑完（那一轮是计费的），然后再忽略缓存
    // 把整页翻一遍——两轮的钱。按钮在这一轮跑完之前必须是关的，并且要说
    // 出原因，否则用户只看到一个"按了没反应"的按钮。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'translating', current: 3, total: 20 },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const button = await screen.findByRole('button', { name: '忽略缓存重翻' });
    expect(button).toBeDisabled();
    expect(screen.getByText('翻译进行中，完成后可重翻')).toBeInTheDocument();
  });

  it('names the number of images a force re-translate will bill for', async () => {
    // 隔壁的"重试失败"对话框会说清是几张，这个更贵的对话框却只说"所有
    // 图片"。用户按下去之前必须知道要付多少次。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'idle', autoContinueArmed: true },
          });
        }
        if (msg.type === 'COUNT_IMAGES') {
          return Promise.resolve({
            success: true,
            count: 12,
            pending: 30,
            total: 12,
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    await userEvent.click(
      await screen.findByRole('button', { name: '忽略缓存重翻' })
    );

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/本页 12 张图片/);
    // 「全部」是假的：这一页还压着 30 张懒加载的图，自动续翻会把它们
    // 也送去模型。只报 12 张，等于把一个偏低的数字说成总数。
    expect(dialog).not.toHaveTextContent(/本页全部/);
    expect(dialog).toHaveTextContent(/另有 30 张还在加载/);
    expect(dialog).toHaveTextContent(/加载后会自动翻译/);
    // 12 是图片数，不是请求数：长条图会被拆成多片分别请求。
    expect(dialog).toHaveTextContent(/长条图会拆成多片分别请求/);
    expect(dialog).toHaveTextContent(/已经翻译成功的图片也会重新翻译/);
    // 还有一轮可能正在跑：两轮都要钱，这句话必须说在前面。
    expect(dialog).toHaveTextContent(/会先让它跑完/);
  });

  it('quotes the number of images a retry will bill for, not the failure count', async () => {
    // 一轮跑到一半夭折：失败计数是 1，但没轮到的图片全都回到了重试列表，
    // 下一次点击会重新请求 20 张。弹窗写 1 张，用户就按 1 张的价钱去授权。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: {
              status: 'complete',
              count: 37,
              failedCount: 1,
              retryTargetCount: 20,
            },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    const retryButton = await screen.findByRole('button', {
      name: /重新翻译失败的 20 张/,
    });
    expect(retryButton).toBeVisible();

    await userEvent.click(retryButton);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/只重新翻译失败的 20 张图片/);
    expect(dialog).toHaveTextContent(/产生费用/);
  });

  it('forgets the previous page when the new page says nothing about the panel', async () => {
    // A 页面开着阅读面板，B 页面没翻过：弹窗不能还留着 A 页面的答案，
    // 然后给 B 页面一个「隐藏译文阅读面板」的按钮。
    //
    // 而且 B 页面根本不该有面板开关：阅读面板是翻完这一页才有的，B 页面
    // 没有译文，按下去只会得到一个空面板盖在画上。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'idle', readingPanelVisible: true },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    await screen.findByRole('button', { name: /隐藏译文阅读面板/ });

    const listener = latestStateUpdateListener();
    expect(listener).toBeTypeOf('function');

    act(() => {
      listener?.({ type: 'STATE_UPDATE', state: { status: 'idle' } });
    });

    expect(
      screen.queryByRole('button', { name: /译文阅读面板/ })
    ).not.toBeInTheDocument();
  });

  it('keeps the price line, the disabled button and the control border readable', async () => {
    // 三处都是用户真正要读的东西：这一页要花多少钱、按不了的时候为什么
    // 按不了、还有那个下拉框（它的边框是"这是个控件"的唯一提示）。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({ state: { status: 'idle' } });
        }
        if (msg.type === 'COUNT_IMAGES') {
          return Promise.resolve({
            success: true,
            count: 12,
            pending: 0,
            total: 12,
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    const { container } = render(<PopupApp />);

    // 1. 价格那一行落在卡片的填充色上。
    const hint = await screen.findByText(/12 张可翻译图片/);
    const cardFill = surfaceColor('rgba(255, 255, 255, 0.08)', SLATE_950);
    const hintColor = paintedColor(
      hint,
      ['text-slate-300', 'text-slate-400', 'text-slate-500'],
      cardFill
    );
    expect(hintColor).toBeDefined();
    expect(contrastRatio(hintColor as Rgb, cardFill)).toBeGreaterThanOrEqual(
      4.5
    );

    // 1b. 「一张图可能变成多次请求」那句被调成了注解，字号更小、颜色更浅。
    // 小字对对比度的要求一点不低 —— 它现在更淡，就更要算一遍。
    const caveat = await screen.findByText(/一张图可能变成多次请求/);
    const caveatColor = paintedColor(
      caveat,
      ['text-slate-400', 'text-slate-500'],
      cardFill
    );
    expect(caveatColor).toBeDefined();
    expect(contrastRatio(caveatColor as Rgb, cardFill)).toBeGreaterThanOrEqual(
      4.5
    );

    // 2. 主按钮禁用时的字色，落在它自己的灰色底上。
    const button = screen.getByRole('button', { name: '翻译当前页面' });
    const disabledColor = paintedColor(
      button,
      ['disabled:text-slate-400', 'disabled:text-slate-500'],
      SLATE_800
    );
    expect(disabledColor).toBeDefined();
    expect(
      contrastRatio(disabledColor as Rgb, SLATE_800)
    ).toBeGreaterThanOrEqual(4.5);

    // 3. 下拉框的边框：WCAG 1.4.11 要 3:1。
    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    const borderColor = paintedColor(
      select as Element,
      ['border-slate-500', 'border-slate-600', 'border-white/20'],
      SLATE_950
    );
    expect(borderColor).toBeDefined();
    expect(contrastRatio(borderColor as Rgb, SLATE_950)).toBeGreaterThanOrEqual(
      3
    );
  });

  it('does not tell a local provider that its calls cost money', async () => {
    // Ollama / LM Studio 在本机跑：不花钱，图片也不离开这台机器。
    // 弹窗上"本月 N 次 API 调用"对这样的读者是一句假话。
    useAppConfigStore.setState(state => ({
      ...state,
      provider: 'ollama',
      providers: {
        ...state.providers,
        ollama: {
          ...state.providers['ollama'],
          baseUrl: 'http://localhost:11434',
          model: 'qwen3',
        },
      },
    }));

    try {
      tabsMock.sendMessage.mockImplementation(
        (_tabId: number, msg: { type: string }) => {
          if (msg.type === 'GET_STATE') {
            return Promise.resolve({ state: { status: 'idle' } });
          }
          return Promise.resolve({ success: true });
        }
      );

      render(<PopupApp />);

      expect(await screen.findByText(/次模型调用/)).toBeInTheDocument();
      expect(screen.queryByText(/次 API 调用/)).toBeNull();
    } finally {
      configureExtension();
    }
  });

  it('lists the keyboard shortcuts where they can be seen', async () => {
    // 四个快捷键在 manifest 里注册了，界面上一个字都没有。折叠起来等于
    // 没有——所以这一块常驻显示。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({ state: { status: 'idle' } });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    // The block advertises the defaults, not the user's own bindings —
    // Chrome lets them rebind every command.
    const heading = await screen.findByText('默认快捷键');
    expect(heading).toBeVisible();
    expect(heading.closest('details')).toBeNull();
    // The button above the list and the shortcut row name the same action
    // the same way — so the query has to be scoped to the list.
    expect(screen.getAllByText('忽略缓存重翻').length).toBeGreaterThan(0);
    expect(screen.getByText('清除当前页面的译文覆盖层')).toBeInTheDocument();
    expect(screen.getByText('显示或隐藏译文阅读面板')).toBeInTheDocument();
    // 键位本身也要写出来，否则用户还是得去猜。
    expect(screen.getAllByText('Shift').length).toBeGreaterThan(0);
  });

  it('lets the page decide whether the reading panel is showing', async () => {
    // 弹窗以前自己翻转按钮上的字。于是在"这一页还没翻过"的页面上，它
    // 声称"隐藏阅读面板"，而页面上的面板其实刚被创建出来——第一次按等于
    // 什么都没发生。页面才知道面板在不在，标签就该听页面的。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({
            state: { status: 'idle', readingPanelVisible: false },
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    await screen.findByRole('button', { name: /显示译文阅读面板/ });

    const listener = latestStateUpdateListener();
    expect(listener).toBeTypeOf('function');

    act(() => {
      listener?.({
        type: 'STATE_UPDATE',
        state: { status: 'idle', readingPanelVisible: true },
      });
    });

    expect(
      screen.getByRole('button', { name: /隐藏译文阅读面板/ })
    ).toBeInTheDocument();
  });

  it('reads the price of the page again once the run finishes', async () => {
    // 翻完一页之后，这一页的"价格"变了：新图加载了，旧图已经翻过。弹窗
    // 以前只在打开时数一次，数字从此停在旧页面上。
    tabsMock.sendMessage.mockImplementation(
      (_tabId: number, msg: { type: string }) => {
        if (msg.type === 'GET_STATE') {
          return Promise.resolve({ state: { status: 'idle' } });
        }
        if (msg.type === 'COUNT_IMAGES') {
          return Promise.resolve({
            success: true,
            count: 5,
            pending: 2,
            total: 5,
          });
        }
        return Promise.resolve({ success: true });
      }
    );

    render(<PopupApp />);

    await waitFor(() => {
      const sent = tabsMock.sendMessage.mock.calls.map(call => call[1]);
      expect(sent).toContainEqual({ type: 'COUNT_IMAGES' });
    });

    const listener = latestStateUpdateListener();

    act(() => {
      listener?.({
        type: 'STATE_UPDATE',
        state: { status: 'complete', count: 5 },
      });
    });

    await waitFor(() => {
      const counted = tabsMock.sendMessage.mock.calls.filter(
        call => call[1].type === 'COUNT_IMAGES'
      );
      expect(counted.length).toBeGreaterThan(1);
    });
  });
});
