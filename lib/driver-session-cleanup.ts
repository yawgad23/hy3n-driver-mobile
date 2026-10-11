type DriverSessionCleanupDependencies = {
  stopForegroundLocationWork?: () => Promise<void>;
  clearQueuedLocationUpdates: () => void;
  stopBackgroundLocationUpdates: () => Promise<void>;
  report?: (message: string) => void;
};

/**
 * Releases Driver-only live-location work before the Firebase auth state is
 * changed. Keeping the native foreground service and its JS publisher alive
 * while the tabs unmount can crash Android during a sign-out transition.
 */
export async function cleanUpDriverSession({
  stopForegroundLocationWork,
  clearQueuedLocationUpdates,
  stopBackgroundLocationUpdates,
  report = () => {},
}: DriverSessionCleanupDependencies): Promise<void> {
  // The active Home screen owns foreground GPS watches and heartbeat work.
  // Stop those callbacks before auth state removes the map and tab tree.
  try {
    await stopForegroundLocationWork?.();
  } catch (error: any) {
    report(`[HY3N] Foreground Driver location cleanup failed: ${error?.message || 'unknown error'}`);
  }

  // This is synchronous so no queued sample can outlive the user session,
  // even if Android needs a moment to finish stopping its foreground service.
  clearQueuedLocationUpdates();

  try {
    await stopBackgroundLocationUpdates();
  } catch (error: any) {
    // A missing or already-stopped Android service must never prevent a user
    // from signing out. The server will also reject any old Firebase token.
    report(`[HY3N] Background Driver location cleanup failed: ${error?.message || 'unknown error'}`);
  }
}
