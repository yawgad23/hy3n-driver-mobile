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

/**
 * Serialises GPS uploads and discards samples that are older than one already
 * accepted by the server. This gives Rider presence one monotonic source of
 * truth and prevents a delayed radio request from moving a car backwards.
 */
export function createDriverLocationPublisher({ getToken, post, baseUrl }: PublisherDependencies) {
  let newestAcceptedAt = 0;
  let inFlight: Promise<void> | null = null;

  const publish = async (sample: DriverLocationSample): Promise<boolean> => {
    const recordedAt = new Date(sample.recordedAt).getTime();
    if (!Number.isFinite(recordedAt) || recordedAt <= newestAcceptedAt) return false;

    const previous = inFlight;
    const operation = (async () => {
      if (previous) await previous.catch(() => {});
      if (recordedAt <= newestAcceptedAt) return;

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
          heading: sample.heading ?? null,
          speedKmh: sample.speedKmh ?? null,
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
