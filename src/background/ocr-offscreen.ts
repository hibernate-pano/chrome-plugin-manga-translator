/**
 * Service-worker side of OCR-in-the-extension-origin.
 *
 * The content script cannot create an offscreen document — `chrome.offscreen`
 * only exists in extension contexts — so it asks the service worker over
 * `runtime.sendMessage` and the worker owns the document's lifecycle here.
 *
 * Three Chrome facts shape this module:
 *
 *   1. Only one offscreen document may exist per extension, and Chrome 110
 *      (this extension's floor) has no `hasDocument()` to ask whether one is
 *      already open. `createDocument` rejects with "Only a single offscreen
 *      document may be created." in that case, and that rejection — and only
 *      that one — is the supported way to detect it. Every other rejection
 *      is a real failure and is reported as `transport` so the chain moves
 *      on.
 *
 *      This matters on Chrome 110–112 specifically: the `WORKERS` reason
 *      was only added in Chrome 113, so `reasons: ['WORKERS']` is rejected
 *      there as an invalid value. That is the expected outcome on those
 *      browsers — it means the offscreen path is unavailable, not that the
 *      document is already open — and swallowing it would leave the chain
 *      waiting on a document that was never created.
 *
 *   2. The document is reached over a `runtime.Port`. A `runtime.sendMessage`
 *      broadcast also lands in every content script, and the content script
 *      answers unknown messages with `{success:false}`, racing the real
 *      reply.
 *
 *   3. The service worker can be terminated between jobs, which closes the
 *      port but leaves the document (and its loaded Tesseract worker) alive.
 *      On the next job the worker pokes the document with
 *      `OCR_OFFSCREEN_WAKE`; the document reconnects and the job goes over
 *      the fresh port. If the document never reconnects, the caller falls
 *      back — see `OCR_TRANSPORT_ORDER`.
 *
 * The environment is injected so the create/port/response logic can be
 * tested without a browser; `background.ts` uses the default, which reads
 * the live `chrome` object at call time.
 */

import { getErrorMessage } from '@/utils/error-message';
import {
  OCR_OFFSCREEN_DOCUMENT_PATH,
  OCR_OFFSCREEN_JOB,
  OCR_OFFSCREEN_PORT,
  OCR_OFFSCREEN_REASON,
  OCR_OFFSCREEN_WAKE,
  isOcrOffscreenResult,
  type OcrOffscreenJob,
  type OcrRecognizeRequest,
  type OcrRecognizeResponse,
} from '@/offscreen/ocr-protocol';

/** A failure that means "this path is not available", not "OCR failed". */
export class OcrOffscreenUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrOffscreenUnavailableError';
  }
}

export interface OcrOffscreenEnv {
  /** `chrome.offscreen.createDocument`, or undefined where the API is absent. */
  createDocument?: (
    parameters: chrome.offscreen.CreateParameters
  ) => Promise<void>;
  /** `chrome.runtime.sendMessage`, used only to wake the document. */
  sendMessage?: (message: unknown) => Promise<unknown>;
  addConnectListener: (listener: (port: chrome.runtime.Port) => void) => void;
}

export interface OcrOffscreenTimeouts {
  /** How long to wait for the document to (re)connect after a wake. */
  portWaitMs: number;
  /** How long one recognition may take inside the document. */
  jobMs: number;
}

const DEFAULT_TIMEOUTS: OcrOffscreenTimeouts = {
  // createDocument resolves after the document's initial load, and a
  // reconnect after a service-worker restart needs a round trip; five
  // seconds covers both without making a dead path feel like a hang.
  portWaitMs: 5000,
  // A four-language Tesseract run on a full manga page takes tens of
  // seconds on first use (worker boot, WASM core, four traineddata files).
  jobMs: 180000,
};

interface PendingJob {
  /** The port this job was sent on; a replaced port's jobs die with it. */
  port: chrome.runtime.Port;
  resolve: (response: OcrRecognizeResponse) => void;
}

/**
 * The live Chrome objects, resolved lazily.
 *
 * Resolving at call time (rather than at module evaluation) keeps this
 * module importable in tests and in the service worker's test harness,
 * where `chrome.offscreen` may be absent or added after import.
 */
export function chromeOcrOffscreenEnv(): OcrOffscreenEnv {
  return {
    createDocument: chrome.offscreen
      ? parameters => chrome.offscreen.createDocument(parameters)
      : undefined,
    sendMessage: message => chrome.runtime.sendMessage(message),
    addConnectListener: listener => {
      chrome.runtime.onConnect?.addListener(listener);
    },
  };
}

export class OffscreenOcrClient {
  private port: chrome.runtime.Port | null = null;
  private readonly pending = new Map<string, PendingJob>();
  private portWaiters: Array<(port: chrome.runtime.Port) => void> = [];
  private creating: Promise<void> | null = null;
  private sequence = 0;

  constructor(
    private readonly env: OcrOffscreenEnv = chromeOcrOffscreenEnv(),
    private readonly timeouts: OcrOffscreenTimeouts = DEFAULT_TIMEOUTS
  ) {}

  /** Register the port listener. Call once, when the worker boots. */
  register(): void {
    this.env.addConnectListener(port => {
      if (port.name !== OCR_OFFSCREEN_PORT) return;
      this.attach(port);
    });
  }

  /**
   * Run one recognition in the offscreen document.
   *
   * Never throws: a failure is returned as a `success:false` response so the
   * content script can decide whether to try the next transport.
   */
  async recognize(request: OcrRecognizeRequest): Promise<OcrRecognizeResponse> {
    try {
      await this.ensureDocument();
    } catch (error) {
      return {
        success: false,
        kind:
          error instanceof OcrOffscreenUnavailableError
            ? 'unsupported'
            : 'transport',
        error: getErrorMessage(error),
      };
    }

    let port = this.port;
    if (!port) {
      this.wakeDocument();
      port = await this.waitForPort();
    }
    if (!port) {
      return {
        success: false,
        kind: 'transport',
        error:
          '扩展 origin 的 OCR 文档没有在等待时间内建立连接（offscreen 通道不可用）',
      };
    }
    return this.sendJob(port, request);
  }

  private async ensureDocument(): Promise<void> {
    const createDocument = this.env.createDocument;
    if (!createDocument) {
      throw new OcrOffscreenUnavailableError(
        'chrome.offscreen API 不可用（需要 Chrome 109+，且 manifest 声明 offscreen 权限）'
      );
    }
    if (this.creating) {
      await this.creating;
      return;
    }
    this.creating = (async () => {
      try {
        await createDocument({
          url: OCR_OFFSCREEN_DOCUMENT_PATH,
          reasons: [OCR_OFFSCREEN_REASON as chrome.offscreen.Reason],
          justification:
            '在扩展自己的 origin 中运行 Tesseract OCR worker，使宿主页面的 CSP 无法阻止文字检测。',
        });
      } catch (error) {
        const message = getErrorMessage(error);
        if (/only a single offscreen document may be created/i.test(message)) {
          // Already open — from an earlier job, or from before a
          // service-worker restart. Not an error. This is the only
          // rejection with that meaning; see the note at the top of the
          // file about `WORKERS` on Chrome 110–112.
          return;
        }
        // Logged verbatim: on Chrome 110–112 this is the invalid-reason
        // rejection, and its full text (including the list of reasons that
        // browser does accept) is what explains the fallback to the in-page
        // worker. The error itself is rethrown so the caller reports the
        // path as unavailable instead of waiting on a document that was
        // never created.
        console.warn('[OcrOffscreen] 创建 offscreen 文档失败:', message);
        throw error;
      }
    })();
    try {
      await this.creating;
    } finally {
      this.creating = null;
    }
  }

  /**
   * Ask the (still open, currently port-less) document to reconnect.
   *
   * `sendMessage` may reject when no context answers — that is fine, the
   * document still received the broadcast. The rejection is swallowed
   * because the port wait that follows is the real check.
   */
  private wakeDocument(): void {
    const sendMessage = this.env.sendMessage;
    if (!sendMessage) return;
    void sendMessage({ type: OCR_OFFSCREEN_WAKE }).catch(() => undefined);
  }

  private waitForPort(): Promise<chrome.runtime.Port | null> {
    if (this.port) return Promise.resolve(this.port);
    return new Promise(resolve => {
      let settled = false;
      const waiter = (port: chrome.runtime.Port): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(port);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Drop the waiter as well, otherwise every timed-out request leaves
        // one behind for the lifetime of the worker.
        this.portWaiters = this.portWaiters.filter(entry => entry !== waiter);
        resolve(null);
      }, this.timeouts.portWaitMs);
      this.portWaiters.push(waiter);
    });
  }

  private attach(port: chrome.runtime.Port): void {
    this.port = port;
    port.onMessage.addListener(message => this.handleMessage(port, message));
    port.onDisconnect.addListener(() => {
      if (this.port === port) {
        this.port = null;
      }
      // Only this port's jobs are lost. A replaced port may disconnect after
      // its successor has already taken new jobs, and those must survive.
      this.failPending('offscreen 文档的连接已断开', port);
    });
    const waiters = this.portWaiters.splice(0);
    for (const waiter of waiters) waiter(port);
  }

  private handleMessage(port: chrome.runtime.Port, message: unknown): void {
    if (!isOcrOffscreenResult(message)) return;
    const pending = this.pending.get(message.requestId);
    if (!pending || pending.port !== port) return;
    this.pending.delete(message.requestId);
    pending.resolve(message.response);
  }

  private sendJob(
    port: chrome.runtime.Port,
    request: OcrRecognizeRequest
  ): Promise<OcrRecognizeResponse> {
    this.sequence += 1;
    const requestId = `ocr-${this.sequence}-${Date.now()}`;
    const job: OcrOffscreenJob = {
      type: OCR_OFFSCREEN_JOB,
      requestId,
      image: request.image,
      options: request.options,
    };

    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          success: false,
          kind: 'transport',
          error: `offscreen OCR 超过 ${Math.round(this.timeouts.jobMs / 1000)} 秒没有返回`,
        });
      }, this.timeouts.jobMs);

      this.pending.set(requestId, {
        port,
        resolve: response => {
          clearTimeout(timer);
          resolve(response);
        },
      });

      try {
        port.postMessage(job);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        resolve({
          success: false,
          kind: 'transport',
          error: getErrorMessage(error),
        });
      }
    });
  }

  private failPending(reason: string, port: chrome.runtime.Port): void {
    const lost: PendingJob[] = [];
    for (const [requestId, job] of this.pending) {
      if (job.port !== port) continue;
      this.pending.delete(requestId);
      lost.push(job);
    }
    for (const job of lost) {
      job.resolve({ success: false, kind: 'transport', error: reason });
    }
  }
}
