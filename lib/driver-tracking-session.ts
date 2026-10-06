/**
 * A small generation lease for asynchronous location start/stop operations.
 * A start can wait on Android permission or a native service call; signing out
 * invalidates that start so it cannot revive tracking after session cleanup.
 */
export function createDriverTrackingSession() {
  let generation = 0;

  const capture = () => generation;
  const isCurrent = (candidate: number) => candidate === generation;
  const invalidate = () => {
    generation += 1;
  };

  return { capture, isCurrent, invalidate };
}
