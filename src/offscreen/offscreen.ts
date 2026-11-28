/**
 * Extension-origin OCR host.
 *
 * This page has exactly one role: it is the extension's offscreen document,
 * opened by `chrome.offscreen.createDocument` and reached by the service
 * worker over a `runtime.Port`. It runs `recognizeWithLocalWorker` with
 * `origin: 'extension'`, so the Tesseract worker is constructed from
 * packaged `chrome-extension://` files on the extension's own origin and the
 * hosting page's CSP has no say in it.
 *
 * It is never embedded in a web page. An extension-origin iframe is still an
 * extension context the host page can reach, and the token that used to
 * scope that channel sat in the frame's URL fragment where page script could
 * read it; that channel was removed rather than repaired.
 *
 * Jobs are serialised. The document can be handed a second job while the
 * first is still recognising — a reader scrolling a chapter — and a
 * Tesseract worker is stateful: a second `recognize` while one is running,
 * or a language change that terminates the worker mid-job, corrupts both
 * answers. One promise chain, one recognition at a time.
 *
 * This page contains no OCR logic of its own and no remote URL. Every asset
 * Tesseract loads (worker, WASM core, language data) is resolved by
 * `text-detector.ts` through `chrome.runtime.getURL`.
 */

import { getErrorMessage } from '@/utils/error-message';
import { recognizeWithLocalWorker } from '@/services/text-detector';
import {
  OCR_OFFSCREEN_PORT,
  OCR_OFFSCREEN_RESULT,
  OCR_OFFSCREEN_WAKE,
  isOcrOffscreenJob,
  type OcrOffscreenJob,
  type OcrOffscreenResult,
  type OcrRecognizeResponse,
  type OcrWireOptions,
} from './ocr-protocol';

/**
 * Run one recognition on this page's origin.
 *
 * Errors are classified as `ocr`, not `transport`: the recogniser ran (or
 * tried to) and failed, so asking the content script to repeat the same work
 * on another transport would just fail again.
 */
async function recognize(
  image: string,
  options: OcrWireOptions
): Promise<OcrRecognizeResponse> {
  try {
    const result = await recognizeWithLocalWorker(image, options, 'extension');
    return { success: true, result };
  } catch (error) {
    return { success: false, kind: 'ocr', error: getErrorMessage(error) };
  }
}

// ==================== Offscreen document role ====================

export function startOffscreenDocument(): void {
  if (typeof chrome.runtime.connect !== 'function') {
    // Nothing to connect to (an older build or a non-extension context).
    // Retrying cannot fix a missing API, so do not leave a timer behind.
    return;
  }

  let port: chrome.runtime.Port | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = (): void => {
    if (port) return;
    let next: chrome.runtime.Port;
    try {
      next = chrome.runtime.connect({ name: OCR_OFFSCREEN_PORT });
    } catch {
      scheduleReconnect();
      return;
    }
    port = next;
    next.onMessage.addListener(message => {
      void handleOffscreenJob(message, next);
    });
    next.onDisconnect.addListener(() => {
      if (port === next) port = null;
      // The service worker can be terminated between jobs; one delayed
      // reconnect wakes it again. The worker also pokes this page with
      // OCR_OFFSCREEN_WAKE when it has a job before the timer fires.
      scheduleReconnect();
    });
  };

  const scheduleReconnect = (): void => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 1000);
  };

  chrome.runtime.onMessage.addListener(message => {
    if (
      typeof message === 'object' &&
      message !== null &&
      (message as { type?: unknown }).type === OCR_OFFSCREEN_WAKE
    ) {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      connect();
    }
    // No response: the wake message carries no work and the reply travels
    // back over the port, not through sendResponse.
  });

  connect();
}

/**
 * The chain every job runs on.
 *
 * One recognition at a time: the worker is stateful, and a second
 * `recognize` (or the language-change teardown that a second job with other
 * options triggers) while the first is running corrupts both answers.
 */
let jobQueue: Promise<void> = Promise.resolve();

function enqueueJob(job: () => Promise<void>): void {
  jobQueue = jobQueue.then(job).catch(error => {
    // A job must not poison the chain for the next one. `runOffscreenJob`
    // turns recogniser failures into a response, so reaching this is a bug —
    // but it still must not wedge every later job behind a rejected promise.
    console.error('[OffscreenOcr] job 队列异常:', getErrorMessage(error));
  });
}

async function handleOffscreenJob(
  message: unknown,
  port: chrome.runtime.Port
): Promise<void> {
  if (!isOcrOffscreenJob(message)) return;
  const job: OcrOffscreenJob = message;
  enqueueJob(() => runOffscreenJob(job, port));
}

async function runOffscreenJob(
  job: OcrOffscreenJob,
  port: chrome.runtime.Port
): Promise<void> {
  const response = await recognize(job.image, job.options);
  const result: OcrOffscreenResult = {
    type: OCR_OFFSCREEN_RESULT,
    requestId: job.requestId,
    response,
  };
  try {
    port.postMessage(result);
  } catch {
    // The port closed while OCR was running (worker terminated or
    // extension reloaded). Nobody is waiting for this answer any more; the
    // caller's timeout resolves it.
  }
}

// ==================== Role selection ====================

// The page has one role now: it is the offscreen document. It is opened by
// `chrome.offscreen.createDocument`, never embedded in a web page.
startOffscreenDocument();
