import type { BackgroundLocationStartResult } from '@/lib/driver-background-location';

/**
 * A permission prompt must be a deliberate once-per-online-session action.
 * Android may deliver the same denied result after a render or an activity
 * resume; never turn that into another system prompt or another alert loop.
 */
export type DriverBackgroundLocationRequestState = 'ready' | 'requesting' | 'active' | 'blocked';

export function beginDriverBackgroundLocationRequest({
  shouldTrack,
  state,
}: {
  shouldTrack: boolean;
  state: DriverBackgroundLocationRequestState;
}): { state: DriverBackgroundLocationRequestState; shouldRequest: boolean } {
  if (!shouldTrack) return { state: 'ready', shouldRequest: false };
  if (state !== 'ready') return { state, shouldRequest: false };
  return { state: 'requesting', shouldRequest: true };
}

export function finishDriverBackgroundLocationRequest(
  result: BackgroundLocationStartResult,
): DriverBackgroundLocationRequestState {
  if (result.started) return 'active';
  // Cancellation occurs during sign-out/offline cleanup. It should not become
  // a warning, and a future deliberate online session begins from `ready`.
  if (result.reason === 'cancelled') return 'ready';
  // A denied, unsupported, or foreground-location failure stays blocked until
  // the Driver deliberately goes offline and online again.
  return 'blocked';
}

export function shouldShowDriverBackgroundLocationWarning(
  result: BackgroundLocationStartResult,
): boolean {
  return !result.started
    && result.reason !== 'cancelled'
    && result.reason !== 'unsupported';
}
