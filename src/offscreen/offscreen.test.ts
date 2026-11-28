/**
 * The extension-origin OCR host page.
 *
 * The page has one role: it is the offscreen document. It connects to the
 * worker over a named port, answers jobs on it one at a time, and reconnects
 * when the worker pokes it after a restart. The embedded-iframe role it used
 * to have is gone — these tests also pin that a job arriving over
 * `postMessage` does nothing.
 *
 * The recogniser itself is mocked — `text-detector.test.ts` covers the
 * worker construction, and this file is about the message plumbing and the
 * job queue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OCR_OFFSCREEN_PORT,
  OCR_OFFSCREEN_RESULT,
  OCR_OFFSCREEN_WAKE,
  type OcrOffscreenJob,
  type OcrOffscreenResult,
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

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve = (_value: T): void => undefined;
  let reject = (_error: unknown): void => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

function job(requestId: string): OcrOffscreenJob {
  return {
    type: 'OCR_OFFSCREEN_JOB',
    requestId,
    image: 'base64-image',
    options: OPTIONS,
  };
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

    fake.emit(job('req-1'));
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

    fake.emit(job('req-2'));
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

  it('runs one recognition at a time and answers both jobs in order', async () => {
    // The worker is stateful: a second `recognize` while the first is
    // running corrupts both answers, and a second job with other options
    // would terminate the worker mid-job. Jobs queue instead.
    const first = deferred<typeof RESULT>();
    recognizeMock.mockReturnValueOnce(first.promise);
    recognizeMock.mockResolvedValueOnce(RESULT);
    await loadHost();

    fake.emit(job('req-a'));
    fake.emit(job('req-b'));
    await tick();

    // The second job is queued, not started.
    expect(recognizeMock).toHaveBeenCalledTimes(1);

    first.resolve(RESULT);
    await tick();
    await tick();

    expect(recognizeMock).toHaveBeenCalledTimes(2);
    const requestIds = fake.posted.map(
      entry => (entry as OcrOffscreenResult).requestId
    );
    expect(requestIds).toEqual(['req-a', 'req-b']);
  });

  it('runs the next job after a recogniser failure', async () => {
    recognizeMock.mockRejectedValueOnce(new Error('language pack is missing'));
    recognizeMock.mockResolvedValueOnce(RESULT);
    await loadHost();

    fake.emit(job('req-fail'));
    fake.emit(job('req-ok'));
    await tick();
    await tick();

    const requestIds = fake.posted.map(
      entry => (entry as OcrOffscreenResult).requestId
    );
    expect(requestIds).toEqual(['req-fail', 'req-ok']);
    expect((fake.posted[1] as OcrOffscreenResult).response).toEqual({
      success: true,
      result: RESULT,
    });
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

  it('answers no postMessage job: the page is not an embeddable OCR service', async () => {
    recognizeMock.mockResolvedValue(RESULT);
    // A fragment token used to be enough to drive this document when it was
    // embedded as an iframe. It is not read any more.
    window.location.hash = '#ocr-frame=token-abc';
    await loadHost();

    window.dispatchEvent(
      new window.MessageEvent('message', {
        data: {
          type: 'OCR_FRAME_JOB',
          token: 'token-abc',
          requestId: 'frame-1',
          image: 'base64-image',
          options: OPTIONS,
        },
        source: window,
      })
    );
    await tick();

    expect(recognizeMock).not.toHaveBeenCalled();
    expect(fake.posted).toEqual([]);
    window.location.hash = '';
  });
});
