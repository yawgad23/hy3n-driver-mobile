import { useCallback, useEffect, useRef, useState } from 'react';
import { auth, firebaseAuth } from '@/lib/firebase';
import {
  DriverDocumentRequestGuard, documentProfileFingerprint,
  type DriverDocumentManifest,
} from '@/lib/driver-document-manifest';

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
  const guard = useRef(new DriverDocumentRequestGuard());
  const controller = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>({
    uid: null, fingerprint: '', status: 'idle', manifest: null, error: '',
  });

  const recheck = useCallback(async (): Promise<DriverDocumentManifest | null> => {
    if (!uid || !enabled || auth.currentUser?.uid !== uid
      || latest.current.uid !== uid || latest.current.fingerprint !== fingerprint) return null;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const ticket = guard.current.begin(uid);
    const isCurrent = () => !abort.signal.aborted
      && guard.current.isCurrent(ticket, auth.currentUser?.uid)
      && latest.current.uid === uid && latest.current.fingerprint === fingerprint && latest.current.enabled;
    setSnapshot({ uid, fingerprint, status: 'checking', manifest: null, error: '' });
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const manifest = await firebaseAuth.getDriverDocumentManifest(abort.signal);
      if (!isCurrent()) {
        // Timeout is an unknown outcome, not an incomplete document set.
        if (guard.current.isCurrent(ticket, auth.currentUser?.uid)
          && latest.current.uid === uid && latest.current.fingerprint === fingerprint && latest.current.enabled) {
          setSnapshot({ uid, fingerprint, status: 'error', manifest: null, error: 'Document verification timed out. Please retry.' });
        }
        return null;
      }
      setSnapshot({ uid, fingerprint, status: 'ready', manifest, error: '' });
      return manifest;
    } catch (error) {
      if (guard.current.isCurrent(ticket, auth.currentUser?.uid)
        && latest.current.uid === uid && latest.current.fingerprint === fingerprint && latest.current.enabled) {
        setSnapshot({ uid, fingerprint, status: 'error', manifest: null,
          error: abort.signal.aborted ? 'Document verification timed out. Please retry.'
            : error instanceof Error ? error.message : 'Your saved documents could not be verified. Please retry.',
        });
      }
      return null;
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) controller.current = null;
    }
  }, [uid, fingerprint, enabled]);

  useEffect(() => {
    if (uid && enabled) void recheck();
    return () => {
      guard.current.invalidate();
      controller.current?.abort();
      controller.current = null;
    };
  }, [uid, fingerprint, enabled, recheck]);

  const belongsToCurrentObservation = snapshot.uid === uid && snapshot.fingerprint === fingerprint;
  const status: Status = !uid || !enabled ? 'idle' : belongsToCurrentObservation ? snapshot.status : 'checking';
  return {
    status,
    manifest: status === 'ready' ? snapshot.manifest : null,
    error: status === 'error' ? snapshot.error : '',
    recheck,
  };
}
