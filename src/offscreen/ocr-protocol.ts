/**
 * OCR wire protocol: the contract between the three contexts that take part
 * in text detection.
 *
 * OCR is the one part of the pipeline that can be blocked by the hosting
 * page. Tesseract.js runs in a dedicated worker, and a content script's
 * worker inherits the page's policy — a site that ships
 * `worker-src 'none'` (or a `script-src 'self'` that has no room for
 * `blob:`) takes the detector down with it. So the worker is moved out of
 * the page and into the extension's own origin, where the page's policy
 * does not apply.
 *
 * The contexts and the messages between them:
 *
 *   content script ──OCR_RECOGNIZE──────────────► service worker
 *   service worker ──port OCR_OFFSCREEN_JOB─────► offscreen document
 *   offscreen document ──port OCR_OFFSCREEN_RESULT──► service worker
 *   service worker ──OCR_RECOGNIZE response─────► content script
 *
 * The service worker reaches the offscreen document over a `runtime.Port`,
 * not `runtime.sendMessage`: a runtime message is broadcast to every frame
 * of the extension, content scripts included, and the content script answers
 * unknown messages with `{success:false}` — that reply would race the
 * offscreen document's real one and occasionally win.
 *
 * The second fallback is the same page embedded as an iframe on the host
 * page. It runs at the extension origin too, so its worker is still outside
 * the page's policy (`frame-src` permitting). That path cannot use runtime
 * messaging either — it is an extension page inside a web page — so it
 * speaks `postMessage` with a per-session token:
 *
 *   content script ──OCR_FRAME_JOB────► iframe
 *   iframe ──OCR_FRAME_READY / OCR_FRAME_RESULT──► content script
 *
 * The last resort is the original in-page blob worker, kept so OCR keeps
 * working on Chrome builds where neither extension-origin path is available.
 *
 * Everything in this file is a runtime value or a type with no imports, so
 * the service worker can depend on it without dragging Tesseract (or the
 * content script's store) into its bundle.
 */

/** Page that hosts the extension-origin OCR worker. */
export const OCR_OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

/** Port name the offscreen document connects back with. */
export const OCR_OFFSCREEN_PORT = 'manga-ocr-offscreen';

/** content script → service worker. */
export const OCR_RECOGNIZE = 'OCR_RECOGNIZE';

/** service worker → offscreen document, over the port. */
export const OCR_OFFSCREEN_JOB = 'OCR_OFFSCREEN_JOB';

/** offscreen document → service worker, over the port. */
export const OCR_OFFSCREEN_RESULT = 'OCR_OFFSCREEN_RESULT';

/**
 * service worker → offscreen document, broadcast.
 *
 * The service worker can be terminated between two OCR jobs, which closes
 * the port. There is no "connect to the offscreen document" API, so the
 * worker pokes the document with a runtime message and waits for it to
 * reconnect. The message carries no work; the reply comes over the port.
 */
export const OCR_OFFSCREEN_WAKE = 'OCR_OFFSCREEN_WAKE';

/** iframe → content script: the frame's script is listening. */
export const OCR_FRAME_READY = 'OCR_FRAME_READY';

/** content script → iframe. */
export const OCR_FRAME_JOB = 'OCR_FRAME_JOB';

/** iframe → content script. */
export const OCR_FRAME_RESULT = 'OCR_FRAME_RESULT';

/**
 * Why the offscreen document is being created.
 *
 * `WORKERS` is the reason Chrome documents for "the document needs to spawn
 * workers"; the offscreen API and this reason both exist since Chrome 109,
 * below the extension's minimum of 110. `chrome.offscreen.hasDocument()`
 * and `runtime.getContexts()` arrived in Chrome 116, so nothing here calls
 * them — see `ocr-offscreen.ts` for how "already open" is detected instead.
 */
export const OCR_OFFSCREEN_REASON = 'WORKERS';

/**
 * The fallback chain, in the order it is tried.
 *
 * Exported as a value so a test can pin the order rather than restate it in
 * prose: the ordering is the feature.
 */
export const OCR_TRANSPORT_ORDER = [
  'offscreen',
  'extension-frame',
  'local',
] as const;

export type OcrTransport = (typeof OCR_TRANSPORT_ORDER)[number];

/**
 * `transport` and `unsupported` mean "this path could not run" and the next
 * one should be tried. `ocr` means the path ran and the recogniser itself
 * failed — retrying the same image on the next path would fail the same way,
 * so it is reported instead of swallowed.
 */
export type OcrFailureKind = 'transport' | 'unsupported' | 'ocr';

/** Options that cross a context boundary. Mirrors TextDetectionOptions. */
export interface OcrWireOptions {
  languages: string[];
  psm: string;
  expandMargin: number;
  minConfidence: number;
  imageWidth: number;
  imageHeight: number;
}

/** One recognised word box. Mirrors TextRegion. */
export interface OcrWireRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  confidence: number;
}

/** Mirrors TextDetectionResult. */
export interface OcrWireResult {
  regions: OcrWireRegion[];
  imageWidth: number;
  imageHeight: number;
  processingTime: number;
}

export type OcrRecognizeResponse =
  | { success: true; result: OcrWireResult }
  | { success: false; kind: OcrFailureKind; error: string };

/** content script → service worker. */
export interface OcrRecognizeRequest {
  type: typeof OCR_RECOGNIZE;
  image: string;
  options: OcrWireOptions;
}

/** service worker → offscreen document. */
export interface OcrOffscreenJob {
  type: typeof OCR_OFFSCREEN_JOB;
  requestId: string;
  image: string;
  options: OcrWireOptions;
}

/** offscreen document → service worker. */
export interface OcrOffscreenResult {
  type: typeof OCR_OFFSCREEN_RESULT;
  requestId: string;
  response: OcrRecognizeResponse;
}

/** iframe → content script. */
export interface OcrFrameReady {
  type: typeof OCR_FRAME_READY;
  token: string;
}

/** content script → iframe. */
export interface OcrFrameJob {
  type: typeof OCR_FRAME_JOB;
  token: string;
  requestId: string;
  image: string;
  options: OcrWireOptions;
}

/** iframe → content script. */
export interface OcrFrameResult {
  type: typeof OCR_FRAME_RESULT;
  token: string;
  requestId: string;
  response: OcrRecognizeResponse;
}

// ==================== Runtime validation ====================
//
// Responses and postMessage payloads cross origins, so they are `unknown`
// until checked. Every field the recogniser relies on is verified here; a
// half-shaped payload is a transport failure, not a crash deep inside the
// region conversion.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isOcrWireOptions(value: unknown): value is OcrWireOptions {
  if (!isRecord(value)) return false;
  const languages = value['languages'];
  return (
    Array.isArray(languages) &&
    languages.every(language => typeof language === 'string') &&
    typeof value['psm'] === 'string' &&
    isFiniteNumber(value['expandMargin']) &&
    isFiniteNumber(value['minConfidence']) &&
    isFiniteNumber(value['imageWidth']) &&
    isFiniteNumber(value['imageHeight'])
  );
}

export function isOcrWireResult(value: unknown): value is OcrWireResult {
  if (!isRecord(value)) return false;
  const regions = value['regions'];
  if (!Array.isArray(regions)) return false;
  const regionsValid = regions.every(region => {
    if (!isRecord(region)) return false;
    return (
      isFiniteNumber(region['x']) &&
      isFiniteNumber(region['y']) &&
      isFiniteNumber(region['width']) &&
      isFiniteNumber(region['height']) &&
      typeof region['text'] === 'string' &&
      isFiniteNumber(region['confidence'])
    );
  });
  return (
    regionsValid &&
    isFiniteNumber(value['imageWidth']) &&
    isFiniteNumber(value['imageHeight']) &&
    isFiniteNumber(value['processingTime'])
  );
}

export function isOcrRecognizeResponse(
  value: unknown
): value is OcrRecognizeResponse {
  if (!isRecord(value)) return false;
  if (value['success'] === true) {
    return isOcrWireResult(value['result']);
  }
  if (value['success'] === false) {
    const kind = value['kind'];
    return (
      (kind === 'transport' || kind === 'unsupported' || kind === 'ocr') &&
      typeof value['error'] === 'string'
    );
  }
  return false;
}

export function isOcrRecognizeRequest(
  value: unknown
): value is OcrRecognizeRequest {
  return (
    isRecord(value) &&
    value['type'] === OCR_RECOGNIZE &&
    typeof value['image'] === 'string' &&
    value['image'].length > 0 &&
    isOcrWireOptions(value['options'])
  );
}

export function isOcrOffscreenJob(value: unknown): value is OcrOffscreenJob {
  return (
    isRecord(value) &&
    value['type'] === OCR_OFFSCREEN_JOB &&
    typeof value['requestId'] === 'string' &&
    typeof value['image'] === 'string' &&
    isOcrWireOptions(value['options'])
  );
}

export function isOcrOffscreenResult(
  value: unknown
): value is OcrOffscreenResult {
  return (
    isRecord(value) &&
    value['type'] === OCR_OFFSCREEN_RESULT &&
    typeof value['requestId'] === 'string' &&
    isOcrRecognizeResponse(value['response'])
  );
}

export function isOcrFrameJob(value: unknown): value is OcrFrameJob {
  return (
    isRecord(value) &&
    value['type'] === OCR_FRAME_JOB &&
    typeof value['token'] === 'string' &&
    typeof value['requestId'] === 'string' &&
    typeof value['image'] === 'string' &&
    isOcrWireOptions(value['options'])
  );
}

export function isOcrFrameResult(value: unknown): value is OcrFrameResult {
  return (
    isRecord(value) &&
    value['type'] === OCR_FRAME_RESULT &&
    typeof value['token'] === 'string' &&
    typeof value['requestId'] === 'string' &&
    isOcrRecognizeResponse(value['response'])
  );
}
