/**
 * Firebase configuration for HY3N Rider Mobile App
 * Project: hy3n26
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  PhoneAuthProvider,
  linkWithCredential,
  signInWithCredential,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  deleteUser,
  type User,
} from 'firebase/auth';
import { Platform } from 'react-native';
// getReactNativePersistence is only available on native — import conditionally
let AsyncStorage: any = null;
let getReactNativePersistence: any = null;
if (Platform.OS !== 'web') {
  AsyncStorage = require('@react-native-async-storage/async-storage').default;
  getReactNativePersistence = require('firebase/auth').getReactNativePersistence;
}
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  onSnapshot,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

// ─── Firebase Config ─────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyDYUm2xv_8er3oGwk6qVXzAT51hoS4N4dE",
  authDomain: "hy3n26.firebaseapp.com",
  projectId: "hy3n26",
  storageBucket: "hy3n26.firebasestorage.app",
  messagingSenderId: "362594902321",
  appId: "1:362594902321:web:9387b08590e7660216d010",
  measurementId: "G-WH7JZPLP0L"
};

function googleWebClientId(): string {
  const services = require('../firebase/google-services.json') as {
    client?: Array<{ oauth_client?: Array<{ client_type?: number; client_id?: string }> }>;
  };
  for (const client of services.client ?? []) {
    const webClient = client.oauth_client?.find((item) => item.client_type === 3 && item.client_id);
    if (webClient?.client_id) return webClient.client_id;
  }
  throw new Error('Google Sign-In is not configured for this app. Please update the native Google service file.');
}

function normalizeGhanaPhone(phoneInput: string): string {
  const digits = String(phoneInput || '').replace(/[^\d+]/g, '');
  const normalized = digits.startsWith('+233')
    ? digits
    : digits.startsWith('233')
      ? `+${digits}`
      : digits.startsWith('0')
        ? `+233${digits.slice(1)}`
        : `+233${digits}`;
  if (!/^\+233\d{9}$/.test(normalized)) {
    throw new Error('Enter a valid Ghana mobile number.');
  }
  return normalized;
}

// Initialize Firebase (avoid re-initialization)
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Use initializeAuth with platform-appropriate persistence
// Web: browserLocalPersistence (localStorage) | Native: AsyncStorage
let auth: ReturnType<typeof getAuth>;
try {
  const persistence = Platform.OS === 'web'
    ? browserLocalPersistence
    : getReactNativePersistence(AsyncStorage);
  auth = initializeAuth(app, { persistence });
} catch (e: any) {
  // Already initialized — get existing instance
  auth = getAuth(app);
}

const db = getFirestore(app);
const storage = getStorage(app);

export { app, auth, db, storage };

// ─── Firestore Collection Names (matching web app) ────────────────────────────
export const COLLECTIONS = {
  RIDER_PROFILES: 'rider_profiles',
  RIDES: 'rides',
  WALLET: 'wallets',
  WALLET_TRANSACTIONS: 'wallet_transactions',
  SCHEDULED_RIDES: 'scheduled_rides',
  SUPPORT_TICKETS: 'support_tickets',
  LOYALTY_POINTS: 'loyalty_points',
  LOYALTY_REDEMPTIONS: 'loyalty_redemptions',
  SAVED_PLACES: 'saved_places',
  REFERRALS: 'referrals',
  SOS_INCIDENTS: 'sos_incidents',
  PROMO_CODES: 'promo_codes',
  PAYMENTS: 'payments',
  RIDE_REPORTS: 'ride_reports',
  DRIVER_PROFILES: 'driver_profiles',
  DAILY_COMMISSION: 'daily_commissions',
  EARNINGS: 'earnings',
  RIDE_CALLS: 'ride_calls',
  DRIVER_NOTIFICATIONS: 'driver_notifications',
  DRIVER_SAFETY_EVENTS: 'driver_safety_events',
  FOUND_ITEMS: 'found_items',
  RIDE_MESSAGES: 'ride_messages',
  DRIVER_REFERRALS: 'driver_referrals',
};

// ─── Auth Helpers ─────────────────────────────────────────────────────────────

export const firebaseAuth = {
  async loginWithEmail(email: string, password: string) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return cred.user;
  },

  async loginWithGoogle() {
    if (Platform.OS !== 'web') {
      const { GoogleSignin } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId: googleWebClientId() });
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const result = await GoogleSignin.signIn();
      if (result.type !== 'success') {
        const cancelled = new Error('Google Sign-In was cancelled.');
        (cancelled as Error & { code?: string }).code = 'auth/popup-closed-by-user';
        throw cancelled;
      }
      const idToken = result.data.idToken;
      if (!idToken) throw new Error('Google Sign-In did not return an identity token. Please try again.');
      const credential = GoogleAuthProvider.credential(idToken);
      const cred = await signInWithCredential(auth, credential);
      return cred.user;
    }
    const provider = new GoogleAuthProvider();
    provider.addScope('email');
    provider.addScope('profile');
    const cred = await signInWithPopup(auth, provider);
    return cred.user;
  },

  async register(email: string, password: string, fullName: string) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: fullName });
    return cred.user;
  },

  /** Starts native SMS verification and returns a durable verification ID for the code entry screen. */
  async startPhoneSignIn(phoneInput: string, appVerifier?: any) {
    const phoneNumber = normalizeGhanaPhone(phoneInput);
    if (Platform.OS !== 'web') {
      const nativeAuth = require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');
      const confirmation = await nativeAuth.signInWithPhoneNumber(nativeAuth.getAuth(), phoneNumber);
      if (!confirmation.verificationId) {
        throw new Error('We could not start secure phone verification. Please try again.');
      }
      return { verificationId: confirmation.verificationId, phoneNumber };
    }
    if (!appVerifier) throw new Error('Phone verification is not ready. Please try again.');
    const provider = new PhoneAuthProvider(auth);
    const verificationId = await provider.verifyPhoneNumber(phoneNumber, appVerifier);
    return { verificationId, phoneNumber };
  },

  /** Completes phone sign-in after the Driver enters the code received by SMS. */
  async confirmPhoneSignIn(verificationId: string, code: string) {
    if (!verificationId || !/^\d{6}$/.test(String(code || '').trim())) {
      throw new Error('Enter the 6-digit verification code.');
    }
    const credential = PhoneAuthProvider.credential(verificationId, String(code).trim());
    const result = await signInWithCredential(auth, credential);
    return result.user;
  },

  async logout() {
    await signOut(auth);
    // Phone verification uses React Native Firebase on iOS/Android. Clear its
    // companion native session too, but never turn a successful app-session
    // logout into a crash or an error screen if that optional cleanup fails.
    if (Platform.OS !== 'web') {
      try {
        const nativeAuth = require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');
        await nativeAuth.signOut(nativeAuth.getAuth());
      } catch {
        // The JavaScript Firebase session is already signed out above.
      }
    }
  },

  async resetPassword(email: string) {
    await sendPasswordResetEmail(auth, email);
  },

  getCurrentUser(): User | null {
    return auth.currentUser;
  },

  onAuthStateChanged(callback: (user: User | null) => void) {
    return onAuthStateChanged(auth, callback);
  },

  async deleteAccount() {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('No user logged in');
    await deleteUser(currentUser);
  },

  /**
   * Sends a Firebase Authentication SMS to verify the Driver's own phone.
   *
   * Native builds deliberately use React Native Firebase here instead of the
   * web SDK / embedded reCAPTCHA flow. Android can consequently use the
   * registered HY3N signing certificate and Play Integrity app verification.
   * The web-only path remains available for the browser preview.
   */
  async sendPhoneVerification(phoneInput: string, appVerifier?: any) {
    const normalized = normalizeGhanaPhone(phoneInput);

    if (Platform.OS !== 'web') {
      // Require lazily so the existing browser preview retains its Firebase
      // web SDK compatibility; native EAS builds resolve this module through
      // the React Native Firebase config plugins.
      const nativeAuth = require('@react-native-firebase/auth') as typeof import('@react-native-firebase/auth');
      // Firebase 25 exposes the native iOS/Android phone-verification flow
      // through PhoneAuthProvider. It remains a native Firebase SMS flow, but
      // unlike Firebase 26 it works with Expo SDK 54's legacy architecture.
      const provider = new nativeAuth.PhoneAuthProvider(nativeAuth.getAuth());
      // The iOS/Android native SDK owns application verification; Firebase 25
      // retains a web-verifier parameter in its TypeScript overload only.
      const verificationId = await provider.verifyPhoneNumber(normalized, undefined as never);
      if (!verificationId) {
        throw new Error('We could not start secure phone verification. Please try again.');
      }
      return { verificationId, phoneNumber: normalized };
    }

    if (!appVerifier) {
      throw new Error('Phone verification is not ready. Please try again.');
    }
    const provider = new PhoneAuthProvider(auth);
    const verificationId = await provider.verifyPhoneNumber(normalized, appVerifier);
    return { verificationId, phoneNumber: normalized };
  },

  /** Links the verified Firebase phone credential to the already signed-in Driver. */
  async confirmPhoneVerification(verificationId: string, code: string) {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Please sign in again before verifying your number.');
    const credential = PhoneAuthProvider.credential(verificationId, code.trim());
    try {
      const linked = await linkWithCredential(currentUser, credential);
      return linked.user;
    } catch (error: any) {
      // Firebase returns this when the signed-in Driver already has this exact
      // verified number linked, which is a successful end state for this gate.
      if (error?.code === 'auth/provider-already-linked' && currentUser.phoneNumber) {
        return currentUser;
      }
      throw error;
    }
  },
};

// ─── Firestore Helpers ────────────────────────────────────────────────────────

function docToObj(docSnap: any) {
  if (!docSnap.exists()) return null;
  return { id: docSnap.id, ...docSnap.data() };
}

function snapshotToArray(querySnap: any) {
  return querySnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
}

export const firestoreDB = {
  async get(collectionName: string, id: string) {
    const docRef = doc(db, collectionName, id);
    const docSnap = await getDoc(docRef);
    return docToObj(docSnap);
  },

  async list(collectionName: string, filters: Record<string, any> = {}, orderByField: string | null = 'created_date', orderDir: 'asc' | 'desc' = 'desc', limitNum?: number) {
    try {
      const colRef = collection(db, collectionName);
      const constraints: any[] = [];
      for (const [field, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          constraints.push(where(field, '==', value));
        }
      }
      if (orderByField) {
        constraints.push(orderBy(orderByField, orderDir));
      }
      if (limitNum) constraints.push(firestoreLimit(limitNum));
      const q = query(colRef, ...constraints);
      const snap = await getDocs(q);
      return snapshotToArray(snap);
    } catch (err: any) {
      // Fallback: fetch all and filter in memory
      const snap = await getDocs(collection(db, collectionName));
      let results = snapshotToArray(snap);
      for (const [field, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null) {
          results = results.filter((d: any) => d[field] === value);
        }
      }
      return results;
    }
  },

  async query(collectionName: string, conditions: Array<{ field: string; operator: any; value: any }> = []) {
    const constraints = conditions.map((condition) => where(condition.field, condition.operator, condition.value));
    const snap = await getDocs(query(collection(db, collectionName), ...constraints));
    return snapshotToArray(snap);
  },

  async create(collectionName: string, data: Record<string, any>) {
    const payload = {
      ...data,
      created_date: data.created_date || new Date().toISOString(),
      updated_date: new Date().toISOString(),
    };
    const colRef = collection(db, collectionName);
    const docRef = await addDoc(colRef, payload);
    return { id: docRef.id, ...payload };
  },

  async update(collectionName: string, id: string, data: Record<string, any>) {
    const docRef = doc(db, collectionName, id);
    const payload = { ...data, updated_date: new Date().toISOString() };
    await updateDoc(docRef, payload);
    return { id, ...payload };
  },

  async delete(collectionName: string, id: string) {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
    return { id };
  },

  subscribe(
    collectionName: string,
    filtersOrCallback: Record<string, any> | ((data: any[]) => void),
    maybeCallback?: (data: any[]) => void,
  ) {
    const filters = typeof filtersOrCallback === 'function' ? {} : filtersOrCallback;
    const callback = typeof filtersOrCallback === 'function' ? filtersOrCallback : maybeCallback;
    if (!callback) throw new Error('A Firestore subscription callback is required.');

    const colRef = collection(db, collectionName);
    const constraints: any[] = [];
    for (const [field, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        constraints.push(where(field, '==', value));
      }
    }
    const q = query(colRef, ...constraints);
    return onSnapshot(q, (snap) => {
      callback(snapshotToArray(snap));
    }, (err) => {
      // Without this handler, Firestore logs an uncaught error and silently kills the listener.
      console.warn(`[firestoreDB.subscribe] ${collectionName}:`, err.message);
    });
  },

  /** Subscribe to a single document by ID. Calls callback with data or null if deleted. */
  subscribeDoc(collectionName: string, id: string, callback: (data: any | null) => void) {
    const docRef = doc(db, collectionName, id);
    return onSnapshot(docRef, (snap) => {
      callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    }, (err) => {
      console.warn(`[firestoreDB.subscribeDoc] ${collectionName}/${id}:`, err.message);
    });
  },

  /** Set (overwrite) a document by ID. */
  async set(collectionName: string, id: string, data: Record<string, any>) {
    const { setDoc: fsSetDoc } = await import('firebase/firestore');
    const docRef = doc(db, collectionName, id);
    const payload = { ...data, updated_date: new Date().toISOString() };
    await fsSetDoc(docRef, payload);
    return { id, ...payload };
  },
};

// ─── Storage Helpers ──────────────────────────────────────────────────────────

export const firebaseStorage = {
  async uploadFile(file: Blob, path: string): Promise<string> {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  },
};
