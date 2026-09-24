import { auth } from '@/lib/firebase';
import { getApiBaseUrl } from '@/constants/oauth';

export function normalizeGhanaPhone(phoneInput: string): string | null {
  const digits = String(phoneInput || '').replace(/\D/g, '');
  const local = digits.startsWith('233') ? `0${digits.slice(3)}` : digits;
  if (!/^0\d{9}$/.test(local)) return null;
  return `+233${local.slice(1)}`;
}

async function authenticatedPost(path: string, body: Record<string, unknown>) {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again before verifying your phone number.');

  const idToken = await user.getIdToken();
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success) {
    throw new Error(String(payload?.message || 'SMS verification is temporarily unavailable. Please try again.'));
  }
  return payload;
}

/** Requests a six-digit code from HY3N's server-side Hubtel SMS gateway. */
export async function requestDriverPhoneOtp(phoneInput: string) {
  const phoneNumber = normalizeGhanaPhone(phoneInput);
  if (!phoneNumber) throw new Error('Enter a valid Ghana mobile number.');
  return authenticatedPost('/api/driver/otp/send', { phoneNumber });
}

/** Verifies a six-digit code without exposing Hubtel credentials to the app. */
export async function verifyDriverPhoneOtp(code: string) {
  return authenticatedPost('/api/driver/otp/verify', { code: String(code || '').trim() });
}
