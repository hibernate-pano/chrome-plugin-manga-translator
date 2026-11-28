/**
 * Text Detection Service
 *
 * Uses Tesseract.js to detect text regions in images.
 * This enables sending only cropped text regions to VLM for translation,
 * significantly reducing token usage.
 *
 * The recogniser is not run in the page if it can be avoided. A content
 * script's worker inherits the hosting page's CSP, and a site that ships
 * `worker-src 'none'` (or a `script-src 'self'` with no `blob:`) takes the
 * in-page worker down with it. So detection tries three transports, in
 * order, and the first one that runs wins for the rest of the session:
 *
 *   1. `offscreen` — the service worker's offscreen document, at the
 *      extension's own origin (see `src/offscreen/offscreen.ts`);
 *   2. `extension-frame` — the same page embedded as an iframe, for builds
 *      or profiles where the offscreen document cannot be created;
 *   3. `local` — the original in-page blob worker, so OCR keeps working
 *      where neither extension-origin path is available.
 *
 * Only `transport`/`unsupported` failures advance the chain. An `ocr`
 * failure means the recogniser ran and failed, and would fail identically
 * on the next transport.
 */

import { createWorker } from 'tesseract.js';
import type { Worker } from 'tesseract.js';
import { getErrorMessage } from '@/utils/error-message';
import {
  OCR_FRAME_JOB,
  OCR_FRAME_READY,
  OCR_OFFSCREEN_DOCUMENT_PATH,
  OCR_RECOGNIZE,
  OCR_TRANSPORT_ORDER,
  isOcrFrameResult,
  isOcrRecognizeResponse,
  type OcrFrameJob,
  type OcrRecognizeRequest,
  type OcrTransport,
  type OcrWireOptions,
  type OcrWireResult,
} from '@/offscreen/ocr-protocol';

// ==================== Type Definitions ====================

export interface TextRegion {
  /** X coordinate of top-left corner */
  x: number;
  /** Y coordinate of top-left corner */
  y: number;
  /** Width of the text region */
  width: number;
  /** Height of the text region */
  height: number;
  /** Detected text content */
  text: string;
  /** Confidence score (0-1) */
  confidence: number;
}

export interface TextDetectionResult {
  /** Array of detected text regions */
  regions: TextRegion[];
  /** Original image dimensions */
  imageWidth: number;
  /** Original image dimensions */
  imageHeight: number;
  /** Processing time in milliseconds */
  processingTime: number;
}

interface TextDetectionOptions {
  /** Language codes (e.g., 'jpn', 'eng', 'chi_sim') */
  languages?: string[];
  /** Whether to expand regions for better coverage (0-1 ratio) */
  expandMargin?: number;
  /** Minimum confidence threshold (0-1) */
  minConfidence?: number;
  /** Tesseract Page Segmentation Mode (PSM) */
  psm?: string;
  /**
   * Dimensions of the image being recognised.
   *
   * tesseract.js 7 stopped copying `imageWidth`/`imageHeight` onto the result,
   * so the caller — which already knows them from image processing — supplies
   * them instead of the detector guessing.
   */
  imageWidth?: number;
  imageHeight?: number;
}

/** One recognised word, as tesseract.js reports it. */
interface OcrWord {
  bbox: { x0: number; y0: number; x1: number; y1: number };
  text: string;
  confidence: number;
}

/** The slice of tesseract.js 7's block tree this module reads. */
interface OcrBlock {
  paragraphs?: Array<{ lines?: Array<{ words?: OcrWord[] }> }>;
}

interface OcrData {
  text?: string;
  confidence?: number;
  imageWidth?: number;
  imageHeight?: number;
  /** Legacy tesseract.js (v5 and earlier) flattened words. */
  words?: OcrWord[];
  /** tesseract.js 7 word tree, emitted only when `output.blocks` is true. */
  blocks?: OcrBlock[] | null;
}

// ==================== Configuration ====================

const DEFAULT_OPTIONS: Required<TextDetectionOptions> = {
  // jpn/eng/chi_sim cover the classic manga set; kor is required for the
  // Korean manhwa (webtoon) target audience this extension serves. All four
  // traineddata files ship inside the extension, so the language list costs
  // package size rather than a first-run download.
  languages: ['kor', 'jpn', 'eng', 'chi_sim'],
  expandMargin: 0.05, // Expand by 5% to capture full text
  minConfidence: 0.3,
  psm: '11', // Sparse text: Find as much text as possible in no particular order
  imageWidth: 0,
  imageHeight: 0,
};

// ==================== Cached Worker ====================

/**
 * Which origin the worker is being created from.
 *
 * `page` is the in-page fallback (content script), where Chrome refuses a
 * direct extension-origin worker and the worker is bootstrapped from a
 * blob. `extension` is the offscreen document or embedded iframe, where the
 * packaged worker is same-origin and needs no blob.
 */
export type OcrWorkerOrigin = 'page' | 'extension';

let worker: Worker | null = null;
let workerLanguages: string[] = [];
let workerOrigin: OcrWorkerOrigin | null = null;

/**
 * Get or create a Tesseract worker with specified languages
 */
async function getWorker(
  languages: string[],
  origin: OcrWorkerOrigin
): Promise<Worker> {
  // 排序的是副本，不是调用方的那份数组。
  //
  // `opts.languages` 是 `DEFAULT_OPTIONS.languages` 的同一个对象（展开是
  // 浅拷贝），所以就地排序会把模块级的默认值改掉 —— 第一次调用之后，
  // 全局默认的语言顺序就变了。
  const langKey = [...languages].sort().join('+');

  // Reuse existing worker if languages and origin match
  if (
    worker &&
    workerOrigin === origin &&
    workerLanguages.join('+') === langKey
  ) {
    return worker;
  }

  // Terminate existing worker if languages or the origin changed
  if (worker) {
    await worker.terminate();
    worker = null;
  }

  // Create new worker with local scripts in Chrome Extension env
  const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.getURL;
  const workerOptions: Record<string, unknown> = {
    logger: (m: { status: string; progress: number }) => {
      if (import.meta.env.DEV && m.status === 'recognizing text') {
        console.log(
          `[TextDetector] 识别进度: ${Math.round(m.progress * 100)}%`
        );
      }
    },
  };

  if (isExtension) {
    workerOptions['workerPath'] = chrome.runtime.getURL(
      'tesseract/worker.min.js'
    );
    workerOptions['corePath'] = chrome.runtime.getURL(
      'tesseract/tesseract-core-simd-lstm.wasm.js'
    );
    // The language data ships inside the extension. `scripts/copy-tesseract.js`
    // copies the pinned `@tesseract.js-data` files into `tesseract/lang`, and
    // the worker reads `<langPath>/<lang>.traineddata.gz` from there.
    //
    // This used to be left unset, which made tesseract.js download the data
    // from jsdelivr on first use. That was an undisclosed third-party request
    // in a local-first product, it failed wherever jsdelivr was unreachable,
    // and the library's default URL stayed in the built bundle — the Chrome
    // Web Store's Blue Argon review treats a remotely hosted script as a
    // Manifest V3 violation even when the runtime overrides it. The worker
    // and core defaults are localized the same way: by the build, not by a
    // runtime option that leaves the remote string in the package.
    workerOptions['langPath'] = chrome.runtime.getURL('tesseract/lang');
    // The packaged files are gzipped; pin the flag instead of relying on the
    // library's default.
    workerOptions['gzip'] = true;
    // Chrome refuses a direct `new Worker(chrome-extension://...)` from a
    // content script: the constructor compares the script URL's origin with
    // the page's and reports "cannot be accessed from origin", even though
    // the worker is listed as a web-accessible resource. Bootstrapping the
    // worker from a blob whose only statement is `importScripts(<packaged
    // worker>)` keeps the script local and passes the extension-resource
    // check. Verified end-to-end by
    // evidence/cws-blue-argon/runtime-offline-ocr.mjs.
    //
    // The blob is only needed in the page. On the extension's own origin
    // (offscreen document / embedded iframe) the packaged worker is
    // same-origin, and the extension CSP's `script-src 'self'` does not
    // admit `blob:` anyway — so the direct worker is both allowed and the
    // only thing that works there.
    workerOptions['workerBlobURL'] = origin === 'page';
  }

  worker = await createWorker(langKey, 1, workerOptions);

  workerLanguages = languages;
  workerOrigin = origin;

  if (import.meta.env.DEV) {
    console.log(
      `[TextDetector] Tesseract worker 已初始化, 语言: ${langKey}, origin: ${origin}`
    );
  }

  return worker;
}

/**
 * Run Tesseract on this context's own origin.
 *
 * The offscreen page calls this directly (with `origin: 'extension'`) so it
 * never re-enters the transport chain, and `detectTextRegions` uses it as
 * the last transport.
 */
export async function recognizeWithLocalWorker(
  imageBase64: string,
  options: TextDetectionOptions = {},
  origin: OcrWorkerOrigin = 'page'
): Promise<TextDetectionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = performance.now();

  // Get Tesseract worker
  const tesseractWorker = await getWorker(opts.languages, origin);

  // 配置页面分割模式 (PSM). tesseract.js 的 setParameters 接受 PSM 枚举值。
  await tesseractWorker.setParameters({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tessedit_pageseg_mode: opts.psm as any,
  });

  if (import.meta.env.DEV) {
    console.log(`[TextDetector] 开始检测文字区域 (PSM: ${opts.psm})...`);
  }

  // Recognize text.
  //
  // tesseract.js 7 returns only `text` by default. The word boxes — the
  // whole point of this call — live under
  // `blocks[].paragraphs[].lines[].words`, and are only emitted when
  // `blocks: true` is requested. The old code read a top-level `data.words`
  // that v7 does not produce, so every OCR run returned zero regions and
  // the caller read that as "this page has no text".
  const recognize = tesseractWorker.recognize.bind(tesseractWorker) as (
    image: string,
    options: Record<string, unknown>,
    output: Record<string, unknown>
  ) => Promise<{ data: unknown }>;
  const result = await recognize(imageBase64, {}, { text: true, blocks: true });
  const data = result.data as OcrData;

  const processingTime = performance.now() - startTime;

  const words = collectOcrWords(data);
  if (words === undefined) {
    throw new Error(
      'OCR 输出形状不匹配：既没有 words 也没有 blocks（tesseract.js 版本不受支持）'
    );
  }
  if (words.length === 0 && (data.text ?? '').trim().length > 0) {
    throw new Error('OCR 输出形状不匹配：有文本，但读不出任何词框');
  }

  if (import.meta.env.DEV) {
    console.log(
      `[TextDetector] 检测完成, 耗时: ${processingTime.toFixed(0)}ms, 文字区域数: ${words.length}`
    );
  }

  const regions = convertToRegions(
    words,
    data.confidence ?? 0,
    opts.expandMargin,
    opts.minConfidence
  );

  return {
    regions,
    imageWidth: data.imageWidth ?? opts.imageWidth,
    imageHeight: data.imageHeight ?? opts.imageHeight,
    processingTime,
  };
}

// ==================== Transport chain ====================

/**
 * The transport that worked last, if any.
 *
 * Negotiation is sticky in one direction: a working path is reused, and a
 * path that failed is not retried this session. Re-negotiating per image
 * would pay a failed probe on every page — and the fallbacks exist for
 * environments where a path is missing, not for transient failures.
 */
let activeTransport: OcrTransport | null = null;

/** A failure that means "this path is unavailable", not "OCR failed". */
class OcrTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OcrTransportError';
  }
}

function hasExtensionRuntime(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime?.getURL === 'function' &&
    typeof chrome.runtime?.sendMessage === 'function'
  );
}

function extensionOrigin(): string {
  // `new URL(...).origin` is not usable here: `chrome-extension:` is not a
  // "special" scheme in the URL standard, so a spec-compliant parser (and
  // jsdom, which the tests run on) serialises its origin as "null". Chrome
  // does return the real origin, but the string is available directly and
  // means the same thing everywhere.
  return chrome.runtime.getURL('').replace(/\/$/, '');
}

function isTransportAvailable(transport: OcrTransport): boolean {
  switch (transport) {
    case 'offscreen':
      return hasExtensionRuntime();
    case 'extension-frame':
      return hasExtensionRuntime() && typeof document !== 'undefined';
    case 'local':
      return true;
  }
}

function toWireOptions(
  options: Required<TextDetectionOptions>
): OcrWireOptions {
  return {
    languages: options.languages,
    psm: options.psm,
    expandMargin: options.expandMargin,
    minConfidence: options.minConfidence,
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
  };
}

async function recognizeThroughTransportChain(
  image: string,
  options: OcrWireOptions
): Promise<OcrWireResult> {
  const startIndex = activeTransport
    ? OCR_TRANSPORT_ORDER.indexOf(activeTransport)
    : 0;
  let lastError: unknown = null;

  for (
    let index = Math.max(0, startIndex);
    index < OCR_TRANSPORT_ORDER.length;
    index++
  ) {
    const transport = OCR_TRANSPORT_ORDER[index];
    if (!transport || !isTransportAvailable(transport)) continue;
    try {
      const result = await runTransport(transport, image, options);
      activeTransport = transport;
      return result;
    } catch (error) {
      if (!(error instanceof OcrTransportError)) {
        // The recogniser itself failed. Repeating the same work on the
        // next transport would fail the same way.
        throw error;
      }
      lastError = error;
      if (import.meta.env.DEV) {
        console.warn(
          `[TextDetector] ${transport} 通道不可用，尝试下一条: ${getErrorMessage(error)}`
        );
      }
    }
  }

  throw lastError ?? new Error('没有可用的 OCR 执行通道');
}

function runTransport(
  transport: OcrTransport,
  image: string,
  options: OcrWireOptions
): Promise<OcrWireResult> {
  switch (transport) {
    case 'offscreen':
      return recognizeInOffscreen(image, options);
    case 'extension-frame':
      return recognizeInExtensionFrame(image, options);
    case 'local':
      return recognizeWithLocalWorker(image, options, 'page');
  }
}

/** A four-language run on a manga page can take tens of seconds. */
const OCR_JOB_TIMEOUT_MS = 180000;

/** The iframe's script must announce itself shortly after `src` is set. */
const FRAME_READY_TIMEOUT_MS = 4000;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new OcrTransportError(message));
    }, timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function recognizeInOffscreen(
  image: string,
  options: OcrWireOptions
): Promise<OcrWireResult> {
  const request: OcrRecognizeRequest = {
    type: OCR_RECOGNIZE,
    image,
    options,
  };

  let response: unknown;
  try {
    response = await withTimeout(
      chrome.runtime.sendMessage(request),
      OCR_JOB_TIMEOUT_MS,
      'offscreen OCR 超时'
    );
  } catch (error) {
    throw new OcrTransportError(
      `offscreen 通道不可用: ${getErrorMessage(error)}`
    );
  }

  return unwrapResponse(response, 'offscreen');
}

/**
 * Turn a wire response into a result, or throw the error the response
 * describes. Transport-shaped failures become `OcrTransportError` so the
 * chain moves on; recogniser failures are thrown as they are.
 */
function unwrapResponse(response: unknown, transport: string): OcrWireResult {
  if (!isOcrRecognizeResponse(response)) {
    throw new OcrTransportError(`${transport} 通道返回了无法识别的响应`);
  }
  if (response.success) {
    return response.result;
  }
  if (response.kind === 'ocr') {
    throw new Error(response.error);
  }
  throw new OcrTransportError(response.error);
}

// ---- extension-origin iframe -------------------------------------------

interface FrameSession {
  frame: HTMLIFrameElement;
  token: string;
  origin: string;
  ready: Promise<void>;
  /** Removes the window listener when this session is dropped. */
  detach: () => void;
  pending: Map<
    string,
    {
      resolve: (response: unknown) => void;
      reject: (error: Error) => void;
    }
  >;
}

let frameSession: FrameSession | null = null;
let frameRequestSequence = 0;

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function ensureFrameSession(): FrameSession {
  if (frameSession && frameSession.frame.isConnected) {
    return frameSession;
  }

  const token = randomToken();
  const origin = extensionOrigin();
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.dataset['mangaOcrFrame'] = '';

  let markReady: (() => void) | null = null;
  const ready = new Promise<void>(resolve => {
    markReady = resolve;
  });

  const session: FrameSession = {
    frame,
    token,
    origin,
    ready,
    detach: () => window.removeEventListener('message', onMessage),
    pending: new Map(),
  };

  const onMessage = (event: MessageEvent) => {
    // A message from another frame — or a page script replaying the token —
    // is not ours. The source check is the strongest signal available: the
    // extension origin is not something a web page can forge as an iframe's
    // source.
    if (event.source !== frame.contentWindow) return;
    if (!event.origin || event.origin !== origin) return;
    const data: unknown = event.data;
    if (typeof data !== 'object' || data === null) return;
    const envelope = data as { type?: unknown; token?: unknown };
    if (envelope.token !== token) return;

    if (envelope.type === OCR_FRAME_READY) {
      markReady?.();
      return;
    }
    if (!isOcrFrameResult(data)) return;
    const pending = session.pending.get(data.requestId);
    if (!pending) return;
    session.pending.delete(data.requestId);
    pending.resolve(data.response);
  };

  window.addEventListener('message', onMessage);

  frame.src = `${chrome.runtime.getURL(
    OCR_OFFSCREEN_DOCUMENT_PATH
  )}#ocr-frame=${token}`;
  (document.body ?? document.documentElement).appendChild(frame);

  frameSession = session;
  return session;
}

async function recognizeInExtensionFrame(
  image: string,
  options: OcrWireOptions
): Promise<OcrWireResult> {
  const session = ensureFrameSession();

  try {
    await withTimeout(
      session.ready,
      FRAME_READY_TIMEOUT_MS,
      '扩展 origin iframe 未在限定时间内就绪'
    );
  } catch (error) {
    // A page that blocks the frame (`frame-src`) leaves an iframe that
    // never speaks. Drop it so the next call starts clean.
    dropFrameSession(session);
    throw new OcrTransportError(
      `扩展 origin iframe 不可用: ${getErrorMessage(error)}`
    );
  }

  frameRequestSequence += 1;
  const requestId = `frame-${frameRequestSequence}-${Date.now()}`;
  const job: OcrFrameJob = {
    type: OCR_FRAME_JOB,
    token: session.token,
    requestId,
    image,
    options,
  };

  const response = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(requestId);
      reject(new OcrTransportError('扩展 origin iframe OCR 超时'));
    }, OCR_JOB_TIMEOUT_MS);

    session.pending.set(requestId, {
      resolve: value => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: error => {
        clearTimeout(timer);
        reject(error);
      },
    });

    const target = session.frame.contentWindow;
    if (!target) {
      clearTimeout(timer);
      session.pending.delete(requestId);
      reject(new OcrTransportError('扩展 origin iframe 没有可用窗口'));
      return;
    }
    try {
      target.postMessage(job, session.origin);
    } catch (error) {
      // A bad target origin or a torn-down frame rejects synchronously;
      // clean up its entry and timer instead of leaving them for the
      // timeout.
      clearTimeout(timer);
      session.pending.delete(requestId);
      reject(
        new OcrTransportError(
          `扩展 origin iframe 发送失败: ${getErrorMessage(error)}`
        )
      );
    }
  });

  return unwrapResponse(response, '扩展 origin iframe');
}

function dropFrameSession(session: FrameSession): void {
  if (frameSession === session) {
    frameSession = null;
  }
  for (const pending of session.pending.values()) {
    pending.reject(new OcrTransportError('扩展 origin iframe 已关闭'));
  }
  session.pending.clear();
  session.detach();
  session.frame.remove();
}

// ==================== Core Functions ====================

/**
 * Detect text regions in an image
 *
 * @param imageSource Image source (base64, data URL, or HTMLImageElement)
 * @param options Detection options
 * @returns TextDetectionResult with detected regions
 */
export async function detectTextRegions(
  imageSource: string | HTMLImageElement,
  options: TextDetectionOptions = {}
): Promise<TextDetectionResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = performance.now();

  // Convert image to base64 if needed
  const base64 = await ensureBase64(imageSource);

  try {
    const result = await recognizeThroughTransportChain(
      base64,
      toWireOptions(opts)
    );

    return {
      ...result,
      processingTime: performance.now() - startTime,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error('[TextDetector] 文字检测失败:', errorMessage);
    throw new Error(`文字检测失败: ${errorMessage}`);
  }
}

/**
 * Pull the word boxes out of a recognition result.
 *
 * Returns `undefined` when the result carries neither shape — that is a
 * version mismatch, not "no text", and the caller must not treat it as an
 * empty page. An empty array means the shapes were present and tesseract
 * genuinely found nothing.
 */
function collectOcrWords(data: OcrData): OcrWord[] | undefined {
  if (Array.isArray(data.words)) {
    return data.words;
  }
  if (Array.isArray(data.blocks)) {
    return data.blocks
      .flatMap(block => block.paragraphs ?? [])
      .flatMap(paragraph => paragraph.lines ?? [])
      .flatMap(line => line.words ?? []);
  }
  return undefined;
}

/**
 * Convert Tesseract words to TextRegion format with optional expansion
 */
function convertToRegions(
  words: OcrWord[] | undefined,
  overallConfidence: number,
  expandMargin: number,
  minConfidence: number
): TextRegion[] {
  if (!words || words.length === 0) {
    return [];
  }

  const regions: TextRegion[] = [];

  for (const word of words) {
    if (!word || !word.bbox) continue;

    const confidence = (word.confidence ?? overallConfidence) / 100;

    // Skip low confidence detections
    if (confidence < minConfidence) {
      continue;
    }

    const bbox = word.bbox;
    const x0 = bbox.x0 ?? 0;
    const y0 = bbox.y0 ?? 0;
    const x1 = bbox.x1 ?? x0;
    const y1 = bbox.y1 ?? y0;

    // Expand the region by margin
    const width = x1 - x0;
    const height = y1 - y0;
    const marginX = width * expandMargin;
    const marginY = height * expandMargin;

    regions.push({
      x: Math.max(0, x0 - marginX),
      y: Math.max(0, y0 - marginY),
      width: width + marginX * 2,
      height: height + marginY * 2,
      text: word.text || '',
      confidence,
    });
  }

  return regions;
}

/**
 * Ensure input is base64 string
 */
async function ensureBase64(
  imageSource: string | HTMLImageElement
): Promise<string> {
  if (typeof imageSource === 'string') {
    // Already a string (base64 or URL)
    if (imageSource.startsWith('data:')) {
      return imageSource;
    }
    // Assume it's a base64 string without prefix
    return imageSource;
  }

  // It's an HTMLImageElement, convert to base64
  return imageToBase64(imageSource);
}

/**
 * Convert HTMLImageElement to base64
 */
function imageToBase64(image: HTMLImageElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Merge overlapping text regions into larger blocks
 *
 * This is useful for manga where multiple words in a speech bubble
 * should be treated as one region.
 *
 * @param regions Array of text regions
 * @param overlapThreshold Overlap ratio threshold for merging (0-1)
 * @returns Merged regions
 */
export function mergeOverlappingRegions(
  regions: TextRegion[],
  overlapThreshold: number = 0.3
): TextRegion[] {
  if (regions.length <= 1) {
    return regions;
  }

  const merged: TextRegion[] = [];
  const used = new Set<number>();

  for (let i = 0; i < regions.length; i++) {
    if (used.has(i)) continue;

    const regionI = regions[i];
    if (!regionI) continue;

    let current: TextRegion = {
      x: regionI.x ?? 0,
      y: regionI.y ?? 0,
      width: regionI.width ?? 0,
      height: regionI.height ?? 0,
      text: regionI.text ?? '',
      confidence: regionI.confidence ?? 0,
    };
    used.add(i);

    for (let j = i + 1; j < regions.length; j++) {
      if (used.has(j)) continue;

      const other = regions[j];
      if (!other) continue;

      const overlap = calculateOverlap(current, other);

      if (overlap >= overlapThreshold) {
        // Merge regions
        const minX = Math.min(current.x, other.x);
        const minY = Math.min(current.y, other.y);
        const maxX = Math.max(current.x + current.width, other.x + other.width);
        const maxY = Math.max(
          current.y + current.height,
          other.y + other.height
        );

        current = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          text: `${current.text} ${other.text ?? ''}`,
          confidence: (current.confidence + (other.confidence ?? 0)) / 2,
        };

        used.add(j);
      }
    }

    merged.push(current);
  }

  return merged;
}

/**
 * Calculate overlap ratio between two regions
 */
function calculateOverlap(a: TextRegion, b: TextRegion): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  if (x2 <= x1 || y2 <= y1) {
    return 0;
  }

  const intersection = (x2 - x1) * (y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  const minArea = Math.min(areaA, areaB);

  return intersection / minArea;
}
