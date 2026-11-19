import type { Transport } from './types';

export function fetchTransport(
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): Transport {
  return async ({ url, headers, body }) => {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        credentials: 'omit',
        keepalive: body.length < 60_000,
      });
      return response.status;
    } catch {
      return 0;
    }
  };
}
