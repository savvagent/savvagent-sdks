# @savvagent/solid

SolidJS SDK for [Savvagent Flags](https://github.com/savvagent/flags-sdks), the feature flag product of [savvagent-services](https://github.com/savvagent/savvagent-services), with reactive primitives (signals and resources).

## Installation

```bash
npm install @savvagent/solid
```

> **The copy on npm is older.** Installing by name gets 1.1.0 (published 2025-12-30), which predates the current source, until the next release is published. To use the current source now, see [Installation](https://github.com/savvagent/flags-sdks#installation) in the repository README.

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
