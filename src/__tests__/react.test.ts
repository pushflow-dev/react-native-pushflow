import { describe, expect, it } from '@jest/globals';
import type { PushFlowNative } from '../client';
import { type NavigationRefLike, trackScreens } from '../react';

function fakeNavigation() {
  const listeners: Record<string, (() => void)[]> = {};
  let ready = false;
  let route: string | undefined;
  const ref: NavigationRefLike = {
    isReady: () => ready,
    getCurrentRoute() {
      if (!ready) {
        throw new Error("The 'navigation' object hasn't been initialized yet.");
      }
      return route ? { name: route } : undefined;
    },
    addListener(event, listener) {
      (listeners[event] ??= []).push(listener);
      return () => {
        listeners[event] = (listeners[event] ?? []).filter(
          (l) => l !== listener
        );
      };
    },
  };
  const emit = (event: string) => (listeners[event] ?? []).forEach((l) => l());
  return {
    ref,
    listeners,
    mount(name: string) {
      ready = true;
      route = name;
      emit('ready');
    },
    unmount() {
      ready = false;
    },
    navigate(name: string) {
      route = name;
      emit('state');
    },
  };
}

function fakeClient() {
  const screens: string[] = [];
  const client = {
    screen: async (name: string) => void screens.push(name),
  } as unknown as PushFlowNative;
  return { client, screens };
}

describe('trackScreens', () => {
  it('can start before the navigator is mounted and tracks the first screen once it is ready', () => {
    const nav = fakeNavigation();
    const { client, screens } = fakeClient();

    trackScreens(nav.ref, client);
    expect(screens).toEqual([]);

    nav.mount('Home');
    nav.navigate('Track');
    nav.navigate('Track');
    expect(screens).toEqual(['Home', 'Track']);
  });

  it('tracks the first screen again after the container remounts on another route', () => {
    const nav = fakeNavigation();
    const { client, screens } = fakeClient();
    trackScreens(nav.ref, client);

    nav.mount('Home');
    nav.unmount();
    nav.mount('PhoneInput');
    expect(screens).toEqual(['Home', 'PhoneInput']);
  });

  it('stops listening when disposed', () => {
    const nav = fakeNavigation();
    const { client, screens } = fakeClient();
    const stop = trackScreens(nav.ref, client);
    stop();

    nav.mount('Home');
    expect(screens).toEqual([]);
    expect(Object.values(nav.listeners).flat()).toEqual([]);
  });
});
