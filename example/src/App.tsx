import AsyncStorage from '@react-native-async-storage/async-storage';
import { Button, StyleSheet, View } from 'react-native';
import {
  createPushFlow,
  PushFlowProvider,
  usePushFlow,
} from 'react-native-pushflow';

const pushflow = createPushFlow({
  apiKey: 'pf_pk_...',
  storage: AsyncStorage,
  app: { id: 'pushflow.example', version: '1.0.0' },
  debug: true,
});

function Home() {
  const client = usePushFlow();

  return (
    <View style={styles.container}>
      <Button
        title="Track event"
        onPress={() => client.track('example_button_pressed')}
      />
      <Button title="Screen view" onPress={() => client.screen('Home')} />
      <Button
        title="Identify"
        onPress={() => client.identify('example-user', { plan: 'gold' })}
      />
      <Button title="Reset" onPress={() => client.reset()} />
      <Button title="Flush" onPress={() => client.flush()} />
    </View>
  );
}

export default function App() {
  return (
    <PushFlowProvider client={pushflow}>
      <Home />
    </PushFlowProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
});
