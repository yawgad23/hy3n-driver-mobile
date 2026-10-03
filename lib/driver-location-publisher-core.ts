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
  let inFlight: Promise<void> | null = null;

  const publish = async (sample: DriverLocationSample): Promise<boolean> => {
    const recordedAt = new Date(sample.recordedAt).getTime();
    if (!Number.isFinite(recordedAt) || recordedAt < newestAcceptedAt) return false;

    const previous = inFlight;
    const operation = (async () => {
      if (previous) await previous.catch(() => {});
      if (recordedAt < newestAcceptedAt) return;

      const token = await getToken();
      if (!token) throw new Error('Driver session is unavailable.');
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
      if (!response.ok) throw new Error(`Driver location update failed (${response.status}).`);
      newestAcceptedAt = Math.max(newestAcceptedAt, recordedAt);
    })();

    inFlight = operation;
    try {
      await operation;
      return recordedAt <= newestAcceptedAt;
    } finally {
      if (inFlight === operation) inFlight = null;
    }
  };

  return { publish };
}
