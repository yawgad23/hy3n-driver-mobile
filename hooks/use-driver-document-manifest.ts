import { useCallback, useEffect, useRef, useState } from 'react';
import { auth, firebaseAuth } from '@/lib/firebase';
import {
  DriverDocumentRequestGuard, documentProfileFingerprint,
  type DriverDocumentManifest,
} from '@/lib/driver-document-manifest';
import { awaitDriverVerification, DriverVerificationTimeoutError } from '@/lib/driver-document-verification';

type Status = 'idle' | 'checking' | 'ready' | 'error';
type Snapshot = {
  uid: string | null; fingerprint: string; status: Status;
  manifest: DriverDocumentManifest | null; error: string;
};

/** Read-only verification. Never changes approval, uploads files, or repairs profiles. */
export function useDriverDocumentManifest(uid: string | null, profile?: unknown, enabled = true) {
  const fingerprint = documentProfileFingerprint(profile);
  const latest = useRef({ uid, fingerprint, enabled });
  latest.current = { uid, fingerprint, enabled };
  const mounted = useRef(true);
  const guard = useRef(new DriverDocumentRequestGuard());
  const controller = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    uid: null, fingerprint: '', status: 'idle', manifest: null, error: '',
  });

  const recheck = useCallback(async (): Promise<DriverDocumentManifest | null> => {
    if (!mounted.current || !uid || !enabled || !latest.current.enabled || auth.currentUser?.uid !== uid
      || latest.current.uid !== uid || latest.current.fingerprint !== fingerprint) return null;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const ticket = guard.current.begin(uid);
    const ownsObservation = () => mounted.current && guard.current.isCurrent(ticket, auth.currentUser?.uid)
      && latest.current.uid === uid && latest.current.fingerprint === fingerprint && latest.current.enabled;
    setSnapshot({ uid, fingerprint, status: 'checking', manifest: null, error: '' });
    try {
      // Bound token acquisition, fetch and parsing, not just abort-aware fetch.
      const manifest = await awaitDriverVerification(() => firebaseAuth.getDriverDocumentManifest(abort.signal), abort.signal);
      if (abort.signal.aborted || !ownsObservation()) return null;
      setSnapshot({ uid, fingerprint, status: 'ready', manifest, error: '' });
      return manifest;
    } catch (error) {
      const timedOut = error instanceof DriverVerificationTimeoutError;
      if (ownsObservation() && (!abort.signal.aborted || timedOut)) {
        setSnapshot({ uid, fingerprint, status: 'error', manifest: null,
          error: error instanceof Error ? error.message : 'Your saved documents could not be verified. Please retry.',
        });
      }
      if (timedOut) abort.abort();
      return null;
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, [uid, fingerprint, enabled]);

  useEffect(() => {
    mounted.current = true;
    if (uid && enabled) void recheck();
    return () => {
      mounted.current = false;
      guard.current.invalidate();
      controller.current?.abort();
      controller.current = null;
    };
  }, [uid, fingerprint, enabled, recheck]);

  const belongsToCurrentObservation = snapshot.uid === uid && snapshot.fingerprint === fingerprint
    && auth.currentUser?.uid === uid;
  const status: Status = !uid || !enabled ? 'idle' : belongsToCurrentObservation ? snapshot.status : 'checking';
  return {
    status,
    manifest: status === 'ready' ? snapshot.manifest : null,
    error: status === 'error' ? snapshot.error : '',
    recheck,
  };
}
