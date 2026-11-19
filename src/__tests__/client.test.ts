import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  createClient,
  type PushFlowNative,
  type PushFlowOptions,
} from '../client';
import { reportPushEvent } from '../push';
import {
  fakeBackend,
  fakePush,
  fakeRuntime,
  MemoryAsyncStorage,
  pushFlowPush,
} from '../__fixtures__/fakes';

type Backend = ReturnType<typeof fakeBackend>;

describe('React Native SDK', () => {
  const realFetch = globalThis.fetch;
  let backend: Backend;
  let clients: PushFlowNative[];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    backend = fakeBackend();
    globalThis.fetch = backend.fetch;
    clients = [];
  });

  afterEach(() => {
    clients.forEach((client) => client.shutdown());
    globalThis.fetch = realFetch;
    jest.useRealTimers();
  });

  const start = async (
    options: Partial<PushFlowOptions> = {},
    runtime = fakeRuntime()
  ) => {
    const client = createClient(
      {
        apiKey: 'pf_pk_test',
        apiUrl: 'https://api.test',
        storage: new MemoryAsyncStorage(),
        app: { id: 'ir.shop.app', version: '2.1.0', build: '210' },
        ...options,
      },
      runtime
    );
    clients.push(client);
    await client.whenReady();
    return { client, runtime };
  };

  const settle = async () => {
    for (let i = 0; i < 5; i++) await jest.advanceTimersByTimeAsync(0);
  };

  describe('installation registry', () => {
    it('registers the installation with device details and push state', async () => {
      const push = fakePush();
      const { client } = await start({ push });
      const [registration] = backend.to('/v1/sdk/devices');
      expect(registration!.body).toMatchObject({
        installationId: client.getInstallationId(),
        anonymousId: client.getAnonymousId(),
        platform: 'android',
        push: { provider: 'fcm', token: null, enabled: false, sandbox: false },
        app: { id: 'ir.shop.app', version: '2.1.0', build: '210' },
        os: { version: '14' },
        device: { manufacturer: 'Google', model: 'Phone' },
        locale: 'fa-IR',
        timezone: 'Asia/Tehran',
      });
      expect(client.getInstallationId()).toMatch(/^[0-9a-f-]{36}$/);

      expect(await client.requestPushPermission()).toBe(true);
      expect(backend.to('/v1/sdk/devices').at(-1)!.body).toMatchObject({
        push: {
          provider: 'fcm',
          token: 'fcm-token-' + 'x'.repeat(30),
          enabled: true,
        },
      });
    });

    it('sends a registration only when something changed or once a day', async () => {
      const storage = new MemoryAsyncStorage();
      const runtime = fakeRuntime();
      (await start({ storage }, runtime)).client.shutdown();
      await start({ storage }, runtime);
      expect(backend.to('/v1/sdk/devices')).toHaveLength(1);
      jest.advanceTimersByTime(25 * 60 * 60_000);
      runtime.emit('active');
      await settle();
      expect(backend.to('/v1/sdk/devices')).toHaveLength(2);
    });

    it('moves the installation to the new anonymous id at logout', async () => {
      const { client } = await start({ push: fakePush() });
      await client.identify('user-1');
      await settle();
      expect(backend.to('/v1/sdk/devices')).toHaveLength(1);
      const before = client.getAnonymousId();
      await client.reset();
      await settle();
      const last = backend.to('/v1/sdk/devices').at(-1)!.body!;
      expect(last.anonymousId).not.toBe(before);
      expect(last.anonymousId).toBe(client.getAnonymousId());
      expect(last.installationId).toBe(client.getInstallationId());
    });

    it('moves the installation off the previous user when another user logs in without logout', async () => {
      const { client } = await start({ push: fakePush() });
      await client.identify('user-1');
      await settle();
      const before = client.getAnonymousId();
      await client.identify('user-2');
      await settle();
      const last = backend.to('/v1/sdk/devices').at(-1)!.body!;
      expect(client.getAnonymousId()).not.toBe(before);
      expect(last.anonymousId).toBe(client.getAnonymousId());
    });

    it('re-registers refreshed tokens and permission changes made in the OS settings', async () => {
      const push = fakePush('apns');
      const runtime = fakeRuntime('ios', true);
      await start({ push }, runtime);
      push.refreshToken('cd'.repeat(32));
      await settle();
      expect(backend.to('/v1/sdk/devices').at(-1)!.body!.push).toEqual({
        provider: 'apns',
        token: 'cd'.repeat(32),
        enabled: false,
        sandbox: true,
      });
      push.permission = true;
      runtime.emit('active');
      await settle();
      expect(backend.to('/v1/sdk/devices').at(-1)!.body!.push).toMatchObject({
        enabled: true,
      });
    });

    it('retries failed registrations with backoff until they succeed', async () => {
      backend.respond('/v1/sdk/devices', 503, 0);
      await start({}, fakeRuntime());
      expect(backend.to('/v1/sdk/devices')).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      await jest.advanceTimersByTimeAsync(10 * 60_000);
      expect(backend.to('/v1/sdk/devices')).toHaveLength(3);
      await jest.advanceTimersByTimeAsync(60 * 60_000);
      expect(backend.to('/v1/sdk/devices')).toHaveLength(3);
    });
  });

  describe('app lifecycle', () => {
    it('tracks installs, updates and sessions', async () => {
      const storage = new MemoryAsyncStorage();
      const first = await start({ storage });
      await first.client.flush();
      expect(backend.events().map((e) => e.event)).toEqual([
        'pf_app_installed',
        'pf_app_opened',
      ]);
      expect(backend.events()[1]!.properties).toMatchObject({
        coldStart: true,
      });
      first.client.shutdown();

      const runtime = fakeRuntime();
      const second = await start(
        { storage, app: { version: '2.2.0' } },
        runtime
      );
      await second.client.flush();
      expect(
        backend
          .events()
          .slice(2)
          .map((e) => e.event)
      ).toEqual(['pf_app_updated', 'pf_app_opened']);
      expect(backend.events()[2]!.properties).toMatchObject({
        previousVersion: '2.1.0',
        version: '2.2.0',
      });

      runtime.emit('background');
      jest.advanceTimersByTime(10 * 60_000);
      runtime.emit('active');
      jest.advanceTimersByTime(1_000);
      runtime.emit('background');
      jest.advanceTimersByTime(31 * 60_000);
      runtime.emit('active');
      await settle();
      await second.client.flush();
      const opened = backend
        .events()
        .filter((e) => e.event === 'pf_app_opened');
      expect(opened.map((e) => e.properties!.coldStart)).toEqual([
        true,
        true,
        false,
      ]);
    });

    it('does not count an existing install that adopts this SDK version as new', async () => {
      const storage = new MemoryAsyncStorage();
      await storage.setItem(
        'pf_anonymous_id',
        '11111111-2222-4333-8444-555555555555'
      );
      const { client } = await start({ storage });
      await client.flush();
      expect(backend.events().map((e) => e.event)).toEqual(['pf_app_opened']);
      expect(client.getAnonymousId()).toBe(
        '11111111-2222-4333-8444-555555555555'
      );
    });

    it('adds app, device, os and session to every event', async () => {
      const { client } = await start();
      await client.track('add_to_cart', { sku: 'A1' });
      await client.flush();
      const batch = backend.to('/v1/sdk/batch')[0]!.body!.batch as Array<{
        context: Record<string, unknown>;
      }>;
      expect(batch.at(-1)!.context).toMatchObject({
        library: { name: 'pushflow-react-native' },
        app: { version: '2.1.0' },
        os: { name: 'Android', version: '14' },
        device: { id: client.getInstallationId(), type: 'android' },
        screen: { width: 390, height: 844 },
      });
      expect(typeof batch.at(-1)!.context.sessionId).toBe('string');
    });
  });

  describe('push notifications', () => {
    it('reports a tap once and opens its deep link', async () => {
      const push = fakePush();
      const onNotificationOpened = jest.fn();
      const { runtime } = await start({ push, onNotificationOpened });
      push.open(pushFlowPush('m1', 'shopapp://product/1'));
      push.open(pushFlowPush('m1', 'shopapp://product/1'));
      await settle();
      expect(backend.to('/v1/sdk/push/events').map((c) => c.body)).toEqual([
        { token: 'tok-m1', type: 'clicked' },
      ]);
      expect(runtime.opened).toEqual(['shopapp://product/1']);
      expect(onNotificationOpened).toHaveBeenCalledTimes(1);
      push.open({ data: { campaign: 'theirs' } });
      await settle();
      expect(onNotificationOpened).toHaveBeenCalledTimes(2);
      expect(backend.to('/v1/sdk/push/events')).toHaveLength(1);
    });

    it("hands the launch notification's link to getInitialLink instead of opening it", async () => {
      const push = fakePush();
      push.initial = pushFlowPush('m2', 'shopapp://sale');
      const runtime = fakeRuntime();
      const client = createClient(
        {
          apiKey: 'k',
          apiUrl: 'https://api.test',
          storage: new MemoryAsyncStorage(),
          push,
        },
        runtime
      );
      clients.push(client);
      expect(await client.getInitialLink()).toBe('shopapp://sale');
      await jest.advanceTimersByTimeAsync(5_000);
      expect(runtime.opened).toEqual([]);
      expect(backend.to('/v1/sdk/push/events').map((c) => c.body)).toEqual([
        { token: 'tok-m2', type: 'clicked' },
      ]);
    });

    it('opens the launch link itself when the app does not ask for it', async () => {
      const push = fakePush();
      push.initial = pushFlowPush('m3', 'shopapp://late');
      const { runtime } = await start({ push });
      expect(runtime.opened).toEqual([]);
      await jest.advanceTimersByTimeAsync(2_000);
      expect(runtime.opened).toEqual(['shopapp://late']);
    });

    it('sends links to onLink listeners (React Navigation) instead of Linking', async () => {
      const push = fakePush();
      const { client, runtime } = await start({ push });
      const links: string[] = [];
      const stop = client.onLink((url, source) =>
        links.push(`${source.type}:${url}`)
      );
      push.open(pushFlowPush('m4', 'shopapp://cart'));
      await settle();
      stop();
      expect(links).toEqual(['push:shopapp://cart']);
      expect(runtime.opened).toEqual([]);
    });

    it('reports foreground notifications as received', async () => {
      const push = fakePush();
      const onForegroundNotification = jest.fn();
      await start({ push, onForegroundNotification });
      push.arrive(pushFlowPush('m5'));
      await settle();
      expect(backend.to('/v1/sdk/push/events').map((c) => c.body)).toEqual([
        { token: 'tok-m5', type: 'received' },
      ]);
      expect(onForegroundNotification).toHaveBeenCalledTimes(1);
    });

    it('keeps reports made offline and sends them when the app is back', async () => {
      backend.respond('/v1/sdk/push/events', 0);
      const push = fakePush();
      const { runtime } = await start({ push });
      push.open(pushFlowPush('m6'));
      await settle();
      runtime.emit('active');
      await settle();
      expect(backend.to('/v1/sdk/push/events').map((c) => c.body)).toEqual([
        { token: 'tok-m6', type: 'clicked' },
        { token: 'tok-m6', type: 'clicked' },
      ]);
      runtime.emit('active');
      await settle();
      expect(backend.to('/v1/sdk/push/events')).toHaveLength(2);
    });

    it('reports pushes from headless background handlers', async () => {
      const options = { apiKey: 'k', apiUrl: 'https://api.test' };
      expect(await reportPushEvent(options, { other: 'x' })).toBe(false);
      expect(await reportPushEvent(options, pushFlowPush('m7').data)).toBe(
        true
      );
      expect(backend.to('/v1/sdk/push/events').map((c) => c.body)).toEqual([
        { token: 'tok-m7', type: 'received' },
      ]);
    });
  });

  describe('in-app messages', () => {
    const message = (id: string, buttonUrl: string | null = null) => ({
      id,
      layout: 'modal',
      title: 't',
      body: 'b',
      imageUrl: null,
      buttonText: buttonUrl ? 'برو' : null,
      buttonUrl,
    });

    const reports = () =>
      backend
        .to('/v1/sdk/in-app/')
        .map((c) => `${c.path.split('/')[4]}:${c.body!.type}`);

    it('fetches messages for the platform and shows them one at a time', async () => {
      backend.serveInApp(message('a', 'shopapp://sale'), message('b'));
      const runtime = fakeRuntime('ios');
      const { client } = await start({}, runtime);
      await settle();
      const request = backend.to('/v1/sdk/in-app')[0]!;
      expect(request.path).toBe(
        `/v1/sdk/in-app?anonymousId=${client.getAnonymousId()}&platform=ios`
      );
      const shown: Array<string | null> = [];
      client.inApp.subscribe((m) => shown.push(m?.id ?? null));
      expect(client.inApp.current()!.id).toBe('a');
      client.inApp.viewed('a');
      client.inApp.clicked('a');
      expect(runtime.opened).toEqual(['shopapp://sale']);
      client.inApp.dismissed('b');
      expect(shown).toEqual(['b', null]);
      await settle();
      expect(reports()).toEqual(['a:viewed', 'a:clicked', 'b:dismissed']);
    });

    it('checks again on screen views and foreground, at most every minInterval', async () => {
      const { client } = await start({ inApp: { minInterval: 60_000 } });
      await settle();
      await client.screen('Home');
      expect(backend.to('/v1/sdk/in-app?')).toHaveLength(1);
      jest.advanceTimersByTime(61_000);
      backend.serveInApp(message('c'));
      await client.screen('Product');
      await settle();
      expect(backend.to('/v1/sdk/in-app?')).toHaveLength(2);
      expect(client.inApp.current()!.id).toBe('c');
      client.inApp.pause();
      expect(client.inApp.current()).toBeNull();
      client.inApp.resume();
      expect(client.inApp.current()!.id).toBe('c');
    });

    it('asks for the templates the app can draw, at once when a new one is registered', async () => {
      const { client } = await start({ inApp: { minInterval: 60_000 } });
      await settle();
      expect(backend.to('/v1/sdk/in-app?')).toHaveLength(1);
      client.inApp.setTemplates(['promo-card', 'Bad Key', 'quiz']);
      await settle();
      expect(backend.to('/v1/sdk/in-app?').at(-1)!.path).toContain(
        '&templates=promo-card%2Cquiz'
      );
      client.inApp.setTemplates(['quiz', 'promo-card']);
      await settle();
      expect(backend.to('/v1/sdk/in-app?')).toHaveLength(2);
    });

    it("runs each button's action", async () => {
      backend.serveInApp(
        {
          ...message('a'),
          buttons: [
            { text: 'خرید', url: 'shopapp://sale', action: 'link' },
            { text: 'بعدا', url: null, action: 'dismiss' },
          ],
        },
        {
          ...message('b'),
          buttons: [
            { text: 'x', url: null, action: 'dismiss' },
            { text: 'y', url: 'shopapp://y', action: 'link' },
          ],
        }
      );
      const runtime = fakeRuntime('ios');
      const { client } = await start({}, runtime);
      await settle();
      client.inApp.clicked('a', 1);
      client.inApp.clicked('b', 1);
      expect(runtime.opened).toEqual(['shopapp://y']);
      await settle();
      expect(reports()).toEqual(['a:dismissed', 'b:clicked']);
    });

    it('can be turned off', async () => {
      const { client } = await start({ inApp: false });
      await client.screen('Home');
      await settle();
      expect(backend.to('/v1/sdk/in-app')).toHaveLength(0);
    });
  });
});
