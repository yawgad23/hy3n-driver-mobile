import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { DRIVER_DOCUMENT_KEYS, type DriverDocumentManifest } from '../lib/driver-document-manifest';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const requireHere = createRequire(__filename);
const FakeTimers = requireHere('@sinonjs/fake-timers') as {
  install(options: { toFake: string[] }): { tick(ms: number): void; countTimers(): number; uninstall(): void };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(uid = 'driver-a', revision = 'first'): DriverDocumentManifest {
  return {
    userId: uid, profileId: uid, approvalStatus: 'pending', documentsComplete: true,
    documentRevision: revision, missingDocuments: [],
    documents: Object.fromEntries(DRIVER_DOCUMENT_KEYS.map((key, i) => [key, {
      label: key, required: i < 6, status: i < 6 ? 'valid' : 'missing',
      reference: i < 6 ? `https://firebasestorage.googleapis.com/v0/b/hy3n26.firebasestorage.app/o/drivers%2F${uid}%2F${key}.jpg?alt=media` : null,
    }])) as DriverDocumentManifest['documents'],
    details: { fullName: 'Driver', email: 'driver@example.test', phone: '+233555111222', momoNumber: '', city: 'Accra',
      serviceType: 'car', acceptedCategories: ['standard'], vehicleMake: 'Toyota', vehicleModel: 'Camry',
      vehiclePlate: 'TEST', vehicleColor: '', vehicleYear: '' },
  };
}
async function mountHook(options: { token?: () => Promise<string>; check?: (signal: AbortSignal) => Promise<DriverDocumentManifest> } = {}) {
  const requests: AbortSignal[] = [];
  const env = {
    uid: 'driver-a' as string | null, currentUID: 'driver-a' as string | null,
    profile: { id: 'driver-a', user_id: 'driver-a', updated_date: '1' }, enabled: true,
    token: options.token ?? (async () => 'fixture-token'),
    check: options.check ?? (async () => fixture()),
  };
  let output!: { status: string; manifest: DriverDocumentManifest | null; error: string; recheck: () => Promise<DriverDocumentManifest | null> };
  let renders = 0;
  const bundle = await build({ entryPoints: [path.join(__dirname, '../hooks/use-driver-document-manifest.ts')], bundle: true,
    write: false, platform: 'node', format: 'cjs', external: ['react'], plugins: [{ name: 'manifest-transport-fixture', setup(b) {
      b.onResolve({ filter: /^@\/lib\/firebase$/ }, args => ({ path: args.path, external: true }));
    } }] });
  const firebase = {
    auth: { get currentUser() { return env.currentUID ? { uid: env.currentUID } : null; } },
    firebaseAuth: { getDriverDocumentManifest: async (signal: AbortSignal) => {
      requests.push(signal);
      // Like Firebase getIdToken: it may never settle and has no abort support.
      await env.token();
      // Deliberately ignore abort here too, to exercise the hook's own deadline.
      return env.check(signal);
    } },
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', bundle.outputFiles[0].text)((name: string) => name === '@/lib/firebase' ? firebase : requireHere(name), module, module.exports);
  const useManifest = module.exports.useDriverDocumentManifest;
  function Probe() { renders++; output = useManifest(env.uid, env.profile, env.enabled); return null; }
  const flushMicrotasks = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(Probe)); await flushMicrotasks(); });
  return {
    env, requests, get output() { return output; }, get renders() { return renders; },
    observe: () => output,
    flush: async () => { await act(async () => { await flushMicrotasks(); }); },
    update: async () => { await act(async () => { tree.update(React.createElement(Probe)); await flushMicrotasks(); }); },
    dispose: async () => { await act(async () => { tree.unmount(); await flushMicrotasks(); }); },
  };
}

for (const stage of ['helper', 'token'] as const) {
  test(`real hook bounds never-settling ${stage} promise and retry succeeds; late original resolution is ignored`, async () => {
    const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const waiting = deferred<DriverDocumentManifest>();
    const token = deferred<string>();
    const app = await mountHook(stage === 'helper' ? { check: () => waiting.promise } : { token: () => token.promise });
    try {
      assert.equal(app.output.status, 'checking');
      await act(async () => { clock.tick(19_999); });
      assert.equal(app.output.status, 'checking');
      await act(async () => { clock.tick(1); });
      await app.flush();
      assert.equal(app.output.status, 'error');
      assert.match(app.output.error, /timed out.*retry/i);
      assert.equal(app.output.manifest, null);
      assert.equal(app.requests[0].aborted, true);
      assert.equal(clock.countTimers(), 0);
      app.env.token = async () => 'retry-token';
      app.env.check = async () => fixture('driver-a', 'retry-success');
      let retry!: Promise<DriverDocumentManifest | null>;
      await act(async () => { retry = app.output.recheck(); await retry; });
      const retried = await retry;
      assert.equal(retried?.documentRevision, 'retry-success');
      assert.equal(app.output.status, 'ready');
      waiting.resolve(fixture('driver-a', 'stale-first'));
      token.resolve('late-token');
      await app.flush();
      assert.equal(app.observe().manifest?.documentRevision, 'retry-success');
      assert.equal(app.requests.length, 2);
      assert.equal(clock.countTimers(), 0);
    } finally { waiting.resolve(fixture()); token.resolve('cleanup'); await app.dispose(); clock.uninstall(); }
  });
}

test('real hook timeout resolves its returned recheck promise to null even when transport never settles', async () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  const app = await mountHook();
  let settled = false;
  let result: DriverDocumentManifest | null | undefined;
  try {
    app.env.check = () => new Promise(() => {});
    await act(async () => { void app.output.recheck().then(value => { result = value; settled = true; }); });
    assert.equal(app.output.status, 'checking');
    await act(async () => { clock.tick(20_000); });
    await app.flush();
    assert.equal(settled, true);
    assert.equal(result, null);
    assert.equal(app.output.status, 'error');
    assert.equal(clock.countTimers(), 0);
  } finally { await app.dispose(); clock.uninstall(); }
});

test('real hook request supersession promptly cancels previous recheck and rejects late resolution and rejection', async () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  const older = deferred<DriverDocumentManifest>();
  const newest = deferred<DriverDocumentManifest>();
  const app = await mountHook();
  let cancelled = false;
  try {
    app.env.check = () => older.promise;
    await act(async () => { void app.output.recheck().then(value => { assert.equal(value, null); cancelled = true; }); });
    app.env.check = () => newest.promise;
    let result!: Promise<DriverDocumentManifest | null>;
    await act(async () => { result = app.output.recheck(); });
    assert.equal(cancelled, true);
    assert.equal(app.requests[1].aborted, true);
    assert.equal(app.output.status, 'checking');
    await act(async () => { newest.resolve(fixture('driver-a', 'newest')); await result; });
    older.reject(new Error('late failure'));
    await app.flush();
    assert.equal(app.output.status, 'ready');
    assert.equal(app.output.manifest?.documentRevision, 'newest');
    assert.equal(clock.countTimers(), 0);
  } finally { older.resolve(fixture()); newest.resolve(fixture()); await app.dispose(); clock.uninstall(); }
});

for (const change of ['fingerprint', 'account'] as const) {
  test(`real hook ${change} invalidation settles old caller and masks old evidence until the new check is ready`, async () => {
    const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const stale = deferred<DriverDocumentManifest>();
    const fresh = deferred<DriverDocumentManifest>();
    const app = await mountHook();
    const obsoleteRecheck = app.output.recheck;
    let cancelled = false;
    try {
      app.env.check = () => stale.promise;
      await act(async () => { void app.output.recheck().then(value => { assert.equal(value, null); cancelled = true; }); });
      app.env.check = () => fresh.promise;
      if (change === 'fingerprint') app.env.profile = { ...app.env.profile, updated_date: '2' };
      else {
        app.env.uid = 'driver-b'; app.env.currentUID = 'driver-b';
        app.env.profile = { id: 'driver-b', user_id: 'driver-b', updated_date: '2' };
      }
      await app.update();
      assert.equal(cancelled, true);
      assert.equal(app.requests[1].aborted, true);
      assert.equal(app.output.status, 'checking');
      assert.equal(app.output.manifest, null);
      assert.equal(await obsoleteRecheck(), null);
      assert.equal(app.requests.length, 3);
      stale.resolve(fixture('driver-a', 'stale'));
      await app.flush();
      assert.equal(app.output.status, 'checking');
      fresh.resolve(fixture(app.env.uid!, 'fresh'));
      await app.flush();
      assert.equal(app.output.status, 'ready');
      assert.equal(app.observe().manifest?.userId, app.env.uid);
      assert.equal(app.observe().manifest?.documentRevision, 'fresh');
      await act(async () => { clock.tick(20_000); });
      assert.equal(app.output.status, 'ready');
      assert.equal(clock.countTimers(), 0);
    } finally { stale.resolve(fixture()); fresh.resolve(fixture()); await app.dispose(); clock.uninstall(); }
  });
}

for (const change of ['disabled', 'unmount'] as const) {
  test(`real hook ${change} cancels a pending caller, removes its deadline, and ignores late work`, async () => {
    const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const late = deferred<DriverDocumentManifest>();
    const app = await mountHook();
    const obsoleteRecheck = app.output.recheck;
    let disposed = false;
    let cancelled = false;
    try {
      app.env.check = () => late.promise;
      await act(async () => { void app.output.recheck().then(value => { assert.equal(value, null); cancelled = true; }); });
      if (change === 'disabled') { app.env.enabled = false; await app.update(); assert.equal(app.output.status, 'idle'); }
      else { await app.dispose(); disposed = true; }
      assert.equal(cancelled, true);
      assert.equal(app.requests[1].aborted, true);
      assert.equal(clock.countTimers(), 0);
      const renders = app.renders;
      assert.equal(await obsoleteRecheck(), null);
      assert.equal(app.requests.length, 2);
      late.resolve(fixture('driver-a', 'late'));
      await app.flush();
      assert.equal(app.renders, renders);
    } finally { late.resolve(fixture()); if (!disposed) await app.dispose(); clock.uninstall(); }
  });
}

test('real hook ignores transport completion and timeout when Firebase account changed before rerender', async () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  const late = deferred<DriverDocumentManifest>();
  const app = await mountHook({ check: () => late.promise });
  try {
    app.env.currentUID = 'driver-b';
    late.resolve(fixture('driver-a', 'foreign-late'));
    await app.flush();
    assert.equal(app.output.manifest, null);
    assert.notEqual(app.output.status, 'ready');
    await act(async () => { clock.tick(20_000); });
    assert.equal(app.output.manifest, null);
    assert.equal(app.output.error, '');
    assert.equal(clock.countTimers(), 0);
  } finally { late.resolve(fixture()); await app.dispose(); clock.uninstall(); }
});

test('real hook keeps timeout unknown after late success or failure without a retry', async () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  const late = deferred<DriverDocumentManifest>();
  const app = await mountHook({ check: () => late.promise });
  try {
    await act(async () => { clock.tick(20_000); });
    await app.flush();
    assert.equal(app.output.status, 'error');
    late.resolve(fixture('driver-a', 'too-late'));
    await app.flush();
    assert.equal(app.output.status, 'error');
    assert.equal(app.output.manifest, null);
    assert.match(app.output.error, /timed out/);
    const failure = deferred<DriverDocumentManifest>();
    app.env.check = () => failure.promise;
    await act(async () => { void app.output.recheck(); });
    await act(async () => { clock.tick(20_000); });
    await app.flush();
    failure.reject(new Error('late transport failure'));
    await app.flush();
    assert.equal(app.output.status, 'error');
    assert.match(app.output.error, /timed out/);
    assert.equal(clock.countTimers(), 0);
  } finally { late.resolve(fixture()); await app.dispose(); clock.uninstall(); }
});
