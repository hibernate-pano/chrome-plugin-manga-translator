/**
 * The service worker's side of OCR-in-the-extension-origin.
 *
 * These tests drive the real client against a fake `chrome` surface: a
 * createDocument spy and a hand-driven port. They pin the parts that are
 * easy to get subtly wrong on Chrome 110 — "already open" detection without
 * `hasDocument()`, the wake-then-wait path after a service-worker restart,
 * and the difference between "this path is unavailable" and "OCR failed".
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chromeOcrOffscreenEnv,
  OffscreenOcrClient,
  type OcrOffscreenEnv,
} from './ocr-offscreen';
import {
  OCR_OFFSCREEN_PORT,
  OCR_OFFSCREEN_RESULT,
  OCR_OFFSCREEN_WAKE,
  OCR_RECOGNIZE,
  type OcrOffscreenJob,
  type OcrRecognizeRequest,
} from '@/offscreen/ocr-protocol';

const RESULT = {
  regions: [
    { x: 1, y: 2, width: 3, height: 4, text: 'こんにちは', confidence: 0.9 },
  ],
  imageWidth: 640,
  imageHeight: 960,
  processingTime: 25,
};

function makeRequest(): OcrRecognizeRequest {
  return {
    type: OCR_RECOGNIZE,
    image: 'base64-image',
    options: {
      languages: ['jpn', 'eng'],
      psm: '11',
      expandMargin: 0.05,
      minConfidence: 0.3,
      imageWidth: 640,
      imageHeight: 960,
    },
  };
}

interface FakePort {
  port: chrome.runtime.Port;
  posted: unknown[];
  emit: (message: unknown) => void;
  disconnect: () => void;
}

function createPort(name = OCR_OFFSCREEN_PORT): FakePort {
  const messageListeners: Array<(message: unknown) => void> = [];
  const disconnectListeners: Array<() => void> = [];
  const posted: unknown[] = [];

  const port = {
    name,
    postMessage: (message: unknown) => {
      posted.push(message);
    },
    onMessage: {
      addListener: (listener: (message: unknown) => void) => {
        messageListeners.push(listener);
      },
    },
    onDisconnect: {
      addListener: (listener: () => void) => {
        disconnectListeners.push(listener);
      },
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

interface EnvHarness {
  env: OcrOffscreenEnv;
  createDocument: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  connect: (port: chrome.runtime.Port) => void;
}

function createEnv(overrides: Partial<OcrOffscreenEnv> = {}): EnvHarness {
  const listeners: Array<(port: chrome.runtime.Port) => void> = [];
  const createDocument = vi.fn(async () => undefined);
  const sendMessage = vi.fn(async (_message: unknown) => undefined);
  const env: OcrOffscreenEnv = {
    createDocument,
    sendMessage,
    addConnectListener: listener => {
      listeners.push(listener);
    },
    ...overrides,
  };
  return {
    env,
    createDocument,
    sendMessage,
    connect: port => {
      for (const listener of listeners) listener(port);
    },
  };
}

async function tick(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('OffscreenOcrClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates the document with the WORKERS reason and runs the job over the port', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 200,
      jobMs: 1000,
    });
    client.register();
    const fake = createPort();
    harness.connect(fake.port);

    const pending = client.recognize(makeRequest());
    await tick();

    expect(harness.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'offscreen.html',
        reasons: ['WORKERS'],
      })
    );

    const job = fake.posted[0] as OcrOffscreenJob;
    expect(job.type).toBe('OCR_OFFSCREEN_JOB');
    expect(job.image).toBe('base64-image');
    expect(job.options.languages).toEqual(['jpn', 'eng']);

    fake.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: job.requestId,
      response: { success: true, result: RESULT },
    });

    await expect(pending).resolves.toEqual({ success: true, result: RESULT });
  });

  it('reports the path as unsupported when chrome.offscreen is absent', async () => {
    const harness = createEnv({ createDocument: undefined });
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 20,
      jobMs: 100,
    });
    client.register();

    const response = await client.recognize(makeRequest());

    expect(response).toMatchObject({ success: false, kind: 'unsupported' });
    expect(JSON.stringify(response)).toContain('chrome.offscreen');
  });

  it('treats "Only a single offscreen document may be created" as already open', async () => {
    // Chrome 110 has no hasDocument(); this rejection is the supported way
    // to detect an existing document.
    const createDocument = vi.fn(async () => {
      throw new Error('Only a single offscreen document may be created.');
    });
    const harness = createEnv({ createDocument });
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 200,
      jobMs: 1000,
    });
    client.register();
    const fake = createPort();
    harness.connect(fake.port);

    const pending = client.recognize(makeRequest());
    await tick();
    const job = fake.posted[0] as OcrOffscreenJob;
    fake.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: job.requestId,
      response: { success: true, result: RESULT },
    });

    await expect(pending).resolves.toEqual({ success: true, result: RESULT });
  });

  it('reports the Chrome 110–112 invalid WORKERS reason as a transport failure', async () => {
    // Verbatim from Chromium 110.0.5481.38. The WORKERS reason was added in
    // Chrome 113, so on 110–112 createDocument rejects with the list of
    // reasons that browser does accept. That is the offscreen path being
    // unavailable — it must fall through to the in-page worker, never be
    // read as "the document is already open" (which would leave the caller
    // waiting on a document that was never created).
    const rejection =
      "Error in invocation of offscreen.createDocument(offscreen.CreateParameters parameters, function callback): Error at parameter 'parameters': Error at property 'reasons': Error at index 0: Value must be one of AUDIO_PLAYBACK, BLOBS, CLIPBOARD, DISPLAY_MEDIA, DOM_PARSER, DOM_SCRAPING, IFRAME_SCRIPTING, TESTING, USER_MEDIA, WEB_RTC.";
    const createDocument = vi.fn(async () => {
      throw new TypeError(rejection);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createEnv({ createDocument });
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 20,
      jobMs: 100,
    });
    client.register();

    const response = await client.recognize(makeRequest());

    expect(response).toEqual({
      success: false,
      kind: 'transport',
      error: rejection,
    });
    // The rejection is logged verbatim so the degradation is diagnosable.
    expect(warn).toHaveBeenCalledWith(
      '[OcrOffscreen] 创建 offscreen 文档失败:',
      rejection
    );
    // It never waited for, or poked, a document it did not create.
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });

  it('reports a real createDocument failure as a transport failure', async () => {
    const harness = createEnv({
      createDocument: vi.fn(async () => {
        throw new Error('no permission');
      }),
    });
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 20,
      jobMs: 100,
    });
    client.register();

    const response = await client.recognize(makeRequest());

    expect(response).toEqual({
      success: false,
      kind: 'transport',
      error: 'no permission',
    });
  });

  it('wakes the document and waits for its port when the worker restarted', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 500,
      jobMs: 1000,
    });
    client.register();

    const pending = client.recognize(makeRequest());
    await tick();

    expect(harness.sendMessage).toHaveBeenCalledWith({
      type: OCR_OFFSCREEN_WAKE,
    });

    const fake = createPort();
    harness.connect(fake.port);
    await tick();
    const job = fake.posted[0] as OcrOffscreenJob;
    fake.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: job.requestId,
      response: { success: true, result: RESULT },
    });

    await expect(pending).resolves.toEqual({ success: true, result: RESULT });
  });

  it('reports a transport failure when the document never reconnects', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 20,
      jobMs: 100,
    });
    client.register();

    const response = await client.recognize(makeRequest());

    expect(response).toMatchObject({ success: false, kind: 'transport' });
    expect(JSON.stringify(response)).toContain('没有在等待时间内建立连接');
  });

  it('fails an in-flight job when the port disconnects', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 200,
      jobMs: 5000,
    });
    client.register();
    const fake = createPort();
    harness.connect(fake.port);

    const pending = client.recognize(makeRequest());
    await tick();
    fake.disconnect();

    const response = await pending;
    expect(response).toMatchObject({ success: false, kind: 'transport' });
    expect(JSON.stringify(response)).toContain('连接已断开');
  });

  it('keeps a job on the new port alive when a replaced port disconnects', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 200,
      jobMs: 1000,
    });
    client.register();

    const replaced = createPort();
    harness.connect(replaced.port);
    const current = createPort();
    harness.connect(current.port);

    // The job goes out on the current port; the replaced one disconnects
    // afterwards. Chrome does not order a reload's old disconnect before the
    // new connection, so that late event must only drop the replaced port's
    // own jobs.
    const pending = client.recognize(makeRequest());
    await tick();
    replaced.disconnect();

    const job = current.posted[0] as OcrOffscreenJob;
    current.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: job.requestId,
      response: { success: true, result: RESULT },
    });

    await expect(pending).resolves.toEqual({ success: true, result: RESULT });
  });

  it('times out a job the document never answers', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 200,
      jobMs: 20,
    });
    client.register();
    const fake = createPort();
    harness.connect(fake.port);

    const response = await client.recognize(makeRequest());

    expect(response).toMatchObject({ success: false, kind: 'transport' });
    expect(JSON.stringify(response)).toContain('没有返回');
  });

  it('passes an OCR failure through unchanged so the caller does not retry it', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 200,
      jobMs: 1000,
    });
    client.register();
    const fake = createPort();
    harness.connect(fake.port);

    const pending = client.recognize(makeRequest());
    await tick();
    const job = fake.posted[0] as OcrOffscreenJob;
    fake.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: job.requestId,
      response: {
        success: false,
        kind: 'ocr',
        error: 'language data is missing',
      },
    });

    await expect(pending).resolves.toEqual({
      success: false,
      kind: 'ocr',
      error: 'language data is missing',
    });
  });

  it('ignores unrelated ports, malformed messages and stale request ids', async () => {
    const harness = createEnv();
    const client = new OffscreenOcrClient(harness.env, {
      portWaitMs: 200,
      jobMs: 1000,
    });
    client.register();

    const otherPort = createPort('some-other-feature');
    harness.connect(otherPort.port);
    expect(harness.createDocument).not.toHaveBeenCalled();

    const fake = createPort();
    harness.connect(fake.port);
    const pending = client.recognize(makeRequest());
    await tick();

    fake.emit({ type: OCR_OFFSCREEN_RESULT, requestId: 'not-a-job' });
    fake.emit('garbage');
    fake.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: 'not-a-job',
      response: { success: true, result: RESULT },
    });

    const job = fake.posted[0] as OcrOffscreenJob;
    fake.emit({
      type: OCR_OFFSCREEN_RESULT,
      requestId: job.requestId,
      response: { success: true, result: RESULT },
    });
    await expect(pending).resolves.toEqual({ success: true, result: RESULT });
  });

  it('resolves the live chrome objects lazily', async () => {
    const createDocument = vi.fn(async () => undefined);
    const addListener = vi.fn();
    vi.stubGlobal('chrome', {
      offscreen: { createDocument },
      runtime: {
        sendMessage: vi.fn(async () => undefined),
        onConnect: { addListener },
      },
    });

    const env = chromeOcrOffscreenEnv();
    expect(typeof env.createDocument).toBe('function');
    const listener = () => undefined;
    env.addConnectListener(listener);
    expect(addListener).toHaveBeenCalledWith(listener);
  });
});
