import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { actualServerTripRead, tripSnapshot } from './helpers/driver-server-trip-read';

for (const data of [null, { status: 'pending', driver_id: null }]) {
  test(`Accept server-only helper rejects cached ${data ? 'unassigned' : 'missing'} trip instead of treating it as failed Accept`, async () => {
    const read = actualServerTripRead(async () => tripSnapshot(data, { fromCache: true, hasPendingWrites: false }));
    await assert.rejects(read('rides', 'offer-A'), /Server trip state is not confirmed/);
  });
}

test('Accept server-only helper rejects locally pending trip writes even with a server result', async () => {
  const read = actualServerTripRead(async () => tripSnapshot({ status: 'pending' }, { fromCache: false, hasPendingWrites: true }));
  await assert.rejects(read('rides', 'offer-A'), /Server trip state is not confirmed/);
});

test('Accept server-only helper propagates offline failure; there is no cached fallback', async () => {
  const unavailable = Error('offline');
  const read = actualServerTripRead(async () => { throw unavailable; });
  await assert.rejects(read('rides', 'offer-A'), error => error === unavailable);
});

test('Accept server-only helper returns a fresh confirmed assignment from the exact requested trip', async () => {
  const read = actualServerTripRead(async reference => {
    assert.deepEqual(reference, { collection: 'rides', id: 'offer-A' });
    return tripSnapshot({ status: 'driver_arriving', driver_id: 'driver-1' });
  });
  assert.deepEqual(await read('rides', 'offer-A'), { id: 'offer-A', status: 'driver_arriving', driver_id: 'driver-1' });
});

for (const data of [null, { status: 'pending', driver_id: null }]) {
  test(`Accept server-only helper returns genuinely fresh ${data ? 'unassigned' : 'missing'} trip without inventing assignment`, async () => {
    const read = actualServerTripRead(async () => tripSnapshot(data));
    assert.deepEqual(await read('rides', 'offer-A'), data ? { id: 'offer-A', ...data } : null);
  });
}

test('only the Accept reconciliation read opts into server-only mode; ordinary Firestore get still uses getDoc', () => {
  const firebase = fs.readFileSync(path.join(__dirname, '../lib/firebase.ts'), 'utf8');
  const home = fs.readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');
  assert.match(firebase, /async get\(collectionName: string, id: string\) \{\s+const docRef = doc\(db, collectionName, id\);\s+const docSnap = await getDoc\(docRef\);\s+return docToObj\(docSnap\);\s+\}/);
  assert.equal(home.split('firestoreDB.getFromServer(').length - 1, 1);
  const reconciliation = home.slice(home.indexOf('const reconcileAcceptedRide ='), home.indexOf('tripActionInFlightRef.current = true;', home.indexOf('const reconcileAcceptedRide =')));
  assert.ok(reconciliation.includes('await firestoreDB.getFromServer(COLLECTIONS.RIDES, rideId)'));
  assert.ok(!reconciliation.includes('firestoreDB.get('));
});
