export type DriverDeliveryContact = {
  label: 'Sender' | 'Recipient';
  name: string;
  phone: string;
  instructions?: string;
  packageDescription?: string;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isDeliveryRide(ride: Record<string, any> | null | undefined): boolean {
  return String(ride?.category || '').trim().toLowerCase() === 'express_delivery';
}

/**
 * After server-side acceptance, show the collection contact until the trip
 * starts, then switch to the recipient. The API never returns these details
 * for unassigned delivery offers.
 */
export function deliveryContactForDriver(ride: Record<string, any> | null | undefined): DriverDeliveryContact | null {
  if (!isDeliveryRide(ride)) return null;
  const delivery = ride?.delivery && typeof ride.delivery === 'object' ? ride.delivery : {};
  const recipientPhase = ride?.status === 'in_progress';
  const contact = recipientPhase ? delivery.recipient : delivery.sender;
  const prefix = recipientPhase ? 'recipient' : 'sender';
  const name = text(contact?.name) || text(ride?.[`delivery_${prefix}_name`]);
  const phone = text(contact?.phone) || text(ride?.[`delivery_${prefix}_phone`]);
  const instructions = recipientPhase
    ? text(delivery.dropoffInstructions) || text(ride?.delivery_dropoff_instructions)
    : text(delivery.pickupInstructions) || text(ride?.delivery_pickup_instructions);
  const packageDescription = text(delivery.packageDescription) || text(ride?.delivery_package_description);

  if (!name && !phone && !instructions && !packageDescription) return null;
  return {
    label: recipientPhase ? 'Recipient' : 'Sender',
    name: name || (recipientPhase ? 'Recipient' : 'Sender'),
    phone,
    instructions: instructions || undefined,
    packageDescription: packageDescription || undefined,
  };
}
