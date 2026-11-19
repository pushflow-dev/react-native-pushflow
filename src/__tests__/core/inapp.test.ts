import { describe, expect, it } from '@jest/globals';
import {
  inAppButtons,
  type InAppMessage,
  resolveInAppTheme,
} from '../../core/inapp';

describe('resolveInAppTheme', () => {
  it('layers defaults, workspace theme, app theme and message style in that order', () => {
    const theme = resolveInAppTheme('light', {
      workspace: {
        light: { accent: '#d9480f', surface: '#fff8e1' },
        radius: 20,
        fontFamily: 'Vazirmatn',
      },
      app: { light: { accent: '#0b7285' }, buttonStyle: 'outline' },
      message: { light: { surface: '#000000' }, radius: 4 },
    });
    expect(theme.colors).toMatchObject({
      accent: '#0b7285',
      surface: '#000000',
      text: '#1b1f24',
    });
    expect(theme).toMatchObject({
      radius: 4,
      buttonStyle: 'outline',
      fontFamily: 'Vazirmatn',
      scheme: 'light',
    });
  });

  it("keeps the app's font over the campaign's, and ignores invalid tokens", () => {
    const theme = resolveInAppTheme('dark', {
      app: { fontFamily: 'IRANSans' },
      message: {
        fontFamily: 'Comic Sans',
        dark: { surface: 'red', text: '#fff;color:red' },
        radius: 99,
      },
    });
    expect(theme.fontFamily).toBe('IRANSans');
    expect(theme.colors.surface).toBe('#1a1e24');
    expect(theme.colors.text).toBe('#e8eaed');
    expect(theme.radius).toBe(14);
  });
});

describe('inAppButtons', () => {
  const base: InAppMessage = {
    id: 'm',
    layout: 'modal',
    title: 't',
    body: 'b',
    imageUrl: null,
    buttonText: null,
    buttonUrl: null,
  };

  it('reads buttons, or the legacy single button', () => {
    expect(
      inAppButtons({ ...base, buttonText: 'برو', buttonUrl: 'shopapp://sale' })
    ).toEqual([{ text: 'برو', url: 'shopapp://sale', action: 'link' }]);
    expect(
      inAppButtons({
        ...base,
        buttons: [{ text: 'a', url: null, action: 'dismiss' }],
      })
    ).toEqual([{ text: 'a', url: null, action: 'dismiss' }]);
    expect(inAppButtons(base)).toEqual([]);
  });
});
