type OfferListener = () => void;

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
