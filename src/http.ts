export interface HttpResponse {
  status: number;
  body: unknown;
}

export interface Http {
  get(path: string): Promise<HttpResponse>;
  post(path: string, body: unknown): Promise<HttpResponse>;
}

export function createHttp(
  apiUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  timeoutMs = 15_000
): Http {
  const base = apiUrl.replace(/\/+$/, '');
  const send = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<HttpResponse> => {
    const controller =
      typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
    try {
      const response = await fetchImpl(base + path, {
        method,
        credentials: 'omit',
        headers: {
          'X-PushFlow-Key': apiKey,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(controller ? { signal: controller.signal } : {}),
      });
      let parsed: unknown = null;
      if (response.status !== 204) {
        try {
          parsed = await response.json();
        } catch {
          parsed = null;
        }
      }
      return { status: response.status, body: parsed };
    } catch {
      return { status: 0, body: null };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  return {
    get: (path) => send('GET', path),
    post: (path, body) => send('POST', path, body),
  };
}

export function retryable(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export function backoff(failures: number, random: () => number): number {
  const ceiling = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(failures, 16));
  return Math.max(1_000, Math.floor(random() * ceiling));
}
