import type { Storage } from './core/index';
import { createHttp, type Http, retryable } from './http';
import { KEYS } from './keys';

export interface PushNotification {
  title?: string;
  body?: string;
  data: Record<string, string>;
}

export interface PushAdapter {
  readonly provider: 'fcm' | 'apns';
  hasPermission(): Promise<boolean>;
  requestPermission(): Promise<boolean>;
  getToken(): Promise<string | null>;
  onTokenRefresh?(listener: (token: string) => void): () => void;
  getInitialNotification?(): Promise<PushNotification | null>;
  onNotificationOpened?(
    listener: (notification: PushNotification) => void
  ): () => void;
  onForegroundNotification?(
    listener: (notification: PushNotification) => void
  ): () => void;
}

export interface PushFlowPushData {
  messageId: string;
  token: string;
  link: string | null;
  imageUrl: string | null;
}

export function pushFlowData(
  data: Record<string, unknown> | undefined | null
): PushFlowPushData | null {
  if (
    !data ||
    typeof data.pf_tok !== 'string' ||
    typeof data.pf_mid !== 'string'
  )
    return null;
  return {
    messageId: data.pf_mid,
    token: data.pf_tok,
    link:
      typeof data.pf_link === 'string' && data.pf_link !== ''
        ? data.pf_link
        : null,
    imageUrl:
      typeof data.pf_image === 'string' && data.pf_image !== ''
        ? data.pf_image
        : null,
  };
}

export function stringData(
  data: Record<string, unknown> | undefined | null
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!data) return result;
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    result[key] = typeof value === 'string' ? value : JSON.stringify(value);
  }
  return result;
}

export type PushEventType = 'received' | 'clicked' | 'dismissed';

const MAX_OUTBOX = 50;
const MAX_HANDLED = 100;

export class PushReporter {
  constructor(
    private readonly http: Http,
    private readonly storage: Storage
  ) {}

  async report(token: string, type: PushEventType): Promise<void> {
    const status = (
      await this.http.post('/v1/sdk/push/events', { token, type })
    ).status;
    if (retryable(status)) {
      await this.update((outbox) => [
        ...outbox.filter((e) => e.token !== token || e.type !== type),
        { token, type },
      ]);
    }
  }

  async flush(): Promise<void> {
    const pending = await this.read();
    if (pending.length === 0) return;
    const kept: Array<{ token: string; type: PushEventType }> = [];
    for (const event of pending) {
      const status = (await this.http.post('/v1/sdk/push/events', event))
        .status;
      if (retryable(status)) kept.push(event);
    }
    await this.update((current) => [
      ...kept,
      ...current.filter(
        (e) => !pending.some((p) => p.token === e.token && p.type === e.type)
      ),
    ]);
  }

  private async read(): Promise<Array<{ token: string; type: PushEventType }>> {
    try {
      const saved = await this.storage.get(KEYS.pushOutbox);
      return saved
        ? (JSON.parse(saved) as Array<{ token: string; type: PushEventType }>)
        : [];
    } catch {
      return [];
    }
  }

  private async update(
    change: (
      outbox: Array<{ token: string; type: PushEventType }>
    ) => Array<{ token: string; type: PushEventType }>
  ) {
    try {
      await this.storage.set(
        KEYS.pushOutbox,
        JSON.stringify(change(await this.read()).slice(-MAX_OUTBOX))
      );
    } catch {}
  }
}

export class HandledPushes {
  private cache: string[] | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: Storage) {}

  claim(messageId: string): Promise<boolean> {
    const result = this.queue.then(() => this.claimNow(messageId));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async claimNow(messageId: string): Promise<boolean> {
    const ids = await this.load();
    if (ids.includes(messageId)) return false;
    ids.push(messageId);
    this.cache = ids.slice(-MAX_HANDLED);
    try {
      await this.storage.set(KEYS.handledPushes, JSON.stringify(this.cache));
    } catch {}
    return true;
  }

  private async load(): Promise<string[]> {
    if (this.cache) return this.cache;
    try {
      const saved = await this.storage.get(KEYS.handledPushes);
      this.cache = saved ? (JSON.parse(saved) as string[]) : [];
    } catch {
      this.cache = [];
    }
    return this.cache;
  }
}

export async function reportPushEvent(
  options: { apiKey: string; apiUrl?: string },
  data: Record<string, unknown>,
  type: PushEventType = 'received'
): Promise<boolean> {
  const push = pushFlowData(data);
  if (!push) return false;
  const http = createHttp(
    options.apiUrl ?? 'https://api.pushflow.ir',
    options.apiKey
  );
  await http.post('/v1/sdk/push/events', { token: push.token, type });
  return true;
}
