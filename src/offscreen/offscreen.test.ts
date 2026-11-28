/**
 * The extension-origin OCR host page.
 *
 * Two roles, both exercised here against a fake `chrome` surface:
 *
 *   - offscreen document: connects to the worker over a named port, answers
 *     jobs on it, and reconnects when the worker pokes it after a restart;
 *   - embedded iframe: answers `postMessage` jobs only when the sender is
 *     the parent frame and carries the token from the page's own fragment.
 *
 * The recogniser itself is mocked — `text-detector.test.ts` covers the
 * worker construction, and this file is about the message plumbing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OCR_FRAME_JOB,
  OCR_FRAME_READY,
  OCR_FRAME_RESULT,
  OCR_OFFSCREEN_PORT,
  OCR_OFFSCREEN_RESULT,
  OCR_OFFSCREEN_WAKE,
  type OcrFrameResult,
  type OcrOffscreenJob,
} from './ocr-protocol';

const { recognizeMock } = vi.hoisted(() => ({
  recognizeMock: vi.fn(),
}));

vi.mock('@/services/text-detector', () => ({
  recognizeWithLocalWorker: recognizeMock,
}));

const RESULT = {
  regions: [
    { x: 1, y: 2, width: 3, height: 4, text: 'こんにちは', confidence: 0.9 },
  ],
  imageWidth: 640,
  imageHeight: 960,
  processingTime: 25,
};

const OPTIONS = {
  languages: ['jpn'],
  psm: '11',
  expandMargin: 0.05,
  minConfidence: 0.3,
  imageWidth: 640,
  imageHeight: 960,
};

interface FakePort {
  port: chrome.runtime.Port;
  posted: unknown[];
  emit: (message: unknown) => void;
  disconnect: () => void;
}

function createPort(): FakePort {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: unknown[] = [];
  const port = {
    name: OCR_OFFSCREEN_PORT,
    postMessage: (message: unknown) => {
      posted.push(message);
    },
    onMessage: {
      addListener: (listener: (message: unknown) => void) =>
        messageListeners.push(listener),
    },
    onDisconnect: {
      addListener: (listener: () => void) => disconnectListeners.push(listener),
    },
  } as unknown as chrome.runtime.Port;
  return {
    port,
    posted,
    emit: message => {
      for (const listener of messageListeners) listener(message);
    },
    disconnect: () => {
      for (const listener of disconnectListeners) listener();
    },
  };
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('offscreen document role', () => {
  let fake: FakePort;
  let connect: ReturnType<typeof vi.fn>;
  let onMessageListeners: Array<(message: unknown) => void>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    fake = createPort();
    connect = vi.fn(() => fake.port);
    onMessageListeners = [];
    vi.stubGlobal('chrome', {
      runtime: {
        connect,
        onMessage: {
          addListener: (listener: (message: unknown) => void) => {
            onMessageListeners.push(listener);
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function loadHost(): Promise<void> {
    await import('./offscreen');
  }

  it('connects on the OCR port and answers a job with the recogniser result', async () => {
    recognizeMock.mockResolvedValue(RESULT);
    await loadHost();

    expect(connect).toHaveBeenCalledWith({ name: OCR_OFFSCREEN_PORT });

    const job: OcrOffscreenJob = {
      type: 'OCR_OFFSCREEN_JOB',
      requestId: 'req-1',
      image: 'base64-image',
      options: OPTIONS,
    };
    fake.emit(job);
    await tick();

    expect(recognizeMock).toHaveBeenCalledWith(
      'base64-image',
      OPTIONS,
      'extension'
    );
    expect(fake.posted[0]).toEqual({
      type: OCR_OFFSCREEN_RESULT,
      requestId: 'req-1',
      response: { success: true, result: RESULT },
    });
  });

  it('reports a recogniser failure as kind "ocr" on the same port', async () => {
    recognizeMock.mockRejectedValue(new Error('language pack is missing'));
    await loadHost();

    fake.emit({
      type: 'OCR_OFFSCREEN_JOB',
      requestId: 'req-2',
      image: 'base64-image',
      options: OPTIONS,
    } satisfies OcrOffscreenJob);
    await tick();

    expect(fake.posted[0]).toEqual({
      type: OCR_OFFSCREEN_RESULT,
      requestId: 'req-2',
      response: {
        success: false,
        kind: 'ocr',
        error: 'language pack is missing',
      },
    });
  });

  it('ignores a job with an unknown shape', async () => {
    await loadHost();

    fake.emit({ type: 'SOMETHING_ELSE' });
    fake.emit({
      type: 'OCR_OFFSCREEN_JOB',
      requestId: 'x',
      image: '',
      options: {},
    });
    await tick();

    expect(recognizeMock).not.toHaveBeenCalled();
    expect(fake.posted).toEqual([]);
  });

  it('reconnects when the worker pokes the page after a restart', async () => {
    vi.useFakeTimers();
    recognizeMock.mockResolvedValue(RESULT);
    await loadHost();
    expect(connect).toHaveBeenCalledTimes(1);

    fake.disconnect();
    // The disconnect schedules one delayed reconnect; the wake message
    // should skip the wait. Either way it must not connect twice.
    for (const listener of onMessageListeners) {
      listener({ type: OCR_OFFSCREEN_WAKE });
    }
    expect(connect).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1500);
    expect(connect).toHaveBeenCalledTimes(2);
  });
});

describe('embedded iframe role', () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let startEmbeddedFrame: typeof import('./offscreen').startEmbeddedFrame;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    postMessageSpy = vi.fn();
    vi.stubGlobal('chrome', {
      runtime: {
        // The module starts its offscreen-document role on import; give it
        // a well-formed port so that path does not throw. This test is
        // about the frame role, started explicitly below.
        connect: vi.fn(() => createPort().port),
        onMessage: { addListener: vi.fn() },
      },
    });
    // jsdom's window is its own parent, so the frame role's
    // `event.source === window.parent` check matches a message dispatched
    // from the window itself.
    Object.defineProperty(window, 'postMessage', {
      configurable: true,
      value: postMessageSpy,
    });
    ({ startEmbeddedFrame } = await import('./offscreen'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = '';
  });

  it('announces itself with the fragment token', () => {
    window.location.hash = '#ocr-frame=token-abc';
    startEmbeddedFrame();

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: OCR_FRAME_READY, token: 'token-abc' },
      '*'
    );
  });

  it('answers a parent job that carries the token', async () => {
    recognizeMock.mockResolvedValue(RESULT);
    window.location.hash = '#ocr-frame=token-abc';
    startEmbeddedFrame();
    postMessageSpy.mockClear();

    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          type: OCR_FRAME_JOB,
          token: 'token-abc',
          requestId: 'frame-1',
          image: 'base64-image',
          options: OPTIONS,
        },
        source: window,
      })
    );
    await tick();

    const result = postMessageSpy.mock.calls[0]?.[0] as OcrFrameResult;
    expect(result.type).toBe(OCR_FRAME_RESULT);
    expect(result.token).toBe('token-abc');
    expect(result.requestId).toBe('frame-1');
    expect(result.response).toEqual({ success: true, result: RESULT });
  });

  it('does nothing without a token, or for a job with the wrong token', async () => {
    window.location.hash = '';
    startEmbeddedFrame();
    expect(postMessageSpy).not.toHaveBeenCalled();

    window.location.hash = '#ocr-frame=token-abc';
    startEmbeddedFrame();
    postMessageSpy.mockClear();

    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          type: OCR_FRAME_JOB,
          token: 'a-different-token',
          requestId: 'frame-2',
          image: 'base64-image',
          options: OPTIONS,
        },
        source: window,
      })
    );
    await tick();

    expect(recognizeMock).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();
  });
});
