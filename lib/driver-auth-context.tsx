import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRef } from 'react';
import { firebaseAuth, firestoreDB, COLLECTIONS } from './firebase';
import type { User } from 'firebase/auth';

export interface DriverProfile {
  id: string;
  user_id: string;
  full_name: string;
  email?: string;
  phone?: string;
  avatar_url?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  vehicle_plate?: string;
  license_number?: string;
  approval_status?: 'pending' | 'approved' | 'rejected';
  is_online?: boolean;
  is_available?: boolean;
  rating?: number;
  total_trips?: number;
  safety_metrics?: { overall_safety_score?: number };
  service_type?: 'car' | 'okada' | 'delivery';
  acceptance_rate?: number;
  preferences?: {
    notifications?: boolean;
    soundAlerts?: boolean;
    autoAccept?: boolean;
    longTripsOnly?: boolean;
    preferHighRated?: boolean;
  };
  created_date?: string;
}

interface DriverAuthContextType {
  user: User | null;
  driverProfile: DriverProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateDriverProfile: (data: Partial<DriverProfile>) => Promise<void>;
}

const DriverAuthContext = createContext<DriverAuthContextType | null>(null);

export function DriverAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (firebaseUser: User) => {
    try {
      // Try by user_id first
      let profiles = await firestoreDB.list(
        COLLECTIONS.DRIVER_PROFILES,
        { user_id: firebaseUser.uid }
      );
      // Fallback: try by email
      if (profiles.length === 0) {
        profiles = await firestoreDB.list(
          COLLECTIONS.DRIVER_PROFILES,
          { email: firebaseUser.email }
        );
      }
      if (profiles.length > 0) {
        const profile = profiles[0] as DriverProfile;
        // Ensure user_id is set
        if (!profile.user_id) {
          await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, profile.id, { user_id: firebaseUser.uid });
          profile.user_id = firebaseUser.uid;
        }
        setDriverProfile(profile);
        // Subscribe to live updates on this profile doc so rating changes reflect immediately
        if (profileUnsubRef.current) profileUnsubRef.current();
        profileUnsubRef.current = firestoreDB.subscribeDoc(COLLECTIONS.DRIVER_PROFILES, profile.id, (updated) => {
          if (updated) setDriverProfile(updated as DriverProfile);
        });
      } else {
        setDriverProfile(null);
      }
    } catch (err) {
      console.error('Error loading driver profile:', err);
    }
  };

  // Ref to hold the live Firestore subscription for the driver profile doc
  const profileUnsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const unsubscribe = firebaseAuth.onAuthStateChanged(async (firebaseUser) => {
      setUser(firebaseUser);
      // Cancel any previous profile subscription
      if (profileUnsubRef.current) { profileUnsubRef.current(); profileUnsubRef.current = null; }
      if (firebaseUser) {
        await loadProfile(firebaseUser);
      } else {
        setDriverProfile(null);
      }
      setLoading(false);
    });
    return () => { unsubscribe(); if (profileUnsubRef.current) profileUnsubRef.current(); };
  }, []);

  const signIn = async (email: string, password: string) => {
    await firebaseAuth.loginWithEmail(email, password);
  };

  const signInWithGoogle = async () => {
    await firebaseAuth.loginWithGoogle();
  };

  const signUp = async (email: string, password: string) => {
    await firebaseAuth.register(email, password, '');
  };

  const signOut = async () => {
    await firebaseAuth.logout();
    setDriverProfile(null);
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user);
  };

  const updateDriverProfile = async (data: Partial<DriverProfile>) => {
    if (!driverProfile?.id) return;
    await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverProfile.id, data);
    setDriverProfile(prev => prev ? { ...prev, ...data } : null);
  };

  return (
    <DriverAuthContext.Provider value={{
      user, driverProfile, loading,
      signIn, signInWithGoogle, signUp, signOut,
      refreshProfile, updateDriverProfile,
    }}>
      {children}
    </DriverAuthContext.Provider>
  );
}

export function useDriverAuth() {
  const ctx = useContext(DriverAuthContext);
  if (!ctx) throw new Error('useDriverAuth must be used within DriverAuthProvider');
  return ctx;
}
