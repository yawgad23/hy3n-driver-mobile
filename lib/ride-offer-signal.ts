type OfferListener = () => void;

type DriverOfferResumeInput = {
  previousAppState?: string | null;
  nextAppState?: string | null;
  authenticated: boolean;
  online: boolean;
  hasCurrentLocation: boolean;
};

// Keep this as a small array rather than a Set. TestFlight crash reports from
// recent iPhones show Hermes failing in Set.delete during incoming-offer
// refreshes. A copied array also makes subscribe/unsubscribe safe while an
// offer event is being delivered.
let listeners: OfferListener[] = [];

/** A foreground ride-offer push should refresh the authenticated offer query immediately. */
export function emitDriverRideOffer() {
  listeners.slice().forEach((listener) => listener());
}

export function subscribeDriverRideOffer(listener: OfferListener) {
  listeners = [...listeners, listener];
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners = [...listeners.slice(0, index), ...listeners.slice(index + 1)];
  };
}

/**
 * React Query intentionally pauses interval polling while a phone is in the
 * background. Refresh the protected offer feed as soon as the Driver returns
 * to HY3N, even when they opened the app icon instead of tapping the push.
 */
export function shouldRefreshDriverRideOffersOnAppResume({
  previousAppState,
  nextAppState,
  authenticated,
  online,
  hasCurrentLocation,
}: DriverOfferResumeInput) {
  return previousAppState !== 'active'
    && nextAppState === 'active'
    && authenticated
    && online
    && hasCurrentLocation;
}
