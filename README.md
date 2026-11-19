# react-native-pushflow

The [PushFlow](https://pushflow.ir) SDK for React Native: events, identity, push notifications (FCM and APNs) and
in-app messages.

It has no native code of its own, so it works in any React Native app, bare or Expo. Push goes through the push
library the app already uses.

Full documentation (in Persian): [pushflow.ir/docs/react-native](https://pushflow.ir/docs/react-native/)

## Install

```bash
npm install react-native-pushflow @react-native-async-storage/async-storage
```

For push notifications, also install one of:

- `@react-native-firebase/app` and `@react-native-firebase/messaging`
- `expo-notifications` (Expo projects)

Requires `react` ≥ 18.2 and `react-native` ≥ 0.74.

## Set up

Create the SDK once, at module level:

```ts
// pushflow.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import messaging from "@react-native-firebase/messaging";
import { createPushFlow, firebaseMessagingAdapter } from "react-native-pushflow";

export const pushflow = createPushFlow({
  apiKey: "pf_pk_...", // Settings → SDK in the dashboard
  storage: AsyncStorage,
  push: firebaseMessagingAdapter(messaging()),
});
```

With `expo-notifications`, use its adapter instead:

```ts
import * as Notifications from "expo-notifications";
import { expoNotificationsAdapter } from "react-native-pushflow";

push: expoNotificationsAdapter(Notifications),
```

Wrap the app in the provider, which shows in-app messages:

```tsx
// App.tsx
import { PushFlowProvider } from "react-native-pushflow";
import { pushflow } from "./pushflow";

export default function App() {
  return (
    <PushFlowProvider client={pushflow}>
      <Navigation />
    </PushFlowProvider>
  );
}
```

## Identity and events

```ts
pushflow.identify("user-42", { email: "sara@example.com", plan: "gold" });
pushflow.track("add_to_cart", { sku: "A1", price: 125000 });
pushflow.screen("Product", { sku: "A1" });
pushflow.reset(); // at logout
```

App installs, updates and opens are tracked automatically (`trackLifecycle: false` turns this off).

## Push notifications

1. Add your FCM or APNs credentials in the dashboard (Settings → Channels → Mobile push).
2. Ask for permission. The device token is then registered automatically:

   ```ts
   await pushflow.requestPushPermission();
   ```

Taps are recorded and their deep link is opened with `Linking.openURL`. To route links through your navigation
instead, use `pushflow.onLink(listener)` and `pushflow.getInitialLink()`.

## Options

| Option            | Default                   |                                                       |
| ----------------- | ------------------------- | ----------------------------------------------------- |
| `apiKey`          | required                  | Public key from the dashboard                         |
| `storage`         | required                  | AsyncStorage, or any `getItem`/`setItem`/`removeItem` |
| `push`            | —                         | Push adapter (see above)                              |
| `app`, `device`   | —                         | App id, version and build; device model               |
| `trackLifecycle`  | `true`                    | Automatic install, update and open events             |
| `inApp`           | `true`                    | `false` turns in-app messages off                     |
| `apiUrl`          | `https://api.pushflow.ir` | Backend origin                                        |
| `debug`           | `false`                   | Log warnings to the console                           |

Background handlers, custom push libraries, screen tracking with React Navigation and custom in-app message
templates are covered in the [full documentation](https://pushflow.ir/docs/react-native/).

## Contributing

- [Development workflow](CONTRIBUTING.md#development-workflow)
- [Sending a pull request](CONTRIBUTING.md#sending-a-pull-request)
- [Code of conduct](CODE_OF_CONDUCT.md)

## License

MIT
