import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { PushFlowClient, type ClientOptions } from '../../core/client';
import { MemoryStorage } from '../../core/storage';
import type { Message, TransportRequest } from '../../core/types';

function setup(statuses: number[] = [], options: Partial<ClientOptions> = {}) {
  const requests: TransportRequest[] = [];
  const storage = new MemoryStorage();
  const transport = jest.fn(async (request: TransportRequest) => {
    requests.push(request);
    return statuses.length > 0 ? statuses.shift()! : 202;
  });
  const client = new PushFlowClient({
    apiKey: 'pf_pk_test',
    apiUrl: 'https://api.example/',
    storage,
    transport,
    flushAt: 3,
    flushInterval: 1000,
    random: () => 0.5,
    ...options,
  });
  const batches = () =>
    requests.map((r) => (JSON.parse(r.body) as { batch: Message[] }).batch);
  return { client, storage, transport, requests, batches };
}

const eventName = (m: Message) => (m.type === 'track' ? m.event : m.type);

describe('PushFlowClient', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists a stable anonymous id', async () => {
    const { client, storage } = setup();
    await client.whenReady();
    const id = client.getAnonymousId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const again = new PushFlowClient({
      apiKey: 'k',
      apiUrl: 'https://x',
      storage,
      transport: async () => 202,
    });
    await again.whenReady();
    expect(again.getAnonymousId()).toBe(id);
  });

  it('batches until flushAt and sends with the key and sentAt', async () => {
    const { client, requests, batches } = setup();
    await client.track('A');
    await client.track('B');
    expect(requests).toHaveLength(0);
    await client.track('C', { price: 10 });
    await jest.runAllTimersAsync();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://api.example/v1/sdk/batch');
    expect(requests[0]!.headers['X-PushFlow-Key']).toBe('pf_pk_test');
    expect(batches()[0]!.map(eventName)).toEqual(['A', 'B', 'C']);
    expect(typeof JSON.parse(requests[0]!.body).sentAt).toBe('string');
    expect(client.queued()).toBe(0);
  });

  it('flushes on the interval when below flushAt', async () => {
    const { client, requests } = setup();
    await client.page({ path: '/' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(requests).toHaveLength(1);
  });

  it('keeps messages and retries with backoff on server errors and network failures', async () => {
    const { client, requests, batches } = setup([503, 0]);
    await client.track('A');
    await client.flush();
    expect(client.queued()).toBe(1);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    await jest.advanceTimersByTimeAsync(5 * 60_000);
    expect(requests.length).toBeGreaterThanOrEqual(3);
    expect(client.queued()).toBe(0);
    expect(new Set(batches().map((b) => b[0]!.messageId)).size).toBe(1);
  });

  it('drops batches the server can never accept', async () => {
    const { client } = setup([401]);
    await client.track('A');
    await client.flush();
    expect(client.queued()).toBe(0);
  });

  it('halves the batch when the body is too large', async () => {
    const { client, batches } = setup([413], { flushAt: 100 });
    for (const name of ['A', 'B', 'C', 'D']) await client.track(name);
    await client.flush();
    expect(batches().map((b) => b.length)).toEqual([4, 2, 2]);
  });

  it('attaches the user id after identify and forgets it on reset', async () => {
    const { client, batches } = setup([], { flushAt: 100 });
    await client.identify(
      'user-1',
      { email: 'a@example.com' },
      { userHash: 'abc' }
    );
    await client.track('after_login');
    const before = client.getAnonymousId();
    await client.reset();
    await client.track('after_logout');
    await client.flush();

    const [identify, login, logout] = batches()[0]!;
    expect(identify).toMatchObject({
      type: 'identify',
      userId: 'user-1',
      userHash: 'abc',
      traits: { email: 'a@example.com' },
    });
    expect(login).toMatchObject({ userId: 'user-1', anonymousId: before });
    expect(logout!.userId).toBeUndefined();
    expect(logout!.anonymousId).not.toBe(before);
  });

  it('notifies identity listeners on login and logout', async () => {
    const { client } = setup([], { flushAt: 100 });
    const seen: Array<{ anonymousId: string; userId: string | undefined }> = [];
    const stop = client.onIdentityChange((identity) => seen.push(identity));
    await client.identify('user-1');
    await client.identify('user-1', { plan: 'gold' });
    const before = client.getAnonymousId();
    await client.reset();
    stop();
    await client.identify('user-2');
    expect(seen).toEqual([
      { anonymousId: before, userId: 'user-1' },
      { anonymousId: client.getAnonymousId(), userId: undefined },
    ]);
  });

  it('treats identifying a different user as a logout first', async () => {
    const { client, batches } = setup([], { flushAt: 100 });
    const seen: Array<{ anonymousId: string; userId: string | undefined }> = [];
    client.onIdentityChange((identity) => seen.push(identity));
    await client.identify('user-1', {}, { userHash: 'h1' });
    const first = client.getAnonymousId();
    await client.track('as_user_1');
    await client.identify('user-2', { plan: 'gold' }, { userHash: 'h2' });
    const second = client.getAnonymousId();
    await client.track('as_user_2');
    await client.identify('user-2', { plan: 'silver' }, { userHash: 'h2' });
    await client.flush();

    expect(second).not.toBe(first);
    expect(client.getAnonymousId()).toBe(second);
    const [, asUser1, identify2, asUser2, sameUser] = batches()[0]!;
    expect(asUser1).toMatchObject({
      userId: 'user-1',
      userHash: 'h1',
      anonymousId: first,
    });
    expect(identify2).toMatchObject({
      type: 'identify',
      userId: 'user-2',
      userHash: 'h2',
      anonymousId: second,
    });
    expect(asUser2).toMatchObject({ userId: 'user-2', anonymousId: second });
    expect(sameUser).toMatchObject({
      type: 'identify',
      userId: 'user-2',
      anonymousId: second,
    });
    expect(seen).toEqual([
      { anonymousId: first, userId: 'user-1' },
      { anonymousId: second, userId: 'user-2' },
    ]);
  });

  it('keeps the anonymous id when an anonymous visitor logs in', async () => {
    const { client } = setup([], { flushAt: 100 });
    await client.whenReady();
    const before = client.getAnonymousId();
    await client.identify('user-1');
    expect(client.getAnonymousId()).toBe(before);
  });

  it('keeps the order of events fired within the same millisecond', async () => {
    const fixed = new Date('2026-11-03T10:00:00.000Z');
    const { client, batches } = setup([], { flushAt: 100, now: () => fixed });
    for (const name of ['A', 'B', 'C']) await client.track(name);
    await client.flush();
    const times = batches()[0]!.map((m) => Date.parse(m.timestamp));
    expect(times).toEqual([times[0], times[0]! + 1, times[0]! + 2]);
  });

  it('survives restarts with the persisted queue and caps its size', async () => {
    const storage = new MemoryStorage();
    const offline = new PushFlowClient({
      apiKey: 'k',
      apiUrl: 'https://x',
      storage,
      transport: async () => 0,
      flushAt: 1000,
      maxQueueSize: 3,
    });
    for (const name of ['A', 'B', 'C', 'D']) await offline.track(name);
    expect(offline.queued()).toBe(3);

    const sent: string[] = [];
    const online = new PushFlowClient({
      apiKey: 'k',
      apiUrl: 'https://x',
      storage,
      flushAt: 1000,
      transport: async (r) => {
        sent.push(...(JSON.parse(r.body).batch as Message[]).map(eventName));
        return 202;
      },
    });
    await online.whenReady();
    await online.flush();
    expect(sent).toEqual(['B', 'C', 'D']);
  });
});
