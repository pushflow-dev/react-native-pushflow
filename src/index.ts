import {
  createClient,
  type PushFlowNative,
  type PushFlowOptions,
} from './client';
import { reactNativeRuntime } from './platform';

export function createPushFlow(options: PushFlowOptions): PushFlowNative {
  return createClient(options, reactNativeRuntime);
}

export { SDK_VERSION } from './version';
export type {
  AsyncStorageLike,
  LinkSource,
  PushFlowNative,
  PushFlowOptions,
} from './client';
export { InAppController, type InAppMessage } from './inapp';
export {
  InAppMessageView,
  type InAppMessageViewProps,
} from './InAppMessageView';
export {
  type PushAdapter,
  type PushNotification,
  reportPushEvent,
  pushFlowData,
} from './push';
export {
  firebaseMessagingAdapter,
  type FirebaseMessagingLike,
} from './adapters/firebase';
export {
  expoNotificationsAdapter,
  type ExpoNotificationsLike,
} from './adapters/expo';
export {
  type InAppTemplateProps,
  trackScreens,
  type NavigationRefLike,
  useInAppMessage,
  usePushFlow,
  PushFlowProvider,
  type PushFlowProviderProps,
} from './react';
export {
  DEFAULT_IN_APP_THEME,
  inAppButtons,
  resolveInAppTheme,
  type InAppButton,
  type InAppFieldValue,
  type InAppTheme,
  type ResolvedInAppTheme,
} from './core/index';
