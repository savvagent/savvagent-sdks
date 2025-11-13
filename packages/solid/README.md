# @savvagent/solid

SolidJS SDK for Savvagent with reactive primitives (signals and resources).

## Installation

```bash
npm install @savvagent/solid
```

## Quick Start

```tsx
import { SavvagentProvider, createFlag } from '@savvagent/solid';
import { Show } from 'solid-js';

function App() {
  return (
    <SavvagentProvider config={{ apiKey: 'sdk_...' }}>
      <MyFeature />
    </SavvagentProvider>
  );
}

function MyFeature() {
  const flag = createFlag('new-feature');

  return (
    <Show when={!flag.loading()} fallback={<div>Loading...</div>}>
      <Show when={flag.value()} fallback={<OldFeature />}>
        <NewFeature />
      </Show>
    </Show>
  );
}
```

## API Reference

### `createFlag(flagKey, options)`

Create a reactive flag with full state.

```tsx
const flag = createFlag('new-feature', {
  context: { user_id: userId() },
  defaultValue: false,
  realtime: true,
});

// Access values
flag.value();   // boolean
flag.loading(); // boolean
flag.error();   // Error | null
flag.refetch(); // force re-evaluation
```

### `createFlagValue(flagKey, options)`

Simple accessor for flag value only.

```tsx
const isEnabled = createFlagValue('new-feature');

return <Show when={isEnabled()}><NewFeature /></Show>;
```

### `createUserSignals()`

Manage user identification.

```tsx
const [userId, setUserId] = createUserSignals();

createEffect(() => {
  setUserId(currentUser()?.id || null);
});
```

## License

MIT
