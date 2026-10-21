import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useAppConfigStore } from '@/stores/config-v2';

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
    provider: 'openai-compatible',
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

describe('PopupApp', () => {
  beforeEach(() => {
    installTabsMock();
    configureExtension();
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  it('retries only the failed images, and says how many', async () => {
    // The old button re-translated the whole page, so three failures on a
    // page of forty images cost the user forty translations. The content
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
    expect(dialog).toHaveTextContent(/只重新翻译失败的那几张图片/);
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

    expect(await screen.findByText(/会继续产生费用/)).toBeInTheDocument();

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
});
