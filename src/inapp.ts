import { inAppButtons, type InAppMessage } from './core/index';
import type { Http } from './http';

export type { InAppMessage } from './core/index';

export type InAppListener = (message: InAppMessage | null) => void;

export class InAppController {
  private queue: InAppMessage[] = [];
  private showing: InAppMessage | null = null;
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<InAppListener>();
  private lastCheck = Number.NEGATIVE_INFINITY;
  private checking: Promise<void> | undefined;
  private paused = false;
  private templates: string[] = [];

  constructor(
    private readonly http: Http,
    private readonly anonymousId: () => string,
    private readonly platform: 'ios' | 'android',
    private readonly now: () => number,
    private readonly minInterval: number,
    private readonly openLink: (url: string, messageId: string) => void
  ) {}

  current(): InAppMessage | null {
    return this.paused ? null : this.showing;
  }

  subscribe(listener: InAppListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  pause(): void {
    this.paused = true;
    this.emit();
  }

  resume(): void {
    this.paused = false;
    this.emit();
  }

  setTemplates(keys: string[]): void {
    const next = [
      ...new Set(keys.filter((k) => /^[a-z][a-z0-9-]{0,47}$/.test(k))),
    ].sort();
    const added = next.some((k) => !this.templates.includes(k));
    this.templates = next;
    if (!added) return;
    if (this.checking) void this.checking.finally(() => this.check(true));
    else if (this.lastCheck !== Number.NEGATIVE_INFINITY) void this.check(true);
  }

  check(force = false): Promise<void> {
    if (this.checking) return this.checking;
    if (!force && this.now() - this.lastCheck < this.minInterval)
      return Promise.resolve();
    this.lastCheck = this.now();
    this.checking = this.fetch().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  viewed(id: string): void {
    this.report(id, 'viewed');
  }

  clicked(id: string, buttonIndex = 0): void {
    const message = this.showing?.id === id ? this.showing : null;
    const button = message ? inAppButtons(message)[buttonIndex] : undefined;
    if (button?.action === 'dismiss') {
      this.dismissed(id);
      return;
    }
    this.report(id, 'clicked');
    this.advance();
    if (button?.url) this.openLink(button.url, id);
  }

  dismissed(id: string): void {
    this.report(id, 'dismissed');
    this.advance();
  }

  private async fetch(): Promise<void> {
    const anonymousId = this.anonymousId();
    if (!anonymousId) return;
    const templates = this.templates.length
      ? `&templates=${encodeURIComponent(this.templates.join(','))}`
      : '';
    const response = await this.http.get(
      `/v1/sdk/in-app?anonymousId=${encodeURIComponent(anonymousId)}&platform=${this.platform}${templates}`
    );
    if (response.status !== 200 || !Array.isArray(response.body)) return;
    for (const message of response.body as InAppMessage[]) {
      if (
        !message ||
        typeof message.id !== 'string' ||
        this.seen.has(message.id)
      )
        continue;
      this.seen.add(message.id);
      this.queue.push(message);
    }
    if (!this.showing) this.advance();
  }

  private advance(): void {
    this.showing = this.queue.shift() ?? null;
    this.emit();
  }

  private report(id: string, type: 'viewed' | 'clicked' | 'dismissed'): void {
    void this.http.post(`/v1/sdk/in-app/${encodeURIComponent(id)}/events`, {
      anonymousId: this.anonymousId(),
      type,
    });
  }

  private emit(): void {
    const message = this.current();
    for (const listener of this.listeners) listener(message);
  }
}
