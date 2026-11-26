import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';

const requireHere = createRequire(__filename);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function adapterFixture() {
  const calls: any[] = [];
  const env = { render: async () => {}, read: async () => new Blob(['encoded-jpeg-fixture'], { type: '' }) };
  let sequence = 0;
  const mocks: Record<string, any> = {
    'react-native': { Image: { getSize: (uri: string, success: (width: number, height: number) => void) => {
      calls.push(['dimensions', uri]); success(4000, 3000);
    } } },
    'expo-image-manipulator': {
      SaveFormat: { JPEG: 'jpeg' },
      ImageManipulator: { manipulate: (uri: string) => {
        const id = ++sequence;
        calls.push(['manipulate', uri, id]);
        return {
          resize: (size: unknown) => { calls.push(['resize', size, id]); },
          renderAsync: async () => {
            calls.push(['render', id]);
            await env.render();
            return {
              saveAsync: async (options: unknown) => {
                calls.push(['save', options, id]);
                return { uri: `file:///app-cache/ImageManipulator/jpeg-${id}.jpg`, width: 2400, height: 1800 };
              },
              release: () => { calls.push(['release-image', id]); },
            };
          },
          release: () => { calls.push(['release-context', id]); },
        };
      } },
    },
    'expo-file-system/legacy': {
      cacheDirectory: 'file:///app-cache/',
      deleteAsync: async (uri: string, options: unknown) => { calls.push(['delete', uri, options]); },
    },
  };
  const built = await build({ entryPoints: [path.join(__dirname, '../lib/driver-photo-native.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs', plugins: [{ name: 'native-photo-fixtures', setup(builder) {
      builder.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, external: true } : null);
    } }] });
  const mod = { exports: {} as any };
  new Function('require', 'module', 'exports', 'fetch', built.outputFiles[0].text)(
    (name: string) => mocks[name] ?? requireHere(name), mod, mod.exports,
    async (uri: string) => { calls.push(['read', uri]); return { ok: true, blob: () => env.read() }; },
  );
  return { ...mod.exports, calls, env };
}

test('native adapter uses actual JPEG save, preserves aspect ratio, explicit converted type and deferred cache cleanup', async () => {
  const app = await adapterFixture();
  const photo = await app.prepareDriverDocumentPhoto('content://gallery/original.heic');
  assert.equal(photo.contentType, 'image/jpeg');
  assert.equal(photo.blob.type, '');
  assert.deepEqual(app.calls.find((call: any[]) => call[0] === 'resize'), ['resize', { width: 2400 }, 1]);
  assert.deepEqual(app.calls.find((call: any[]) => call[0] === 'save'), ['save', { format: 'jpeg', compress: 0.9 }, 1]);
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'delete').length, 0);
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'release-image').length, 1);
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'release-context').length, 1);
  await Promise.all([photo.dispose(), photo.dispose()]);
  assert.deepEqual(app.calls.filter((call: any[]) => call[0] === 'delete'), [
    ['delete', 'file:///app-cache/ImageManipulator/jpeg-1.jpg', { idempotent: true }],
  ]);
  assert.ok(!app.calls.some((call: any[]) => call[0] === 'delete' && call[1].includes('original')));
});

test('native adapter serializes original-image decoding to protect lower-memory phones', async () => {
  const app = await adapterFixture();
  const barrier = deferred<void>();
  let renders = 0;
  app.env.render = async () => { renders++; if (renders === 1) await barrier.promise; };
  const first = app.prepareDriverDocumentPhoto('file:///gallery/front.png');
  const second = app.prepareDriverDocumentPhoto('file:///gallery/back.png');
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'manipulate').length, 1);
  barrier.resolve();
  const photos = await Promise.all([first, second]);
  assert.equal(renders, 2);
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'manipulate').length, 2);
  const firstRelease = app.calls.findIndex((call: any[]) => call[0] === 'release-context' && call[1] === 1);
  const secondDecode = app.calls.findIndex((call: any[]) => call[0] === 'manipulate' && call[2] === 2);
  assert.ok(firstRelease < secondDecode);
  await Promise.all(photos.map((photo: any) => photo.dispose()));
});

test('failed native render releases context and does not poison later gallery work', async () => {
  const app = await adapterFixture();
  let renders = 0;
  app.env.render = async () => { if (++renders === 1) throw new Error('private decoder details'); };
  await assert.rejects(app.prepareDriverDocumentPhoto('file:///gallery/bad.tiff'), /couldn’t prepare/);
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'release-context').length, 1);
  const photo = await app.prepareDriverDocumentPhoto('file:///gallery/good.jpg');
  assert.equal(photo.contentType, 'image/jpeg');
  await photo.dispose();
});

test('queued preparation stops before another native decode when the account operation is cancelled', async () => {
  const app = await adapterFixture();
  const barrier = deferred<void>();
  app.env.render = () => barrier.promise;
  let current = true;
  const assertCurrent = () => { if (!current) throw new Error('Account changed'); };
  const first = app.prepareDriverDocumentPhoto('file:///gallery/front.png', assertCurrent);
  const second = app.prepareDriverDocumentPhoto('file:///gallery/back.png', assertCurrent);
  const results = Promise.allSettled([first, second]);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  current = false;
  barrier.resolve();
  const settled = await results;
  assert.ok(settled.every(result => result.status === 'rejected'));
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'manipulate').length, 1);
  assert.equal(app.calls.filter((call: any[]) => call[0] === 'delete').length, 1);
});
