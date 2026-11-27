import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import ts from 'typescript';
import { getApprovedDriverProfilePhoto } from '../lib/driver-profile-photo';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Profile = Record<string, unknown>;
type PhotoProps = { uri?: string; identity: string; driverName: string };
type PlatformName = 'android' | 'ios' | 'web';
const photoFor = getApprovedDriverProfilePhoto as (profile: Profile | null | undefined) => string | undefined;
const selfie = 'https://firebasestorage.googleapis.com/v0/b/fixture/o/drivers%2Fdriver-a%2Fselfie.jpg?alt=media&token=fixture';
const avatar = 'https://example.test/avatar.jpg';
const legacyPhoto = 'http://example.test/legacy-photo.jpg';
const newSelfie = 'https://example.test/new-selfie.jpg';
const statusFields = ['approval_status', 'application_status', 'status'] as const;
const approved = (fields: Profile = {}): Profile => ({ approval_status: 'approved', ...fields });

// Transpile only local source in memory. Native/auth/router/support dependencies
// are fixtures; unexpected imports fail rather than reaching Firebase or a device.
const transpiled = new Map<string, string>();
function loadLocal(relativePath: string, mocks: Record<string, unknown>): any {
  const filename = path.join(__dirname, '..', relativePath);
  let source = transpiled.get(filename);
  if (!source) {
    source = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React, esModuleInterop: true,
      },
    }).outputText;
    transpiled.set(filename, source);
  }
  const module = { exports: {} as any };
  const requireMock = (name: string) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'react') return React;
    if (/\/driver-profile-photo$/.test(name)) return { getApprovedDriverProfilePhoto };
    throw new Error(`Unexpected runtime dependency in ${relativePath}: ${name}`);
  };
  runInNewContext(source, {
    module, exports: module.exports, require: requireMock, console, URL,
  }, { filename });
  return module.exports;
}

function flattenStyle(value: any): Record<string, any> {
  return Array.isArray(value)
    ? Object.assign({}, ...value.filter(Boolean).map(flattenStyle))
    : value || {};
}

function nativeMocks(platform: PlatformName = 'android') {
  return {
    View: 'view', Text: 'text', Image: 'image', ScrollView: 'scroll', TouchableOpacity: 'button',
    Platform: { OS: platform }, Alert: { alert: () => {} }, Linking: { openURL: async () => {} },
    StyleSheet: { create: (styles: any) => styles, flatten: flattenStyle },
  };
}
const iconMock = (props: any) => React.createElement('icon', props);
function loadPhoto(platform: PlatformName = 'android'): React.ComponentType<PhotoProps> {
  const exports = loadLocal('components/DriverProfilePhoto.tsx', {
    'react-native': nativeMocks(platform),
    '@expo/vector-icons/MaterialIcons': iconMock,
    '@expo/vector-icons': { MaterialIcons: iconMock },
  });
  assert.equal(typeof exports.DriverProfilePhoto, 'function');
  return exports.DriverProfilePhoto;
}

function hosts(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll(node => typeof node.type === 'string' && node.props.testID === testID);
}
function image(renderer: ReactTestRenderer) {
  const nodes = hosts(renderer, 'driver-profile-selfie');
  assert.equal(nodes.length, 1, 'exactly one profile selfie Image is mounted');
  assert.equal(nodes[0].type, 'image');
  return nodes[0];
}
function frame(renderer: ReactTestRenderer) {
  const nodes = hosts(renderer, 'driver-profile-photo');
  assert.equal(nodes.length, 1, 'the profile avatar has one stable host testID');
  assert.equal(nodes[0].type, 'view');
  return nodes[0];
}
function assertFallback(renderer: ReactTestRenderer) {
  assert.equal(hosts(renderer, 'driver-profile-selfie').length, 0, 'unavailable photos never mount an Image');
  const nodes = hosts(renderer, 'driver-profile-photo-fallback');
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, 'icon');
  assert.equal(nodes[0].props.name, 'person');
  assert.match(frame(renderer).props.accessibilityLabel, /photo.*unavailable/i);
}
function assertPhoto(renderer: ReactTestRenderer, uri: string, driverName = 'Ada Mensah') {
  assert.equal(image(renderer).props.source.uri, uri);
  assert.equal(image(renderer).props.resizeMode, 'cover');
  assert.equal(hosts(renderer, 'driver-profile-photo-fallback').length, 0);
  assert.match(frame(renderer).props.accessibilityLabel, /photo.*for/i);
  assert.ok(frame(renderer).props.accessibilityLabel.includes(driverName), 'photo label identifies the driver');
  assert.doesNotMatch(frame(renderer).props.accessibilityLabel, /unavailable/i);
}
async function mountPhoto(t: TestContext, initial: Partial<PhotoProps> = {}, platform: PlatformName = 'android') {
  const Component = loadPhoto(platform);
  let props: PhotoProps = { uri: selfie, identity: 'user-a:profile-a', driverName: 'Ada Mensah', ...initial };
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Component, props)); });
  t.after(async () => { await act(async () => { renderer.unmount(); }); });
  return {
    renderer,
    async update(next: Partial<PhotoProps>) {
      props = { ...props, ...next };
      await act(async () => { renderer.update(React.createElement(Component, props)); });
    },
    async fail(callback = image(renderer).props.onError) {
      assert.equal(typeof callback, 'function');
      await act(async () => { callback({ nativeEvent: { error: 'fixture image unavailable' } }); });
    },
  };
}

test('absent, empty, or unapproved profiles never expose an uploaded selfie', () => {
  for (const profile of [null, undefined, {}, { profile_photo_url: selfie }, { approved: false, profile_photo_url: selfie }]) {
    assert.equal(photoFor(profile), undefined);
  }
  assert.equal(photoFor(approved()), undefined);
});

test('approved uploaded selfie wins over every legacy candidate and is trimmed without mutating the profile', () => {
  const profile = Object.freeze(approved({ profile_photo_url: `  ${selfie}\n`, avatar_url: avatar, photo_url: legacyPhoto }));
  assert.equal(photoFor(profile), selfie);
  assert.equal(profile.profile_photo_url, `  ${selfie}\n`);
});

test('each explicit approval field recognizes only normalized approved, pending, or rejected states', () => {
  for (const field of statusFields) {
    for (const status of ['approved', ' APPROVED ', '\tApPrOvEd\n']) {
      assert.equal(photoFor({ [field]: status, profile_photo_url: selfie }), selfie, `${field}: ${status}`);
    }
    for (const status of ['pending', ' PENDING ', '\tRejected\n']) {
      assert.equal(photoFor({ [field]: status, profile_photo_url: selfie }), undefined, `${field}: ${status}`);
    }
  }
});

test('the first recognized state wins in approval_status, application_status, status order', () => {
  const states = ['approved', 'pending', 'rejected'];
  for (const first of states) for (const second of states) for (const third of states) {
    assert.equal(photoFor({ approval_status: first, application_status: second, status: third,
      approved: true, is_approved: true, profile_photo_url: selfie }), first === 'approved' ? selfie : undefined,
    `${first}/${second}/${third}`);
  }
  for (const ignored of [undefined, null, '', 'online', 'unknown', true, 1, {}]) {
    assert.equal(photoFor({ approval_status: ignored, application_status: ' APPROVED ', status: 'rejected', profile_photo_url: selfie }), selfie);
    assert.equal(photoFor({ approval_status: ignored, application_status: 'in_review', status: 'approved', profile_photo_url: selfie }), selfie);
    assert.equal(photoFor({ approval_status: ignored, application_status: ' PENDING ', status: 'approved', approved: true, profile_photo_url: selfie }), undefined);
  }
});

test('explicit pending and rejection override historical true approval flags in every state field', () => {
  for (const field of statusFields) for (const status of ['pending', ' ReJeCtEd ']) {
    for (const flags of [{ approved: true }, { is_approved: true }, { approved: true, is_approved: true }]) {
      assert.equal(photoFor({ [field]: status, ...flags, profile_photo_url: selfie, avatar_url: avatar, photo_url: legacyPhoto }), undefined,
        `${field}=${status}, ${JSON.stringify(flags)}`);
    }
  }
});

test('legacy booleans allow a photo only when strictly true and no explicit state is recognized', () => {
  for (const flags of [{ approved: true }, { is_approved: true }, { approved: false, is_approved: true }]) {
    assert.equal(photoFor({ approval_status: 'unknown', application_status: null, status: 'online', ...flags, profile_photo_url: selfie }), selfie);
  }
  for (const value of [undefined, null, false, 'true', 'approved', 1, {}, ['true']]) {
    assert.equal(photoFor({ approved: value, is_approved: value, profile_photo_url: selfie }), undefined);
  }
});

test('presence, availability, online, and verification metadata do not count as approval', () => {
  for (const status of ['online', 'offline', 'active', 'available', 'busy', 'verified', 'accepted', 'true']) {
    assert.equal(photoFor({ approval_status: status, application_status: status, status,
      is_online: true, online: true, available: true, verified: true, profile_photo_url: selfie }), undefined, status);
  }
});

test('approved profiles use the first usable selfie, avatar, then legacy photo URL', () => {
  assert.equal(photoFor(approved({ avatar_url: ` ${avatar} `, photo_url: legacyPhoto })), avatar);
  assert.equal(photoFor(approved({ profile_photo_url: 'file:///camera/selfie.jpg', avatar_url: avatar, photo_url: legacyPhoto })), avatar);
  assert.equal(photoFor(approved({ profile_photo_url: {}, avatar_url: 'not-a-url', photo_url: `\n${legacyPhoto}  ` })), legacyPhoto);
  assert.equal(photoFor({ approved: true, photo_url: legacyPhoto }), legacyPhoto, 'legacy HTTP remains compatible');
  assert.equal(photoFor(approved({ profile_photo_url: 'https://example.test/selfie.jpg?token=a%2Fb#image' })), 'https://example.test/selfie.jpg?token=a%2Fb#image');
});

test('non-string, malformed, credential-bearing, local, and unsafe URLs are rejected in all three candidates', () => {
  const invalid: unknown[] = [
    undefined, null, false, 42, {}, [selfie], new String(selfie), { uri: selfie },
    { toString: () => { throw new Error('photo candidates must not be coerced'); } },
    '', '  ', 'not-a-url', '/selfie.jpg', '//example.test/selfie.jpg',
    'https://', 'https://exa mple.test/selfie.jpg', 'https://[invalid]/selfie.jpg', 'https://example.test:invalid/selfie.jpg',
    'file:///camera/selfie.jpg', 'content://media/external/images/1', 'ph://fixture-image',
    'data:image/jpeg;base64,fixture', 'javascript:alert(1)', 'blob:https://example.test/fixture', 'ftp://example.test/selfie.jpg',
    'https://user@example.test/selfie.jpg', 'https://user:secret@example.test/selfie.jpg',
    'http://user:secret@example.test/selfie.jpg', 'https://%75ser:%70ass@example.test/selfie.jpg',
  ];
  for (const field of ['profile_photo_url', 'avatar_url', 'photo_url']) for (const value of invalid) {
    assert.equal(photoFor(approved({ [field]: value })), undefined, `${field}: ${typeof value === 'string' ? value : typeof value}`);
  }
  assert.equal(photoFor(approved({ profile_photo_url: 'https://user:secret@example.test/selfie.jpg', avatar_url: avatar })), avatar,
    'an unusable primary candidate does not prevent a safe legacy fallback');
});

test('trimmed URLs are accepted through 4000 characters but longer candidates are skipped', () => {
  const prefix = 'https://example.test/selfie.jpg?token=';
  const atLimit = prefix + 'a'.repeat(4000 - prefix.length);
  assert.equal(atLimit.length, 4000);
  assert.equal(photoFor(approved({ profile_photo_url: atLimit })), atLimit);
  const paddedWithinLimit = ` ${atLimit.slice(0, -2)} `;
  assert.equal(paddedWithinLimit.length, 4000);
  assert.equal(photoFor(approved({ profile_photo_url: paddedWithinLimit })), paddedWithinLimit.trim());
  const tooLong = atLimit + 'a';
  for (const field of ['profile_photo_url', 'avatar_url', 'photo_url']) {
    assert.equal(photoFor(approved({ [field]: tooLong })), undefined, field);
  }
  assert.equal(photoFor(approved({ profile_photo_url: tooLong, avatar_url: avatar })), avatar);
});

test('identity documents and nested registration selfie fields are never read or used as avatar fallbacks', () => {
  const documentFields = [
    'ghana_card_front_url', 'ghana_card_back_url', 'drivers_license_front_url', 'drivers_license_back_url',
    'license_front_url', 'license_back_url', 'identity_document_url', 'id_card_url', 'vehicle_photo_url',
    'ghanaCardFront', 'ghanaCardBack', 'licenseFront', 'licenseBack', 'driverPhoto', 'selfie_url', 'documents',
  ];
  const onlyDocuments = approved(Object.fromEntries(documentFields.map(field => [field, selfie])));
  onlyDocuments.documents = { driverPhoto: selfie, ghanaCardFront: selfie };
  assert.equal(photoFor(onlyDocuments), undefined);
  const unreadableDocuments = approved({ profile_photo_url: selfie });
  for (const field of documentFields) Object.defineProperty(unreadableDocuments, field, {
    get() { throw new Error(`private document field must not be inspected: ${field}`); },
  });
  assert.equal(photoFor(unreadableDocuments), selfie);
  delete unreadableDocuments.profile_photo_url;
  assert.equal(photoFor(unreadableDocuments), undefined);
});

for (const platform of ['android', 'ios', 'web'] as const) {
  test(`${platform}: an approved selfie fills an 82x82 gold-bordered avatar with cover resize and driver accessibility`, async t => {
    const app = await mountPhoto(t, {}, platform);
    assertPhoto(app.renderer, selfie);
    const style = flattenStyle(frame(app.renderer).props.style);
    assert.equal(style.width, 82);
    assert.equal(style.height, 82);
    assert.ok(style.borderWidth > 0, 'the avatar retains its border');
    assert.match(style.borderColor, /^#d4af37(?:[a-f0-9]{2})?$/i);
    assert.equal(style.overflow, 'hidden', 'the Image stays inside the rounded avatar');
    assert.equal(typeof image(app.renderer).props.onError, 'function');
  });

  test(`${platform}: no URI renders the person fallback and an unavailable-photo accessibility label`, async t => {
    const app = await mountPhoto(t, { uri: undefined }, platform);
    assertFallback(app.renderer);
    assert.equal(flattenStyle(frame(app.renderer).props.style).width, 82);
    assert.equal(flattenStyle(frame(app.renderer).props.style).height, 82);
  });
}

test('Image error replaces the selfie with the person icon while preserving the avatar frame', async t => {
  const app = await mountPhoto(t);
  const before = flattenStyle(frame(app.renderer).props.style);
  await app.fail();
  assertFallback(app.renderer);
  assert.deepEqual(flattenStyle(frame(app.renderer).props.style), before);
  await app.update({ driverName: 'Updated Driver Name' });
  assertFallback(app.renderer);
  await app.update({ uri: selfie, identity: 'user-a:profile-a' });
  assertFallback(app.renderer);
});

test('changing the URL resets a failed Image, and removing then restoring the URL also starts fresh', async t => {
  const app = await mountPhoto(t);
  await app.fail();
  await app.update({ uri: newSelfie });
  assertPhoto(app.renderer, newSelfie);
  await app.fail();
  await app.update({ uri: undefined });
  assertFallback(app.renderer);
  await app.update({ uri: newSelfie });
  assertPhoto(app.renderer, newSelfie);
});

test('changing account/profile identity resets a failed Image even when the URL is unchanged', async t => {
  const app = await mountPhoto(t);
  const oldOnError = image(app.renderer).props.onError;
  await app.fail(oldOnError);
  await app.update({ identity: 'user-b:profile-b', driverName: 'New Driver' });
  assertPhoto(app.renderer, selfie, 'New Driver');
  await app.fail(oldOnError);
  assertPhoto(app.renderer, selfie, 'New Driver');
});

test('a retained old URL error cannot hide a fresh selfie; the fresh Image still handles its own errors', async t => {
  const app = await mountPhoto(t);
  const oldOnError = image(app.renderer).props.onError;
  await app.update({ uri: newSelfie });
  await app.fail(oldOnError);
  assertPhoto(app.renderer, newSelfie);
  await app.fail();
  assertFallback(app.renderer);
});

test('a stale callback cannot hide a recycled URL after the inner component is replaced twice', async t => {
  const app = await mountPhoto(t);
  const firstOnError = image(app.renderer).props.onError;
  await app.update({ uri: newSelfie });
  const secondOnError = image(app.renderer).props.onError;
  await app.update({ uri: selfie });
  await app.fail(firstOnError);
  await app.fail(secondOnError);
  assertPhoto(app.renderer, selfie);
});

async function mountProfile(t: TestContext, initialProfile: Profile | null) {
  const env = {
    user: { uid: 'user-a', displayName: 'Auth Driver', email: 'driver@example.test', photoURL: avatar },
    driverProfile: initialProfile,
    routes: [] as string[], signOuts: 0, supportCalls: 0,
  };
  const Photo = loadPhoto();
  const mocks: Record<string, unknown> = {
    'react-native': nativeMocks(),
    '@expo/vector-icons/MaterialIcons': iconMock,
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) },
    '@/lib/driver-auth-context': { useDriverAuth: () => ({ user: env.user, driverProfile: env.driverProfile,
      signOut: async () => { env.signOuts += 1; } }) },
    'expo-router': { router: { push: (route: string) => env.routes.push(route), replace: (route: string) => env.routes.push(route) } },
    '@/hooks/use-colors': { useColors: () => ({ background: '#0A0A0A', foreground: '#FAFAFA', surface: '#111111',
      card: '#111111', border: '#2A2A2A', muted: '#9CA3AF' }) },
    '@/lib/support-whatsapp': { openDriverSupportWhatsApp: async () => { env.supportCalls += 1; } },
    '@/components/DriverProfilePhoto': { DriverProfilePhoto: Photo },
    '../../components/DriverProfilePhoto': { DriverProfilePhoto: Photo },
  };
  const Screen = loadLocal('app/(tabs)/profile.tsx', mocks).default;
  let renderer!: ReactTestRenderer;
  await act(async () => { renderer = create(React.createElement(Screen)); });
  t.after(async () => { await act(async () => { renderer.unmount(); }); });
  return { env, renderer,
    async update() { await act(async () => { renderer.update(React.createElement(Screen)); }); },
  };
}

test('real profile updates from a pending icon to the approved uploaded selfie without changing approval or triggering operations', async t => {
  const pending = Object.freeze({ id: 'profile-a', full_name: 'Ada Mensah', approval_status: 'pending',
    approved: true, is_approved: true, profile_photo_url: selfie, avatar_url: avatar, photo_url: legacyPhoto });
  const app = await mountProfile(t, pending);
  assertFallback(app.renderer);
  assert.equal(app.env.driverProfile, pending);
  app.env.driverProfile = Object.freeze({ ...pending, approval_status: 'approved' });
  await app.update();
  assertPhoto(app.renderer, selfie);
  assert.equal(app.env.driverProfile.approval_status, 'approved');
  app.env.driverProfile = Object.freeze({ ...pending, approval_status: 'rejected' });
  await app.update();
  assertFallback(app.renderer);
  assert.deepEqual(app.env.routes, []);
  assert.equal(app.env.signOuts, 0);
  assert.equal(app.env.supportCalls, 0, 'displaying a selfie performs no operational actions');
});

test('real profile passes both auth UID and profile ID to reset errors, even with the same photo URL', async t => {
  const app = await mountProfile(t, { id: 'profile-a', full_name: 'Ada Mensah', approval_status: 'approved', profile_photo_url: selfie });
  const firstOnError = image(app.renderer).props.onError;
  await act(async () => { firstOnError({ nativeEvent: { error: 'first account error' } }); });
  assertFallback(app.renderer);
  app.env.driverProfile = { ...app.env.driverProfile, id: 'profile-b' };
  await app.update();
  assertPhoto(app.renderer, selfie);
  const secondOnError = image(app.renderer).props.onError;
  await act(async () => { secondOnError({ nativeEvent: { error: 'second profile error' } }); });
  assertFallback(app.renderer);
  app.env.user = { ...app.env.user, uid: 'user-b' };
  await app.update();
  assertPhoto(app.renderer, selfie);
  await act(async () => { firstOnError({}); secondOnError({}); });
  assertPhoto(app.renderer, selfie);
});

test('real profile ignores auth avatars and identity documents when no approved profile photo exists', async t => {
  const app = await mountProfile(t, null);
  assertFallback(app.renderer);
  app.env.driverProfile = { id: 'profile-a', approval_status: 'approved', full_name: 'Ada Mensah',
    ghana_card_front_url: selfie, drivers_license_front_url: selfie, documents: { driverPhoto: selfie } };
  await app.update();
  assertFallback(app.renderer);
  app.env.driverProfile = { ...app.env.driverProfile, profile_photo_url: 'file:///camera/new-selfie.jpg', avatar_url: avatar };
  await app.update();
  assertPhoto(app.renderer, avatar);
});
