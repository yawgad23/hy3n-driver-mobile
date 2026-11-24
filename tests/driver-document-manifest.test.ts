import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import {
  DRIVER_DOCUMENT_KEYS, REQUIRED_DRIVER_DOCUMENT_KEYS,
  DriverDocumentRequestGuard, canConfirmDriverSubmission,
  documentProfileFingerprint, isOwnedDriverStorageReference,
  parseDriverDocumentManifest, type DriverDocumentManifest,
} from '../lib/driver-document-manifest';

const uid = 'offline-driver';
const reference = (key: string, owner = uid) => `https://firebasestorage.googleapis.com/v0/b/hy3n26.firebasestorage.app/o/${encodeURIComponent(`drivers/${owner}/${key}.jpg`)}?alt=media`;
function fixture(): DriverDocumentManifest {
  return {
    userId: uid, profileId: uid, approvalStatus: 'pending', documentsComplete: true,
    documentRevision: 'offline-document-revision', missingDocuments: [],
    documents: Object.fromEntries(DRIVER_DOCUMENT_KEYS.map((key, i) => [key, {
      label: key, required: i < 6, status: i < 6 ? 'valid' : 'missing', reference: i < 6 ? reference(key) : null,
    }])) as DriverDocumentManifest['documents'],
    details: { fullName: 'Offline fixture', email: 'offline@example.invalid', phone: '+233000000000', momoNumber: '', city: 'Accra', serviceType: 'car', acceptedCategories: ['standard'], vehicleMake: 'Fixture', vehicleModel: 'Fixture', vehiclePlate: 'OFFLINE', vehicleColor: '', vehicleYear: '' },
  };
}

test('complete six-object pending manifest confirms submission, not approval', () => {
  assert.equal(canConfirmDriverSubmission(fixture(), uid), true);
  assert.equal(fixture().approvalStatus, 'pending');
});
for (const key of REQUIRED_DRIVER_DOCUMENT_KEYS) {
  test(`missing ${key} cannot confirm submission`, () => {
    const m = fixture(); m.documentsComplete = false; m.missingDocuments = [key];
    m.documents[key] = { ...m.documents[key], status: 'missing', reference: null };
    assert.equal(canConfirmDriverSubmission(m, uid), false);
  });
}
test('zero-object pending profile is incomplete', () => {
  const m = fixture(); m.documentsComplete = false; m.missingDocuments = [...REQUIRED_DRIVER_DOCUMENT_KEYS];
  for (const key of DRIVER_DOCUMENT_KEYS) m.documents[key] = { ...m.documents[key], status: 'missing', reference: null };
  assert.equal(canConfirmDriverSubmission(m, uid), false);
});
test('optional documents do not block complete required evidence', () => {
  const m = fixture();
  m.documents.insurance.status = 'invalid'; m.documents.insurance.reference = null;
  assert.equal(canConfirmDriverSubmission(m, uid), true);
});
test('backend missing keys are normalized to readable labels and remain incomplete', () => {
  const m = fixture(); m.documentsComplete = false; m.missingDocuments = ['ghanaCardFront'];
  m.documents.ghanaCardFront = { label: 'Ghana Card (Front)', required: true, status: 'missing', reference: null };
  const parsed = parseDriverDocumentManifest(m, uid);
  assert.deepEqual(parsed.missingDocuments, ['Ghana Card (Front)']);
  assert.equal(canConfirmDriverSubmission(parsed, uid), false);
  assert.deepEqual(parseDriverDocumentManifest(parsed, uid).missingDocuments, ['Ghana Card (Front)']);
});
for (const uri of ['file:///tmp/front.jpg', 'content://media/123', 'not-a-url', 'http://example.invalid/front.jpg', 'https://example.invalid/front.jpg', reference('front', 'another-driver')]) {
  test(`untrusted reference is rejected: ${uri.split(':')[0]}`, () => {
    const m = fixture(); m.documents.ghanaCardFront.reference = uri;
    assert.equal(canConfirmDriverSubmission(m, uid), false);
  });
}
test('foreign bucket and encoded traversal are not owned evidence', () => {
  assert.equal(isOwnedDriverStorageReference(reference('front').replace('hy3n26.firebasestorage.app', 'other.firebasestorage.app'), uid), false);
  assert.equal(isOwnedDriverStorageReference(reference('../front'), uid), false);
  assert.equal(isOwnedDriverStorageReference(reference('%2e%2e/front'), uid), false);
});
test('account mismatch, no canonical profile and missing revision cannot confirm', () => {
  assert.equal(canConfirmDriverSubmission(fixture(), 'other-driver'), false);
  const noProfile = fixture(); noProfile.profileId = null;
  assert.equal(canConfirmDriverSubmission(noProfile, uid), false);
  const noRevision = fixture(); noRevision.documentRevision = '';
  assert.equal(canConfirmDriverSubmission(noRevision, uid), false);
});
test('approved/rejected accounts are never treated as newly submitted pending applications', () => {
  for (const status of ['approved', 'rejected'] as const) {
    const m = fixture(); m.approvalStatus = status;
    assert.equal(canConfirmDriverSubmission(m, uid), false);
  }
});
test('contradictory complete flags and invalid contract entries fail closed', () => {
  const m = fixture(); m.documents.licenseBack.status = 'missing'; m.documents.licenseBack.reference = null;
  assert.throws(() => parseDriverDocumentManifest(m, uid));
  assert.throws(() => parseDriverDocumentManifest({ approvalStatus: 'pending' }, uid));
  assert.throws(() => parseDriverDocumentManifest(null, uid));
});
test('newer checks invalidate older checks', () => {
  const guard = new DriverDocumentRequestGuard(); const older = guard.begin(uid); const newer = guard.begin(uid);
  assert.equal(guard.isCurrent(older, uid), false);
  assert.equal(guard.isCurrent(newer, uid), true);
});
test('account change and unmount invalidate late completion', () => {
  const guard = new DriverDocumentRequestGuard(); const ticket = guard.begin(uid);
  assert.equal(guard.isCurrent(ticket, 'other-driver'), false);
  guard.invalidate(); assert.equal(guard.isCurrent(ticket, uid), false);
});
test('document/status/revision observations invalidate prior profile fingerprints', () => {
  const p = { id: uid, user_id: uid, approval_status: 'pending', ghana_card_front_url: reference('front'), updated_date: '1' };
  assert.notEqual(documentProfileFingerprint(p), documentProfileFingerprint({ ...p, approval_status: 'rejected' }));
  assert.notEqual(documentProfileFingerprint(p), documentProfileFingerprint({ ...p, ghana_card_front_url: '' }));
  assert.notEqual(documentProfileFingerprint(p), documentProfileFingerprint({ ...p, updated_date: '2' }));
});
test('pending gate reads verified evidence and offers safe full-application repair', () => {
  const source = readFileSync(new NodeURL('../app/(tabs)/_layout.tsx', import.meta.url), 'utf8');
  const gate = source.slice(source.indexOf('function ApprovalGate('), source.indexOf('// ─── No Profile Gate'));
  assert(gate.includes('useDriverDocumentManifest'));
  assert(gate.includes('documentsComplete === true'));
  assert(!gate.includes("label: 'Documents Uploaded', done: true"));
  assert(gate.includes('Complete & Resubmit Documents'));
  assert(gate.includes("router.push('/register' as any)"));
  assert(gate.includes('Documents Not Verified'));
  assert(gate.includes('Retry / Refresh Verification'));
});
test('manifest network request is authenticated read-only and cannot auto-approve', () => {
  const source = readFileSync(new NodeURL('../lib/firebase.ts', import.meta.url), 'utf8');
  const request = source.slice(source.indexOf('async getDriverDocumentManifest('), source.indexOf('async logout()'));
  assert(request.includes('/api/account/profile/driver/documents'));
  assert(request.includes("method: 'GET'"));
  assert(request.includes('getIdToken(true)'));
  assert(request.includes('auth.currentUser?.uid !== uid'));
  assert(!request.includes('approvalStatus:'));
});
