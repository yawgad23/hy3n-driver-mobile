import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createTranslucentPalette, type TranslucentPalette } from '../lib/driver-ios-overlay-theme';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const requireHere = createRequire(__filename);
const hookPath = path.join(__dirname, '../hooks/use-driver-ios-overlay-palette.ts');
type PlatformName = 'ios' | 'android' | 'web';
type PreferenceListener = (value: boolean) => void;
type OverlayHook = (isDark: boolean) => TranslucentPalette;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Bundle only the hook and its real palette dependency in memory. No app build or emitted files.
let bundledHook: Promise<string> | undefined;
function bundleHook(): Promise<string> {
  return bundledHook ??= build({
    entryPoints: [hookPath],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    external: ['react', 'react-native'],
    tsconfig: path.join(__dirname, '../tsconfig.json'),
  }).then(result => result.outputFiles[0].text);
}

async function mountHarness(t: TestContext, options: {
  platform?: PlatformName;
  isDark?: boolean;
  missingApi?: 'query' | 'listener';
} = {}) {
  const platform = options.platform ?? 'ios';
  const query = deferred<boolean>();
  const calls: string[] = [];
  const subscriptions: { listener: PreferenceListener; removed: boolean }[] = [];
  const stateWrites: React.SetStateAction<boolean>[] = [];
  const snapshots: TranslucentPalette[] = [];
  let readCount = 0;
  let removeCount = 0;
  let mounted = true;
  let latest!: TranslucentPalette;
  let renderer!: ReactTestRenderer;

  const accessibilityInfo = {
    isReduceTransparencyEnabled: options.missingApi === 'query' ? undefined : () => {
      readCount += 1;
      calls.push('read');
      return query.promise;
    },
    addEventListener: options.missingApi === 'listener' ? undefined : (event: string, listener: PreferenceListener) => {
      assert.equal(event, 'reduceTransparencyChanged');
      calls.push('listen');
      const subscription = { listener, removed: false };
      subscriptions.push(subscription);
      return {
        remove() {
          removeCount += 1;
          subscription.removed = true;
          calls.push('remove');
        },
      };
    },
  };
  const native = { Platform: { OS: platform }, AccessibilityInfo: accessibilityInfo };
  // Keep actual React state and effects, but observe setter attempts even after unmount.
  // React can silently discard late writes, so render counts alone would not prove cleanup.
  const observedReact = {
    ...React,
    useState(initial: boolean | (() => boolean)) {
      const [value, setValue] = React.useState(initial);
      const trackedSetValue: React.Dispatch<React.SetStateAction<boolean>> = next => {
        stateWrites.push(next);
        setValue(next);
      };
      return [value, trackedSetValue] as const;
    },
  };
  const module = { exports: {} as { useDriverIosOverlayPalette: OverlayHook } };
  new Function('require', 'module', 'exports', await bundleHook())(
    (name: string) => name === 'react-native' ? native : name === 'react' ? observedReact : requireHere(name),
    module,
    module.exports,
  );
  const useDriverIosOverlayPalette = module.exports.useDriverIosOverlayPalette;
  assert.equal(typeof useDriverIosOverlayPalette, 'function');

  function Probe({ isDark }: { isDark: boolean }) {
    latest = useDriverIosOverlayPalette(isDark);
    snapshots.push(latest);
    return null;
  }

  async function unmount() {
    if (!mounted) return;
    await act(async () => { renderer.unmount(); });
    mounted = false;
  }
  t.after(unmount);
  await act(async () => { renderer = create(React.createElement(Probe, { isDark: options.isDark ?? false })); });

  return {
    get palette() { return latest; },
    get readCount() { return readCount; },
    get removeCount() { return removeCount; },
    get renderCount() { return snapshots.length; },
    calls,
    subscriptions,
    stateWrites,
    snapshots,
    async resolveInitial(value: boolean) {
      await act(async () => { query.resolve(value); await query.promise; });
    },
    async rejectInitial() {
      await act(async () => {
        query.reject(new Error('Native accessibility preference unavailable'));
        await query.promise.catch(() => {});
      });
    },
    async emit(value: boolean) {
      await act(async () => {
        for (const subscription of subscriptions) {
          if (!subscription.removed) subscription.listener(value);
        }
      });
    },
    async invokeRetainedListener(value: boolean) {
      assert.equal(subscriptions.length, 1, 'retain a callback to simulate an already queued native event');
      await act(async () => { subscriptions[0].listener(value); });
    },
    async updateTheme(isDark: boolean) {
      await act(async () => { renderer.update(React.createElement(Probe, { isDark })); });
    },
    unmount,
  };
}

for (const isDark of [false, true]) {
  const theme = isDark ? 'dark' : 'light';

  test(`iOS ${theme}: renders solid before the initial accessibility query resolves`, async t => {
    const harness = await mountHarness(t, { isDark });
    assert.deepEqual(harness.snapshots[0], createTranslucentPalette(theme, true), 'first render is conservatively solid');
    assert.deepEqual(harness.palette, createTranslucentPalette(theme, true));
    assert.equal(harness.readCount, 1);
    assert.equal(harness.subscriptions.length, 1);
    assert.deepEqual(harness.calls, ['listen', 'read'], 'listen before reading so a preference change cannot be missed');
    assert.deepEqual(harness.stateWrites, [], 'no preference is guessed while native query is pending');
  });

  for (const preference of [false, true]) {
    test(`iOS ${theme}: initial preference ${preference} selects ${preference ? 'solid' : 'translucent'} fills`, async t => {
      const harness = await mountHarness(t, { isDark });
      await harness.resolveInitial(preference);
      assert.deepEqual(harness.palette, createTranslucentPalette(theme, preference));
      assert.deepEqual(harness.stateWrites, [preference]);
      assert.equal(harness.readCount, 1);
      assert.equal(harness.subscriptions.length, 1);
    });
  }

  test(`iOS ${theme}: live Reduce Transparency toggles both directions without another query`, async t => {
    const harness = await mountHarness(t, { isDark });
    await harness.resolveInitial(false);
    for (const preference of [true, false, true, false]) {
      await harness.emit(preference);
      assert.deepEqual(harness.palette, createTranslucentPalette(theme, preference));
    }
    assert.deepEqual(harness.stateWrites, [false, true, false, true, false]);
    assert.equal(harness.readCount, 1);
    assert.equal(harness.subscriptions.length, 1);
    assert.equal(harness.removeCount, 0);
  });
}

for (const preference of [false, true]) {
  test(`iOS: changing app OS-theme input preserves the resolved accessibility preference ${preference}`, async t => {
    const harness = await mountHarness(t);
    await harness.resolveInitial(preference);
    const lightPalette = harness.palette;
    await harness.updateTheme(false);
    assert.equal(harness.palette, lightPalette, 'unchanged inputs retain the memoized palette');
    await harness.updateTheme(true);
    assert.deepEqual(harness.palette, createTranslucentPalette('dark', preference));
    assert.notEqual(harness.palette, lightPalette, 'a new theme recomputes colour tokens');
    const darkPalette = harness.palette;
    await harness.updateTheme(true);
    assert.equal(harness.palette, darkPalette);
    await harness.updateTheme(false);
    assert.deepEqual(harness.palette, createTranslucentPalette('light', preference));
    assert.deepEqual(harness.stateWrites, [preference], 'theme changes never reset native preference');
    assert.equal(harness.readCount, 1);
    assert.equal(harness.subscriptions.length, 1);
    assert.equal(harness.removeCount, 0);
  });
}

test('iOS: theme changes during the pending read stay solid, then use the latest theme on resolution', async t => {
  const harness = await mountHarness(t);
  await harness.updateTheme(true);
  assert.deepEqual(harness.palette, createTranslucentPalette('dark', true));
  await harness.resolveInitial(false);
  assert.deepEqual(harness.palette, createTranslucentPalette('dark', false));
  assert.equal(harness.readCount, 1);
  assert.equal(harness.subscriptions.length, 1);
});

test('iOS: rejecting the initial accessibility query retains solid fills and the live subscription', async t => {
  const harness = await mountHarness(t);
  await harness.rejectInitial();
  assert.deepEqual(harness.palette, createTranslucentPalette('light', true));
  assert.deepEqual(harness.stateWrites, [], 'rejection does not invent a preference');
  await harness.updateTheme(true);
  assert.deepEqual(harness.palette, createTranslucentPalette('dark', true));
  await harness.emit(false);
  assert.deepEqual(harness.palette, createTranslucentPalette('dark', false), 'live events still work after native query rejection');
  assert.equal(harness.readCount, 1);
  assert.equal(harness.subscriptions.length, 1);
});

for (const livePreference of [false, true]) {
  test(`iOS: late initial read ${!livePreference} cannot override newer live preference ${livePreference}`, async t => {
    const harness = await mountHarness(t);
    await harness.emit(livePreference);
    await harness.updateTheme(true);
    await harness.resolveInitial(!livePreference);
    assert.deepEqual(harness.palette, createTranslucentPalette('dark', livePreference));
    assert.deepEqual(harness.stateWrites, [livePreference], 'stale initial result must never call the state setter');
    await harness.emit(!livePreference);
    assert.deepEqual(harness.palette, createTranslucentPalette('dark', !livePreference), 'newer events remain authoritative after the fence');
  });
}

test('iOS: multiple live events before the initial read retain the newest preference', async t => {
  const harness = await mountHarness(t);
  await harness.emit(false);
  await harness.emit(true);
  await harness.emit(false);
  await harness.resolveInitial(true);
  assert.deepEqual(harness.palette, createTranslucentPalette('light', false));
  assert.deepEqual(harness.stateWrites, [false, true, false]);
});

test('iOS: a rejected stale query cannot reset a newer live translucent preference', async t => {
  const harness = await mountHarness(t);
  await harness.emit(false);
  await harness.rejectInitial();
  assert.deepEqual(harness.palette, createTranslucentPalette('light', false));
  assert.deepEqual(harness.stateWrites, [false]);
});

for (const latePreference of [false, true]) {
  test(`iOS: unmount removes the listener once and blocks late query ${latePreference} and queued events from setting state`, async t => {
    const harness = await mountHarness(t);
    await harness.unmount();
    const renderCount = harness.renderCount;
    assert.equal(harness.removeCount, 1);
    assert.equal(harness.subscriptions[0].removed, true);
    await harness.resolveInitial(latePreference);
    await harness.invokeRetainedListener(false);
    await harness.invokeRetainedListener(true);
    assert.deepEqual(harness.stateWrites, [], 'neither late completion nor an already queued callback can write after unmount');
    assert.equal(harness.renderCount, renderCount);
    await harness.unmount();
    assert.equal(harness.removeCount, 1, 'cleanup is not duplicated');
  });
}

test('iOS: a late query rejection after unmount is handled without a state update', async t => {
  const harness = await mountHarness(t);
  await harness.unmount();
  const renderCount = harness.renderCount;
  await harness.rejectInitial();
  assert.deepEqual(harness.stateWrites, []);
  assert.equal(harness.renderCount, renderCount);
  assert.equal(harness.removeCount, 1);
});

for (const missingApi of ['query', 'listener'] as const) {
  test(`iOS: missing native ${missingApi} API keeps the defensive solid default without partial subscriptions`, async t => {
    const harness = await mountHarness(t, { missingApi });
    assert.deepEqual(harness.palette, createTranslucentPalette('light', true));
    await harness.updateTheme(true);
    assert.deepEqual(harness.palette, createTranslucentPalette('dark', true));
    assert.equal(harness.readCount, 0);
    assert.equal(harness.subscriptions.length, 0);
    assert.deepEqual(harness.stateWrites, []);
    await harness.unmount();
    assert.equal(harness.removeCount, 0);
  });
}

for (const platform of ['android', 'web'] as const) {
  for (const isDark of [false, true]) {
    test(`${platform}, dark=${isDark}: never reads or subscribes to iOS transparency APIs on mount, theme change, or unmount`, async t => {
      const harness = await mountHarness(t, { platform, isDark });
      assert.deepEqual(harness.palette, createTranslucentPalette(isDark ? 'dark' : 'light', false));
      await harness.emit(true);
      await harness.resolveInitial(true);
      assert.deepEqual(harness.palette, createTranslucentPalette(isDark ? 'dark' : 'light', false));
      await harness.updateTheme(!isDark);
      assert.deepEqual(harness.palette, createTranslucentPalette(isDark ? 'light' : 'dark', false));
      await harness.unmount();
      assert.equal(harness.readCount, 0);
      assert.equal(harness.subscriptions.length, 0);
      assert.equal(harness.removeCount, 0);
      assert.deepEqual(harness.calls, [], 'no native accessibility API operations on this platform');
      assert.deepEqual(harness.stateWrites, []);
    });
  }
}
