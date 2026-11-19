export interface InAppPalette {
  surface?: string;
  text?: string;
  muted?: string;
  accent?: string;
  onAccent?: string;
  backdrop?: string;
}

export type InAppButtonStyle = 'filled' | 'outline' | 'text';

export interface InAppTheme {
  light?: InAppPalette;
  dark?: InAppPalette;
  radius?: number;
  fontFamily?: string;
  buttonStyle?: InAppButtonStyle;
}

export interface ResolvedInAppTheme {
  scheme: 'light' | 'dark';
  colors: Required<InAppPalette>;
  radius: number;
  fontFamily: string | null;
  buttonStyle: InAppButtonStyle;
}

export interface InAppButton {
  text: string;
  url: string | null;
  action: 'link' | 'dismiss';
}

export type InAppFieldValue = string | number | boolean;

export interface InAppMessage {
  id: string;
  layout: 'modal' | 'banner';
  title: string;
  body: string;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  buttons?: InAppButton[];
  theme?: InAppTheme | null;
  style?: InAppTheme | null;
  template?: string | null;
  fields?: Record<string, InAppFieldValue> | null;
}

export const DEFAULT_IN_APP_THEME = {
  light: {
    surface: '#ffffff',
    text: '#1b1f24',
    muted: '#5b6470',
    accent: '#3b5bdb',
    onAccent: '#ffffff',
    backdrop: '#00000073',
  },
  dark: {
    surface: '#1a1e24',
    text: '#e8eaed',
    muted: '#a8b0ba',
    accent: '#5c7cfa',
    onAccent: '#10131a',
    backdrop: '#000000a6',
  },
  radius: 14,
  buttonStyle: 'filled',
} as const satisfies InAppTheme;

const COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/;
const BUTTON_STYLES: readonly string[] = ['filled', 'outline', 'text'];
const TOKENS = [
  'surface',
  'text',
  'muted',
  'accent',
  'onAccent',
  'backdrop',
] as const;

export interface InAppThemeLayers {
  workspace?: InAppTheme | null | undefined;
  app?: InAppTheme | null | undefined;
  message?: InAppTheme | null | undefined;
}

export function resolveInAppTheme(
  scheme: 'light' | 'dark',
  layers: InAppThemeLayers = {}
): ResolvedInAppTheme {
  const ordered: Array<InAppTheme | null | undefined> = [
    DEFAULT_IN_APP_THEME,
    layers.workspace,
    layers.app,
    layers.message,
  ];
  const colors = { ...DEFAULT_IN_APP_THEME[scheme] } as Required<InAppPalette>;
  let radius: number = DEFAULT_IN_APP_THEME.radius;
  let buttonStyle: InAppButtonStyle = DEFAULT_IN_APP_THEME.buttonStyle;
  let fontFamily: string | null = null;
  for (const layer of ordered) {
    if (!layer || typeof layer !== 'object') continue;
    const palette = layer[scheme];
    if (palette && typeof palette === 'object') {
      for (const token of TOKENS) {
        const value = palette[token];
        if (typeof value === 'string' && COLOR.test(value))
          colors[token] = value;
      }
    }
    if (
      typeof layer.radius === 'number' &&
      Number.isFinite(layer.radius) &&
      layer.radius >= 0 &&
      layer.radius <= 28
    ) {
      radius = layer.radius;
    }
    if (
      typeof layer.buttonStyle === 'string' &&
      BUTTON_STYLES.includes(layer.buttonStyle)
    )
      buttonStyle = layer.buttonStyle;
    if (
      typeof layer.fontFamily === 'string' &&
      FONT_FAMILY.test(layer.fontFamily)
    )
      fontFamily = layer.fontFamily;
  }
  const appFont = layers.app?.fontFamily;
  if (typeof appFont === 'string' && FONT_FAMILY.test(appFont))
    fontFamily = appFont;
  return { scheme, colors, radius, fontFamily, buttonStyle };
}

export function inAppButtons(message: InAppMessage): InAppButton[] {
  if (Array.isArray(message.buttons)) {
    return message.buttons
      .filter((b): b is InAppButton => !!b && typeof b.text === 'string')
      .slice(0, 2);
  }
  return message.buttonText
    ? [{ text: message.buttonText, url: message.buttonUrl, action: 'link' }]
    : [];
}
