import assert from 'node:assert/strict';
import test from 'node:test';
import {
  driverVehicleMarkerAsset,
  normalizeDriverServiceType,
} from '../lib/driver-vehicle-marker';

test('normalizes Driver service types to car, Okada, or delivery', () => {
  assert.equal(normalizeDriverServiceType('car'), 'car');
  assert.equal(normalizeDriverServiceType('okada'), 'okada');
  assert.equal(normalizeDriverServiceType('motorcycle'), 'okada');
  assert.equal(normalizeDriverServiceType('delivery'), 'delivery');
  assert.equal(normalizeDriverServiceType('express_delivery'), 'delivery');
  assert.equal(normalizeDriverServiceType('unknown'), 'car');
});

test('selects platform-native marker assets for every service type', () => {
  assert.equal(driverVehicleMarkerAsset('car', 'android'), 'hy3n_driver_car_marker.png');
  assert.equal(driverVehicleMarkerAsset('okada', 'android'), 'hy3n_driver_okada_marker.png');
  assert.equal(driverVehicleMarkerAsset('delivery', 'android'), 'hy3n_driver_delivery_marker.png');
  assert.equal(driverVehicleMarkerAsset('car', 'ios'), 'HY3NDriverCarMarker');
  assert.equal(driverVehicleMarkerAsset('okada', 'ios'), 'HY3NDriverOkadaMarker');
  assert.equal(driverVehicleMarkerAsset('delivery', 'ios'), 'HY3NDriverDeliveryMarker');
});
