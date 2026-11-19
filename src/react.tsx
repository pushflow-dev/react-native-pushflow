import {
  type InAppFieldValue,
  type InAppTheme,
  resolveInAppTheme,
  type ResolvedInAppTheme,
} from './core/index';
import {
  Component,
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { useColorScheme } from 'react-native';
import type { PushFlowNative } from './client';
import type { InAppMessage } from './inapp';
import {
  InAppMessageView,
  type InAppMessageViewProps,
} from './InAppMessageView';

export interface InAppTemplateProps {
  message: InAppMessage;
  fields: Record<string, InAppFieldValue>;
  theme: ResolvedInAppTheme;
  onAction(buttonIndex?: number): void;
  onDismiss(): void;
}

const PushFlowContext = createContext<PushFlowNative | null>(null);

export interface PushFlowProviderProps {
  client: PushFlowNative;
  children?: ReactNode;
  renderInApp?: (props: InAppMessageViewProps) => ReactNode;
  inApp?: boolean;
  theme?: InAppTheme;
  templates?: Record<string, ComponentType<InAppTemplateProps>>;
}

export function PushFlowProvider({
  client,
  children,
  renderInApp,
  inApp = true,
  theme,
  templates,
}: PushFlowProviderProps) {
  const templateKeys = Object.keys(templates ?? {})
    .sort()
    .join(',');
  useEffect(() => {
    client.inApp.setTemplates(templateKeys ? templateKeys.split(',') : []);
  }, [client, templateKeys]);
  return (
    <PushFlowContext.Provider value={client}>
      {children}
      {inApp ? (
        <InAppMessageHost
          client={client}
          {...(renderInApp ? { render: renderInApp } : {})}
          {...(theme ? { theme } : {})}
          {...(templates ? { templates } : {})}
        />
      ) : null}
    </PushFlowContext.Provider>
  );
}

export function usePushFlow(): PushFlowNative {
  const client = useContext(PushFlowContext);
  if (!client)
    throw new Error('usePushFlow() must be used inside <PushFlowProvider>');
  return client;
}

export function useInAppMessage(client: PushFlowNative): InAppMessage | null {
  const subscribe = useCallback(
    (onChange: () => void) => client.inApp.subscribe(onChange),
    [client]
  );
  return useSyncExternalStore(subscribe, () => client.inApp.current());
}

function InAppMessageHost({
  client,
  render,
  theme,
  templates,
}: {
  client: PushFlowNative;
  render?: (props: InAppMessageViewProps) => ReactNode;
  theme?: InAppTheme;
  templates?: Record<string, ComponentType<InAppTemplateProps>>;
}) {
  const message = useInAppMessage(client);
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  useEffect(() => {
    if (message) client.inApp.viewed(message.id);
  }, [client, message]);
  if (!message) return null;
  const resolved = resolveInAppTheme(scheme, {
    workspace: message.theme,
    app: theme,
    message: message.style,
  });
  const onAction = (buttonIndex?: number) =>
    client.inApp.clicked(message.id, buttonIndex);
  const onDismiss = () => client.inApp.dismissed(message.id);
  const Template = message.template ? templates?.[message.template] : undefined;
  const props: InAppMessageViewProps = {
    message,
    theme: resolved,
    onAction,
    onDismiss,
  };
  const builtIn = <>{render?.(props) ?? <InAppMessageView {...props} />}</>;
  if (Template) {
    return (
      <TemplateBoundary key={message.id} fallback={builtIn}>
        <Template
          message={message}
          fields={message.fields ?? {}}
          theme={resolved}
          onAction={onAction}
          onDismiss={onDismiss}
        />
      </TemplateBoundary>
    );
  }
  return builtIn;
}

class TemplateBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export interface NavigationRefLike {
  getCurrentRoute(): { name: string } | undefined;
  addListener(event: 'state' | 'ready', listener: () => void): () => void;
  isReady?(): boolean;
}

export function trackScreens(
  navigation: NavigationRefLike,
  client: PushFlowNative
): () => void {
  let last: string | undefined;
  const onState = () => {
    if (navigation.isReady && !navigation.isReady()) return;
    const name = navigation.getCurrentRoute()?.name;
    if (name && name !== last) {
      last = name;
      void client.screen(name);
    }
  };
  onState();
  const stopState = navigation.addListener('state', onState);
  const stopReady = navigation.addListener('ready', onState);
  return () => {
    stopState();
    stopReady();
  };
}
