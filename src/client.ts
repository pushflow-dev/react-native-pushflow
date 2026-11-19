import {
  fetchTransport,
  type Identity,
  type Properties,
  type Storage,
  uuid,
  PushFlowClient,
} from './core/index';
import { DeviceRegistrar, type DeviceState } from './devices';
import { createHttp } from './http';
import { InAppController } from './inapp';
import { KEYS } from './keys';
import { installOrUpdate, LIFECYCLE_EVENTS, Sessions } from './lifecycle';
import {
  HandledPushes,
  type PushAdapter,
  type PushNotification,
  PushReporter,
  pushFlowData,
} from './push';
import type { AppStateName, Runtime } from './runtime';
import { SDK_VERSION } from './version';

export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface LinkSource {
  type: 'push' | 'in_app';
  messageId: string;
}

export interface PushFlowOptions {
  apiKey: string;
  apiUrl?: string;
  storage: AsyncStorageLike;
  app?: { id?: string; version?: string; build?: string };
  device?: { manufacturer?: string; model?: string };
  push?: PushAdapter;
  apnsEnvironment?: 'sandbox' | 'production';
  onDeepLink?: (url: string, source: LinkSource) => void;
  onNotificationOpened?: (notification: PushNotification) => void;
  onForegroundNotification?: (notification: PushNotification) => void;
  trackLifecycle?: boolean;
  sessionTimeout?: number;
  inApp?: boolean | { minInterval?: number };
  context?: Properties;
  flushAt?: number;
  flushInterval?: number;
  debug?: boolean;
}

export interface PushFlowNative {
  track(event: string, properties?: Properties): Promise<void>;
  screen(name: string, properties?: Properties): Promise<void>;
  identify(
    userId?: string | null,
    traits?: Properties,
    options?: { userHash?: string }
  ): Promise<void>;
  reset(): Promise<void>;
  flush(): Promise<void>;
  getAnonymousId(): string;
  getInstallationId(): string;
  whenReady(): Promise<void>;
  requestPushPermission(): Promise<boolean>;
  refreshPush(): Promise<void>;
  handleNotification(
    notification: PushNotification,
    event: 'received' | 'clicked'
  ): Promise<boolean>;
  getInitialLink(): Promise<string | null>;
  onLink(listener: (url: string, source: LinkSource) => void): () => void;
  readonly inApp: InAppController;
  shutdown(): void;
}

const INITIAL_LINK_GRACE = 1_500;

export function createClient(
  options: PushFlowOptions,
  runtime: Runtime
): PushFlowNative {
  const apiUrl = (options.apiUrl ?? 'https://api.pushflow.ir').replace(
    /\/+$/,
    ''
  );
  const log = (message: string) => {
    if (options.debug) console.warn(`[PushFlow] ${message}`);
  };
  let knownDevice: boolean | undefined;
  const storage: Storage = {
    get: async (key) => {
      const value = await options.storage.getItem(key);
      if (key === KEYS.anonymousId && knownDevice === undefined)
        knownDevice = value !== null;
      return value;
    },
    set: (key, value) => options.storage.setItem(key, value),
    remove: (key) => options.storage.removeItem(key),
  };
  const info = runtime.info();
  let installationId = '';
  let sessions: Sessions | undefined;
  const staticContext: Properties = {
    library: { name: 'pushflow-react-native', version: SDK_VERSION },
    app: { ...(options.app ?? {}) },
    os: {
      name: info.os === 'ios' ? 'iOS' : 'Android',
      version: info.osVersion,
    },
    device: {
      type: info.os,
      ...((options.device?.manufacturer ?? info.manufacturer)
        ? { manufacturer: options.device?.manufacturer ?? info.manufacturer }
        : {}),
      ...((options.device?.model ?? info.model)
        ? { model: options.device?.model ?? info.model }
        : {}),
    },
    ...(runtime.locale() ? { locale: runtime.locale() } : {}),
    ...(runtime.timezone() ? { timezone: runtime.timezone() } : {}),
    ...options.context,
  };
  const client = new PushFlowClient({
    apiKey: options.apiKey,
    apiUrl,
    storage,
    transport: fetchTransport(),
    context: () => ({
      ...staticContext,
      device: {
        ...(staticContext.device as Record<string, string>),
        ...(installationId ? { id: installationId } : {}),
      },
      screen: runtime.screenSize(),
      ...(sessions?.current() ? { sessionId: sessions.current() } : {}),
    }),
    ...(options.flushAt ? { flushAt: options.flushAt } : {}),
    ...(options.flushInterval ? { flushInterval: options.flushInterval } : {}),
  });
  const http = createHttp(apiUrl, options.apiKey);
  const registrar = new DeviceRegistrar(
    http,
    storage,
    runtime,
    Math.random,
    log
  );
  const reporter = new PushReporter(http, storage);
  const handled = new HandledPushes(storage);
  const push = options.push;
  const sandbox =
    (options.apnsEnvironment ?? (info.isDev ? 'sandbox' : 'production')) ===
    'sandbox';
  let pushState: { token: string | null; enabled: boolean } = {
    token: null,
    enabled: false,
  };
  const linkListeners = new Set<(url: string, source: LinkSource) => void>();
  const cleanups: Array<() => void> = [];
  let initialLink: { url: string; source: LinkSource } | null = null;
  let initialLinkClaimed = false;
  let initialNotificationRead: Promise<void> = Promise.resolve();

  const openLink = (url: string, source: LinkSource) => {
    try {
      if (options.onDeepLink) {
        options.onDeepLink(url, source);
      } else if (linkListeners.size > 0) {
        for (const listener of linkListeners) listener(url, source);
      } else {
        runtime.openUrl(url).catch(() => log(`could not open ${url}`));
      }
    } catch {
      log(`deep link handler failed for ${url}`);
    }
  };

  const inAppOptions = typeof options.inApp === 'object' ? options.inApp : {};
  const inApp = new InAppController(
    http,
    () => client.getAnonymousId(),
    info.os,
    runtime.now,
    inAppOptions.minInterval ?? 30_000,
    (url, messageId) => openLink(url, { type: 'in_app', messageId })
  );
  const inAppEnabled = options.inApp !== false;

  const deviceState = (): DeviceState => ({
    installationId,
    anonymousId: client.getAnonymousId(),
    platform: info.os,
    push: push
      ? {
          provider: push.provider,
          token: pushState.token,
          enabled: pushState.enabled,
          sandbox,
        }
      : null,
    app: { ...(options.app ?? {}) },
    os: { version: info.osVersion },
    device: {
      ...((options.device?.manufacturer ?? info.manufacturer)
        ? { manufacturer: options.device?.manufacturer ?? info.manufacturer }
        : {}),
      ...((options.device?.model ?? info.model)
        ? { model: options.device?.model ?? info.model }
        : {}),
    },
    ...(runtime.locale() ? { locale: runtime.locale() } : {}),
    ...(runtime.timezone() ? { timezone: runtime.timezone() } : {}),
    sdkVersion: SDK_VERSION,
  });
  const register = () =>
    installationId ? registrar.sync(deviceState()) : Promise.resolve();

  const readPushState = async () => {
    if (!push) return;
    const enabled = await push.hasPermission();
    const token = await push.getToken();
    pushState = { token, enabled };
  };

  const processPush = async (
    notification: PushNotification,
    event: 'received' | 'clicked'
  ) => {
    const data = pushFlowData(notification.data);
    if (!data) return 'foreign';
    if (event === 'received') {
      await reporter.report(data.token, 'received');
      return 'handled';
    }
    if (!(await handled.claim(data.messageId))) return 'duplicate';
    await reporter.report(data.token, 'clicked');
    if (data.link)
      openLink(data.link, { type: 'push', messageId: data.messageId });
    return 'handled';
  };
  const handleNotification = async (
    notification: PushNotification,
    event: 'received' | 'clicked'
  ) => (await processPush(notification, event)) !== 'foreign';

  const opened = async (notification: PushNotification) => {
    if ((await processPush(notification, 'clicked')) !== 'duplicate')
      options.onNotificationOpened?.(notification);
  };

  const onAppState = (state: AppStateName) => {
    if (state === 'background') {
      sessions?.background();
      void client.flush();
    } else if (state === 'active') {
      sessions?.foreground();
      void readPushState()
        .then(register)
        .catch(() => undefined);
      void reporter.flush();
      if (inAppEnabled) void inApp.check();
    }
  };

  const ready = (async () => {
    await client.whenReady();
    let firstLaunch = false;
    try {
      installationId = (await storage.get(KEYS.installationId)) ?? '';
      if (!installationId) {
        firstLaunch = true;
        installationId = uuid();
        await storage.set(KEYS.installationId, installationId);
      }
    } catch {
      installationId ||= uuid();
    }
    if (options.trackLifecycle !== false) {
      const change = await installOrUpdate(
        storage,
        firstLaunch,
        knownDevice === true,
        options.app?.version,
        options.app?.build
      );
      if (change) await client.track(change.event, change.properties);
      sessions = new Sessions(
        options.sessionTimeout ?? 30 * 60_000,
        runtime.now,
        uuid,
        (sessionId, coldStart) => {
          void client.track(LIFECYCLE_EVENTS.opened, { coldStart, sessionId });
        }
      );
      sessions.start();
    }
    cleanups.push(runtime.onAppStateChange(onAppState));
    cleanups.push(
      client.onIdentityChange((_identity: Identity) => void register())
    );
    if (push) {
      if (push.onTokenRefresh) {
        cleanups.push(
          push.onTokenRefresh((token) => {
            pushState = { ...pushState, token };
            void register();
          })
        );
      }
      if (push.onNotificationOpened)
        cleanups.push(push.onNotificationOpened((n) => void opened(n)));
      if (push.onForegroundNotification) {
        cleanups.push(
          push.onForegroundNotification((n) => {
            void handleNotification(n, 'received');
            options.onForegroundNotification?.(n);
          })
        );
      }
      initialNotificationRead = (async () => {
        const initial = await push.getInitialNotification?.().catch(() => null);
        const data = initial ? pushFlowData(initial.data) : null;
        if (!initial) return;
        if (data) {
          if (!(await handled.claim(data.messageId))) return;
          await reporter.report(data.token, 'clicked');
          if (data.link)
            initialLink = {
              url: data.link,
              source: { type: 'push', messageId: data.messageId },
            };
        }
        options.onNotificationOpened?.(initial);
      })();
      await readPushState().catch(() => undefined);
    }
    await register();
    void reporter.flush();
    if (inAppEnabled && runtime.appState() !== 'background')
      void inApp.check(true);
    await initialNotificationRead;
    if (initialLink) {
      runtime.setTimeout(() => {
        if (initialLink && !initialLinkClaimed)
          openLink(initialLink.url, initialLink.source);
        initialLink = null;
      }, INITIAL_LINK_GRACE);
    }
  })().catch(() => log('initialization failed'));

  return {
    track: (event, properties) => client.track(event, properties),
    async screen(name, properties) {
      await client.page({ screen: name, path: name, ...properties });
      if (inAppEnabled) void inApp.check();
    },
    identify: (userId, traits, identifyOptions) =>
      client.identify(userId, traits, identifyOptions),
    reset: () => client.reset(),
    flush: () => client.flush(),
    getAnonymousId: () => client.getAnonymousId(),
    getInstallationId: () => installationId,
    whenReady: () => ready,
    async requestPushPermission() {
      if (!push) return false;
      await ready;
      const granted = await push.requestPermission();
      await readPushState().catch(() => undefined);
      await register();
      return granted;
    },
    async refreshPush() {
      await ready;
      await readPushState().catch(() => undefined);
      await register();
    },
    handleNotification: async (notification, event) => {
      await ready;
      return handleNotification(notification, event);
    },
    async getInitialLink() {
      initialLinkClaimed = true;
      await ready;
      await initialNotificationRead;
      const url = initialLink?.url ?? null;
      initialLink = null;
      return url;
    },
    onLink(listener) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    inApp,
    shutdown() {
      for (const cleanup of cleanups.splice(0)) cleanup();
    },
  };
}
