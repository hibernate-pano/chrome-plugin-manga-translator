import type {
  FetchImageBytesResponse,
  TestServerConnectionResponse,
  TranslateViaServerRequest,
  TranslateViaServerResponse,
} from '@/shared/runtime-contracts';
import { loadRuntimeAppConfig, type ServerConfig } from '@/shared/app-config';

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

export async function translateViaServer(
  request: TranslateViaServerRequest
): Promise<TranslateViaServerResponse> {
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
    const image = await fetchImageBytes(request.imageUrl);
    const formData = new FormData();

    formData.append(
      'image',
      new Blob([image.buffer], { type: image.mimeType }),
      guessFileName(image.mimeType)
    );
    formData.append('imageKey', request.imageUrl);
    formData.append('targetLanguage', request.targetLanguage);
    formData.append(
      'translationStylePreset',
      request.translationStylePreset
    );
    formData.append('forceRefresh', String(Boolean(request.forceRefresh)));

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
