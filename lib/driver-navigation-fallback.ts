import {
  googleMapsNavigationFallbackUrl,
  googleMapsTurnByTurnUri,
  isTurnByTurnDestination,
  type TurnByTurnDestination,
} from '@/lib/driver-turn-navigation';

export type DriverNavigationPlatform = 'android' | 'ios';

function encodedDestination(destination: TurnByTurnDestination) {
  return encodeURIComponent(`${destination.latitude},${destination.longitude}`);
}

/**
 * Use the server-derived ride coordinates rather than a user-editable address
 * when embedded Google Navigation is unavailable. Android opens the installed
 * Google Maps navigation app; iOS opens Apple Maps with driving directions.
 */
export function driverMapAppNavigationUri(
  destination: TurnByTurnDestination,
  platform: DriverNavigationPlatform,
) {
  if (!isTurnByTurnDestination(destination)) return null;

  if (platform === 'ios') {
    return `https://maps.apple.com/?daddr=${encodedDestination(destination)}&dirflg=d`;
  }

  return googleMapsTurnByTurnUri(destination);
}

/** Open the installed Google Maps app when the Driver explicitly selects it. */
export function driverGoogleMapsAppUri(
  destination: TurnByTurnDestination,
  platform: DriverNavigationPlatform,
) {
  if (!isTurnByTurnDestination(destination)) return null;
  const coordinate = `${destination.latitude},${destination.longitude}`;
  if (platform === 'ios') {
    return `comgooglemaps://?daddr=${encodeURIComponent(coordinate)}&directionsmode=driving`;
  }
  return googleMapsTurnByTurnUri(destination);
}

/** Android's generic geo intent lets another installed maps app handle the route. */
export function driverOtherAndroidMapsUri(destination: TurnByTurnDestination) {
  if (!isTurnByTurnDestination(destination)) return null;
  const coordinate = `${destination.latitude},${destination.longitude}`;
  return `geo:0,0?q=${encodeURIComponent(coordinate)}&mode=d`;
}

/** A universal Google Maps URL is available if Android has no Maps app. */
export function driverMapAppWebFallbackUri(destination: TurnByTurnDestination) {
  return googleMapsNavigationFallbackUrl(destination);
}

export function driverMapAppNavigationLabel(platform: DriverNavigationPlatform) {
  return platform === 'ios' ? 'Navigate in Apple Maps' : 'Navigate in Google Maps';
}
