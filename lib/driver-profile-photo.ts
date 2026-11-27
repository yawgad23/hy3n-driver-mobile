/** Display-only profile photo selection. This never approves an application. */
export interface DriverPhotoProfile {
  approval_status?: unknown;
  application_status?: unknown;
  status?: unknown;
  approved?: unknown;
  is_approved?: unknown;
  profile_photo_url?: unknown;
  avatar_url?: unknown;
  photo_url?: unknown;
}

export function getApprovedDriverProfilePhoto(profile: DriverPhotoProfile | null | undefined): string | undefined {
  if (!profile) return undefined;
  let approval: string | undefined;
  for (const value of [profile.approval_status, profile.application_status, profile.status]) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['approved', 'pending', 'rejected'].includes(normalized)) {
      approval = normalized;
      break;
    }
  }
  // An explicit pending/rejected decision overrides historical approval flags.
  const isApproved = approval ? approval === 'approved' : profile.approved === true || profile.is_approved === true;
  if (!isApproved) return undefined;

  // These are the same display-photo fields used for new Rider assignments.
  // Never fall back to Ghana Card, licence or vehicle verification documents.
  for (const candidate of [profile.profile_photo_url, profile.avatar_url, profile.photo_url]) {
    if (typeof candidate !== 'string' || candidate.length > 4_000) continue;
    const value = candidate.trim();
    try {
      const url = new URL(value);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password) return value;
    } catch {
      // Missing or unusable photos keep the existing placeholder avatar.
    }
  }
  return undefined;
}
