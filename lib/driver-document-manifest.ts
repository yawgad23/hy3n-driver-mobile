/** A document manifest is evidence of submission, never administrator approval. */
export const DRIVER_DOCUMENT_KEYS = [
  'ghanaCardFront', 'ghanaCardBack', 'licenseFront', 'licenseBack',
  'profilePhoto', 'vehiclePhoto', 'insurance', 'roadworthy',
] as const;
export type DriverDocumentKey = typeof DRIVER_DOCUMENT_KEYS[number];
export const REQUIRED_DRIVER_DOCUMENT_KEYS = DRIVER_DOCUMENT_KEYS.slice(0, 6);
export type DriverDocumentEntry = {
  label: string;
  required: boolean;
  status: 'valid' | 'missing' | 'invalid';
  reference: string | null;
};
export type DriverDocumentManifest = {
  userId: string;
  profileId: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  documentsComplete: boolean;
  documentRevision: string;
  missingDocuments: string[];
  documents: Record<DriverDocumentKey, DriverDocumentEntry>;
  details: {
    fullName: string; email: string; phone: string; momoNumber: string;
    city: string; serviceType: string; acceptedCategories: string[];
    vehicleMake: string; vehicleModel: string; vehiclePlate: string;
    vehicleColor: string; vehicleYear: string;
  };
};

export function isSavedRemoteDocumentReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4_000 || value.trim() !== value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}

export function isOwnedDriverStorageReference(value: unknown, uid: string): value is string {
  if (!uid || !isSavedRemoteDocumentReference(value)) return false;
  try {
    const url = new URL(value);
    if (url.hostname !== 'firebasestorage.googleapis.com' || url.port || url.hash) return false;
    const match = url.pathname.match(/^\/v0\/b\/([^/]+)\/o\/([^/]+)$/);
    if (!match || decodeURIComponent(match[1]) !== 'hy3n26.firebasestorage.app') return false;
    const path = decodeURIComponent(match[2]);
    const parts = path.split('/');
    return ['drivers', 'driver-documents'].includes(parts[0]) && parts[1] === uid && parts.length >= 3
      && parts.every(part => !!part && part !== '.' && part !== '..' && !part.includes('\\') && !part.includes('%'));
  } catch { return false; }
}

/** Treat transport/schema/account mismatches as unknown, not missing documents. */
export function parseDriverDocumentManifest(value: unknown, uid: string): DriverDocumentManifest {
  const manifest = value as DriverDocumentManifest | null;
  const invalid = () => { throw new Error('Your saved documents could not be verified. Please retry.'); };
  if (!uid || !manifest || manifest.userId !== uid
    || !(manifest.profileId === null || (typeof manifest.profileId === 'string' && manifest.profileId.length > 0))
    || !['pending', 'approved', 'rejected'].includes(manifest.approvalStatus)
    || typeof manifest.documentsComplete !== 'boolean'
    || typeof manifest.documentRevision !== 'string' || !manifest.documentRevision.trim()
    || !Array.isArray(manifest.missingDocuments) || !manifest.missingDocuments.every(label => typeof label === 'string')
    || !manifest.documents || !manifest.details) return invalid();
  for (const key of DRIVER_DOCUMENT_KEYS) {
    const item = manifest.documents[key];
    if (!item || typeof item.label !== 'string' || !item.label.trim()
      || item.required !== REQUIRED_DRIVER_DOCUMENT_KEYS.includes(key)
      || !['valid', 'missing', 'invalid'].includes(item.status)
      || !(item.reference === null || typeof item.reference === 'string')
      || (item.status === 'valid' && !isOwnedDriverStorageReference(item.reference, uid))
      || (item.status !== 'valid' && item.reference !== null)) return invalid();
  }
  const details = manifest.details;
  const strings = ['fullName', 'email', 'phone', 'momoNumber', 'city', 'serviceType', 'vehicleMake', 'vehicleModel', 'vehiclePlate', 'vehicleColor', 'vehicleYear'] as const;
  if (!strings.every(key => typeof details[key] === 'string')
    || !Array.isArray(details.acceptedCategories) || !details.acceptedCategories.every(key => typeof key === 'string')) return invalid();
  const complete = !!manifest.profileId && REQUIRED_DRIVER_DOCUMENT_KEYS.every(key => manifest.documents[key].status === 'valid');
  if (manifest.documentsComplete && (!complete || manifest.missingDocuments.length !== 0)) return invalid();
  // The wire contract sends document keys; screens need readable labels.
  return {
    ...manifest,
    missingDocuments: manifest.missingDocuments.map(key => DRIVER_DOCUMENT_KEYS.includes(key as DriverDocumentKey)
      ? manifest.documents[key as DriverDocumentKey].label : key),
  };
}

export function canConfirmDriverSubmission(manifest: DriverDocumentManifest | null | undefined, uid: string | null | undefined): boolean {
  if (!uid || !manifest) return false;
  try {
    const checked = parseDriverDocumentManifest(manifest, uid);
    return checked.approvalStatus === 'pending' && checked.documentsComplete;
  } catch { return false; }
}

/** Fingerprint the observed profile so a prior response cannot outlive new evidence. */
export function documentProfileFingerprint(value: unknown): string {
  const profile = (value || {}) as Record<string, unknown>;
  const keys = ['id', 'user_id', 'approval_status', 'application_status', 'status', 'approved', 'is_approved',
    'updated_date', 'ghana_card_front_url', 'ghana_card_back_url', 'drivers_license_front_url',
    'drivers_license_back_url', 'profile_photo_url', 'vehicle_photo_url', 'vehicle_registration_url',
    'insurance_url', 'roadworthy_url'];
  return JSON.stringify(keys.map(key => profile[key] ?? null));
}

/** Used by the hook and tested without a native runtime or production records. */
export class DriverDocumentRequestGuard {
  private generation = 0;
  private owner: string | null = null;
  begin(uid: string): { uid: string; generation: number } {
    this.owner = uid;
    return { uid, generation: ++this.generation };
  }
  invalidate(): void { this.owner = null; this.generation += 1; }
  isCurrent(ticket: { uid: string; generation: number }, currentUid: string | null | undefined): boolean {
    return ticket.uid === currentUid && ticket.uid === this.owner && ticket.generation === this.generation;
  }
}
