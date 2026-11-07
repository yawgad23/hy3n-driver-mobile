import {
  googleMapsNavigationFallbackUrl,
  googleMapsTurnByTurnUri,
  isTurnByTurnDestination,
  type TurnByTurnDestination,
} from '@/lib/driver-turn-navigation';

export type DriverNavigationPlatform = 'android' | 'ios';
export type DriverNavigationChoice = 'apple' | 'google' | 'waze' | 'other';

function encodedDestination(destination: TurnByTurnDestination) {
  return encodeURIComponent(`${destination.latitude},${destination.longitude}`);
}

/** Native default map: Apple Maps on iOS and Google Maps on Android. */
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

/** Waze deep link on both platforms, using the server-verified trip coordinate. */
export function driverWazeAppUri(destination: TurnByTurnDestination) {
  if (!isTurnByTurnDestination(destination)) return null;
  const coordinate = `${destination.latitude},${destination.longitude}`;
  return `waze://?ll=${encodeURIComponent(coordinate)}&navigate=yes`;
}

/** Official Waze universal link opens Waze or its web/app handoff if installed. */
export function driverWazeWebFallbackUri(destination: TurnByTurnDestination) {
  if (!isTurnByTurnDestination(destination)) return null;
  const coordinate = `${destination.latitude},${destination.longitude}`;
  return `https://waze.com/ul?ll=${encodeURIComponent(coordinate)}&navigate=yes`;
}

/** Android's generic geo intent lets another installed maps app handle the route. */
export function driverOtherAndroidMapsUri(destination: TurnByTurnDestination) {
  if (!isTurnByTurnDestination(destination)) return null;
  const coordinate = `${destination.latitude},${destination.longitude}`;
  return `geo:0,0?q=${encodeURIComponent(coordinate)}&mode=d`;
}

export function driverMapAppWebFallbackUri(destination: TurnByTurnDestination) {
  return googleMapsNavigationFallbackUrl(destination);
}

export function driverMapAppNavigationLabel(platform: DriverNavigationPlatform) {
  return platform === 'ios' ? 'Navigate in Apple Maps' : 'Navigate in Google Maps';
}
