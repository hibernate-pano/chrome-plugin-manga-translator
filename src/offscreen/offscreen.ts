/**
 * Extension-origin OCR host.
 *
 * One page serves two roles, decided by how it was opened:
 *
 *   - **Offscreen document** (`chrome.offscreen.createDocument`): a hidden
 *     extension page, reached by the service worker over a `runtime.Port`.
 *     This is the primary path.
 *   - **Embedded iframe** on the host page: the fallback for builds or
 *     profiles where the offscreen document cannot be created. It speaks
 *     `postMessage` with a per-session token to the content script that
 *     created it.
 *
 * Both roles run the same Tesseract invocation — `recognizeWithLocalWorker`
 * with `origin: 'extension'` — which is the point: the worker is constructed
 * from packaged `chrome-extension://` files on the extension's own origin,
 * so the hosting page's CSP has no say in it.
 *
 * This page contains no OCR logic of its own and no remote URL. Every asset
 * Tesseract loads (worker, WASM core, language data) is resolved by
 * `text-detector.ts` through `chrome.runtime.getURL`.
 */

import { getErrorMessage } from '@/utils/error-message';
import { recognizeWithLocalWorker } from '@/services/text-detector';
import {
  OCR_FRAME_READY,
  OCR_FRAME_RESULT,
  OCR_OFFSCREEN_PORT,
  OCR_OFFSCREEN_RESULT,
  OCR_OFFSCREEN_WAKE,
  isOcrFrameJob,
  isOcrOffscreenJob,
  type OcrFrameJob,
  type OcrFrameResult,
  type OcrFrameReady,
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

async function handleOffscreenJob(
  message: unknown,
  port: chrome.runtime.Port
): Promise<void> {
  if (!isOcrOffscreenJob(message)) return;
  const job: OcrOffscreenJob = message;
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

// ==================== Embedded iframe role ====================

function readFrameToken(): string {
  const hash = window.location.hash;
  if (!hash.startsWith('#')) return '';
  const params = new URLSearchParams(hash.slice(1));
  return params.get('ocr-frame') ?? '';
}

export function startEmbeddedFrame(): void {
  const token = readFrameToken();
  // A page that embeds this document without the fragment gets a page that
  // does nothing. Without the token it was not opened by our content
  // script, and running OCR for arbitrary embedders would turn the
  // extension into a free OCR service.
  if (!token) return;

  window.addEventListener('message', event => {
    // Only the embedding frame may drive this document, and only with the
    // token from its own fragment (unguessable, generated per session by
    // the content script).
    if (event.source !== window.parent) return;
    if (!isOcrFrameJob(event.data) || event.data.token !== token) return;
    const job: OcrFrameJob = event.data;
    void (async () => {
      const response = await recognize(job.image, job.options);
      const result: OcrFrameResult = {
        type: OCR_FRAME_RESULT,
        token,
        requestId: job.requestId,
        response,
      };
      // The parent's origin is the host page, which this document does not
      // know (and must not trust from `document.referrer`). The token
      // already scopes the reply; `*` only addresses the parent frame.
      window.parent.postMessage(result, '*');
    })();
  });

  const ready: OcrFrameReady = { type: OCR_FRAME_READY, token };
  window.parent.postMessage(ready, '*');
}

// ==================== Role selection ====================

/** `window.top` access can throw in exotic embedding situations. */
function isEmbedded(): boolean {
  try {
    return window.top !== window;
  } catch {
    return true;
  }
}

if (isEmbedded()) {
  startEmbeddedFrame();
} else {
  startOffscreenDocument();
}
