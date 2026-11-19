import type { Properties, Storage } from './core/index';
import { KEYS } from './keys';

export const LIFECYCLE_EVENTS = {
  installed: 'pf_app_installed',
  updated: 'pf_app_updated',
  opened: 'pf_app_opened',
} as const;

export async function installOrUpdate(
  storage: Storage,
  firstLaunch: boolean,
  knownDevice: boolean,
  version: string | undefined,
  build: string | undefined
): Promise<{ event: string; properties: Properties } | null> {
  const current = version ?? null;
  let previous: string | null;
  try {
    previous = await storage.get(KEYS.appVersion);
    if (current !== null && previous !== current) {
      await storage.set(KEYS.appVersion, current);
    }
  } catch {
    return null;
  }
  if (firstLaunch && !knownDevice) {
    return {
      event: LIFECYCLE_EVENTS.installed,
      properties: { version: current, build: build ?? null },
    };
  }
  if (current !== null && previous !== null && previous !== current) {
    return {
      event: LIFECYCLE_EVENTS.updated,
      properties: {
        previousVersion: previous,
        version: current,
        build: build ?? null,
      },
    };
  }
  return null;
}

export class Sessions {
  private id: string | undefined;
  private backgroundSince: number | undefined;

  constructor(
    private readonly timeoutMs: number,
    private readonly now: () => number,
    private readonly newId: () => string,
    private readonly onStart: (sessionId: string, coldStart: boolean) => void
  ) {}

  current(): string | undefined {
    return this.id;
  }

  start(): void {
    this.id = this.newId();
    this.backgroundSince = undefined;
    this.onStart(this.id, true);
  }

  background(): void {
    this.backgroundSince ??= this.now();
  }

  foreground(): void {
    const since = this.backgroundSince;
    this.backgroundSince = undefined;
    if (since !== undefined && this.now() - since >= this.timeoutMs) {
      this.id = this.newId();
      this.onStart(this.id, false);
    }
  }
}
