import { getApiBaseUrl } from '@/constants/oauth';
import { auth } from '@/lib/firebase';
import { createDriverLocationPublisher } from '@/lib/driver-location-publisher-core';

export { createDriverLocationPublisher, type DriverLocationSample } from '@/lib/driver-location-publisher-core';

export const driverLocationPublisher = createDriverLocationPublisher({
  baseUrl: getApiBaseUrl(),
  getToken: async () => auth.currentUser?.getIdToken() ?? null,
  post: (url, init) => fetch(url, init),
});
