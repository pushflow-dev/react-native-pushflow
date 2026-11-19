import { describe, expect, it, jest } from '@jest/globals';
import { PermissionsAndroid } from 'react-native';
import {
  expoNotificationsAdapter,
  type ExpoNotificationsLike,
} from '../adapters/expo';
import {
  firebaseMessagingAdapter,
  type FirebaseMessagingLike,
} from '../adapters/firebase';
import { stringData, pushFlowData } from '../push';

jest.mock('react-native', () => ({
  Platform: { OS: 'android', Version: 34 },
  PermissionsAndroid: {
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
    request: jest.fn(),
  },
}));

describe('firebaseMessagingAdapter', () => {
  const messaging = (
    status: number,
    token: string | Error
  ): FirebaseMessagingLike => ({
    hasPermission: async () => status,
    requestPermission: async () => status,
    getToken: async () => {
      if (token instanceof Error) throw token;
      return token;
    },
    onTokenRefresh: () => () => undefined,
    getInitialNotification: async () => ({
      data: { pf_mid: 'm', pf_tok: 't', nested: { a: 1 } },
      notification: { title: 'T' },
    }),
    onNotificationOpenedApp: () => () => undefined,
    onMessage: () => () => undefined,
  });

  it('maps authorization statuses, tokens and messages', async () => {
    expect(
      await firebaseMessagingAdapter(messaging(1, 'tok')).hasPermission()
    ).toBe(true);
    expect(
      await firebaseMessagingAdapter(messaging(2, 'tok')).hasPermission()
    ).toBe(true);
    expect(
      await firebaseMessagingAdapter(messaging(0, 'tok')).hasPermission()
    ).toBe(false);
    expect(
      await firebaseMessagingAdapter(messaging(-1, 'tok')).hasPermission()
    ).toBe(false);
    expect(
      await firebaseMessagingAdapter(
        messaging(1, new Error('SERVICE_NOT_AVAILABLE'))
      ).getToken()
    ).toBeNull();
    expect(
      await firebaseMessagingAdapter(messaging(1, 'tok'))
        .getInitialNotification!()
    ).toEqual({
      title: 'T',
      data: { pf_mid: 'm', pf_tok: 't', nested: '{"a":1}' },
    });
  });

  it('asks for the Android 13 notification permission first', async () => {
    jest
      .mocked(PermissionsAndroid.request)
      .mockResolvedValueOnce('denied')
      .mockResolvedValueOnce('granted');
    expect(
      await firebaseMessagingAdapter(messaging(1, 'tok')).requestPermission()
    ).toBe(false);
    expect(
      await firebaseMessagingAdapter(messaging(1, 'tok')).requestPermission()
    ).toBe(true);
  });
});

describe('expoNotificationsAdapter', () => {
  it('reads native tokens and the raw push payload', async () => {
    const remove = jest.fn();
    const expo: ExpoNotificationsLike = {
      getPermissionsAsync: async () => ({ granted: false, ios: { status: 3 } }),
      requestPermissionsAsync: async () => ({ granted: true }),
      getDevicePushTokenAsync: async () => ({
        type: 'android',
        data: 'fcm-token',
      }),
      addPushTokenListener: () => ({ remove }),
      getLastNotificationResponse: () => ({
        notification: {
          request: {
            content: { title: 'T', body: null, data: {} },
            trigger: {
              remoteMessage: {
                data: { pf_mid: 'm', pf_tok: 't', pf_link: 'shopapp://x' },
              },
            },
          },
        },
      }),
      addNotificationResponseReceivedListener: () => ({ remove }),
      addNotificationReceivedListener: () => ({ remove }),
    };
    const adapter = expoNotificationsAdapter(expo);
    expect(adapter.provider).toBe('fcm');
    expect(await adapter.hasPermission()).toBe(true);
    expect(await adapter.getToken()).toBe('fcm-token');
    const initial = await adapter.getInitialNotification!();
    expect(pushFlowData(initial!.data)).toEqual({
      messageId: 'm',
      token: 't',
      link: 'shopapp://x',
      imageUrl: null,
    });
    adapter.onNotificationOpened!(() => undefined)();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('drops the aps dictionary of iOS payloads', async () => {
    const expo = {
      getLastNotificationResponse: () => ({
        notification: {
          request: {
            content: { data: null },
            trigger: {
              type: 'push',
              payload: { aps: { alert: 'x' }, pf_mid: 'm', pf_tok: 't' },
            },
          },
        },
      }),
    } as unknown as ExpoNotificationsLike;
    expect(
      (await expoNotificationsAdapter(expo).getInitialNotification!())!.data
    ).toEqual({ pf_mid: 'm', pf_tok: 't' });
  });
});

describe('payload helpers', () => {
  it('recognizes PushFlow pushes only', () => {
    expect(pushFlowData({ pf_mid: 'm' })).toBeNull();
    expect(pushFlowData(null)).toBeNull();
    expect(stringData({ a: 1, b: null, c: 'x' })).toEqual({ a: '1', c: 'x' });
  });
});
