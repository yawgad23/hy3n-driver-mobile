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
  vehicle_colour?: string;
  vehicle_colour_hex?: string;
  vehicle_plate?: string;
  license_plate?: string;
  license_number?: string;
  approval_status?: 'pending' | 'approved' | 'rejected';
  application_status?: string;
  status?: string;
  approved?: boolean;
  is_approved?: boolean;
  is_online?: boolean;
  is_available?: boolean;
  rating?: number;
  total_trips?: number;
  safety_metrics?: { overall_safety_score?: number };
  service_type?: 'car' | 'okada' | 'delivery';
  momo_number?: string;
  momo_number_masked?: string;
  momo_provider?: 'MTN MoMo' | 'Telecel Cash' | 'AirtelTigo Money' | string;
  momo_account_name?: string;
  momo_account_holder?: string;
  city?: string;
  momo_updated_at?: string;
  momo_network?: 'mtn-gh' | 'vodafone-gh' | 'tigo-gh';
  referral_code?: string;
  accepted_categories?: string[];
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
  startPhoneSignIn: (phone: string, appVerifier?: any) => Promise<{ verificationId: string; phoneNumber: string }>;
  confirmPhoneSignIn: (verificationId: string, code: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateDriverProfile: (data: Partial<DriverProfile>) => Promise<void>;
}

const DriverAuthContext = createContext<DriverAuthContextType | null>(null);

export function DriverAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);
  const [loading, setLoading] = useState(true);
  // Keep profile reads and subscriptions tied to the current authenticated
  // session. A late Firestore response from a previous Driver must never put
  // profile state back after that Driver has signed out.
  const profileUnsubRef = useRef<(() => void) | null>(null);
  const authTransitionRef = useRef(0);

  const clearProfileSubscription = () => {
    if (profileUnsubRef.current) {
      profileUnsubRef.current();
      profileUnsubRef.current = null;
    }
  };

  const loadProfile = async (firebaseUser: User, authTransition: number) => {
    const isCurrentSession = () => (
      authTransition === authTransitionRef.current
      && firebaseAuth.getCurrentUser()?.uid === firebaseUser.uid
    );
    try {
      // There may be both a UID-keyed document and an older auto-ID document.
      // Read every matching record so a stale pending record cannot hide an
      // approved record updated by the admin portal.
      const candidates: any[] = [];
      const canonical = await firestoreDB.get(COLLECTIONS.DRIVER_PROFILES, firebaseUser.uid);
      if (canonical) candidates.push(canonical);
      const byUserId = await firestoreDB.list(COLLECTIONS.DRIVER_PROFILES, { user_id: firebaseUser.uid });
      const byEmail = firebaseUser.email
        ? await firestoreDB.list(COLLECTIONS.DRIVER_PROFILES, { email: firebaseUser.email })
        : [];
      for (const profile of [...byUserId, ...byEmail]) {
        if (!candidates.some((existing) => existing.id === profile.id)) candidates.push(profile);
      }

      const isApproved = (profile: any) => {
        const status = String(profile?.approval_status ?? profile?.application_status ?? profile?.status ?? '').trim().toLowerCase();
        return status === 'approved' || profile?.approved === true || profile?.is_approved === true;
      };
      const profiles = candidates.sort((a, b) => {
        if (isApproved(a) !== isApproved(b)) return isApproved(a) ? -1 : 1;
        return String(b.updated_date || b.created_date || '').localeCompare(String(a.updated_date || a.created_date || ''));
      });
      if (!isCurrentSession()) return;
      if (profiles.length > 0) {
        const profile = profiles[0] as DriverProfile;
        // Ensure user_id is set
        if (!profile.user_id) {
          await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, profile.id, { user_id: firebaseUser.uid });
          profile.user_id = firebaseUser.uid;
        }
        setDriverProfile(profile);
        // Subscribe to live updates on this profile doc so rating changes reflect immediately
        clearProfileSubscription();
        profileUnsubRef.current = firestoreDB.subscribeDoc(COLLECTIONS.DRIVER_PROFILES, profile.id, (updated) => {
          if (updated && isCurrentSession()) setDriverProfile(updated as DriverProfile);
        });
      } else {
        setDriverProfile(null);
      }
    } catch (err) {
      console.error('Error loading driver profile:', err);
    }
  };

  useEffect(() => {
    const unsubscribe = firebaseAuth.onAuthStateChanged((firebaseUser) => {
      const authTransition = ++authTransitionRef.current;
      setUser(firebaseUser);
      clearProfileSubscription();
      if (firebaseUser) {
        // Do not leave the previous Driver's profile visible while the new
        // account is loading.
        setDriverProfile(null);
        setLoading(true);
        void loadProfile(firebaseUser, authTransition).finally(() => {
          if (authTransition === authTransitionRef.current) setLoading(false);
        });
      } else {
        setDriverProfile(null);
        setLoading(false);
      }
    });
    return () => {
      authTransitionRef.current += 1;
      unsubscribe();
      clearProfileSubscription();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    await firebaseAuth.loginWithEmail(email, password);
  };

  const startPhoneSignIn = async (phone: string, appVerifier?: any) => {
    return firebaseAuth.startPhoneSignIn(phone, appVerifier);
  };

  const confirmPhoneSignIn = async (verificationId: string, code: string) => {
    const confirmedUser = await firebaseAuth.confirmPhoneSignIn(verificationId, code);
    try {
      await firebaseAuth.linkPhoneLoginToDriverProfile();
      // The auth listener normally runs during sign-in. Load explicitly too so
      // the login screen only navigates after the linked Driver profile exists.
      await loadProfile(confirmedUser, authTransitionRef.current);
    } catch (error) {
      // A successful code must not leave an unmatched phone-auth account open
      // in the Driver app. The user receives the actionable server message.
      await firebaseAuth.logout().catch(() => {});
      throw error;
    }
  };

  const signInWithGoogle = async () => {
    await firebaseAuth.loginWithGoogle();
  };

  const signUp = async (email: string, password: string, fullName = '') => {
    await firebaseAuth.register(email, password, fullName);
  };

  const signOut = async () => {
    await firebaseAuth.logout();
    // Firebase normally emits the null auth-state callback before logout()
    // resolves. Apply the safe state locally as well so the tab shell cannot
    // retain an authenticated profile during a navigation transition.
    authTransitionRef.current += 1;
    clearProfileSubscription();
    setUser(null);
    setDriverProfile(null);
    setLoading(false);
  };

  /**
   * Removes the signed-in Driver's profile before deleting their Firebase
   * Authentication account. The latter is essential: merely signing out would
   * leave the account usable and would not satisfy an account-deletion request.
   */
  const deleteAccount = async () => {
    if (!user) throw new Error('No Driver account is signed in.');

    if (driverProfile?.id) {
      await firestoreDB.delete(COLLECTIONS.DRIVER_PROFILES, driverProfile.id);
    }

    await firebaseAuth.deleteAccount();
    setDriverProfile(null);
  };

  const refreshProfile = async () => {
    if (user) await loadProfile(user, authTransitionRef.current);
  };

  const updateDriverProfile = async (data: Partial<DriverProfile>) => {
    if (!driverProfile?.id) return;
    await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, driverProfile.id, data);
    setDriverProfile(prev => prev ? { ...prev, ...data } : null);
  };

  return (
    <DriverAuthContext.Provider value={{
      user, driverProfile, loading,
      signIn, startPhoneSignIn, confirmPhoneSignIn, signInWithGoogle, signUp, signOut, deleteAccount,
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
