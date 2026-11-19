import { AppState, Dimensions, Linking, Platform } from 'react-native';
import {
  type AppStateName,
  intlLocale,
  intlTimezone,
  type PlatformInfo,
  type Runtime,
} from './runtime';

export const reactNativeRuntime: Runtime = {
  info(): PlatformInfo {
    const constants = (Platform.constants ?? {}) as Record<string, unknown>;
    const os = Platform.OS === 'ios' ? 'ios' : 'android';
    const text = (value: unknown) =>
      typeof value === 'string' && value !== '' ? value : undefined;
    return {
      os,
      osVersion:
        os === 'android'
          ? (text(constants.Release) ?? String(Platform.Version))
          : String(Platform.Version),
      manufacturer:
        os === 'ios'
          ? 'Apple'
          : (text(constants.Manufacturer) ?? text(constants.Brand)),
      model: text(constants.Model),
      isDev: (globalThis as { __DEV__?: boolean }).__DEV__ === true,
    };
  },
  appState: () => (AppState.currentState ?? 'unknown') as AppStateName,
  onAppStateChange(listener) {
    const subscription = AppState.addEventListener('change', (state) =>
      listener(state as AppStateName)
    );
    return () => subscription.remove();
  },
  openUrl: async (url) => {
    await Linking.openURL(url);
  },
  screenSize() {
    const { width, height } = Dimensions.get('window');
    return { width: Math.round(width), height: Math.round(height) };
  },
  locale: intlLocale,
  timezone: intlTimezone,
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};
