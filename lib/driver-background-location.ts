import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ExpoLocation from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { auth } from '@/lib/firebase';
import { getApiBaseUrl } from '@/constants/oauth';

export const DRIVER_BACKGROUND_LOCATION_TASK = 'hy3n-driver-background-location-v1';
const BACKGROUND_TRACKING_ENABLED_KEY = 'hy3n:driver-background-location-enabled';

async function publishDriverLocation(location: ExpoLocation.LocationObject) {
  const user = auth.currentUser;
  if (!user) return;
  const idToken = await user.getIdToken();
  await fetch(`${getApiBaseUrl()}/api/driver/location`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      heading: location.coords.heading ?? null,
      speedKmh: location.coords.speed === null || location.coords.speed === undefined
        ? null
        : Math.max(0, Number((location.coords.speed * 3.6).toFixed(1))),
      recordedAt: new Date(location.timestamp || Date.now()).toISOString(),
    }),
  });
}

// The task must be declared at module scope and imported from the root layout,
// otherwise iOS cannot resume it after the app has been backgrounded.
if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(DRIVER_BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(DRIVER_BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[HY3N] Background Driver location task failed:', error.message);
      return;
    }
    const enabled = await AsyncStorage.getItem(BACKGROUND_TRACKING_ENABLED_KEY);
    if (enabled !== 'true') return;

    const locations = (data as { locations?: ExpoLocation.LocationObject[] } | undefined)?.locations || [];
    const latest = locations[locations.length - 1];
    if (!latest) return;
    try {
      await publishDriverLocation(latest);
    } catch (publishError: any) {
      // iOS will retry the task when the next qualifying location arrives. Do
      // not throw here, which would mark the location task as failed.
      console.warn('[HY3N] Background Driver location publish failed:', publishError?.message || 'unknown error');
    }
  });
}

export type BackgroundLocationStartResult = {
  started: boolean;
  reason?: 'foreground_denied' | 'background_denied' | 'unsupported';
};

export async function startDriverBackgroundLocationUpdates(): Promise<BackgroundLocationStartResult> {
  if (Platform.OS === 'web') return { started: false, reason: 'unsupported' };

  const foreground = await ExpoLocation.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') return { started: false, reason: 'foreground_denied' };

  const background = await ExpoLocation.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') return { started: false, reason: 'background_denied' };

  await AsyncStorage.setItem(BACKGROUND_TRACKING_ENABLED_KEY, 'true');
  const alreadyStarted = await ExpoLocation.hasStartedLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK);
  if (!alreadyStarted) {
    await ExpoLocation.startLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK, {
      accuracy: ExpoLocation.Accuracy.BestForNavigation,
      timeInterval: 10_000,
      distanceInterval: 10,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'HY3N Driver is online',
        notificationBody: 'Your location is shared while you are available for rides.',
      },
    });
  }
  return { started: true };
}

export async function stopDriverBackgroundLocationUpdates() {
  if (Platform.OS === 'web') return;
  await AsyncStorage.removeItem(BACKGROUND_TRACKING_ENABLED_KEY);
  const alreadyStarted = await ExpoLocation.hasStartedLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK);
  if (alreadyStarted) await ExpoLocation.stopLocationUpdatesAsync(DRIVER_BACKGROUND_LOCATION_TASK);
}
