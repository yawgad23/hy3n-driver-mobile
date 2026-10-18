import { getApiBaseUrl } from '@/constants/oauth';
import { auth } from '@/lib/firebase';
import type { DriverOfferPreferences } from './driver-offer-preferences';

export async function saveDriverOfferPreferences(preferences: DriverOfferPreferences): Promise<{ preferences: DriverOfferPreferences }> {
  const user = auth.currentUser;
  const baseUrl = getApiBaseUrl();
  if (!user || !baseUrl) throw new Error('Please sign in again before saving Driver preferences.');

  const response = await fetch(`${baseUrl}/api/driver/offer-preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ preferences }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.success || !body?.preferences) {
    throw new Error(body?.message || 'HY3N could not save your Driver preferences.');
  }
  return { preferences: body.preferences as DriverOfferPreferences };
}
