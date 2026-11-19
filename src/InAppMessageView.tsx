import {
  inAppButtons,
  type InAppButton,
  resolveInAppTheme,
  type ResolvedInAppTheme,
} from './core/index';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import type { InAppMessage } from './inapp';

export interface InAppMessageViewProps {
  message: InAppMessage;
  theme?: ResolvedInAppTheme;
  onAction(buttonIndex?: number): void;
  onDismiss(): void;
}

export function InAppMessageView({
  message,
  theme,
  onAction,
  onDismiss,
}: InAppMessageViewProps) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const t =
    theme ??
    resolveInAppTheme(scheme, {
      workspace: message.theme,
      message: message.style,
    });
  const { colors } = t;
  const font = t.fontFamily ? { fontFamily: t.fontFamily } : null;
  const buttons = inAppButtons(message);
  const card = (
    <View
      style={[
        styles.card,
        message.layout === 'banner' ? styles.banner : styles.modal,
        { backgroundColor: colors.surface, borderRadius: t.radius },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={message.title}
    >
      {message.imageUrl && message.layout !== 'banner' ? (
        <Image
          source={{ uri: message.imageUrl }}
          style={[styles.image, { borderRadius: Math.max(0, t.radius - 6) }]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      <Text style={[styles.title, font, { color: colors.text }]}>
        {message.title}
      </Text>
      {message.body ? (
        <Text style={[styles.body, font, { color: colors.muted }]}>
          {message.body}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <View style={styles.buttons}>
          {buttons.map((button, index) => (
            <ActionButton
              key={index}
              button={button}
              primary={index === 0}
              theme={t}
              onPress={() => onAction(index)}
            />
          ))}
        </View>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="بستن"
          hitSlop={12}
          style={styles.close}
        >
          <Text style={[styles.closeText, { color: colors.muted }]}>×</Text>
        </Pressable>
      </View>
    </View>
  );
  if (message.layout === 'banner') {
    return (
      <View pointerEvents="box-none" style={styles.bannerHost}>
        {card}
      </View>
    );
  }
  return (
    <Modal
      transparent
      animationType="fade"
      visible
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <Pressable
        style={[styles.backdrop, { backgroundColor: colors.backdrop }]}
        onPress={onDismiss}
        accessibilityLabel="بستن"
      >
        <Pressable onPress={() => undefined}>{card}</Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionButton({
  button,
  primary,
  theme,
  onPress,
}: {
  button: InAppButton;
  primary: boolean;
  theme: ResolvedInAppTheme;
  onPress(): void;
}) {
  const { colors } = theme;
  const style = primary ? theme.buttonStyle : 'text';
  const radius = Math.min(theme.radius, 20);
  const font = theme.fontFamily ? { fontFamily: theme.fontFamily } : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { borderRadius: radius, opacity: pressed ? 0.85 : 1 },
        style === 'filled' ? { backgroundColor: colors.accent } : null,
        style === 'outline'
          ? { borderWidth: 1.5, borderColor: colors.accent }
          : null,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          font,
          { color: style === 'filled' ? colors.onAccent : colors.accent },
        ]}
      >
        {button.text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  modal: { width: 340, maxWidth: '100%' },
  banner: { marginHorizontal: 12 },
  bannerHost: { position: 'absolute', top: 48, left: 0, right: 0 },
  image: { width: '100%', height: 160, marginBottom: 12 },
  title: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
    writingDirection: 'auto',
  },
  body: { fontSize: 14, lineHeight: 22, writingDirection: 'auto' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
  button: { paddingVertical: 10, paddingHorizontal: 20 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  close: { paddingHorizontal: 8 },
  closeText: { fontSize: 22 },
});
