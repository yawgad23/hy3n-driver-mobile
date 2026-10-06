export type DriverBackgroundLocationDisclosureDecision = 'unseen' | 'accepted' | 'declined';

export const DRIVER_BACKGROUND_LOCATION_DISCLOSURE = Object.freeze({
  title: 'Location while you are online',
  message:
    'HY3N Driver collects your location while the app is in the background or not in use when you are online or completing an active trip. This lets Riders follow your approach and helps HY3N manage the trip. Location sharing stops when you go offline and have no active trip.',
  continueLabel: 'Continue',
  notNowLabel: 'Not now',
});

/**
 * Android requires a prominent, in-app explanation immediately before the
 * background-location runtime prompt. A declined disclosure must not fall
 * through to an automatic permission request on a later render.
 */
export function shouldShowDriverBackgroundLocationDisclosure({
  platform,
  shouldTrack,
  decision,
}: {
  platform: string;
  shouldTrack: boolean;
  decision: DriverBackgroundLocationDisclosureDecision;
}): boolean {
  return platform === 'android' && shouldTrack && decision === 'unseen';
}
