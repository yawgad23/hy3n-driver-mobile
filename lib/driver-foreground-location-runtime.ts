type DriverForegroundLocationCleanup = () => void | Promise<void>;

// The Home screen owns foreground GPS subscriptions and heartbeat work, while
// the auth provider owns Firebase sign-out. Keep a small process-local bridge
// so foreground work can be stopped before Firebase removes the Driver tree.
const cleanupCallbacks = new Set<DriverForegroundLocationCleanup>();

export function registerDriverForegroundLocationCleanup(cleanup: DriverForegroundLocationCleanup) {
  cleanupCallbacks.add(cleanup);
  return () => cleanupCallbacks.delete(cleanup);
}

/**
 * Stops every currently registered foreground Driver location task. Call this
 * before changing Firebase auth state; each cleanup is idempotent because the
 * normal React effect cleanup may run afterwards as the tab tree unmounts.
 */
export async function stopDriverForegroundLocationWork(): Promise<void> {
  const callbacks = Array.from(cleanupCallbacks);
  cleanupCallbacks.clear();
  await Promise.allSettled(callbacks.map((cleanup) => Promise.resolve().then(cleanup)));
}
