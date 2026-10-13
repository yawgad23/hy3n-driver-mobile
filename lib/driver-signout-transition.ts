export type DriverFrameScheduler = (callback: () => void) => void;

const scheduleDefaultFrame: DriverFrameScheduler = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
};

/**
 * Lets React commit the signed-out shell before Firebase changes its auth state.
 *
 * Android must not release a Google Map and revoke Firebase in the same native
 * transition. Two animation frames give the Driver tab tree time to unmount its
 * map, markers, and navigation views before the auth listener redirects to the
 * public landing screen.
 */
export function waitForDriverNativeUnmount(
  scheduleFrame: DriverFrameScheduler = scheduleDefaultFrame,
): Promise<void> {
  return new Promise((resolve) => {
    scheduleFrame(() => scheduleFrame(resolve));
  });
}
