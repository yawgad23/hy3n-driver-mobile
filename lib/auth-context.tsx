import React, { createContext, useContext, useEffect, useState } from 'react';
import { firebaseAuth, firestoreDB, COLLECTIONS } from './firebase';
import type { User } from 'firebase/auth';

export interface RiderProfile {
  id: string;
  user_id: string;
  full_name: string;
  email?: string;
  phone?: string;
  profile_picture?: string;
  loyalty_points?: number;
  loyalty_tier?: string;
  rating?: number;
  total_rides?: number;
  referral_code?: string;
  wallet_balance?: number;
  saved_places?: Array<{ label: string; address: string; lat?: number; lng?: number }>;
  created_date?: string;
}

interface AuthContextType {
  user: User | null;
  riderProfile: RiderProfile | null;
  loading: boolean;
  guestMode: boolean;
  setGuestMode: (val: boolean) => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, fullName: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<RiderProfile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [riderProfile, setRiderProfile] = useState<RiderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestMode, setGuestMode] = useState(false);

  const loadProfile = async (firebaseUser: User) => {
    try {
      const profiles = await firestoreDB.list(
        COLLECTIONS.RIDER_PROFILES,
        { user_id: firebaseUser.uid }
      );
      if (profiles.length > 0) {
        setRiderProfile(profiles[0] as RiderProfile);
      } else {
        const newProfile = await firestoreDB.create(COLLECTIONS.RIDER_PROFILES, {
          user_id: firebaseUser.uid,
          full_name: firebaseUser.displayName || '',
          email: firebaseUser.email || '',
          phone: firebaseUser.phoneNumber || '',
          loyalty_points: 0,
          loyalty_tier: 'Bronze',
          rating: 5.0,
          total_rides: 0,
          referral_code: Math.random().toString(36).slice(2, 8).toUpperCase(),
        });
        setRiderProfile(newProfile as unknown as RiderProfile);
      }
    } catch (err) {
      console.error('Error loading rider profile:', err);
    }
  };

  useEffect(() => {
    const unsubscribe = firebaseAuth.onAuthStateChanged(async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        await loadProfile(firebaseUser);
      } else {
        setRiderProfile(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    const firebaseUser = await firebaseAuth.loginWithEmail(email, password);
    setGuestMode(false);
    await loadProfile(firebaseUser);
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const firebaseUser = await firebaseAuth.register(email, password, fullName);
    setGuestMode(false);
    await loadProfile(firebaseUser);
  };

  const signOutUser = async () => {
    await firebaseAuth.logout();
    setUser(null);
    setRiderProfile(null);
    setGuestMode(false);
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user);
  };

  const updateProfileData = async (data: Partial<RiderProfile>) => {
    if (!riderProfile?.id) return;
    const updated = await firestoreDB.update(COLLECTIONS.RIDER_PROFILES, riderProfile.id, data);
    setRiderProfile((prev) => prev ? { ...prev, ...updated } : prev);
  };

  return (
    <AuthContext.Provider value={{
      user,
      riderProfile,
      loading,
      guestMode,
      setGuestMode,
      signIn,
      signUp,
      signOut: signOutUser,
      refreshProfile,
      updateProfile: updateProfileData,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
