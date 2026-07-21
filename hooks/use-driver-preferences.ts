/**
 * useDriverPreferences
 *
 * Manages driver preference toggles with dual persistence:
 *   1. AsyncStorage — instant local reads on every app launch
 *   2. Firestore (via updateDriverProfile) — cross-device sync
 *
 * Usage:
 *   const { prefs, setPrefs, toggle, saving } = useDriverPreferences();
 */
import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDriverAuth } from '@/lib/driver-auth-context';

export interface DriverPreferences {
  notifications: boolean;
  soundAlerts: boolean;
  autoAccept: boolean;
  longTripsOnly: boolean;
  preferHighRated: boolean;
  destinationFilter: string | null;
}

const STORAGE_KEY = 'hy3n_driver_preferences';

const DEFAULT_PREFS: DriverPreferences = {
  notifications: true,
  soundAlerts: true,
  autoAccept: false,
  longTripsOnly: false,
  preferHighRated: true,
  destinationFilter: null,
};

export function useDriverPreferences() {
  const { driverProfile, updateDriverProfile } = useDriverAuth();
  const [prefs, setPrefsState] = useState<DriverPreferences>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load on mount: AsyncStorage first, then merge any Firestore-saved prefs
  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const local: Partial<DriverPreferences> = raw ? JSON.parse(raw) : {};

        // Firestore preferences stored under driver profile as `preferences` field
        const remote = (driverProfile as any)?.preferences as Partial<DriverPreferences> | undefined;

        // Remote wins over local for cross-device sync; fall back to defaults
        const merged: DriverPreferences = {
          ...DEFAULT_PREFS,
          ...local,
          ...(remote || {}),
        };
        setPrefsState(merged);
      } catch {
        // Silently fall back to defaults
      } finally {
        setLoaded(true);
      }
    };
    load();
  }, [driverProfile?.id]); // re-run when profile loads

  const persist = useCallback(async (next: DriverPreferences) => {
    setSaving(true);
    try {
      // 1. Local — always fast
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      // 2. Firestore — best effort (don't block UI on failure)
      await updateDriverProfile({ preferences: next } as any);
    } catch {
      // AsyncStorage write may still have succeeded; Firestore failure is non-critical
    } finally {
      setSaving(false);
    }
  }, [updateDriverProfile]);

  const setPrefs = useCallback((next: DriverPreferences) => {
    setPrefsState(next);
    persist(next);
  }, [persist]);

  const toggle = useCallback((key: keyof DriverPreferences) => {
    setPrefsState(prev => {
      const next = { ...prev, [key]: !prev[key] };
      persist(next);
      return next;
    });
  }, [persist]);

  return { prefs, setPrefs, toggle, saving, loaded };
}
