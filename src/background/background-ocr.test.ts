/**
 * Wiring test for the OCR route in the service worker.
 *
 * `ocr-offscreen.test.ts` covers the document/port mechanics; this test
 * covers the seam `background.ts` adds: an `OCR_RECOGNIZE` message from a
 * content script reaches the offscreen client and its response is sent back
 * on the same channel. It imports the real worker module against a chrome
 * stub, the way `background-auth.test.ts` does, so the listener that is
 * actually registered is the one under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OCR_OFFSCREEN_PORT,
  OCR_OFFSCREEN_RESULT,
  OCR_RECOGNIZE,
  type OcrOffscreenJob,
} from '@/offscreen/ocr-protocol';

type Listener = (...args: unknown[]) => unknown;

interface ResponseFields {
  success?: boolean;
  kind?: string;
  error?: string;
  result?: unknown;
  received?: boolean;
}

const EXTENSION_ID = 'test-extension-id';

interface Harness {
  onMessage: Listener[];
  onConnect: Listener[];
  createDocument: ReturnType<typeof vi.fn>;
  send: (
    request: unknown,
    sender: Record<string, unknown>
  ) => Promise<ResponseFields>;
  connect: (port: chrome.runtime.Port) => void;
}

function installChromeMock(withOffscreen: boolean): Harness {
  const onMessage: Listener[] = [];
  const onConnect: Listener[] = [];
  const createDocument = vi.fn(async () => undefined);
  const noop = () => undefined;

  const chromeMock: Record<string, unknown> = {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://${EXTENSION_ID}/${path}`,
      sendMessage: vi.fn(async () => undefined),
      onMessage: { addListener: (l: Listener) => onMessage.push(l) },
      onConnect: { addListener: (l: Listener) => onConnect.push(l) },
      onStartup: { addListener: noop },
      onInstalled: { addListener: noop },
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
      sync: {
        get: async () => ({}),
        set: async () => undefined,
        remove: async () => undefined,
      },
      onChanged: { addListener: noop },
    },
    alarms: {
      create: noop,
      clear: noop,
      onAlarm: { addListener: noop },
    },
    commands: {
      onCommand: { addListener: noop },
    },
    contextMenus: {
      create: noop,
      update: noop,
      remove: noop,
      removeAll: noop,
      onClicked: { addListener: noop },
    },
    tabs: {
      query: vi.fn(async () => []),
      sendMessage: vi.fn(async () => undefined),
      onUpdated: { addListener: noop },
    },
  };
  if (withOffscreen) {
    chromeMock['offscreen'] = { createDocument };
  }

  (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;

  return {
    onMessage,
    onConnect,
    createDocument,
    send: (request, sender) =>
      new Promise<ResponseFields>(resolve => {
        for (const listener of onMessage) {
          listener(request, { id: EXTENSION_ID, ...sender }, resolve);
        }
      }),
    connect: port => {
      for (const listener of onConnect) listener(port);
    },
  };
}

function createOffscreenPort(): {
  port: chrome.runtime.Port;
  posted: unknown[];
  emit: (message: unknown) => void;
} {
  const listeners: Array<(message: unknown) => void> = [];
  const posted: unknown[] = [];
  const port = {
    name: OCR_OFFSCREEN_PORT,
    postMessage: (message: unknown) => {
      posted.push(message);
    },
    onMessage: {
      addListener: (listener: (message: unknown) => void) =>
        listeners.push(listener),
    },
    onDisconnect: { addListener: () => undefined },
  } as unknown as chrome.runtime.Port;
  return {
    port,
    posted,
    emit: message => {
      for (const listener of listeners) listener(message);
    },
  };
}

async function loadWorker(): Promise<void> {
  vi.resetModules();
  await import('./background');
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function waitFor<T>(
  probe: () => T | undefined,
  description: string
): Promise<T> {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const value = probe();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${description}`);
}

const OCR_REQUEST = {
  type: OCR_RECOGNIZE,
  image: 'base64-image',
  options: {
    languages: ['jpn', 'eng', 'chi_sim', 'kor'],
    psm: '11',
    expandMargin: 0.05,
    minConfidence: 0.3,
    imageWidth: 640,
    imageHeight: 960,
  },
};

const OCR_RESULT = {
  regions: [
    { x: 10, y: 20, width: 30, height: 40, text: '待って', confidence: 0.8 },
  ],
  imageWidth: 640,
  imageHeight: 960,
  processingTime: 30,
};

describe('service worker OCR routing', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = installChromeMock(true);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('forwards a content-script OCR request to the offscreen port and answers on the message channel', async () => {
    await loadWorker();

    const offscreen = createOffscreenPort();
    harness.connect(offscreen.port);

    const responsePromise = harness.send(OCR_REQUEST, {
      // A content script: our id, but the document belongs to a web page.
      tab: { id: 7, url: 'https://example.com/reader' },
      url: 'https://example.com/reader',
    });

    const job = await waitFor(
      () => offscreen.posted[0] as OcrOffscreenJob | undefined,
      'the offscreen job'
    );
    expect(job.type).toBe('OCR_OFFSCREEN_JOB');
    expect(job.image).toBe('base64-image');
    expect(job.options.languages).toEqual(['jpn', 'eng', 'chi_sim', 'kor']);

    offscreen.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: job.requestId,
      response: { success: true, result: OCR_RESULT },
    });

    await expect(responsePromise).resolves.toEqual({
      success: true,
      result: OCR_RESULT,
    });
  });

  it('answers with an unsupported failure when the offscreen API is missing', async () => {
    harness = installChromeMock(false);
    await loadWorker();

    const response = await harness.send(OCR_REQUEST, {
      tab: { id: 8, url: 'https://example.com/' },
      url: 'https://example.com/',
    });

    expect(response).toMatchObject({ success: false, kind: 'unsupported' });
    expect(JSON.stringify(response)).toContain('chrome.offscreen');
  });

  it('refuses a malformed OCR request without touching the offscreen document', async () => {
    await loadWorker();

    const response = await harness.send(
      { type: OCR_RECOGNIZE, image: '', options: {} },
      { tab: { id: 9, url: 'https://example.com/' } }
    );

    expect(response).toEqual({
      success: false,
      kind: 'transport',
      error: 'OCR 请求格式不正确',
    });
    expect(harness.createDocument).not.toHaveBeenCalled();
  });
});
