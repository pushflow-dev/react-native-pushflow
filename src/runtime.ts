export type AppStateName = 'active' | 'background' | 'inactive' | 'unknown';

export interface PlatformInfo {
  os: 'ios' | 'android';
  osVersion: string;
  manufacturer?: string;
  model?: string;
  isDev: boolean;
}

export interface Runtime {
  info(): PlatformInfo;
  appState(): AppStateName;
  onAppStateChange(listener: (state: AppStateName) => void): () => void;
  openUrl(url: string): Promise<void>;
  screenSize(): { width: number; height: number };
  locale(): string | undefined;
  timezone(): string | undefined;
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export function intlLocale(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

export function intlTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}
