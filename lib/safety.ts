import { auth } from '@/lib/firebase';
import { getApiBaseUrl } from '@/constants/oauth';

export type SosLocation = {
  latitude: number;
  longitude: number;
};

export type SosSubmission = {
  rideId?: string;
  location?: SosLocation;
  message?: string;
};

export type SosSubmissionResult = {
  success: true;
  incidentId: string;
  supportTicketId: string;
  receivedAt: string;
};

let retryAlertId: string | null = null;
let retryAlertStartedAt = 0;

function getRetryAlertId(driverId: string, rideId?: string) {
  const now = Date.now();
  if (!retryAlertId || now - retryAlertStartedAt > 5 * 60_000) {
    retryAlertId = `sos_${driverId}_${rideId || 'no-trip'}_${now}`;
    retryAlertStartedAt = now;
  }
  return retryAlertId;
}

/**
 * Sends a Driver SOS through the dedicated Firebase-authenticated endpoint.
 * This deliberately does not depend on the general tRPC request pipeline:
 * emergency reporting remains available even if an unrelated app session token
 * is stale. The server derives the Driver identity from the Firebase ID token.
 */
export async function submitDriverSos(input: SosSubmission): Promise<SosSubmissionResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in again before sending an SOS alert.');
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch(`${getApiBaseUrl()}/api/driver/sos`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Retain the ID for a short retry window so a lost network response
      // cannot create a duplicate incident or support ticket.
      clientAlertId: getRetryAlertId(currentUser.uid, input.rideId),
      rideId: input.rideId,
      location: input.location,
      message: input.message || 'Emergency alert initiated from the Driver app.',
    }),
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    throw new Error('HY3N Safety could not confirm your SOS report. Please call emergency services.');
  }

  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || 'HY3N Safety could not confirm your SOS report. Please call emergency services.');
  }

  retryAlertId = null;
  retryAlertStartedAt = 0;
  return payload as SosSubmissionResult;
}
