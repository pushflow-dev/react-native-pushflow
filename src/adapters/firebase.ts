import { PermissionsAndroid, Platform } from 'react-native';
import { type PushAdapter, type PushNotification, stringData } from '../push';

export interface FirebaseMessagingLike {
  hasPermission(): Promise<number>;
  requestPermission(): Promise<number>;
  getToken(): Promise<string>;
  onTokenRefresh(listener: (token: string) => void): () => void;
  getInitialNotification(): Promise<FirebaseRemoteMessage | null>;
  onNotificationOpenedApp(
    listener: (message: FirebaseRemoteMessage) => void
  ): () => void;
  onMessage(listener: (message: FirebaseRemoteMessage) => unknown): () => void;
}

export interface FirebaseRemoteMessage {
  data?: Record<string, unknown>;
  notification?: { title?: string; body?: string };
}

const allowed = (status: number) => status >= 1;

function notification(message: FirebaseRemoteMessage): PushNotification {
  return {
    ...(message.notification?.title
      ? { title: message.notification.title }
      : {}),
    ...(message.notification?.body ? { body: message.notification.body } : {}),
    data: stringData(message.data),
  };
}

export function firebaseMessagingAdapter(
  messaging: FirebaseMessagingLike
): PushAdapter {
  return {
    provider: 'fcm',
    hasPermission: async () => {
      try {
        return allowed(await messaging.hasPermission());
      } catch {
        return false;
      }
    },
    requestPermission: async () => {
      try {
        if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
          const result = await PermissionsAndroid.request(
            'android.permission.POST_NOTIFICATIONS'
          );
          if (result !== PermissionsAndroid.RESULTS.GRANTED) return false;
        }
        return allowed(await messaging.requestPermission());
      } catch {
        return false;
      }
    },
    getToken: async () => {
      try {
        return (await messaging.getToken()) || null;
      } catch {
        return null;
      }
    },
    onTokenRefresh: (listener) => messaging.onTokenRefresh(listener),
    getInitialNotification: async () => {
      const message = await messaging.getInitialNotification();
      return message ? notification(message) : null;
    },
    onNotificationOpened: (listener) =>
      messaging.onNotificationOpenedApp((message) =>
        listener(notification(message))
      ),
    onForegroundNotification: (listener) =>
      messaging.onMessage((message) => listener(notification(message))),
  };
}
