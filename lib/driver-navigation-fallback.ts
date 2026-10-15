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

/** A universal Google Maps URL is available if Android has no Maps app. */
export function driverMapAppWebFallbackUri(destination: TurnByTurnDestination) {
  return googleMapsNavigationFallbackUrl(destination);
}

export function driverMapAppNavigationLabel(platform: DriverNavigationPlatform) {
  return platform === 'ios' ? 'Navigate in Apple Maps' : 'Navigate in Google Maps';
}
