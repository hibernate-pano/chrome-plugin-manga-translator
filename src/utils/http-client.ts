/**
 * HTTP Client Utilities
 *
 * Provides a simple HTTP client with error handling and retry logic.
 */

interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
}

interface HttpResponse<T = unknown> {
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

  // The timer lives outside the `try` so that the `finally` below always
  // cancels it. It used to be cleared on the success path only, which left a
  // pending 30 s timer behind every request that threw — a timeout fires the
  // abort on a controller nobody is waiting for, and in a service worker it
  // keeps the worker alive for the length of the timeout.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

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
  } finally {
    clearTimeout(timeoutId);
  }
}
