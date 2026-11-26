import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import {
  canConfirmDriverSubmission, DRIVER_DOCUMENT_KEYS, REQUIRED_DRIVER_DOCUMENT_KEYS,
  type DriverDocumentManifest,
} from '../lib/driver-document-manifest';
import {
  clampDriverDraftStep, createDriverRegistrationDraftSession, driverRegistrationDetailsMissing,
  driverRegistrationDraftKey, driverRegistrationMatchesSavedSubmission, driverRegistrationMissingLabels,
  driverRegistrationRecoveryStep, driverRegistrationRejectionReason, driverRegistrationRevision,
  emptyDriverRegistrationForm, isCurrentDriverRegistrationOperation, parseDriverRegistrationDraft,
  restoreDriverRegistrationForm, type DriverRegistrationDraft, type DriverRegistrationForm,
} from '../lib/driver-registration-draft';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const requireHere = createRequire(__filename);
const FakeTimers = requireHere('@sinonjs/fake-timers') as {
  install(options: { toFake: string[] }): { tick(ms: number): void; countTimers(): number; uninstall(): void };
};
const remote = (uid: string, key: string) => `https://firebasestorage.googleapis.com/v0/b/hy3n26.firebasestorage.app/o/drivers%2F${uid}%2F${key}.jpg?alt=media`;
const labels = ['Ghana Card (Front)', 'Ghana Card (Back)', "Driver's License (Front)", "Driver's License (Back)", 'Your Photo (Selfie)', 'Vehicle Photo', 'Insurance Certificate', 'Roadworthy Certificate'];
function fixture(uid = 'driver-a', count = 0): DriverDocumentManifest {
  return {
    userId: uid, profileId: uid, approvalStatus: 'pending', documentsComplete: count >= 6,
    documentRevision: `${uid}-${count}`, missingDocuments: labels.slice(Math.min(count, 6), 6),
    documents: Object.fromEntries(DRIVER_DOCUMENT_KEYS.map((key, i) => [key, {
      label: labels[i], required: i < 6, status: i < count ? 'valid' : 'missing', reference: i < count ? remote(uid, key) : null,
    }])) as DriverDocumentManifest['documents'],
    details: { fullName: 'Driver A', email: `${uid}@example.test`, phone: '+233555111222', momoNumber: '+233555111222',
      city: 'Accra', serviceType: 'car', acceptedCategories: ['standard'], vehicleMake: 'Toyota', vehicleModel: 'Camry',
      vehiclePlate: 'TEST-1', vehicleColor: 'Silver', vehicleYear: '2022' },
  };
}
const draftFor = (uid: string, overrides: Partial<DriverRegistrationDraft> = {}): DriverRegistrationDraft => ({
  version: 1, uid, step: 4, pendingEdits: false, form: emptyDriverRegistrationForm(), ...overrides,
});
function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const calls: string[] = [];
  return { values, calls,
    getItem: async (key: string) => { calls.push(`read:${key}`); return values.get(key) ?? null; },
    setItem: async (key: string, value: string) => { calls.push(`write:${key}`); values.set(key, value); },
    removeItem: async (key: string) => { calls.push(`clear:${key}`); values.delete(key); },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function childText(value: any): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(childText).join(' ');
  return value?.props ? childText(value.props.children) : '';
}

for (const count of [0, 1, 3, 5, 6]) {
  test(`pending with ${count} of six verified documents only confirms when all six exist`, () => {
    const manifest = fixture('driver-a', count);
    assert.equal(canConfirmDriverSubmission(manifest, 'driver-a'), count === 6);
    const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, manifest, false);
    assert.equal(driverRegistrationRecoveryStep({ status: 'ready', confirmed: canConfirmDriverSubmission(manifest, 'driver-a'), pendingEdits: false,
      detailsMissing: driverRegistrationDetailsMissing(form) }), count === 6 ? 5 : 4);
    assert.deepEqual(driverRegistrationMissingLabels(manifest), labels.slice(count, 6));
    assert.equal(driverRegistrationRevision(manifest), `driver-a-${count}`);
  });
}

test('complete manifest ignores absent optional insurance/roadworthy, and rejects local/malformed or foreign references', () => {
  const valid = fixture('driver-a', 6);
  assert.equal(canConfirmDriverSubmission(valid, 'driver-a'), true);
  assert.equal(valid.documents.insurance.required, false);
  assert.equal(valid.documents.roadworthy.status, 'missing');
  for (const reference of ['file:///fake.jpg', 'content://camera/a', 'not-a-url', remote('driver-b', 'front'), 'https://example.test/a.jpg']) {
    const manifest = fixture('driver-a', 6);
    manifest.documents.ghanaCardFront.reference = reference;
    assert.equal(canConfirmDriverSubmission(manifest, 'driver-a'), false);
  }
  assert.equal(canConfirmDriverSubmission(valid, 'driver-b'), false);
  for (const approvalStatus of ['rejected', 'approved'] as const) {
    assert.equal(canConfirmDriverSubmission({ ...valid, approvalStatus }, 'driver-a'), false);
  }
});

test('incomplete personal details restore step three, and network/idle/checking are unknown rather than missing', () => {
  const manifest = fixture('driver-a', 0);
  manifest.details.city = '';
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, manifest, false);
  assert.equal(driverRegistrationRecoveryStep({ status: 'ready', confirmed: false, pendingEdits: false, detailsMissing: driverRegistrationDetailsMissing(form) }), 3);
  for (const status of ['idle', 'checking', 'error'] as const) {
    assert.equal(driverRegistrationRecoveryStep({ status, confirmed: true, pendingEdits: false, detailsMissing: false }), null);
  }
  assert.equal(driverRegistrationRecoveryStep({ status: 'ready', confirmed: true, pendingEdits: true, detailsMissing: false }), 4);
});

test('drafts are UID-scoped, stored UID checked, stale step five clamped and passwords excluded', () => {
  assert.notEqual(driverRegistrationDraftKey('driver-a'), driverRegistrationDraftKey('driver-b'));
  assert.equal(driverRegistrationDraftKey('a/b'), 'hy3n_driver_register_draft:a%2Fb');
  const raw = JSON.stringify({ ...draftFor('driver-a', { step: 5 }), password: 'never-save', form: { ...emptyDriverRegistrationForm(), password: 'never-save' } });
  assert.equal(parseDriverRegistrationDraft(raw, 'driver-a')?.step, 4);
  assert.equal(parseDriverRegistrationDraft(raw, 'driver-b'), null);
  assert.equal(parseDriverRegistrationDraft('{broken', 'driver-a'), null);
  assert.equal(parseDriverRegistrationDraft(JSON.stringify({ step: 5, fullName: 'Legacy account' }), 'driver-a'), null);
  assert.equal('password' in parseDriverRegistrationDraft(raw, 'driver-a')!.form, false);
  assert.equal(parseDriverRegistrationDraft(JSON.stringify(draftFor('driver-a', {
    form: { ...emptyDriverRegistrationForm(), driverPhoto: 'file:///new.jpg' }, pendingEdits: false,
  })), 'driver-a')?.pendingEdits, true);
  for (const value of [undefined, NaN, '5', 5, 99, -10]) assert.ok(clampDriverDraftStep(value) <= 4);
});

test('manifest restoration only restores valid references, preserving local picks, explicit removals and rejected reason', () => {
  const draft = { ...emptyDriverRegistrationForm(), fullName: 'Unsaved Name', ghanaCardFront: 'file:///new-front.jpg',
    licenseBack: remote('driver-b', 'stale'), driverPhoto: '', insurancePhoto: 'malformed' };
  const manifest = fixture('driver-a', 6);
  const restored = restoreDriverRegistrationForm(draft, { rejection_reason: 'Replace blurry photo' }, manifest, true, new Set(['driverPhoto']));
  assert.equal(restored.fullName, 'Unsaved Name');
  assert.equal(restored.ghanaCardFront, 'file:///new-front.jpg');
  assert.equal(restored.licenseBack, manifest.documents.licenseBack.reference);
  assert.equal(restored.driverPhoto, '');
  assert.equal(restored.insurancePhoto, '');
  assert.equal(restored.vehicleFullModel, '2022');
  assert.equal(driverRegistrationRejectionReason({ rejection_reason: 'Replace blurry photo' }), 'Replace blurry photo');
});

test('saved submission retry only matches exact saved fields, categories and references', () => {
  const manifest = fixture('driver-a', 6);
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, manifest, false);
  assert.equal(driverRegistrationMatchesSavedSubmission(form, manifest), true);
  assert.equal(driverRegistrationMatchesSavedSubmission({ ...form, fullName: 'New unsaved edit' }, manifest), false);
  assert.equal(driverRegistrationMatchesSavedSubmission({ ...form, ghanaCardFront: 'file:///new.jpg' }, manifest), false);
  assert.equal(driverRegistrationMatchesSavedSubmission({ ...form, selectedCategories: ['comfort'] }, manifest), false);
});

test('hydration finishes before any write; queued writes and confirmed clear are serialized without resurrection', async () => {
  const storage = memoryStorage({ [driverRegistrationDraftKey('driver-a')]: JSON.stringify(draftFor('driver-a', { step: 5 })) });
  const readBarrier = deferred<string | null>();
  const session = createDriverRegistrationDraftSession({ ...storage, getItem: async key => {
    storage.calls.push(`read:${key}`); return readBarrier.promise;
  } }, 'driver-a');
  const reading = session.read();
  await session.write(draftFor('driver-a'), () => true);
  assert.equal(storage.calls.filter(call => call.startsWith('write')).length, 0);
  readBarrier.resolve(storage.values.get(driverRegistrationDraftKey('driver-a'))!);
  assert.equal((await reading)?.step, 4);
  const first = session.write(draftFor('driver-a', { form: { ...emptyDriverRegistrationForm(), fullName: 'Keep' } }), () => true);
  const clear = session.confirmedClear(() => true);
  const late = session.write(draftFor('driver-a'), () => true);
  await Promise.all([first, clear, late]);
  assert.equal(storage.values.has(driverRegistrationDraftKey('driver-a')), false);
  assert.equal(storage.calls.at(-1), `clear:${driverRegistrationDraftKey('driver-a')}`);
});

test('no premature clear or account-change queued write; failures retain the previous draft', async () => {
  const storage = memoryStorage();
  const session = createDriverRegistrationDraftSession(storage, 'driver-a');
  await session.read();
  await session.write(draftFor('driver-a'), () => true);
  await session.confirmedClear(() => false);
  assert.ok(storage.values.has(driverRegistrationDraftKey('driver-a')));
  await session.write(draftFor('driver-a', { form: { ...emptyDriverRegistrationForm(), fullName: 'Stale' } }), () => false);
  assert.equal(JSON.parse(storage.values.get(driverRegistrationDraftKey('driver-a'))!).form.fullName, '');
  const failing = createDriverRegistrationDraftSession({ ...storage, setItem: async () => { throw new Error('disk offline'); } }, 'driver-a');
  await failing.read();
  await assert.rejects(failing.write(draftFor('driver-a'), () => true), /disk offline/);
  assert.ok(storage.values.has(driverRegistrationDraftKey('driver-a')));
});

test('a cancelled queued clear does not delete new edits, and cross-mount reads wait for prior writes', async () => {
  const storage = memoryStorage();
  const barrier = deferred<void>();
  const first = createDriverRegistrationDraftSession({ ...storage, setItem: async (key, value) => {
    await barrier.promise; await storage.setItem(key, value);
  } }, 'driver-a');
  await first.read();
  const writing = first.write(draftFor('driver-a', { form: { ...emptyDriverRegistrationForm(), fullName: 'Prior mount' } }), () => true);
  await Promise.resolve();
  const second = createDriverRegistrationDraftSession(storage, 'driver-a');
  const reading = second.read();
  barrier.resolve();
  await writing;
  assert.equal((await reading)?.form.fullName, 'Prior mount');
  let clean = true;
  const clearing = second.confirmedClear(() => clean);
  clean = false;
  second.resumeEdits();
  const edit = second.write(draftFor('driver-a', { pendingEdits: true }), () => true);
  await Promise.all([clearing, edit]);
  assert.ok(storage.values.has(driverRegistrationDraftKey('driver-a')));
});

test('late checks, submits, auth reloads and unmount completion cannot mutate another UID or a recycled same-UID generation', () => {
  const ticket = { uid: 'driver-a', generation: 1 };
  const base = { uid: 'driver-a', generation: 1, mounted: true, authUID: 'driver-a' };
  assert.equal(isCurrentDriverRegistrationOperation(ticket, base), true);
  for (const changed of [{ uid: 'driver-b' }, { authUID: 'driver-b' }, { generation: 2 }, { mounted: false }]) {
    assert.equal(isCurrentDriverRegistrationOperation(ticket, { ...base, ...changed }), false);
  }
});

// Bundle only the assigned screen and its real pure helpers. Native, auth,
// storage, and server manifest are controlled fixtures, never production calls.
async function mountRegistration(options: { count?: number; savedDraft?: DriverRegistrationDraft; authLoading?: boolean;
  anonymous?: boolean; emailVerified?: boolean; approvalStatus?: 'pending' | 'approved' | 'rejected'; storageRead?: Promise<string | null>;
  reload?: () => Promise<void>; refresh?: () => Promise<void> } = {}) {
  const storage = memoryStorage(options.savedDraft ? { [driverRegistrationDraftKey(options.savedDraft.uid)]: JSON.stringify(options.savedDraft) } : {});
  const user = { uid: 'driver-a', email: 'driver-a@example.test', displayName: 'Driver A', emailVerified: options.emailVerified !== false, reload: options.reload ?? (async () => {}) };
  const env: any = {
    auth: { user: options.anonymous ? null : user, driverProfile: options.anonymous ? null : { id: user.uid, user_id: user.uid,
      approval_status: options.approvalStatus ?? 'pending', rejection_reason: 'Replace blurry front image' }, loading: !!options.authLoading },
    snapshot: { manifest: fixture(user.uid, options.count ?? 0), status: 'ready', error: '' },
    currentUser: options.anonymous ? null : user, routes: [] as string[], submits: [] as unknown[], clears: storage.calls,
    submit: async () => {}, refresh: options.refresh ?? (async () => {}), check: async () => env.snapshot.manifest,
    upload: async (_blob: unknown, key: string) => remote(env.currentUser.uid, key.split('/').at(-1)!.replace('.jpg', '')),
    preparations: [] as string[], disposed: [] as string[],
    prepare: async (uri: string, assertCurrent?: () => void) => {
      assertCurrent?.();
      return { uri: 'file:///cache/prepared.jpg', blob: new Blob(['converted-jpeg-fixture'], { type: 'image/jpeg' }), contentType: 'image/jpeg',
        dispose: async () => { env.disposed.push(uri); } };
    },
    signup: async () => {}, google: async () => {},
  };
  env.snapshot.manifest.approvalStatus = options.approvalStatus ?? 'pending';
  const mocked = new Set(['react-native', 'expo-router', 'react-native-safe-area-context', '@expo/vector-icons/MaterialIcons', 'expo-image-picker',
    '@/lib/driver-auth-context', '@/lib/firebase', '@/lib/driver-photo-native', '@react-native-async-storage/async-storage', '@/lib/support-whatsapp', '@/hooks/use-driver-document-manifest', 'firebase/auth']);
  const result = await build({ entryPoints: [path.join(__dirname, '../app/driver/register.tsx')], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['react'], plugins: [{ name: 'registration-fixtures', setup(b) {
      b.onResolve({ filter: /.*/ }, args => mocked.has(args.path) ? { path: args.path, external: true } : null);
    } }] });
  const native = { View: 'view', Text: 'text', TextInput: 'input', TouchableOpacity: 'button', ScrollView: 'scroll', Image: 'image',
    ActivityIndicator: 'loader', KeyboardAvoidingView: 'keyboard', Platform: { OS: 'ios' }, Alert: { alert: () => {} }, StyleSheet: { create: (v: any) => v } };
  const firebase = { auth: { get currentUser() { return env.currentUser; } }, firebaseAuth: {
    submitDriverProfile: async (payload: any) => { env.submits.push(payload); return env.submit(); },
  }, firebaseStorage: { uploadFile: (blob: unknown, key: string, metadata?: { contentType: string }) => env.upload(blob, key, metadata) } };
  const mocks: Record<string, unknown> = {
    'react-native': native, 'expo-router': { useRouter: () => ({ replace: (route: string) => env.routes.push(route), push: () => {} }) },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    '@expo/vector-icons/MaterialIcons': (props: any) => React.createElement('icon', props),
    'expo-image-picker': {}, '@/lib/driver-auth-context': { useDriverAuth: () => ({ ...env.auth,
      signUp: (...args: any[]) => env.signup(...args), signInWithGoogle: () => env.google(), refreshProfile: () => env.refresh() }) },
    '@/lib/firebase': firebase, '@react-native-async-storage/async-storage': options.storageRead ? { ...storage, getItem: async (key: string) => {
      storage.calls.push(`read:${key}`); return options.storageRead;
    } } : storage,
    '@/lib/support-whatsapp': { openDriverSupportWhatsApp: async () => {} },
    '@/lib/driver-photo-native': { prepareDriverDocumentPhoto: async (uri: string, assertCurrent?: () => void) => {
      env.preparations.push(uri);
      return env.prepare(uri, assertCurrent);
    } },
    '@/hooks/use-driver-document-manifest': { useDriverDocumentManifest: (uid: string | null, _profile: unknown, enabled: boolean) => ({
      ...(enabled && env.snapshot.manifest?.userId === uid ? env.snapshot : { status: enabled ? 'checking' : 'idle', manifest: null, error: '' }),
      recheck: () => env.check(),
    }) },
    'firebase/auth': { sendEmailVerification: async () => {} },
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)((name: string) => mocks[name] ?? requireHere(name), module, module.exports);
  const Component = module.exports.default;
  let tree!: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  await act(async () => { tree = create(React.createElement(Component)); await flush(); });
  return { env, storage, tree,
    rendered: () => JSON.stringify(tree.toJSON()),
    update: async () => { await act(async () => { tree.update(React.createElement(Component)); await flush(); }); },
    flush: async () => { await act(async () => { await flush(); }); },
    dispose: async () => { await act(async () => { tree.unmount(); await flush(); }); },
    input: async (index: number, value: string) => { await act(async () => { tree.root.findAllByType('input')[index].props.onChangeText(value); await flush(); }); },
    press: async (label: string) => { const button = tree.root.findAllByType('button').find(node => childText(node.props.children).includes(label));
      assert.ok(button, `button ${label} exists`); await act(async () => { await button.props.onPress(); await flush(); }); },
    startPress: async (label: string) => {
      const button = tree.root.findAllByType('button').find(node => childText(node.props.children).includes(label));
      assert.ok(button, `button ${label} exists`);
      let completion!: Promise<void>;
      await act(async () => { completion = Promise.resolve(button.props.onPress()); await flush(); });
      return { completion };
    },
  };
}

test('actual screen renders incomplete pending repair with exact labels and valid partial restored selections', async () => {
  const app = await mountRegistration({ count: 3 });
  try {
    assert.match(app.rendered(), /Vehicle & Documents/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.match(app.rendered(), /Driver's License \(Back\)/);
    assert.equal(app.tree.root.findAllByType('image').length, 3);
    assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 0);
  } finally { await app.dispose(); }
});

test('actual unverified email remains on verification step with a single cancellable timer, not an endless loader', async () => {
  const app = await mountRegistration({ emailVerified: false });
  try {
    assert.match(app.rendered(), /Verify Your Email/);
    assert.doesNotMatch(app.rendered(), /Checking your account/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
  } finally { await app.dispose(); }
});

test('actual approved profile routes home without editing; rejected complete profile retains reason and remains editable', async () => {
  const approved = await mountRegistration({ count: 6, approvalStatus: 'approved' });
  try {
    assert.ok(approved.env.routes.includes('/home'));
    assert.doesNotMatch(approved.rendered(), /Application Submitted!/);
    assert.equal(approved.env.submits.length, 0);
  } finally { await approved.dispose(); }
  const rejected = await mountRegistration({ count: 6, approvalStatus: 'rejected' });
  try {
    assert.match(rejected.rendered(), /Replace blurry front image/);
    assert.match(rejected.rendered(), /Vehicle & Documents/);
    assert.doesNotMatch(rejected.rendered(), /Application Submitted!/);
    assert.equal(rejected.storage.calls.filter(v => v.startsWith('clear')).length, 0);
  } finally { await rejected.dispose(); }
});

test('only this component email-signup carries fresh form to its new UID; arbitrary account selection resets it', async () => {
  const app = await mountRegistration({ anonymous: true });
  const created = { uid: 'fresh-driver', email: 'fresh@example.test', displayName: 'Fresh Driver', emailVerified: false, reload: async () => {} };
  try {
    await app.input(0, 'Fresh Driver');
    await app.input(1, created.email);
    await app.input(2, 'fixture-password');
    await app.input(3, 'fixture-password');
    app.env.signup = async () => {
      app.env.currentUser = created;
      app.env.auth = { user: created, driverProfile: null, loading: false };
    };
    await app.press('Create Account');
    await app.update();
    assert.match(app.rendered(), /Verify Your Email/);
    const raw = app.storage.values.get(driverRegistrationDraftKey(created.uid));
    assert.ok(raw);
    assert.equal(JSON.parse(raw).form.fullName, 'Fresh Driver');
    assert.equal(raw.includes('fixture-password'), false);
    const other = { uid: 'driver-b', email: 'driver-b@example.test', displayName: 'Driver B', emailVerified: true, reload: async () => {} };
    app.env.currentUser = other;
    app.env.auth = { user: other, driverProfile: { id: other.uid, user_id: other.uid, approval_status: 'pending' }, loading: false };
    app.env.snapshot = { status: 'ready', manifest: fixture(other.uid, 0), error: '' };
    await app.update();
    assert.equal(JSON.parse(app.storage.values.get(driverRegistrationDraftKey(other.uid))!).form.fullName, 'Driver A');
    assert.doesNotMatch(app.rendered(), /Fresh Driver/);
  } finally { await app.dispose(); }
});

test('actual screen waits for auth and draft hydration; stale local step five cannot flash or clear', async () => {
  const saved = draftFor('driver-a', { step: 5 });
  const barrier = deferred<string | null>();
  const app = await mountRegistration({ savedDraft: saved, authLoading: true, storageRead: barrier.promise });
  try {
    assert.match(app.rendered(), /Checking your account/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.equal(app.storage.calls.length, 0);
    app.env.auth.loading = false;
    await app.update();
    assert.equal(app.storage.calls.filter(v => v.startsWith('write')).length, 0);
    barrier.resolve(JSON.stringify(saved));
    await app.flush();
    assert.match(app.rendered(), /Vehicle & Documents/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 0);
  } finally { barrier.resolve(JSON.stringify(saved)); await app.dispose(); }
});

test('actual complete pending confirms and clears, whereas unsaved local edit remains editable and retained', async () => {
  const complete = await mountRegistration({ count: 6 });
  try {
    assert.match(complete.rendered(), /Application Submitted!/);
    assert.equal(complete.storage.values.has(driverRegistrationDraftKey('driver-a')), false);
  } finally { await complete.dispose(); }
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
  const edited = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form: { ...form, ghanaCardFront: 'file:///new.jpg' } }) });
  try {
    assert.match(edited.rendered(), /Vehicle & Documents/);
    assert.doesNotMatch(edited.rendered(), /Application Submitted!/);
    assert.ok(edited.storage.values.has(driverRegistrationDraftKey('driver-a')));
  } finally { await edited.dispose(); }
});

test('actual screen preserves edits on save failure and unknown check; retry can confirm only the exact successful save', async () => {
  const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true,
    form: restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false) }) });
  try {
    await app.input(0, 'Unsaved make');
    app.env.submit = async () => { throw new Error('save failed'); };
    await app.press('Submit Application');
    assert.match(app.rendered(), /save failed/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.equal(JSON.parse(app.storage.values.get(driverRegistrationDraftKey('driver-a'))!).form.vehicleMake, 'Unsaved make');
    app.env.submit = async () => {};
    let checks = 0;
    app.env.check = async () => ++checks === 1 ? app.env.snapshot.manifest : null;
    await app.press('Submit Application');
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.ok(app.storage.values.has(driverRegistrationDraftKey('driver-a')));
    app.env.snapshot = { status: 'error', manifest: null, error: 'Network unknown' };
    // Keep an owned placeholder for the mock's UID gate while simulating unknown.
    app.env.snapshot.manifest = fixture('driver-a', 6);
    await app.update();
    assert.match(app.rendered(), /Verification unavailable/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    const checked = fixture('driver-a', 6);
    checked.details.vehicleMake = 'Unsaved make';
    app.env.check = async () => checked;
    await app.press('Retry verification');
    app.env.snapshot = { status: 'ready', manifest: checked, error: '' };
    await app.update();
    assert.match(app.rendered(), /Application Submitted!/);
    assert.equal(app.storage.values.has(driverRegistrationDraftKey('driver-a')), false);
  } finally { await app.dispose(); }
});

test('actual account change masks prior success immediately and resets fields; late old submission cannot clear new UID draft', async () => {
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
  const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
  const pending = deferred<void>();
  try {
    app.env.submit = () => pending.promise;
    const submitButton = app.tree.root.findAllByType('button').find(node => childText(node.props.children).includes('Submit Application'))!;
    let submission!: Promise<void>;
    await act(async () => { submission = submitButton.props.onPress(); await Promise.resolve(); });
    const next = { uid: 'driver-b', email: 'driver-b@example.test', displayName: 'Driver B', emailVerified: true, reload: async () => {} };
    app.env.currentUser = next;
    app.env.auth = { user: next, driverProfile: { id: next.uid, user_id: next.uid, approval_status: 'pending' }, loading: true };
    app.env.snapshot = { status: 'ready', manifest: fixture('driver-b', 0), error: '' };
    await app.update();
    assert.match(app.rendered(), /Checking your account/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    app.env.auth.loading = false;
    await app.update();
    assert.equal(app.tree.root.findAllByType('input')[0].props.value, 'Toyota');
    await act(async () => { pending.resolve(); await submission; });
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.ok(app.storage.values.has(driverRegistrationDraftKey('driver-b')));
    assert.equal(app.storage.calls.filter(v => v === `clear:${driverRegistrationDraftKey('driver-b')}`).length, 0);
  } finally { pending.resolve(); await app.dispose(); }
});

test('initial local upload failure is fail-closed and retains camera selection and own-UID draft', async () => {
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
  form.ghanaCardFront = 'file:///camera-front.jpg';
  const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({ blob: async () => ({ fixture: true }) })) as unknown as typeof fetch;
    let uploadPath = '';
    app.env.upload = async (_blob: unknown, key: string) => { uploadPath = key; throw new Error('initial upload failed'); };
    await app.press('Submit Application');
    assert.equal(uploadPath, 'drivers/driver-a/ghana-card-front.jpg');
    assert.equal(app.env.submits.length, 0);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.match(app.rendered(), /Ghana Card \(Front\)/);
    assert.doesNotMatch(app.rendered(), /initial upload failed/);
    assert.deepEqual(app.env.preparations, [form.ghanaCardFront]);
    assert.deepEqual(app.env.disposed, [form.ghanaCardFront]);
    assert.equal(JSON.parse(app.storage.values.get(driverRegistrationDraftKey('driver-a'))!).form.ghanaCardFront, form.ghanaCardFront);
  } finally { globalThis.fetch = originalFetch; await app.dispose(); }
});

test('late camera callback from previous UID cannot insert its document into another account', async () => {
  const app = await mountRegistration({ count: 0 });
  try {
    const field = app.tree.root.findAll(node => typeof node.type === 'function' && node.type.name === 'FileUploadField')[0];
    const oldPick = field.props.onPick;
    const other = { uid: 'driver-b', email: 'driver-b@example.test', displayName: 'Driver B', emailVerified: true, reload: async () => {} };
    app.env.currentUser = other;
    app.env.auth = { user: other, driverProfile: { id: other.uid, user_id: other.uid, approval_status: 'pending' }, loading: false };
    app.env.snapshot = { status: 'ready', manifest: fixture(other.uid, 0), error: '' };
    await app.update();
    await act(async () => { oldPick('file:///previous-user-card.jpg'); });
    await app.flush();
    assert.equal(JSON.parse(app.storage.values.get(driverRegistrationDraftKey(other.uid))!).form.ghanaCardFront, '');
    assert.doesNotMatch(app.rendered(), /previous-user-card/);
  } finally { await app.dispose(); }
});

test('source boundary preserves camera/front-back/manual approval and narrowly scoped initial uploads', () => {
  const source = readFileSync(path.join(__dirname, '../app/driver/register.tsx'), 'utf8');
  assert.match(source, /launchCameraAsync/);
  assert.match(source, /launchImageLibraryAsync/);
  for (const key of REQUIRED_DRIVER_DOCUMENT_KEYS) assert.ok(source.includes(key));
  assert.ok(source.includes('`drivers/${submitUser.uid}/${key}.jpg`'));
  assert.doesNotMatch(source, /\/applications\/\$\{key\}/);
  assert.match(source, /await firebaseAuth\.submitDriverProfile/);
  assert.match(source, /await refreshProfile\(\)/);
  assert.match(source, /const checked = await recheck\(\)/);
  assert.match(source, /canConfirmDriverSubmission\(checked, submitUser\.uid\)/);
  assert.doesNotMatch(source, /AsyncStorage\.(getItem|removeItem)\('hy3n_driver_register_draft'\)/);
  assert.doesNotMatch(source, /setInterval\(/);
  assert.match(source, /clearTimeout\(pollRef\.current\)/);
  assert.match(source, /Our admin team will review/);
  assert.doesNotMatch(source, /approval_status:\s*['"]approved/);
});

const localDocumentFields = ['ghanaCardFront', 'ghanaCardBack', 'licenseFront', 'licenseBack', 'driverPhoto', 'vehiclePhoto'] as const;
function localUploadForm() {
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
  for (const field of localDocumentFields) form[field] = `file:///camera-${field}.jpg`;
  return form;
}

test('POST success with a complete old manifest cannot confirm or erase the edited form and local selection', async () => {
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
  form.ghanaCardFront = 'file:///new-front.jpg';
  const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({ blob: async () => ({ fixture: true }) })) as unknown as typeof fetch;
    await app.input(0, 'Edited make');
    await app.press('Submit Application');
    assert.equal(app.env.submits.length, 1);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.match(app.rendered(), /Vehicle & Documents/);
    assert.match(app.rendered(), /saved.*not.*reflected|not.*match|could not be confirmed/i);
    assert.equal(app.tree.root.findAllByType('input')[0].props.value, 'Edited make');
    assert.ok(app.tree.root.findAllByType('image').some(node => node.props.source.uri === form.ghanaCardFront));
    const raw = app.storage.values.get(driverRegistrationDraftKey('driver-a'));
    assert.ok(raw);
    assert.equal(JSON.parse(raw).pendingEdits, true);
    assert.equal(JSON.parse(raw).form.vehicleMake, 'Edited make');
    assert.equal(JSON.parse(raw).form.ghanaCardFront, form.ghanaCardFront);
    assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 0);
  } finally { globalThis.fetch = originalFetch; await app.dispose(); }
});

test('six local uploads confirm only their saved remote references with normalized details and category order', async () => {
  const form = localUploadForm();
  form.selectedCategories = ['standard', 'comfort'];
  const app = await mountRegistration({ count: 0, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
  const originalFetch = globalThis.fetch;
  const uploads: string[] = [];
  try {
    globalThis.fetch = (async () => ({ blob: async () => ({ fixture: true }) })) as unknown as typeof fetch;
    app.env.upload = async (_blob: unknown, key: string) => { uploads.push(key); return remote('driver-a', key.split('/').at(-1)!.replace('.jpg', '')); };
    await app.input(0, ' Toyota ');
    app.env.submit = async () => {
      const payload = app.env.submits.at(-1);
      const checked = fixture('driver-a', 6);
      checked.documentRevision = 'six-upload-save';
      checked.details.vehicleMake = payload.vehicleMake.trim();
      checked.details.acceptedCategories = [...payload.rideCategories].reverse();
      for (const key of REQUIRED_DRIVER_DOCUMENT_KEYS) checked.documents[key].reference = payload.documents[key];
      app.env.snapshot = { manifest: checked, status: 'ready', error: '' };
    };
    await app.press('Submit Application');
    assert.equal(uploads.length, 6);
    assert.equal(new Set(uploads).size, 6);
    assert.ok(uploads.every(key => key.startsWith('drivers/driver-a/')));
    assert.equal(app.env.submits.length, 1);
    for (const key of REQUIRED_DRIVER_DOCUMENT_KEYS) assert.equal(app.env.submits[0].documents[key], app.env.snapshot.manifest.documents[key].reference);
    assert.match(app.rendered(), /Application Submitted!/);
    assert.equal(app.storage.values.has(driverRegistrationDraftKey('driver-a')), false);
    assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 1);
  } finally { globalThis.fetch = originalFetch; await app.dispose(); }
});

test('partial concurrent upload failure retains all six local picks, never posts or clears, and ignores late upload completion', async () => {
  const form = localUploadForm();
  const app = await mountRegistration({ count: 0, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
  const originalFetch = globalThis.fetch;
  const late = deferred<string>();
  let completed = 0;
  const uploads: string[] = [];
  let submission: Promise<void> | undefined;
  try {
    globalThis.fetch = (async () => ({ blob: async () => ({ fixture: true }) })) as unknown as typeof fetch;
    app.env.upload = async (_blob: unknown, key: string) => {
      uploads.push(key);
      if (key.endsWith('vehicle-photo.jpg')) return late.promise;
      if (key.endsWith('drivers-license-back.jpg')) throw new Error('partial upload failed');
      completed++;
      return remote('driver-a', key.split('/').at(-1)!.replace('.jpg', ''));
    };
    ({ completion: submission } = await app.startPress('Submit Application'));
    assert.equal(uploads.length, 6);
    assert.equal(completed, 4);
    assert.equal(app.env.submits.length, 0);
    assert.match(app.rendered(), /Preparing & uploading/);
    const busy = app.tree.root.findAllByType('button').find(node => childText(node.props.children).includes('Preparing & uploading'));
    assert.equal(busy?.props.disabled, true);
    late.resolve(remote('driver-a', 'vehicle-photo'));
    await act(async () => { await submission; });
    await app.flush();
    assert.match(app.rendered(), /Driver's License \(Back\)/);
    assert.doesNotMatch(app.rendered(), /partial upload failed/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.equal(app.env.submits.length, 0);
    const saved = JSON.parse(app.storage.values.get(driverRegistrationDraftKey('driver-a'))!);
    for (const field of localDocumentFields) assert.equal(saved.form[field], form[field]);
    assert.equal(saved.pendingEdits, true);
    assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 0);
  } finally { late.resolve(remote('driver-a', 'vehicle-photo')); await act(async () => { await submission; }); globalThis.fetch = originalFetch; await app.dispose(); }
});

test('a failed batch drains old writes before a replacement-photo retry can upload or save', async () => {
  const form = localUploadForm();
  const app = await mountRegistration({ count: 0, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
  const heldFront = deferred<void>();
  const stored = new Map<string, string>();
  const frontPath = 'drivers/driver-a/ghana-card-front.jpg';
  let holdFront = true;
  let failBack = true;
  let uploads = 0;
  let submission: Promise<void> | undefined;
  try {
    app.env.prepare = async (uri: string, assertCurrent: () => void) => {
      assertCurrent();
      return { uri: 'file:///cache/prepared.jpg', blob: new Blob([uri], { type: 'image/jpeg' }),
        contentType: 'image/jpeg', dispose: async () => {} };
    };
    app.env.upload = async (blob: Blob, key: string) => {
      uploads++;
      const contents = await blob.text();
      if (key === frontPath && holdFront) { holdFront = false; await heldFront.promise; }
      if (key.endsWith('ghana-card-back.jpg') && failBack) { failBack = false; throw new Error('private provider failure'); }
      stored.set(key, contents);
      return remote('driver-a', key.split('/').at(-1)!.replace('.jpg', ''));
    };
    ({ completion: submission } = await app.startPress('Submit Application'));
    assert.match(app.rendered(), /Preparing & uploading/);
    assert.equal(uploads, 6);
    assert.equal(stored.has(frontPath), false);
    // Even invoking the disabled button's handler cannot start a second batch.
    await app.press('Preparing & uploading');
    assert.equal(uploads, 6);
    assert.equal(app.env.submits.length, 0);
    heldFront.resolve();
    await act(async () => { await submission; });
    await app.flush();
    assert.equal(stored.get(frontPath), form.ghanaCardFront);
    assert.match(app.rendered(), /Ghana Card \(Back\)/);
    assert.doesNotMatch(app.rendered(), /private provider failure/);
    assert.equal(app.env.submits.length, 0);
    const replacement = 'file:///gallery/replacement-front.png';
    const frontField = app.tree.root.findAll(node => typeof node.type === 'function'
      && node.props.label === 'Ghana Card (Front)' && typeof node.props.onPick === 'function')[0];
    assert.ok(frontField);
    await act(async () => { frontField.props.onPick(replacement); });
    await app.flush();
    app.env.submit = async () => {
      const payload = app.env.submits.at(-1);
      const checked = fixture('driver-a', 6);
      checked.documentRevision = 'replacement-save';
      for (const key of REQUIRED_DRIVER_DOCUMENT_KEYS) checked.documents[key].reference = payload.documents[key];
      app.env.snapshot = { manifest: checked, status: 'ready', error: '' };
    };
    await app.press('Submit Application');
    assert.equal(uploads, 12);
    assert.equal(stored.get(frontPath), replacement);
    assert.equal(app.env.submits.length, 1);
    assert.equal(app.env.snapshot.manifest.approvalStatus, 'pending');
    assert.match(app.rendered(), /Application Submitted!/);
    assert.equal(app.storage.values.has(driverRegistrationDraftKey('driver-a')), false);
  } finally {
    heldFront.resolve();
    await act(async () => { await submission; });
    await app.dispose();
  }
});

for (const stage of ['reload', 'refresh'] as const) {
  test(`initial ${stage} stall is bounded, retry does not overlap, late result cannot clear, then retry recovers`, async () => {
    const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = deferred<void>();
    let calls = 0;
    const form = localUploadForm();
    const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form }),
      [stage]: () => { calls++; return pending.promise; } });
    try {
      assert.match(app.rendered(), /Checking your account/);
      await act(async () => { clock.tick(19_999); });
      assert.match(app.rendered(), /Checking your account/);
      await act(async () => { clock.tick(1); });
      await app.flush();
      assert.match(app.rendered(), /Verification unavailable/);
      assert.doesNotMatch(app.rendered(), /Checking your account/);
      assert.ok(app.storage.values.has(driverRegistrationDraftKey('driver-a')));
      await app.press('Retry verification');
      assert.match(app.rendered(), /Checking your account/);
      assert.equal(calls, 1);
      await act(async () => { clock.tick(20_000); });
      await app.flush();
      assert.match(app.rendered(), /Verification unavailable/);
      pending.resolve();
      await app.flush();
      assert.match(app.rendered(), /Verification unavailable/);
      assert.doesNotMatch(app.rendered(), /Application Submitted!/);
      assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 0);
      await app.press('Retry verification');
      assert.match(app.rendered(), /Vehicle & Documents/);
      assert.equal(calls, 2);
      assert.ok(app.storage.values.has(driverRegistrationDraftKey('driver-a')));
    } finally { pending.resolve(); await app.dispose(); assert.equal(clock.countTimers(), 0); clock.uninstall(); }
  });
}

test('initial recovery account change and unmount cancel deadlines and reject late old email results', async () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  const pending = deferred<void>();
  let oldRefreshes = 0;
  const app = await mountRegistration({ reload: () => pending.promise, refresh: async () => { oldRefreshes++; } });
  try {
    const next = { uid: 'driver-b', email: 'driver-b@example.test', displayName: 'Driver B', emailVerified: false, reload: async () => {} };
    app.env.currentUser = next;
    app.env.auth = { user: next, driverProfile: null, loading: false };
    app.env.snapshot = { status: 'ready', manifest: fixture('driver-b', 0), error: '' };
    await app.update();
    assert.match(app.rendered(), /Verify Your Email/);
    pending.resolve();
    await app.flush();
    assert.equal(oldRefreshes, 0);
    assert.match(app.rendered(), /Verify Your Email/);
    assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 0);
  } finally { pending.resolve(); await app.dispose(); assert.equal(clock.countTimers(), 0); clock.uninstall(); }
});

test('initial email recovery has one whole-chain twenty-second deadline across reload then profile refresh', async () => {
  const clock = FakeTimers.install({ toFake: ['setTimeout', 'clearTimeout'] });
  const reload = deferred<void>();
  const refresh = deferred<void>();
  let refreshes = 0;
  const app = await mountRegistration({ reload: () => reload.promise, refresh: () => { refreshes++; return refresh.promise; } });
  try {
    await act(async () => { clock.tick(15_000); reload.resolve(); });
    await app.flush();
    assert.equal(refreshes, 1);
    assert.match(app.rendered(), /Checking your account/);
    await act(async () => { clock.tick(4_999); });
    assert.match(app.rendered(), /Checking your account/);
    await act(async () => { clock.tick(1); });
    await app.flush();
    assert.match(app.rendered(), /Verification unavailable/);
    refresh.resolve();
    await app.flush();
    assert.match(app.rendered(), /Verification unavailable/);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
    assert.equal(app.storage.calls.filter(v => v.startsWith('clear')).length, 0);
    assert.equal(clock.countTimers(), 0);
  } finally { reload.resolve(); refresh.resolve(); await app.dispose(); clock.uninstall(); }
});

for (const uri of ['content://gallery/license-front.heic', 'file:///gallery/license-front.png', 'file:///camera/license-front.jpg']) {
  test(`actual screen automatically prepares selected ${uri.split('/').at(-1)} before sending JPEG metadata`, async () => {
    const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
    form.licenseFront = uri;
    const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
    const preparedBlob = new Blob(['actual-encoder-output-fixture'], { type: '' });
    const calls: string[] = [];
    try {
      app.env.prepare = async (selected: string, assertCurrent: () => void) => {
        assertCurrent();
        assert.equal(selected, uri);
        calls.push('prepare');
        return { uri: 'file:///cache/converted.jpg', blob: preparedBlob, contentType: 'image/jpeg', dispose: async () => { calls.push('dispose'); } };
      };
      app.env.upload = async (blob: Blob, objectPath: string, metadata: { contentType: string }) => {
        calls.push('upload');
        assert.equal(blob, preparedBlob);
        assert.equal(objectPath, 'drivers/driver-a/drivers-license-front.jpg');
        assert.deepEqual(metadata, { contentType: 'image/jpeg' });
        return remote('driver-a', 'drivers-license-front');
      };
      await app.press('Submit Application');
      assert.deepEqual(calls, ['prepare', 'upload', 'dispose']);
      assert.deepEqual(app.env.preparations, [uri]);
      assert.match(app.rendered(), /prepare and resize your photos automatically/);
    } finally { await app.dispose(); }
  });
}

test('actual gallery preparation failure retains the original selection and never uploads or submits', async () => {
  const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
  form.licenseFront = 'content://gallery/license-front.tiff';
  const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
  let uploads = 0;
  try {
    app.env.prepare = async () => { throw new Error('Decoder failed for private account and file URI'); };
    app.env.upload = async () => { uploads++; return ''; };
    await app.press('Submit Application');
    assert.equal(uploads, 0);
    assert.equal(app.env.submits.length, 0);
    assert.match(app.rendered(), /Driver's License \(Front\)/);
    assert.doesNotMatch(app.rendered(), /Decoder failed|private account/);
    assert.equal(JSON.parse(app.storage.values.get(driverRegistrationDraftKey('driver-a'))!).form.licenseFront, form.licenseFront);
    assert.doesNotMatch(app.rendered(), /Application Submitted!/);
  } finally { await app.dispose(); }
});

for (const stage of ['upload', 'confirm'] as const) {
  test(`actual ${stage} denial shows friendly slot error with no Firebase, UID or private URL`, async () => {
    const form = restoreDriverRegistrationForm(emptyDriverRegistrationForm(), null, fixture('driver-a', 6), false);
    form.licenseFront = 'file:///gallery/license-front.jpg';
    const app = await mountRegistration({ count: 6, savedDraft: draftFor('driver-a', { pendingEdits: true, form }) });
    try {
      app.env.upload = async () => { throw Object.assign(new Error('Firebase Storage: drivers/PRIVATE_UID/file.jpg?token=SECRET (storage/unauthorized)'), {
        code: 'storage/unauthorized', driverDocumentStage: stage,
      }); };
      await app.press('Submit Application');
      assert.equal(app.env.submits.length, 0);
      assert.match(app.rendered(), /Driver's License \(Front\)/);
      assert.doesNotMatch(app.rendered(), /Firebase|PRIVATE_UID|SECRET|storage\/unauthorized/);
      assert.deepEqual(app.env.disposed, [form.licenseFront]);
      assert.equal(JSON.parse(app.storage.values.get(driverRegistrationDraftKey('driver-a'))!).form.licenseFront, form.licenseFront);
    } finally { await app.dispose(); }
  });
}
