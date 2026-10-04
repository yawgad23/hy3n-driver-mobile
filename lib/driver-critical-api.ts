const CRITICAL_DRIVER_PROCEDURES = new Set([
  'driverTrips.availableOffers',
  'driverTrips.respondToOffer',
  'driverTrips.setAvailability',
  'driverTrips.arrive',
  'driverTrips.start',
  'driverTrips.verifyAndStart',
  'driverTrips.complete',
  'driverTrips.recordTripLocation',
]);

/**
 * These operations drive the live trip state and must never wait behind a
 * background History, Finance, or preference query in the tRPC batch queue.
 */
export function isCriticalDriverProcedure(path: string): boolean {
  return CRITICAL_DRIVER_PROCEDURES.has(path);
}
