export type DriverOfferRefreshRequest = () => void | Promise<unknown>;

/**
 * Serializes offer refreshes from polling, push delivery, and app resume.
 *
 * A Driver can receive all three signals for one ride. Re-running a React
 * Query fetch while a previous offer fetch is still settling needlessly adds
 * concurrent work to the iPhone incoming-offer window. Keep the latest signal
 * as one trailing refresh instead.
 */
export function createSingleFlightDriverOfferRefresher() {
  let inFlight = false;
  let replayRequested = false;

  const refresh = (request: DriverOfferRefreshRequest) => {
    if (inFlight) {
      replayRequested = true;
      return;
    }

    inFlight = true;
    void Promise.resolve()
      .then(request)
      .catch(() => undefined)
      .finally(() => {
        inFlight = false;
        if (!replayRequested) return;
        replayRequested = false;
        refresh(request);
      });
  };

  return {
    refresh,
    clearPending() {
      replayRequested = false;
    },
  };
}
