import type { Storage } from './core/index';
import { backoff, type Http, retryable } from './http';
import { KEYS } from './keys';
import type { Runtime } from './runtime';

export interface DeviceState {
  installationId: string;
  anonymousId: string;
  platform: 'ios' | 'android';
  push: {
    provider: 'fcm' | 'apns';
    token: string | null;
    enabled: boolean;
    sandbox: boolean;
  } | null;
  app: { id?: string; version?: string; build?: string };
  os: { version: string };
  device: { manufacturer?: string; model?: string };
  locale?: string;
  timezone?: string;
  sdkVersion: string;
}

const REFRESH_AFTER = 24 * 60 * 60_000;

export class DeviceRegistrar {
  private latest: DeviceState | undefined;
  private running: Promise<void> | undefined;
  private again = false;
  private failures = 0;
  private retryTimer: unknown;

  constructor(
    private readonly http: Http,
    private readonly storage: Storage,
    private readonly runtime: Pick<
      Runtime,
      'now' | 'setTimeout' | 'clearTimeout'
    >,
    private readonly random: () => number = Math.random,
    private readonly log: (message: string) => void = () => undefined
  ) {}

  sync(state: DeviceState): Promise<void> {
    this.latest = state;
    if (this.running) {
      this.again = true;
      return this.running;
    }
    if (this.retryTimer !== undefined) {
      this.runtime.clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    do {
      this.again = false;
      const state = this.latest;
      if (!state) return;
      const fingerprint = JSON.stringify(state);
      const last = await this.lastRegistration();
      if (
        last &&
        last.fingerprint === fingerprint &&
        this.runtime.now() - last.at < REFRESH_AFTER
      ) {
        continue;
      }
      const response = await this.http.post('/v1/sdk/devices', state);
      if (response.status >= 200 && response.status < 300) {
        this.failures = 0;
        await this.save(fingerprint);
      } else if (retryable(response.status)) {
        this.failures++;
        const delay = backoff(this.failures, this.random);
        this.log(
          `device registration failed (${response.status}); retrying in ${Math.round(delay / 1000)} s`
        );
        this.retryTimer = this.runtime.setTimeout(() => {
          this.retryTimer = undefined;
          if (this.latest) void this.sync(this.latest);
        }, delay);
        return;
      } else {
        this.log(`device registration rejected (${response.status})`);
        await this.save(fingerprint);
      }
    } while (this.again);
  }

  private async lastRegistration(): Promise<{
    fingerprint: string;
    at: number;
  } | null> {
    try {
      const saved = await this.storage.get(KEYS.registration);
      return saved
        ? (JSON.parse(saved) as { fingerprint: string; at: number })
        : null;
    } catch {
      return null;
    }
  }

  private async save(fingerprint: string): Promise<void> {
    try {
      await this.storage.set(
        KEYS.registration,
        JSON.stringify({ fingerprint, at: this.runtime.now() })
      );
    } catch {}
  }
}
