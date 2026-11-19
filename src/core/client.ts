import type {
  BaseMessage,
  Message,
  Properties,
  Storage,
  Transport,
} from './types';

type MessageFields = Message extends infer M
  ? M extends Message
    ? Omit<M, keyof BaseMessage>
    : never
  : never;
import { uuid } from './uuid';

export interface ClientOptions {
  apiKey: string;
  apiUrl: string;
  storage: Storage;
  transport: Transport;
  context?: () => Properties;
  flushAt?: number;
  flushInterval?: number;
  maxQueueSize?: number;
  maxBatchSize?: number;
  now?: () => Date;
  random?: () => number;
}

const KEYS = {
  anonymousId: 'pf_anonymous_id',
  userId: 'pf_user_id',
  queue: 'pf_queue',
} as const;

export interface Identity {
  anonymousId: string;
  userId: string | undefined;
}
const MIN_BACKOFF = 1_000;
const MAX_BACKOFF = 5 * 60_000;

export class PushFlowClient {
  private readonly options: Required<Omit<ClientOptions, 'context'>> &
    Pick<ClientOptions, 'context'>;
  private queue: Message[] = [];
  private anonymousId = '';
  private userId: string | undefined;
  private userHash: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private failures = 0;
  private lastTimestamp = 0;
  private batchSize: number;
  private ready: Promise<void>;
  private readonly identityListeners = new Set<(identity: Identity) => void>();

  constructor(options: ClientOptions) {
    this.options = {
      flushAt: 20,
      flushInterval: 5_000,
      maxQueueSize: 1_000,
      maxBatchSize: 100,
      now: () => new Date(),
      random: Math.random,
      ...options,
      apiUrl: options.apiUrl.replace(/\/+$/, ''),
    };
    this.batchSize = this.options.maxBatchSize;
    this.ready = this.load();
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  getAnonymousId(): string {
    return this.anonymousId;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  queued(): number {
    return this.queue.length;
  }

  onIdentityChange(listener: (identity: Identity) => void): () => void {
    this.identityListeners.add(listener);
    return () => this.identityListeners.delete(listener);
  }

  async track(event: string, properties: Properties = {}): Promise<void> {
    if (!event || typeof event !== 'string') {
      throw new TypeError('track() needs an event name');
    }
    await this.enqueue({ type: 'track', event, properties });
  }

  async page(properties: Properties = {}): Promise<void> {
    await this.enqueue({ type: 'page', properties });
  }

  async identify(
    userId?: string | null,
    traits: Properties = {},
    options: { userHash?: string } = {}
  ): Promise<void> {
    await this.ready;
    let changed = false;
    if (userId !== undefined && userId !== null && userId !== '') {
      const id = String(userId);
      changed = this.userId !== id;
      if (changed && this.userId !== undefined) {
        await this.forget();
      }
      this.userId = id;
      this.userHash = options.userHash;
      await this.options.storage.set(
        KEYS.userId,
        JSON.stringify({ id: this.userId, hash: this.userHash })
      );
    }
    await this.enqueue({ type: 'identify', traits });
    if (changed) {
      this.emitIdentity();
    }
  }

  async reset(): Promise<void> {
    await this.ready;
    await this.forget();
    this.emitIdentity();
  }

  private async forget(): Promise<void> {
    this.userId = undefined;
    this.userHash = undefined;
    this.anonymousId = uuid();
    await this.options.storage.remove(KEYS.userId);
    await this.options.storage.set(KEYS.anonymousId, this.anonymousId);
  }

  private emitIdentity(): void {
    const identity: Identity = {
      anonymousId: this.anonymousId,
      userId: this.userId,
    };
    for (const listener of this.identityListeners) {
      try {
        listener(identity);
      } catch {}
    }
  }

  async flush(): Promise<void> {
    await this.ready;
    if (this.flushing) {
      return this.flushing;
    }
    this.flushing = this.drain().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  takeForBeacon(max = 50): { url: string; body: string } | null {
    if (this.queue.length === 0) {
      return null;
    }
    const batch = this.queue.splice(0, max);
    void this.persist();
    return {
      url: `${this.options.apiUrl}/v1/sdk/batch?key=${encodeURIComponent(this.options.apiKey)}`,
      body: JSON.stringify({ batch, sentAt: this.options.now().toISOString() }),
    };
  }

  requeue(body: string): void {
    const parsed = JSON.parse(body) as { batch: Message[] };
    this.queue.unshift(...parsed.batch);
    void this.persist();
  }

  private async load(): Promise<void> {
    const storage = this.options.storage;
    this.anonymousId = (await storage.get(KEYS.anonymousId)) ?? '';
    if (!this.anonymousId) {
      this.anonymousId = uuid();
      await storage.set(KEYS.anonymousId, this.anonymousId);
    }
    const user = await storage.get(KEYS.userId);
    if (user) {
      try {
        const parsed = JSON.parse(user) as { id?: string; hash?: string };
        this.userId = parsed.id;
        this.userHash = parsed.hash;
      } catch {
        this.userId = user;
      }
    }
    const saved = await storage.get(KEYS.queue);
    if (saved) {
      try {
        this.queue = [...(JSON.parse(saved) as Message[]), ...this.queue].slice(
          -this.options.maxQueueSize
        );
      } catch {
        await storage.remove(KEYS.queue);
      }
    }
    if (this.queue.length > 0) {
      this.schedule(0);
    }
  }

  private async enqueue(fields: MessageFields): Promise<void> {
    await this.ready;
    const time = Math.max(this.options.now().getTime(), this.lastTimestamp + 1);
    this.lastTimestamp = time;
    const message: Message = {
      ...fields,
      messageId: uuid(),
      anonymousId: this.anonymousId,
      timestamp: new Date(time).toISOString(),
      context: this.options.context?.() ?? {},
      ...(this.userId ? { userId: this.userId } : {}),
      ...(this.userId && this.userHash ? { userHash: this.userHash } : {}),
    };
    this.queue.push(message);
    if (this.queue.length > this.options.maxQueueSize) {
      this.queue.splice(0, this.queue.length - this.options.maxQueueSize);
    }
    await this.persist();
    if (this.queue.length >= this.options.flushAt) {
      void this.flush();
    } else {
      this.schedule(this.options.flushInterval);
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.batchSize);
      const status = await this.options.transport({
        url: `${this.options.apiUrl}/v1/sdk/batch`,
        headers: {
          'Content-Type': 'application/json',
          'X-PushFlow-Key': this.options.apiKey,
        },
        body: JSON.stringify({
          batch,
          sentAt: this.options.now().toISOString(),
        }),
      });
      if (status >= 200 && status < 300) {
        this.remove(batch);
        this.failures = 0;
        this.batchSize = this.options.maxBatchSize;
        continue;
      }
      if (status === 413 && batch.length > 1) {
        this.batchSize = Math.max(1, Math.floor(batch.length / 2));
        continue;
      }
      if (status === 0 || status === 408 || status === 429 || status >= 500) {
        this.failures++;
        this.schedule(this.backoff());
        return;
      }
      this.remove(batch);
    }
    await this.persist();
  }

  private remove(batch: Message[]): void {
    const sent = new Set(batch.map((m) => m.messageId));
    this.queue = this.queue.filter((m) => !sent.has(m.messageId));
    void this.persist();
  }

  private backoff(): number {
    const ceiling = Math.min(
      MAX_BACKOFF,
      MIN_BACKOFF * 2 ** Math.min(this.failures, 16)
    );
    return Math.max(MIN_BACKOFF, Math.floor(this.options.random() * ceiling));
  }

  private schedule(delay: number): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  private async persist(): Promise<void> {
    try {
      await this.options.storage.set(KEYS.queue, JSON.stringify(this.queue));
    } catch {}
  }
}
