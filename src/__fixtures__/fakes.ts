import { jest } from '@jest/globals';
import type { AsyncStorageLike } from '../client';
import type { PushAdapter, PushNotification } from '../push';
import type { AppStateName, Runtime } from '../runtime';

export class MemoryAsyncStorage implements AsyncStorageLike {
  readonly values = new Map<string, string>();

  async getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  async removeItem(key: string) {
    this.values.delete(key);
  }
}

export interface FakeRuntime extends Runtime {
  opened: string[];
  emit(state: AppStateName): void;
}

export function fakeRuntime(
  os: 'ios' | 'android' = 'android',
  isDev = false
): FakeRuntime {
  const listeners = new Set<(state: AppStateName) => void>();
  const opened: string[] = [];
  return {
    opened,
    emit: (state) => listeners.forEach((listener) => listener(state)),
    info: () => ({
      os,
      osVersion: os === 'ios' ? '18.1' : '14',
      manufacturer: os === 'ios' ? 'Apple' : 'Google',
      model: 'Phone',
      isDev,
    }),
    appState: () => 'active',
    onAppStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openUrl: async (url) => {
      opened.push(url);
    },
    screenSize: () => ({ width: 390, height: 844 }),
    locale: () => 'fa-IR',
    timezone: () => 'Asia/Tehran',
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}

export interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

export function fakeBackend() {
  const calls: Call[] = [];
  const statuses = new Map<string, number[]>();
  let inApp: unknown[] = [];
  const fetchMock = jest.fn(async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;
    const body =
      typeof init.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : null;
    calls.push({ method: init.method ?? 'GET', path, body });
    const prefix = [...statuses.keys()].find((p) => path.startsWith(p));
    const queued = prefix ? statuses.get(prefix)!.shift() : undefined;
    if (queued === 0) throw new TypeError('Network request failed');
    const status =
      queued ??
      (path.startsWith('/v1/sdk/batch')
        ? 202
        : path.startsWith('/v1/sdk/in-app?')
          ? 200
          : 204);
    const payload =
      path.startsWith('/v1/sdk/in-app?') && status === 200
        ? inApp.splice(0)
        : null;
    return { status, json: async () => payload } as unknown as Response;
  });
  return {
    calls,
    fetch: fetchMock as unknown as typeof fetch,
    respond(prefix: string, ...codes: number[]) {
      statuses.set(prefix, [...(statuses.get(prefix) ?? []), ...codes]);
    },
    serveInApp(...messages: unknown[]) {
      inApp = messages;
    },
    to(prefix: string) {
      return calls.filter((call) => call.path.startsWith(prefix));
    },
    events() {
      return calls
        .filter((c) => c.path === '/v1/sdk/batch')
        .flatMap(
          (c) =>
            c.body!.batch as Array<{
              type: string;
              event?: string;
              properties?: Record<string, unknown>;
            }>
        );
    },
  };
}

export interface FakePush extends PushAdapter {
  permission: boolean;
  token: string | null;
  initial: PushNotification | null;
  refreshToken(token: string): void;
  open(notification: PushNotification): void;
  arrive(notification: PushNotification): void;
}

export function fakePush(provider: 'fcm' | 'apns' = 'fcm'): FakePush {
  const tokenListeners = new Set<(token: string) => void>();
  const openListeners = new Set<(n: PushNotification) => void>();
  const foregroundListeners = new Set<(n: PushNotification) => void>();
  const adapter: FakePush = {
    provider,
    permission: false,
    token: null,
    initial: null,
    hasPermission: async () => adapter.permission,
    requestPermission: async () => {
      adapter.permission = true;
      adapter.token ??=
        provider === 'apns' ? 'ab'.repeat(32) : 'fcm-token-' + 'x'.repeat(30);
      return true;
    },
    getToken: async () => adapter.token,
    onTokenRefresh(listener) {
      tokenListeners.add(listener);
      return () => tokenListeners.delete(listener);
    },
    getInitialNotification: async () => adapter.initial,
    onNotificationOpened(listener) {
      openListeners.add(listener);
      return () => openListeners.delete(listener);
    },
    onForegroundNotification(listener) {
      foregroundListeners.add(listener);
      return () => foregroundListeners.delete(listener);
    },
    refreshToken(token) {
      adapter.token = token;
      tokenListeners.forEach((listener) => listener(token));
    },
    open: (n) => openListeners.forEach((listener) => listener(n)),
    arrive: (n) => foregroundListeners.forEach((listener) => listener(n)),
  };
  return adapter;
}

export function pushFlowPush(
  messageId: string,
  link?: string
): PushNotification {
  return {
    title: 'عنوان',
    body: 'متن',
    data: {
      pf_mid: messageId,
      pf_tok: `tok-${messageId}`,
      ...(link ? { pf_link: link } : {}),
    },
  };
}
