import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transform } from 'esbuild';

async function storageFixture() {
  const file = readFileSync(path.join(__dirname, '../lib/firebase.ts'), 'utf8');
  const start = file.indexOf('export const firebaseStorage =');
  assert.ok(start >= 0);
  // Exercise the real helper only. Never initialize Auth, Storage or a network client.
  const source = await transform(file.slice(start), { loader: 'ts', format: 'cjs' });
  const calls: any[] = [];
  const env = { upload: async () => {}, confirm: async () => 'https://example.test/test-owned-photo' };
  const module = { exports: {} as any };
  new Function('ref', 'storage', 'uploadBytes', 'getDownloadURL', 'module', 'exports', source.code)(
    (_storage: unknown, objectPath: string) => ({ objectPath }), { fixture: true },
    async (reference: unknown, blob: Blob, metadata: unknown) => { calls.push(['upload', reference, blob, metadata]); await env.upload(); },
    async (reference: unknown) => { calls.push(['confirm', reference]); return env.confirm(); }, module, module.exports,
  );
  return { uploadFile: module.exports.firebaseStorage.uploadFile as (blob: Blob, name: string, metadata?: { contentType: string }) => Promise<string>, calls, env };
}

test('upload helper passes truthful JPEG metadata and confirms only after upload succeeds', async () => {
  const app = await storageFixture();
  const converted = new Blob(['converted-fixture'], { type: '' });
  assert.equal(await app.uploadFile(converted, 'drivers/test-owner/licence.jpg', { contentType: 'image/jpeg' }), 'https://example.test/test-owned-photo');
  assert.equal(app.calls[0][2], converted);
  assert.deepEqual(app.calls[0][3], { contentType: 'image/jpeg' });
  assert.deepEqual(app.calls.map(call => call[0]), ['upload', 'confirm']);
});

test('upload rejection is annotated as upload and cannot leak raw bucket/UID/token error details', async () => {
  const app = await storageFixture();
  app.env.upload = async () => { throw Object.assign(new Error('Firebase Storage drivers/PRIVATE_UID/id.jpg?token=SECRET'), { code: 'storage/unauthorized' }); };
  await assert.rejects(app.uploadFile(new Blob(['jpeg']), 'drivers/test-owner/licence.jpg', { contentType: 'image/jpeg' }), (error: any) => {
    assert.equal(error.driverDocumentStage, 'upload');
    assert.equal(error.code, 'storage/unauthorized');
    assert.doesNotMatch(error.message, /Firebase|PRIVATE_UID|SECRET|drivers\//);
    return true;
  });
  assert.deepEqual(app.calls.map(call => call[0]), ['upload']);
});

test('upload success followed by URL-read rejection is annotated as confirmation without claiming upload failure', async () => {
  const app = await storageFixture();
  app.env.confirm = async () => { throw Object.assign(new Error('Firebase internal URL with PRIVATE_UID and SECRET'), { code: 'storage/unauthorized' }); };
  await assert.rejects(app.uploadFile(new Blob(['jpeg']), 'drivers/test-owner/licence.jpg', { contentType: 'image/jpeg' }), (error: any) => {
    assert.equal(error.driverDocumentStage, 'confirm');
    assert.equal(error.code, 'storage/unauthorized');
    assert.doesNotMatch(error.message, /Firebase|PRIVATE_UID|SECRET/);
    return true;
  });
  assert.deepEqual(app.calls.map(call => call[0]), ['upload', 'confirm']);
});

test('legacy two-argument callers remain compatible and unknown provider errors are sanitized', async () => {
  const app = await storageFixture();
  await app.uploadFile(new Blob(['jpeg'], { type: 'image/jpeg' }), 'drivers/test-owner/photo.jpg');
  assert.equal(app.calls[0][3], undefined);
  app.env.upload = async () => { throw new Error('private account details'); };
  await assert.rejects(app.uploadFile(new Blob(['jpeg']), 'drivers/test-owner/photo.jpg'), (error: any) => {
    assert.equal(error.code, 'storage/unknown');
    assert.doesNotMatch(error.message, /private account/);
    return true;
  });
});
