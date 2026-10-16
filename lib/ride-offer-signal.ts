type OfferListener = () => void;

type DriverOfferResumeInput = {
  previousAppState?: string | null;
  nextAppState?: string | null;
  authenticated: boolean;
  online: boolean;
  hasCurrentLocation: boolean;
};

const listeners = new Set<OfferListener>();

/** A foreground ride-offer push should refresh the authenticated offer query immediately. */
export function emitDriverRideOffer() {
  listeners.forEach((listener) => listener());
}

export function subscribeDriverRideOffer(listener: OfferListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
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
