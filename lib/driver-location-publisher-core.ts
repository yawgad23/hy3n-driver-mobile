export type DriverLocationSample = {
  latitude: number;
  longitude: number;
  heading?: number | null;
  speedKmh?: number | null;
  recordedAt: string;
};

type PublisherDependencies = {
  getToken: () => Promise<string | null>;
  post: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number }>;
  baseUrl: string;
};

/** Core Location uses -1 when the compass heading is unavailable. */
export function publishableDriverHeading(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 360
    ? value
    : null;
}

export function publishableDriverSpeedKmh(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 240
    ? value
    : null;
}

/**
 * Serialises GPS uploads and discards samples that are older than one already
 * accepted by the server. An equal iOS timestamp is a legitimate stationary
 * heartbeat: it must reach the server so a verified online Driver does not
 * disappear from Rider maps simply because Core Location reused its cache.
 */
export function createDriverLocationPublisher({ getToken, post, baseUrl }: PublisherDependencies) {
  let newestAcceptedAt = 0;
  let newestQueuedAt = 0;
  let inFlight: Promise<void> | null = null;
  let pending: DriverLocationSample | null = null;
  let sessionGeneration = 0;

  /**
   * Stops this publisher from starting another queued GPS request after a
   * Driver signs out. An already-started request cannot be revoked reliably,
   * but it is prevented from advancing the queue into the next user session.
   */
  const clear = () => {
    sessionGeneration += 1;
    pending = null;
    newestAcceptedAt = 0;
    newestQueuedAt = 0;
  };

  const send = async (sample: DriverLocationSample, generation: number) => {
    if (generation !== sessionGeneration) return false;
    const recordedAt = new Date(sample.recordedAt).getTime();
    const token = await getToken();
    if (generation !== sessionGeneration || !token) return false;
    const response = await post(`${baseUrl}/api/driver/location`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        latitude: sample.latitude,
        longitude: sample.longitude,
        heading: publishableDriverHeading(sample.heading),
        speedKmh: publishableDriverSpeedKmh(sample.speedKmh),
        recordedAt: sample.recordedAt,
      }),
    });
    if (generation !== sessionGeneration) return false;
    if (!response.ok) throw new Error(`Driver location update failed (${response.status}).`);
    newestAcceptedAt = Math.max(newestAcceptedAt, recordedAt);
    return true;
  };

  const publish = async (sample: DriverLocationSample): Promise<boolean> => {
    const recordedAt = new Date(sample.recordedAt).getTime();
    if (!Number.isFinite(recordedAt) || recordedAt < newestAcceptedAt || recordedAt < newestQueuedAt) return false;
    newestQueuedAt = Math.max(newestQueuedAt, recordedAt);

    // When mobile data is slow, retaining every GPS sample makes lifecycle
    // actions queue behind obsolete uploads. Keep the newest point only; an
    // equal timestamp is deliberately retained as a stationary heartbeat.
    if (inFlight) {
      pending = sample;
      return true;
    }

    const generation = sessionGeneration;
    const operation = (async () => {
      let next: DriverLocationSample | null = sample;
      while (next && generation === sessionGeneration) {
        const current = next;
        pending = null;
        try {
          if (!await send(current, generation)) break;
        } catch (error) {
          if (generation === sessionGeneration) newestQueuedAt = newestAcceptedAt;
          throw error;
        }
        next = generation === sessionGeneration ? pending : null;
      }
    })();
    inFlight = operation;
    try {
      await operation;
      return recordedAt <= newestAcceptedAt;
    } finally {
      if (inFlight === operation) inFlight = null;
    }
  };

  return { publish, clear };
}
