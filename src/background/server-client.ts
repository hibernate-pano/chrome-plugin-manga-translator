import type {
  FetchImageBytesResponse,
  TestServerConnectionResponse,
  TranslateImageBytesViaServerRequest,
  TranslateViaServerRequest,
  TranslateViaServerResponse,
} from '@/shared/runtime-contracts';
import { loadRuntimeAppConfig, type ServerConfig } from '@/shared/app-config';
import type { TranslationStylePreset } from '@/utils/translation-style';

interface ImageBytes {
  buffer: ArrayBuffer;
  base64: string;
  mimeType: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bufferCtor = (
    globalThis as {
      Buffer?: {
        from: (
          data: ArrayBuffer
        ) => { toString: (encoding: string) => string };
      };
    }
  ).Buffer;

  if (bufferCtor) {
    return bufferCtor.from(buffer).toString('base64');
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';

  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary);
}

function buildServerHeaders(server: ServerConfig): HeadersInit {
  const headers: HeadersInit = {};

  if (server.authToken.trim()) {
    headers['Authorization'] = `Bearer ${server.authToken.trim()}`;
  }

  return headers;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error('服务端请求超时'));
    }, timeoutMs);

    promise.then(
      value => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      error => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

async function readJsonError(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { detail?: string; error?: string };
    return body.detail ?? body.error ?? null;
  } catch {
    return null;
  }
}

export async function fetchImageBytes(imageUrl: string): Promise<ImageBytes> {
  const response = await fetch(imageUrl, {
    credentials: 'omit',
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`无法获取图片 (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const mimeType = response.headers.get('content-type') || 'image/jpeg';

  return {
    buffer,
    base64: arrayBufferToBase64(buffer),
    mimeType,
  };
}

export async function fetchImageBytesResponse(
  imageUrl: string
): Promise<FetchImageBytesResponse> {
  try {
    const image = await fetchImageBytes(imageUrl);
    return {
      success: true,
      imageBase64: image.base64,
      mimeType: image.mimeType,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : '获取图片失败',
    };
  }
}

export async function testServerConnection(): Promise<TestServerConnectionResponse> {
  const config = await loadRuntimeAppConfig();
  const baseUrl = config.server.baseUrl.trim();

  if (!baseUrl) {
    return {
      success: false,
      message: '请先在设置页填写服务端地址',
    };
  }

  try {
    const response = await withTimeout(
      fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/health`, {
        headers: buildServerHeaders(config.server),
      }),
      config.server.timeoutMs
    );

    if (!response.ok) {
      const detail = await readJsonError(response);
      return {
        success: false,
        message: detail || `服务端返回 ${response.status}`,
      };
    }

    return {
      success: true,
      message: '服务端连接正常',
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : '无法连接到服务端',
    };
  }
}

function guessFileName(mimeType: string): string {
  if (mimeType.includes('png')) {
    return 'page.png';
  }
  if (mimeType.includes('webp')) {
    return 'page.webp';
  }
  return 'page.jpg';
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bufferCtor = (
    globalThis as {
      Buffer?: {
        from: (data: string, encoding: string) => Uint8Array;
      };
    }
  ).Buffer;

  if (bufferCtor) {
    return bufferCtor.from(base64, 'base64');
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function postServerTranslation(args: {
  imageData: BlobPart;
  mimeType: string;
  imageUrl: string;
  sourcePageUrl?: string;
  targetLanguage: string;
  translationStylePreset: TranslationStylePreset;
  forceRefresh?: boolean;
}): Promise<TranslateViaServerResponse> {
  const config = await loadRuntimeAppConfig();
  const baseUrl = config.server.baseUrl.trim();

  if (!baseUrl) {
    return {
      success: false,
      textAreas: [],
      pipeline: 'full-image-fallback',
      cached: false,
      error: '请先在设置页配置服务端地址',
    };
  }

  try {
    const formData = new FormData();

    formData.append(
      'image',
      new Blob([args.imageData], { type: args.mimeType }),
      guessFileName(args.mimeType)
    );
    formData.append('imageKey', args.imageUrl);
    if (args.sourcePageUrl?.trim()) {
      formData.append('sourcePageUrl', args.sourcePageUrl);
    }
    formData.append('targetLanguage', args.targetLanguage);
    formData.append(
      'translationStylePreset',
      args.translationStylePreset
    );
    formData.append('forceRefresh', String(Boolean(args.forceRefresh)));

    const response = await withTimeout(
      fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/translate-image`, {
        method: 'POST',
        body: formData,
        headers: buildServerHeaders(config.server),
      }),
      config.server.timeoutMs
    );

    if (!response.ok) {
      const detail = await readJsonError(response);
      return {
        success: false,
        textAreas: [],
        pipeline: 'full-image-fallback',
        cached: false,
        error: detail || `服务端返回 ${response.status}`,
      };
    }

    const payload = (await response.json()) as Partial<TranslateViaServerResponse>;

    return {
      success: Boolean(payload.success),
      textAreas: payload.textAreas ?? [],
      pipeline: payload.pipeline ?? 'full-image-fallback',
      cached: payload.cached ?? false,
      diagnostics: payload.diagnostics ?? null,
      error: payload.error,
    };
  } catch (error) {
    return {
      success: false,
      textAreas: [],
      pipeline: 'full-image-fallback',
      cached: false,
      error:
        error instanceof Error ? error.message : '服务端翻译失败',
    };
  }
}

export async function translateViaServer(
  request: TranslateViaServerRequest
): Promise<TranslateViaServerResponse> {
  try {
    const image = await fetchImageBytes(request.imageUrl);

    return postServerTranslation({
      imageData: image.buffer,
      mimeType: image.mimeType,
      imageUrl: request.imageUrl,
      sourcePageUrl: request.sourcePageUrl,
      targetLanguage: request.targetLanguage,
      translationStylePreset: request.translationStylePreset,
      forceRefresh: request.forceRefresh,
    });
  } catch (error) {
    return {
      success: false,
      textAreas: [],
      pipeline: 'full-image-fallback',
      cached: false,
      error:
        error instanceof Error ? error.message : '服务端翻译失败',
    };
  }
}

export async function translateImageBytesViaServer(
  request: TranslateImageBytesViaServerRequest
): Promise<TranslateViaServerResponse> {
  const bytes = base64ToUint8Array(request.imageBase64);
  const copiedBytes = new Uint8Array(bytes.byteLength);
  copiedBytes.set(bytes);

  return postServerTranslation({
    imageData: copiedBytes,
    mimeType: request.mimeType,
    imageUrl: request.imageUrl,
    sourcePageUrl: request.sourcePageUrl,
    targetLanguage: request.targetLanguage,
    translationStylePreset: request.translationStylePreset,
    forceRefresh: request.forceRefresh,
  });
}
