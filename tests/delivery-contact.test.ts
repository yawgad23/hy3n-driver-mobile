import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryContactForDriver, isDeliveryRide } from '../lib/delivery-contact';

const deliveryRide = {
  category: 'express_delivery',
  status: 'driver_arriving',
  delivery: {
    sender: { name: 'Yaw Mensah', phone: '0501234567' },
    recipient: { name: 'Ama Boateng', phone: '0241234567' },
    packageDescription: 'Sealed document envelope',
    pickupInstructions: 'Ask at reception',
    dropoffInstructions: 'Call at the gate',
  },
};

test('shows the sender before collection and the recipient after the delivery trip starts', () => {
  assert.equal(isDeliveryRide(deliveryRide), true);
  assert.deepEqual(deliveryContactForDriver(deliveryRide), {
    label: 'Sender',
    name: 'Yaw Mensah',
    phone: '0501234567',
    instructions: 'Ask at reception',
    packageDescription: 'Sealed document envelope',
  });
  assert.deepEqual(deliveryContactForDriver({ ...deliveryRide, status: 'in_progress' }), {
    label: 'Recipient',
    name: 'Ama Boateng',
    phone: '0241234567',
    instructions: 'Call at the gate',
    packageDescription: 'Sealed document envelope',
  });
});
