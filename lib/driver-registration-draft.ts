export interface DriverRegistrationForm {
  fullName: string;
  email: string;
  phone: string;
  momoNumber: string;
  vehicleMake: string;
  vehicleModel: string;
  vehiclePlate: string;
  vehicleColor: string;
  vehicleFullModel: string;
  city: string;
  serviceType: string;
  selectedCategories: string[];
  ghanaCardFront: string;
  ghanaCardBack: string;
  licenseFront: string;
  licenseBack: string;
  driverPhoto: string;
  vehiclePhoto: string;
  insurancePhoto: string;
  roadworthyPhoto: string;
}

export interface DriverRegistrationDraft {
  version: 1;
  uid: string;
  step: number;
  pendingEdits: boolean;
  editedFields?: Array<keyof DriverRegistrationForm>;
  form: DriverRegistrationForm;
}

export const emptyDriverRegistrationForm = (): DriverRegistrationForm => ({
  fullName: '', email: '', phone: '+233', momoNumber: '+233',
  vehicleMake: '', vehicleModel: '', vehiclePlate: '', vehicleColor: '', vehicleFullModel: '',
  city: '', serviceType: '', selectedCategories: [],
  ghanaCardFront: '', ghanaCardBack: '', licenseFront: '', licenseBack: '',
  driverPhoto: '', vehiclePhoto: '', insurancePhoto: '', roadworthyPhoto: '',
});

export const driverRegistrationDraftKey = (uid: string) => `hy3n_driver_register_draft:${encodeURIComponent(uid)}`;
export const clampDriverDraftStep = (step: unknown) => (
  typeof step === 'number' && Number.isInteger(step) ? Math.max(1, Math.min(4, step)) : 1
);

const record = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);
const text = (value: unknown): string => typeof value === 'string' ? value : '';
export const isLocalDriverDocument = (uri: string) => /^(file|content):\/\//.test(uri);

export function parseDriverRegistrationDraft(raw: string | null, uid: string): DriverRegistrationDraft | null {
  if (!raw || !uid) return null;
  try {
    const draft = record(JSON.parse(raw));
    if (draft.uid !== uid || draft.version !== 1) return null;
    const saved = record(draft.form);
    const form = emptyDriverRegistrationForm();
    for (const key of Object.keys(form) as Array<keyof DriverRegistrationForm>) {
      if (key === 'selectedCategories') {
        form[key] = Array.isArray(saved[key]) ? saved[key].filter((v): v is string => typeof v === 'string') : [];
      } else if (typeof saved[key] === 'string') {
        form[key] = saved[key];
      }
    }
    const editedFields = Array.isArray(draft.editedFields)
      ? draft.editedFields.filter((v): v is keyof DriverRegistrationForm => typeof v === 'string' && v in form) : [];
    const localDocuments = Object.values(DRIVER_REGISTRATION_DOCUMENT_FIELDS).some(key => isLocalDriverDocument(form[key]));
    return { version: 1, uid, step: clampDriverDraftStep(draft.step),
      pendingEdits: draft.pendingEdits !== false || localDocuments || editedFields.length > 0, editedFields, form };
  } catch {
    return null;
  }
}

export const DRIVER_REGISTRATION_DOCUMENT_FIELDS = {
  ghanaCardFront: 'ghanaCardFront', ghanaCardBack: 'ghanaCardBack',
  licenseFront: 'licenseFront', licenseBack: 'licenseBack',
  profilePhoto: 'driverPhoto', vehiclePhoto: 'vehiclePhoto',
  insurance: 'insurancePhoto', roadworthy: 'roadworthyPhoto',
} as const;

/** Local selections are edits, not evidence. Only the checked server manifest may restore remote references. */
export function restoreDriverRegistrationForm(
  current: DriverRegistrationForm,
  profile: unknown,
  manifest: unknown,
  preserveEdits: boolean,
  editedFields: ReadonlySet<keyof DriverRegistrationForm> = new Set(),
): DriverRegistrationForm {
  const next = { ...current, selectedCategories: [...current.selectedCategories] };
  const p = record(profile);
  const m = record(manifest);
  const details = record(m.details);
  const mappings = {
    fullName: 'full_name', email: 'email', phone: 'phone', momoNumber: 'momo_number',
    city: 'city', serviceType: 'service_type', vehicleMake: 'vehicle_make',
    vehicleModel: 'vehicle_model', vehiclePlate: 'vehicle_plate', vehicleColor: 'vehicle_color',
    vehicleFullModel: 'vehicle_year',
  } as const;
  for (const [field, profileKey] of Object.entries(mappings)) {
    const key = field as keyof typeof mappings;
    const detailKey = key === 'vehicleFullModel' ? 'vehicleYear' : key;
    const server = text(details[detailKey]) || text(p[profileKey]);
    const local = current[key];
    if (server && (!preserveEdits || (!editedFields.has(key) && (!local || local === '+233')))) next[key] = server;
  }
  const categories = details.acceptedCategories ?? p.accepted_categories;
  if ((!preserveEdits || (!editedFields.has('selectedCategories') && !next.selectedCategories.length)) && Array.isArray(categories)) {
    next.selectedCategories = categories.filter((v): v is string => typeof v === 'string');
  }
  const documents = record(m.documents);
  for (const [documentKey, formKey] of Object.entries(DRIVER_REGISTRATION_DOCUMENT_FIELDS)) {
    const checked = record(documents[documentKey]);
    const valid = checked.status === 'valid' ? text(checked.reference) : '';
    const local = current[formKey];
    next[formKey] = preserveEdits && (isLocalDriverDocument(local) || (editedFields.has(formKey) && !local)) ? local : valid;
  }
  return next;
}

export function driverRegistrationDetailsMissing(form: DriverRegistrationForm): boolean {
  return !form.fullName.trim() || !form.phone.trim() || form.phone === '+233'
    || !form.city.trim() || !form.serviceType || !form.selectedCategories.length;
}

export function driverRegistrationRecoveryStep(input: {
  status: 'idle' | 'checking' | 'ready' | 'error';
  confirmed: boolean;
  pendingEdits: boolean;
  detailsMissing: boolean;
}): 3 | 4 | 5 | null {
  if (input.status !== 'ready') return null; // A network failure means unknown, not missing.
  if (input.confirmed && !input.pendingEdits) return 5;
  return input.detailsMissing ? 3 : 4;
}

export function driverRegistrationMissingLabels(manifest: unknown): string[] {
  const labels = record(manifest).missingDocuments;
  return Array.isArray(labels) ? labels.filter((v): v is string => typeof v === 'string') : [];
}

export function driverRegistrationRevision(manifest: unknown): string {
  return text(record(manifest).documentRevision);
}

export function driverRegistrationRejectionReason(profile: unknown): string {
  const p = record(profile);
  return text(p.rejection_reason) || text(p.rejectionReason) || text(p.review_reason);
}

/** A later retry may finish a saved submission, but never a different or edited form. */
export function driverRegistrationMatchesSavedSubmission(form: DriverRegistrationForm, manifest: unknown): boolean {
  const m = record(manifest);
  const details = record(m.details);
  const detailFields = {
    fullName: 'fullName', email: 'email', phone: 'phone', momoNumber: 'momoNumber',
    city: 'city', serviceType: 'serviceType', vehicleMake: 'vehicleMake', vehicleModel: 'vehicleModel',
    vehiclePlate: 'vehiclePlate', vehicleColor: 'vehicleColor', vehicleFullModel: 'vehicleYear',
  } as const;
  for (const [field, detail] of Object.entries(detailFields)) {
    if (form[field as keyof typeof detailFields].trim() !== text(details[detail]).trim()) return false;
  }
  if (!Array.isArray(details.acceptedCategories)
    || [...form.selectedCategories].sort().join('|') !== [...details.acceptedCategories].sort().join('|')) return false;
  const documents = record(m.documents);
  for (const [key, field] of Object.entries(DRIVER_REGISTRATION_DOCUMENT_FIELDS)) {
    if (form[field] && (record(documents[key]).status !== 'valid' || record(documents[key]).reference !== form[field])) return false;
  }
  return true;
}

export interface DriverDraftStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

// Shared across mounts: a queued write from an earlier screen must finish before a
// subsequent session hydrates or clears the same UID's draft.
let draftQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = draftQueue.then(operation, operation);
  draftQueue = result.catch(() => undefined);
  return result;
}

export function createDriverRegistrationDraftSession(storage: DriverDraftStorage, uid: string) {
  const key = driverRegistrationDraftKey(uid);
  let hydrated = false;
  let sealed = false;
  return {
    read: () => enqueue(async () => {
      const raw = await storage.getItem(key);
      hydrated = true;
      return parseDriverRegistrationDraft(raw, uid);
    }),
    resumeEdits: () => { sealed = false; },
    write: (draft: DriverRegistrationDraft, isCurrent: () => boolean) => {
      // Capture the payload now, not when an asynchronous write eventually runs.
      const payload = JSON.stringify({ ...draft, uid, step: clampDriverDraftStep(draft.step) });
      if (!hydrated || sealed || draft.uid !== uid) return Promise.resolve();
      return enqueue(async () => {
        if (!sealed && isCurrent()) await storage.setItem(key, payload);
      });
    },
    confirmedClear: (canClear: () => boolean) => {
      if (!hydrated || sealed || !canClear()) return Promise.resolve();
      sealed = true; // Prevent any late save from resurrecting a confirmed draft.
      return enqueue(async () => {
        if (!canClear()) { sealed = false; return; }
        try { await storage.removeItem(key); }
        catch (error) { sealed = false; throw error; }
      });
    },
  };
}

export function isCurrentDriverRegistrationOperation(
  captured: { uid: string | null; generation: number },
  current: { uid: string | null; generation: number; mounted: boolean; authUID: string | null },
): boolean {
  return current.mounted && captured.uid === current.uid && captured.uid === current.authUID
    && captured.generation === current.generation;
}
