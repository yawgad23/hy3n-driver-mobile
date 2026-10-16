type DriverForegroundLocationCleanup = () => void | Promise<void>;

// The Home screen owns foreground GPS subscriptions and heartbeat work, while
// the auth provider owns Firebase sign-out. Keep a compact copied-array bridge
// so a React cleanup can unregister safely while a shutdown snapshot runs.
let cleanupCallbacks: DriverForegroundLocationCleanup[] = [];

export function registerDriverForegroundLocationCleanup(cleanup: DriverForegroundLocationCleanup) {
  cleanupCallbacks = [...cleanupCallbacks, cleanup];
  let active = true;

  return () => {
    if (!active) return;
    active = false;
    const index = cleanupCallbacks.indexOf(cleanup);
    if (index >= 0) {
      cleanupCallbacks = [...cleanupCallbacks.slice(0, index), ...cleanupCallbacks.slice(index + 1)];
    }
  };
}

/**
 * Stops every currently registered foreground Driver location task. Call this
 * before changing Firebase auth state; each cleanup is idempotent because the
 * normal React effect cleanup may run afterwards as the tab tree unmounts.
 */
export async function stopDriverForegroundLocationWork(): Promise<void> {
  const callbacks = cleanupCallbacks;
  cleanupCallbacks = [];
  await Promise.allSettled(callbacks.map((cleanup) => Promise.resolve().then(cleanup)));
}
