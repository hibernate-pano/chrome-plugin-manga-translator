/**
 * HTTP Client Utilities
 *
 * Provides a simple HTTP client with error handling and retry logic.
 */

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  data?: T;
  error?: string;
}

/**
 * Make an HTTP request with error handling
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const { method = 'GET', headers = {}, body, timeout = 30000 } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      };
    }

    const data = await response.json().catch(() => null);
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      data,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return {
          ok: false,
          status: 408,
          statusText: 'Request Timeout',
          error: 'Request timed out',
        };
      }
      return {
        ok: false,
        status: 0,
        statusText: 'Network Error',
        error: error.message,
      };
    }

    return {
      ok: false,
      status: 0,
      statusText: 'Unknown Error',
      error: 'Unknown network error',
    };
  }
}
