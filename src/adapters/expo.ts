import { Platform } from 'react-native';
import { type PushAdapter, type PushNotification, stringData } from '../push';

interface ExpoPermissions {
  granted: boolean;
  ios?: { status?: number | null } | null;
}

interface ExpoSubscription {
  remove(): void;
}

export interface ExpoNotification {
  request: {
    content: {
      title?: string | null;
      body?: string | null;
      data?: Record<string, unknown> | null;
    };
    trigger?: unknown;
  };
}

export interface ExpoNotificationResponse {
  notification: ExpoNotification;
}

export interface ExpoNotificationsLike {
  getPermissionsAsync(): Promise<ExpoPermissions>;
  requestPermissionsAsync(): Promise<ExpoPermissions>;
  getDevicePushTokenAsync(): Promise<{ type: string; data: unknown }>;
  addPushTokenListener(
    listener: (token: { type: string; data: unknown }) => void
  ): ExpoSubscription;
  getLastNotificationResponseAsync?(): Promise<ExpoNotificationResponse | null>;
  getLastNotificationResponse?(): ExpoNotificationResponse | null;
  addNotificationResponseReceivedListener(
    listener: (response: ExpoNotificationResponse) => void
  ): ExpoSubscription;
  addNotificationReceivedListener(
    listener: (notification: ExpoNotification) => void
  ): ExpoSubscription;
}

const allowed = (permissions: ExpoPermissions) =>
  permissions.granted ||
  permissions.ios?.status === 3 ||
  permissions.ios?.status === 4;

function notification(source: ExpoNotification): PushNotification {
  const trigger = (source.request.trigger ?? {}) as {
    payload?: Record<string, unknown>;
    remoteMessage?: { data?: Record<string, unknown> };
  };
  const { aps: _aps, ...payload } = trigger.payload ?? {};
  const content = source.request.content;
  return {
    ...(content.title ? { title: content.title } : {}),
    ...(content.body ? { body: content.body } : {}),
    data: {
      ...stringData(trigger.remoteMessage?.data),
      ...stringData(payload),
      ...stringData(content.data),
    },
  };
}

export function expoNotificationsAdapter(
  notifications: ExpoNotificationsLike
): PushAdapter {
  return {
    provider: Platform.OS === 'ios' ? 'apns' : 'fcm',
    hasPermission: async () => {
      try {
        return allowed(await notifications.getPermissionsAsync());
      } catch {
        return false;
      }
    },
    requestPermission: async () => {
      try {
        return allowed(await notifications.requestPermissionsAsync());
      } catch {
        return false;
      }
    },
    getToken: async () => {
      try {
        const token = await notifications.getDevicePushTokenAsync();
        return typeof token.data === 'string' && token.data !== ''
          ? token.data
          : null;
      } catch {
        return null;
      }
    },
    onTokenRefresh: (listener) => {
      const subscription = notifications.addPushTokenListener((token) => {
        if (typeof token.data === 'string' && token.data !== '')
          listener(token.data);
      });
      return () => subscription.remove();
    },
    getInitialNotification: async () => {
      const response = notifications.getLastNotificationResponse
        ? notifications.getLastNotificationResponse()
        : await notifications.getLastNotificationResponseAsync?.();
      return response ? notification(response.notification) : null;
    },
    onNotificationOpened: (listener) => {
      const subscription =
        notifications.addNotificationResponseReceivedListener((response) =>
          listener(notification(response.notification))
        );
      return () => subscription.remove();
    },
    onForegroundNotification: (listener) => {
      const subscription = notifications.addNotificationReceivedListener(
        (received) => listener(notification(received))
      );
      return () => subscription.remove();
    },
  };
}
