import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rides = readFileSync(path.join(__dirname, '../constants/rides.ts'), 'utf8');
const registration = readFileSync(path.join(__dirname, '../app/driver/register.tsx'), 'utf8');
const nativeMap = readFileSync(path.join(__dirname, '../components/NativeDriverGoogleMap.tsx'), 'utf8');
const home = readFileSync(path.join(__dirname, '../app/(tabs)/home.tsx'), 'utf8');

test('Driver category labels match current HY3N services', () => {
  assert.match(rides, /id: "car_delivery"[\s\S]*?name: "Car Delivery"/);
  assert.match(rides, /id: "express_delivery"[\s\S]*?name: "Delivery"/);
  assert.match(registration, /id: 'car_delivery',[\s\S]*?label: 'Car Delivery'/);
  assert.match(registration, /id: 'express_delivery',[\s\S]*?label: 'Delivery'/);
  assert.doesNotMatch(registration, /Standard, Comfort, Kantanka or Executive rides/);
});

test('Driver map selects vehicle artwork for car, Car Delivery, Okada and Delivery', () => {
  assert.match(nativeMap, /car_delivery:[\s\S]*?HY3NDriverCarMarker/);
  assert.match(nativeMap, /okada:[\s\S]*?HY3NDriverMotorcycleMarker/);
  assert.match(nativeMap, /delivery:[\s\S]*?HY3NDriverDeliveryMarker/);
  assert.match(nativeMap, /function normalizeDriverMapServiceType/);
});

test('Driver location tracking remains active during an accepted trip', () => {
  assert.match(home, /shouldTrackDriverLocation\(isOnline, Boolean\(activeTrip\?\.id\)\)/);
  assert.match(home, /driverForegroundLocationPolicy/);
  assert.match(home, /startDriverBackgroundLocationUpdates/);
});
