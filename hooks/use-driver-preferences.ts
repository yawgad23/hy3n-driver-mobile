import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDriverAuth } from '@/lib/driver-auth-context';
import {
  DEFAULT_DRIVER_OFFER_PREFERENCES,
  mergeDriverOfferPreferences,
  normalizeDriverOfferPreferences,
  type DriverOfferPreferences,
} from '@/lib/driver-offer-preferences';
import { saveDriverOfferPreferences } from '@/lib/driver-preferences-api';

export type DriverPreferences = DriverOfferPreferences;

type Listener = (preferences: DriverPreferences) => void;

let activeDriverKey: string | null = null;
let sharedPreferences: DriverPreferences = DEFAULT_DRIVER_OFFER_PREFERENCES;
const listeners = new Set<Listener>();

function publish(preferences: DriverPreferences) {
  sharedPreferences = preferences;
  listeners.forEach((listener) => listener(preferences));
}

function storageKey(driverId: string) {
  return `hy3n_driver_preferences:${driverId}`;
}

/**
 * One per-Driver store feeds Settings and Home. A switch changes the offer
 * runtime immediately, then is authenticated and saved server-side for other
 * sessions and server offer dispatch. A failed server save is reported instead
 * of being silently shown as a successful save.
 */
export function useDriverPreferences() {
  const { driverProfile } = useDriverAuth();
  const driverId = String(driverProfile?.user_id || driverProfile?.id || '').trim();
  const remotePreferences = ((driverProfile as any)?.preferences ?? (driverProfile as any)?.driver_preferences) as Partial<DriverPreferences> | undefined;
  const [prefs, setPrefsState] = useState<DriverPreferences>(sharedPreferences);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const preferenceWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const preferenceWriteVersionRef = useRef(0);

  useEffect(() => {
    const listener: Listener = (next) => setPrefsState(next);
    listeners.add(listener);
    listener(sharedPreferences);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!driverId) {
        if (!cancelled) {
          activeDriverKey = null;
          publish(DEFAULT_DRIVER_OFFER_PREFERENCES);
          setLoaded(false);
        }
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(storageKey(driverId));
        const local = raw ? JSON.parse(raw) as Partial<DriverPreferences> : {};
        const next = mergeDriverOfferPreferences(local, remotePreferences);
        if (!cancelled) {
          activeDriverKey = driverId;
          publish(next);
          setSyncError(null);
        }
      } catch {
        if (!cancelled) publish(normalizeDriverOfferPreferences(remotePreferences));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [driverId]);

  // The profile is live-subscribed. Apply a confirmed remote preference update
  // to every mounted consumer without waiting for a screen remount.
  useEffect(() => {
    if (!loaded || savingRef.current || !driverId || activeDriverKey !== driverId || !remotePreferences) return;
    publish(mergeDriverOfferPreferences(sharedPreferences, remotePreferences));
  }, [driverId, loaded, remotePreferences]);

  const persist = useCallback((next: DriverPreferences) => {
    if (!driverId) {
      setSyncError('Please sign in again before changing Driver preferences.');
      return;
    }
    const writeVersion = ++preferenceWriteVersionRef.current;
    savingRef.current = true;
    setSaving(true);
    setSyncError(null);
    const write = preferenceWriteQueueRef.current.then(async () => {
      await AsyncStorage.setItem(storageKey(driverId), JSON.stringify(next));
      return saveDriverOfferPreferences(next);
    });
    preferenceWriteQueueRef.current = write.then(() => undefined, () => undefined);
    void write.then(
      (saved) => {
        if (writeVersion === preferenceWriteVersionRef.current && activeDriverKey === driverId) {
          publish(normalizeDriverOfferPreferences(saved.preferences));
        }
      },
      (error) => {
        if (writeVersion === preferenceWriteVersionRef.current && activeDriverKey === driverId) {
          setSyncError(error instanceof Error ? error.message : 'HY3N could not sync this setting. Check your connection and try again.');
        }
      },
    ).finally(() => {
      if (writeVersion === preferenceWriteVersionRef.current) {
        savingRef.current = false;
        setSaving(false);
      }
    });
  }, [driverId]);

  const setPrefs = useCallback((next: DriverPreferences) => {
    const normalized = normalizeDriverOfferPreferences(next);
    publish(normalized);
    void persist(normalized);
  }, [persist]);

  const toggle = useCallback((key: keyof DriverPreferences) => {
    const next = normalizeDriverOfferPreferences({ ...sharedPreferences, [key]: !sharedPreferences[key] });
    publish(next);
    void persist(next);
  }, [persist]);

  return { prefs, setPrefs, toggle, saving, loaded, syncError };
}
