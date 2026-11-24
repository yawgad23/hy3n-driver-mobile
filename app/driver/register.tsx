import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, Image, ActivityIndicator, Platform, KeyboardAvoidingView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { auth as firebaseAuthObj, firebaseAuth, firebaseStorage } from '@/lib/firebase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { openDriverSupportWhatsApp } from '@/lib/support-whatsapp';
import { useDriverDocumentManifest } from '@/hooks/use-driver-document-manifest';
import { canConfirmDriverSubmission, isOwnedDriverStorageReference } from '@/lib/driver-document-manifest';
import {
  clampDriverDraftStep, createDriverRegistrationDraftSession, driverRegistrationDetailsMissing,
  driverRegistrationMissingLabels, driverRegistrationRecoveryStep, driverRegistrationRejectionReason,
  driverRegistrationMatchesSavedSubmission,
  driverRegistrationRevision, emptyDriverRegistrationForm, isCurrentDriverRegistrationOperation,
  isLocalDriverDocument, restoreDriverRegistrationForm,
  type DriverRegistrationForm,
} from '@/lib/driver-registration-draft';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';

const ALL_CATEGORIES = [
  { id: 'standard',         label: 'Standard',          description: 'Everyday affordable rides',             icon: 'directions-car' as const },
  { id: 'comfort',          label: 'Comfort',            description: 'Newer cars with extra space',            icon: 'airline-seat-recline-extra' as const },
  { id: 'kantanka',         label: 'Kantanka',           description: 'Mini SUVs (Kantanka Hyen, etc.)',        icon: 'directions-car' as const },
  { id: 'car_delivery',     label: 'Car Delivery',       description: 'Deliver parcels using your car',          icon: 'local-shipping' as const },
  { id: 'okada',            label: 'Okada',              description: 'Fast motorbike rides',                   icon: 'two-wheeler' as const },
  { id: 'express_delivery', label: 'Delivery',   description: 'Package and parcel deliveries',          icon: 'inventory' as const },
];

const CATEGORIES_BY_SERVICE: Record<string, string[]> = {
  car:      ['standard', 'comfort', 'kantanka', 'car_delivery'],
  okada:    ['okada'],
  delivery: ['express_delivery'],
};

const SERVICE_TYPES = [
  {
    id: 'car',
    label: 'Car Driver',
    description: 'Standard, Comfort, Kantanka or Car Delivery rides',
    icon: 'directions-car' as const,
    vehicleLabel: 'Car',
    vehiclePlaceholder: 'e.g. Toyota Camry 2022',
    makePlaceholder: 'e.g. Toyota',
  },
  {
    id: 'okada',
    label: 'Okada Rider',
    description: 'Fast motorbike rides to beat traffic',
    icon: 'two-wheeler' as const,
    vehicleLabel: 'Motorbike',
    vehiclePlaceholder: 'e.g. Yamaha Fazer 2021',
    makePlaceholder: 'e.g. Yamaha',
  },
  {
    id: 'delivery',
    label: 'Delivery Driver',
    description: 'Package and parcel deliveries across the city',
    icon: 'inventory' as const,
    vehicleLabel: 'Vehicle',
    vehiclePlaceholder: 'e.g. Honda CB 2020',
    makePlaceholder: 'e.g. Honda',
  },
];

function FileUploadField({ label, uri, onPick }: { label: string; uri: string; onPick: (u: string) => void }) {
  const pick = async (camera: boolean) => {
    const perm = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission required', `Please allow ${camera ? 'camera' : 'photo library'} access.`);
      return;
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets[0]) onPick(result.assets[0].uri);
  };

  return (
    <View style={{ gap: 6, marginBottom: 12 }}>
      <Text style={[styles.label]}>{label}</Text>
      {uri ? (
        <View style={[styles.uploadedRow]}>
          <Image source={{ uri }} style={styles.uploadThumb} />
          <Text style={{ color: GOLD, flex: 1, fontSize: 13, fontWeight: '600' }} numberOfLines={1}>Photo selected ✓</Text>
          <TouchableOpacity onPress={() => onPick('')}>
            <Text style={{ color: MUTED, fontSize: 12 }}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.uploadRow}>
          <TouchableOpacity style={styles.uploadBtn} onPress={() => pick(false)}>
            <MaterialIcons name="upload" size={20} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 12 }}>Upload</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.uploadBtn} onPress={() => pick(true)}>
            <MaterialIcons name="camera-alt" size={20} color={MUTED} />
            <Text style={{ color: MUTED, fontSize: 12 }}>Camera</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function DriverRegisterScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { signUp, signInWithGoogle, user, driverProfile, loading: authLoading, refreshProfile } = useDriverAuth();
  const uid = user?.uid ?? null;
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<DriverRegistrationForm>(emptyDriverRegistrationForm);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hydratedScope, setHydratedScope] = useState<string | null>(null);
  const [hydrationError, setHydrationError] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [retry, setRetry] = useState(0);
  const [verifiedUID, setVerifiedUID] = useState<string | null>(null);
  const [emailCheckedUID, setEmailCheckedUID] = useState<string | null>(null);
  const [recoveredRevision, setRecoveredRevision] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ uid: string; revision: string } | null>(null);
  const [pendingEdits, setPendingEdits] = useState(false);
  const mountedRef = useRef(true);
  const identityRef = useRef({ uid, generation: 0 });
  if (identityRef.current.uid !== uid) {
    identityRef.current = { uid, generation: identityRef.current.generation + 1 };
  }
  const formRef = useRef(form);
  formRef.current = form;
  const editsRef = useRef(false);
  const editRevisionRef = useRef(0);
  const editedFieldsRef = useRef(new Set<keyof DriverRegistrationForm>());
  const submissionRef = useRef(false);
  const savedSubmissionRef = useRef<{
    ticket: { uid: string | null; generation: number }; editRevision: number; form: DriverRegistrationForm;
  } | null>(null);
  const draftSessionRef = useRef<ReturnType<typeof createDriverRegistrationDraftSession> | null>(null);
  const freshSignUpRef = useRef<{ email: string; form: DriverRegistrationForm; targetUID: string | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scope = uid ?? 'anonymous-this-screen';
  const hydrated = hydratedScope === scope;
  const ownProfile = driverProfile?.user_id === uid || driverProfile?.id === uid ? driverProfile : null;
  const profileStatus = String(ownProfile?.approval_status ?? ownProfile?.application_status ?? ownProfile?.status ?? '').toLowerCase();
  const { manifest, status: manifestStatus, error: manifestError, recheck } = useDriverDocumentManifest(
    uid, ownProfile, !authLoading && hydrated && verifiedUID === uid && !!uid,
  );
  const approved = manifest?.approvalStatus === 'approved';
  const rejected = manifest ? manifest.approvalStatus === 'rejected' : profileStatus === 'rejected';
  const rejectionReason = rejected ? driverRegistrationRejectionReason(ownProfile) : '';
  const approvedRef = useRef(approved);
  approvedRef.current = approved;
  const manifestRef = useRef(manifest);
  manifestRef.current = manifest;
  const confirmedRef = useRef(confirmed);
  confirmedRef.current = confirmed;

  const isCurrent = (captured: { uid: string | null; generation: number }) => isCurrentDriverRegistrationOperation(captured, {
    ...identityRef.current, mounted: mountedRef.current, authUID: firebaseAuthObj.currentUser?.uid ?? null,
  });
  const renderTicket = { ...identityRef.current };
  const updateForm = <K extends keyof DriverRegistrationForm>(key: K, value: React.SetStateAction<DriverRegistrationForm[K]>) => {
    if (submissionRef.current || !isCurrent(renderTicket)) return;
    editsRef.current = true;
    editRevisionRef.current += 1;
    editedFieldsRef.current.add(key);
    setPendingEdits(true);
    savedSubmissionRef.current = null;
    draftSessionRef.current?.resumeEdits();
    setConfirmed(null);
    setForm(previous => {
      const next = { ...previous, [key]: typeof value === 'function' ? (value as (old: DriverRegistrationForm[K]) => DriverRegistrationForm[K])(previous[key]) : value };
      formRef.current = next;
      return next;
    });
  };
  const { fullName, email, phone, momoNumber, vehicleMake, vehicleModel, vehiclePlate, vehicleColor,
    vehicleFullModel, city, serviceType, selectedCategories, ghanaCardFront, ghanaCardBack,
    licenseFront, licenseBack, driverPhoto, vehiclePhoto, insurancePhoto, roadworthyPhoto } = form;
  const setFullName = (v: string) => updateForm('fullName', v);
  const setEmail = (v: string) => updateForm('email', v);
  const setPhone = (v: string) => updateForm('phone', v);
  const setMomoNumber = (v: string) => updateForm('momoNumber', v);
  const setVehicleMake = (v: string) => updateForm('vehicleMake', v);
  const setVehicleModel = (v: string) => updateForm('vehicleModel', v);
  const setVehiclePlate = (v: string) => updateForm('vehiclePlate', v);
  const setVehicleColor = (v: string) => updateForm('vehicleColor', v);
  const setVehicleFullModel = (v: string) => updateForm('vehicleFullModel', v);
  const setCity = (v: string) => updateForm('city', v);
  const setServiceType = (v: string) => updateForm('serviceType', v);
  const setSelectedCategories = (v: React.SetStateAction<string[]>) => updateForm('selectedCategories', v);
  const setGhanaCardFront = (v: string) => updateForm('ghanaCardFront', v);
  const setGhanaCardBack = (v: string) => updateForm('ghanaCardBack', v);
  const setLicenseFront = (v: string) => updateForm('licenseFront', v);
  const setLicenseBack = (v: string) => updateForm('licenseBack', v);
  const setDriverPhoto = (v: string) => updateForm('driverPhoto', v);
  const setVehiclePhoto = (v: string) => updateForm('vehiclePhoto', v);
  const setInsurancePhoto = (v: string) => updateForm('insurancePhoto', v);
  const setRoadworthyPhoto = (v: string) => updateForm('roadworthyPhoto', v);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      identityRef.current.generation += 1;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // A screen-initiated email sign-up alone can carry this mount's anonymous form
  // into its newly created UID. No unscoped disk draft is ever read or imported.
  useEffect(() => {
    const fresh = freshSignUpRef.current;
    const preserveFresh = !!uid && !!fresh && fresh.email === user?.email?.trim().toLowerCase()
      && (!fresh.targetUID || fresh.targetUID === uid);
    if (preserveFresh && fresh) fresh.targetUID = uid;
    else freshSignUpRef.current = null;
    const initial = preserveFresh && fresh ? fresh.form : emptyDriverRegistrationForm();
    setForm(initial);
    formRef.current = initial;
    editsRef.current = preserveFresh;
    setPendingEdits(preserveFresh);
    editedFieldsRef.current = new Set();
    editRevisionRef.current += 1;
    setPassword('');
    setConfirmPassword('');
    setStep(1);
    setLoading(false);
    submissionRef.current = false;
    savedSubmissionRef.current = null;
    setError('');
    setRecoveryError('');
    setHydrationError('');
    setHydratedScope(null);
    setVerifiedUID(null);
    setEmailCheckedUID(null);
    setRecoveredRevision(null);
    setConfirmed(null);
    draftSessionRef.current = uid ? createDriverRegistrationDraftSession(AsyncStorage, uid) : null;
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, [uid]);

  useEffect(() => {
    if (authLoading || hydrated) return;
    const captured = { ...identityRef.current };
    let active = true;
    const hydrate = async () => {
      try {
        const draft = await draftSessionRef.current?.read();
        if (!active || !isCurrent(captured)) return;
        if (draft) {
          setForm(draft.form);
          formRef.current = draft.form;
          editsRef.current = draft.pendingEdits;
          setPendingEdits(draft.pendingEdits);
          editedFieldsRef.current = new Set(draft.editedFields);
          setStep(clampDriverDraftStep(draft.step));
        }
        setHydrationError('');
        setHydratedScope(scope);
      } catch {
        if (active && isCurrent(captured)) setHydrationError('Your saved draft could not be loaded. Retry before continuing; it has not been overwritten.');
      }
    };
    void hydrate();
    return () => { active = false; };
  }, [uid, authLoading, retry]);

  // Hydration is an explicit barrier. All reads, writes and confirmation clears
  // share one ordered queue; an account change invalidates queued writes.
  useEffect(() => {
    if (authLoading || !hydrated || !uid || confirmed || hydrationError) return;
    const captured = { ...identityRef.current };
    void draftSessionRef.current?.write({ version: 1, uid, step: clampDriverDraftStep(step), pendingEdits,
      editedFields: [...editedFieldsRef.current], form }, () => isCurrent(captured))
      .catch(() => { if (isCurrent(captured)) setError('Your draft could not be saved on this device. Keep this page open and retry.'); });
  }, [form, step, pendingEdits, uid, authLoading, hydrated, confirmed, hydrationError]);

  useEffect(() => {
    if (authLoading || !hydrated || !user) return;
    const captured = { ...identityRef.current };
    let active = true;
    let busy = false;
    const checkEmail = async () => {
      if (busy || !active || !isCurrent(captured)) return;
      busy = true;
      try {
        await user.reload();
        if (!active || !isCurrent(captured)) return;
        setRecoveryError('');
        if (user.emailVerified) {
          await refreshProfile();
          if (!active || !isCurrent(captured)) return;
          setVerifiedUID(user.uid);
          setEmailCheckedUID(user.uid);
        } else {
          setEmailCheckedUID(user.uid);
          setStep(2);
          setForm(previous => ({ ...previous, email: previous.email || user.email || '', fullName: previous.fullName || user.displayName || '' }));
          // One non-overlapping timeout chain, cancelled for account changes/unmount.
          pollRef.current = setTimeout(() => { void checkEmail(); }, 3000);
        }
      } catch {
        if (active && isCurrent(captured)) setRecoveryError('We could not verify your account right now. Retry; your draft and selections are still here.');
      } finally {
        busy = false;
      }
    };
    void checkEmail();
    return () => {
      active = false;
      if (pollRef.current) clearTimeout(pollRef.current);
      pollRef.current = null;
    };
  }, [uid, authLoading, hydrated, retry]);

  const confirmSubmission = (checked: NonNullable<typeof manifest>, captured: { uid: string | null; generation: number }) => {
    if (!captured.uid || !isCurrent(captured) || editsRef.current || !canConfirmDriverSubmission(checked, captured.uid)) return false;
    const revision = driverRegistrationRevision(checked);
    const confirmation = { uid: captured.uid, revision };
    confirmedRef.current = confirmation;
    setConfirmed(confirmation);
    setStep(5);
    void draftSessionRef.current?.confirmedClear(() => isCurrent(captured) && !editsRef.current
      && confirmedRef.current?.uid === captured.uid && confirmedRef.current?.revision === revision
      && driverRegistrationRevision(manifestRef.current) === revision
      && canConfirmDriverSubmission(manifestRef.current, captured.uid))
      .catch(() => { if (isCurrent(captured)) setError('Submission is verified, but the local draft could not be removed.'); });
    return true;
  };

  useEffect(() => {
    if (authLoading || !hydrated || !uid || verifiedUID !== uid || submissionRef.current || recoveryError) return;
    if (approved) { router.replace('/home'); return; }
    if (manifestStatus !== 'ready' || !manifest) return;
    const captured = { ...identityRef.current };
    if (!isCurrent(captured)) return;
    const saved = savedSubmissionRef.current;
    if (saved && isCurrent(saved.ticket) && saved.editRevision === editRevisionRef.current
      && canConfirmDriverSubmission(manifest, uid) && driverRegistrationMatchesSavedSubmission(saved.form, manifest)) {
      editsRef.current = false;
      setPendingEdits(false);
      editedFieldsRef.current.clear();
      savedSubmissionRef.current = null;
    }
    const restored = restoreDriverRegistrationForm(formRef.current, ownProfile, manifest, editsRef.current, editedFieldsRef.current);
    restored.email ||= user?.email || '';
    restored.fullName ||= user?.displayName || '';
    setForm(restored);
    formRef.current = restored;
    const revision = driverRegistrationRevision(manifest);
    setRecoveredRevision(revision);
    const complete = !rejected && canConfirmDriverSubmission(manifest, uid);
    const nextStep = driverRegistrationRecoveryStep({ status: manifestStatus, confirmed: complete,
      pendingEdits: editsRef.current, detailsMissing: driverRegistrationDetailsMissing(restored) });
    if (nextStep === 5) {
      confirmSubmission(manifest, captured);
    } else {
      setConfirmed(null);
      setStep(nextStep ?? 3);
      const labels = driverRegistrationMissingLabels(manifest);
      setError(previous => previous && editsRef.current ? previous
        : labels.length ? `Please upload the required documents before submitting: ${labels.join(', ')}.` : '');
    }
  }, [uid, authLoading, hydrated, verifiedUID, ownProfile, manifest, manifestStatus, approved, rejected, recoveryError, loading]);

  const isKantanka = selectedCategories.includes('kantanka') || serviceType === 'okada' || serviceType === 'delivery';
  const maxCategories = isKantanka ? 99 : 2;
  const toggleCategory = (id: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(id)) return prev.filter(c => c !== id);
      if (id === 'kantanka') return ['standard', 'comfort', 'kantanka', 'car_delivery'];
      if (prev.length >= maxCategories) return prev;
      return [...prev, id];
    });
  };
  const availableCategories = serviceType ? ALL_CATEGORIES.filter(c => CATEGORIES_BY_SERVICE[serviceType]?.includes(c.id)) : [];
  const selectedService = SERVICE_TYPES.find(s => s.id === serviceType);

  const handleCreateAccount = async () => {
    if (loading || !hydrated || uid) return;
    setError('');
    if (!fullName.trim()) { setError('Please enter your full name.'); return; }
    if (!email.trim()) { setError('Please enter your email.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    const captured = { ...identityRef.current };
    const fresh = { email: email.trim().toLowerCase(), form: { ...form, selectedCategories: [...selectedCategories] }, targetUID: null as string | null };
    freshSignUpRef.current = fresh;
    const stillFresh = () => mountedRef.current && freshSignUpRef.current === fresh
      && (!firebaseAuthObj.currentUser || firebaseAuthObj.currentUser.email?.toLowerCase() === fresh.email)
      && (!fresh.targetUID || firebaseAuthObj.currentUser?.uid === fresh.targetUID);
    setLoading(true);
    try {
      await signUp(email.trim(), password, fullName.trim());
      if (!stillFresh()) return;
      const createdUser = firebaseAuthObj.currentUser;
      if (createdUser) {
        fresh.targetUID = createdUser.uid;
        const { sendEmailVerification: sendVerif } = await import('firebase/auth');
        if (!stillFresh()) return;
        await sendVerif(createdUser);
        if (!stillFresh()) return;
        setStep(2);
      }
    } catch (err: any) {
      if (!stillFresh() && !isCurrent(captured)) return;
      if (!firebaseAuthObj.currentUser && freshSignUpRef.current === fresh) freshSignUpRef.current = null;
      if (err?.code === 'auth/email-already-in-use') {
        freshSignUpRef.current = null;
        Alert.alert('Account already exists', 'This email already has a HY3N account. Please log in with your password.', [
          { text: 'Stay here', style: 'cancel' }, { text: 'Log in', onPress: () => router.replace('/login' as any) },
        ]);
      } else setError(err?.message || 'Failed to create account.');
    } finally {
      if (stillFresh() || isCurrent(captured)) setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    if (loading || !hydrated || uid) return;
    const captured = { ...identityRef.current };
    setError('');
    setLoading(true);
    try {
      // Google may select an existing account; never transplant anonymous data.
      await signInWithGoogle();
    } catch (err: any) {
      if (isCurrent(captured)) setError(err?.message || 'Google sign-in failed.');
    } finally {
      if (isCurrent(captured)) setLoading(false);
    }
  };

  const handleSubmitApplication = async () => {
    if (submissionRef.current || loading || !uid || !hydrated || approved || verifiedUID !== uid || manifestStatus !== 'ready') return;
    if (driverRegistrationDetailsMissing(form)) { setStep(3); setError('Please fill in your personal details and select a ride category.'); return; }
    if (!vehicleMake.trim() || !vehicleModel.trim() || !vehiclePlate.trim()) {
      setError('Please fill in all vehicle details.'); return;
    }
    const requiredDocuments = [
      ['Ghana Card (Front)', ghanaCardFront], ['Ghana Card (Back)', ghanaCardBack],
      ["Driver's License (Front)", licenseFront], ["Driver's License (Back)", licenseBack],
      ['Your Photo (Selfie)', driverPhoto], ['Vehicle Photo', vehiclePhoto],
    ] as const;
    const missingDocuments = requiredDocuments.filter(([, uri]) => !uri.trim()).map(([label]) => label);
    if (missingDocuments.length) {
      setStep(4);
      setError(`Please upload the required documents before submitting: ${missingDocuments.join(', ')}.`);
      return;
    }
    const captured = { ...identityRef.current };
    const editRevision = editRevisionRef.current;
    const submittedForm = { ...form, selectedCategories: [...selectedCategories] };
    submissionRef.current = true;
    setConfirmed(null);
    setError('');
    setLoading(true);
    try {
      const submitUser = firebaseAuthObj.currentUser;
      if (!submitUser || !isCurrent(captured)) throw new Error('Please sign in again before submitting.');
      const assertCurrent = () => {
        if (!isCurrent(captured) || editRevisionRef.current !== editRevision || approvedRef.current) throw new Error('Account or application changed. Please retry.');
      };
      // Recheck before replacing fixed-slot objects that an administrator may
      // have reviewed since this repair screen was opened.
      const beforeUpload = await recheck();
      assertCurrent();
      if (!beforeUpload) throw new Error('Documents could not be checked before uploading. Retry verification; your selections are retained.');
      if (beforeUpload.approvalStatus === 'approved') throw new Error('This application is already approved. Please return to the Driver app.');
      const uploadDocument = async (uri: string, key: string, manifestKey: string) => {
        assertCurrent();
        if (!uri) return '';
        if (!isLocalDriverDocument(uri)) {
          const checked = beforeUpload.documents[manifestKey as keyof typeof beforeUpload.documents];
          if (checked?.status !== 'valid' || checked.reference !== uri) throw new Error('Please select the document again; this reference has not been verified.');
          return uri;
        }
        const response = await fetch(uri);
        assertCurrent();
        const blob = await response.blob();
        assertCurrent();
        const uploaded = await firebaseStorage.uploadFile(blob, `drivers/${submitUser.uid}/${key}.jpg`);
        assertCurrent();
        if (!isOwnedDriverStorageReference(uploaded, submitUser.uid)) throw new Error('Document upload was not confirmed. Please retry.');
        return uploaded;
      };
      const uploadedDocuments = await Promise.all([
        uploadDocument(ghanaCardFront, 'ghana-card-front', 'ghanaCardFront'),
        uploadDocument(ghanaCardBack, 'ghana-card-back', 'ghanaCardBack'),
        uploadDocument(licenseFront, 'drivers-license-front', 'licenseFront'),
        uploadDocument(licenseBack, 'drivers-license-back', 'licenseBack'),
        uploadDocument(driverPhoto, 'profile-photo', 'profilePhoto'),
        uploadDocument(vehiclePhoto, 'vehicle-photo', 'vehiclePhoto'),
        uploadDocument(insurancePhoto, 'insurance', 'insurance'),
        uploadDocument(roadworthyPhoto, 'roadworthy', 'roadworthy'),
      ]);
      assertCurrent();
      const [uploadedGhanaCardFront, uploadedGhanaCardBack, uploadedLicenseFront, uploadedLicenseBack,
        uploadedDriverPhoto, uploadedVehiclePhoto, uploadedInsurance, uploadedRoadworthy] = uploadedDocuments;
      await firebaseAuth.submitDriverProfile({
        fullName: submittedForm.fullName, email: submittedForm.email || submitUser.email || '', phone: submittedForm.phone,
        momoNumber: submittedForm.momoNumber, city: submittedForm.city,
        serviceType: submittedForm.serviceType as 'car' | 'okada' | 'delivery',
        rideCategories: submittedForm.selectedCategories as Array<'standard' | 'comfort' | 'kantanka' | 'car_delivery' | 'executive' | 'okada' | 'express_delivery'>,
        vehicleMake: submittedForm.vehicleMake, vehicleModel: submittedForm.vehicleModel, vehiclePlate: submittedForm.vehiclePlate,
        vehicleColor: submittedForm.vehicleColor, vehicleYear: submittedForm.vehicleFullModel,
        documents: { ghanaCardFront: uploadedGhanaCardFront, ghanaCardBack: uploadedGhanaCardBack,
          licenseFront: uploadedLicenseFront, licenseBack: uploadedLicenseBack, profilePhoto: uploadedDriverPhoto,
          vehiclePhoto: uploadedVehiclePhoto, insurance: uploadedInsurance, roadworthy: uploadedRoadworthy },
      });
      assertCurrent();
      await refreshProfile();
      assertCurrent();
      // A profile-fingerprint change can cancel this hook closure's recheck.
      // Keep the saved snapshot so a later authoritative ready/retry can finish
      // only these exact edits; a new selection invalidates it immediately.
      savedSubmissionRef.current = { ticket: captured, editRevision, form: {
        ...submittedForm, email: submittedForm.email || submitUser.email || '',
        ghanaCardFront: uploadedGhanaCardFront, ghanaCardBack: uploadedGhanaCardBack,
        licenseFront: uploadedLicenseFront, licenseBack: uploadedLicenseBack,
        driverPhoto: uploadedDriverPhoto, vehiclePhoto: uploadedVehiclePhoto,
        insurancePhoto: uploadedInsurance, roadworthyPhoto: uploadedRoadworthy,
      } };
      const checked = await recheck();
      assertCurrent();
      if (!checked) throw new Error('Your application was saved, but documents could not be verified. Retry verification; your selections are retained.');
      const restored = restoreDriverRegistrationForm(submittedForm, null, checked, false);
      if (!canConfirmDriverSubmission(checked, submitUser.uid)) {
        setStep(driverRegistrationDetailsMissing(restored) ? 3 : 4);
        const labels = driverRegistrationMissingLabels(checked);
        throw new Error(labels.length ? `Documents still need attention: ${labels.join(', ')}.` : 'Submission could not be confirmed. Retry verification.');
      }
      // Clear the edit barrier only after this exact save, refresh and new check.
      editsRef.current = false;
      setPendingEdits(false);
      editedFieldsRef.current.clear();
      savedSubmissionRef.current = null;
      setForm(restored);
      formRef.current = restored;
      manifestRef.current = checked;
      setRecoveredRevision(driverRegistrationRevision(checked));
      confirmSubmission(checked, captured);
    } catch (err: any) {
      if (isCurrent(captured)) {
        setStep(driverRegistrationDetailsMissing(formRef.current) ? 3 : 4);
        setError(err?.message || 'Failed to submit application. Your draft and selections are retained.');
      }
    } finally {
      if (isCurrent(captured)) {
        submissionRef.current = false;
        setLoading(false);
      }
    }
  };

  const retryRecovery = () => {
    setRecoveryError('');
    setHydrationError('');
    if (!hydrated || recoveryError || verifiedUID !== uid) setRetry(value => value + 1);
    else void recheck();
  };
  const verificationFailed = hydrationError || recoveryError || (verifiedUID === uid && manifestStatus === 'error' ? manifestError || 'Documents could not be checked. Retry; their status is unknown.' : '');
  const checkingRecovery = authLoading || !hydrated || (!!uid && (emailCheckedUID !== uid
    || (verifiedUID === uid && (approved || manifestStatus === 'idle' || manifestStatus === 'checking'
      || (manifestStatus === 'ready' && recoveredRevision !== driverRegistrationRevision(manifest))))));
  const canShowSubmitted = step === 5 && !!uid && confirmed?.uid === uid && !pendingEdits && !rejected
    && confirmed.revision === driverRegistrationRevision(manifest) && manifestStatus === 'ready'
    && canConfirmDriverSubmission(manifest, uid);
  const visibleStep = checkingRecovery || verificationFailed ? 1 : step === 5 && !canShowSubmitted ? 4 : step;

  const TOTAL_STEPS = 5;
  const stepLabels = ['Account', 'Verify', 'Details', 'Documents', 'Done'];

  const renderStep1 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Create Account</Text>
      <Text style={styles.stepSubtitle}>Start your journey as an HY3N driver</Text>

      <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleSignUp} disabled={loading}>
        <View style={styles.googleIconWrap}><Text style={{ color: '#4285F4', fontWeight: '700', fontSize: 14 }}>G</Text></View>
        <Text style={styles.googleBtnText}>Continue with Google</Text>
      </TouchableOpacity>

      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <Text style={styles.label}>Full Name</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="person" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="e.g. Kwame Mensah" placeholderTextColor={MUTED} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
      </View>

      <Text style={styles.label}>Email Address</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="email" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="you@example.com" placeholderTextColor={MUTED} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      </View>

      <Text style={styles.label}>Password</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="lock" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="Min. 6 characters" placeholderTextColor={MUTED} value={password} onChangeText={setPassword} secureTextEntry />
      </View>

      <Text style={styles.label}>Confirm Password</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="lock" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="Repeat password" placeholderTextColor={MUTED} value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
      </View>

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity style={[styles.primaryBtn, { opacity: loading ? 0.7 : 1 }]} onPress={handleCreateAccount} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Create Account</Text>}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.push('/login' as any)} style={{ marginTop: 16, alignItems: 'center' }}>
        <Text style={styles.linkText}>Already have an account? <Text style={{ color: GOLD }}>Sign In</Text></Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderStep2 = () => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
      <MaterialIcons name="mark-email-unread" size={72} color={GOLD} />
      <Text style={[styles.stepTitle, { textAlign: 'center', marginTop: 16 }]}>Verify Your Email</Text>
      <Text style={[styles.stepSubtitle, { textAlign: 'center' }]}>
        We sent a verification link to{'\n'}
        <Text style={{ color: TEXT, fontWeight: '700' }}>{email}</Text>
      </Text>
      <View style={styles.infoBox}>
        <MaterialIcons name="info" size={16} color={GOLD} />
        <Text style={styles.infoText}>This page will advance automatically once verified.</Text>
      </View>
      <TouchableOpacity style={styles.outlineBtn} onPress={async () => {
        const captured = { ...identityRef.current };
        try {
          const currentUser = firebaseAuthObj.currentUser;
          if (currentUser && isCurrent(captured)) {
            const { sendEmailVerification: sendVerif } = await import('firebase/auth');
            if (!isCurrent(captured)) return;
            await sendVerif(currentUser);
          }
          if (isCurrent(captured)) Alert.alert('Sent!', 'Verification email resent. Check your inbox.');
        } catch { if (isCurrent(captured)) Alert.alert('Error', 'Could not resend email.'); }
      }}>
        <MaterialIcons name="refresh" size={18} color={TEXT} />
        <Text style={styles.outlineBtnText}>Resend Email</Text>
      </TouchableOpacity>
    </View>
  );

  const renderStep3 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Personal Details</Text>
      <Text style={styles.stepSubtitle}>Tell us about yourself</Text>

      <Text style={styles.label}>Full Name</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="person" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="e.g. Kwame Mensah" placeholderTextColor={MUTED} autoCapitalize="words" />
      </View>

      <Text style={styles.label}>Phone Number</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="phone" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="+233XXXXXXXXX" placeholderTextColor={MUTED} keyboardType="phone-pad" />
      </View>

      <Text style={styles.label}>City</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="location-city" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} value={city} onChangeText={setCity} placeholder="e.g. Accra" placeholderTextColor={MUTED} autoCapitalize="words" />
      </View>

      <Text style={styles.label}>MoMo Number (for earnings)</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="account-balance-wallet" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} value={momoNumber} onChangeText={setMomoNumber} placeholder="+233XXXXXXXXX" placeholderTextColor={MUTED} keyboardType="phone-pad" />
      </View>

      <Text style={[styles.sectionTitle]}>Select Service Type</Text>
      {SERVICE_TYPES.map((svc) => (
        <TouchableOpacity
          key={svc.id}
          style={[styles.serviceCard, serviceType === svc.id && { borderColor: GOLD, backgroundColor: GOLD + '15' }]}
          onPress={() => setServiceType(svc.id)}
        >
          <View style={[styles.serviceIconBox, serviceType === svc.id && { backgroundColor: GOLD + '30' }]}>
            <MaterialIcons name={svc.icon} size={26} color={serviceType === svc.id ? GOLD : MUTED} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.serviceLabel, serviceType === svc.id && { color: GOLD }]}>{svc.label}</Text>
            <Text style={styles.serviceDesc}>{svc.description}</Text>
          </View>
          {serviceType === svc.id && <MaterialIcons name="check-circle" size={22} color={GOLD} />}
        </TouchableOpacity>
      ))}

      {availableCategories.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Ride Categories</Text>
          <Text style={{ color: MUTED, fontSize: 12, marginBottom: 10, marginTop: -6 }}>
            {selectedCategories.includes('kantanka')
              ? 'Kantanka unlocks all categories'
              : serviceType === 'okada' || serviceType === 'delivery'
              ? 'Your service type has one fixed category'
              : `Select up to 2 categories (${selectedCategories.length}/2 selected)`}
          </Text>
          {availableCategories.map((cat) => {
            const selected = selectedCategories.includes(cat.id);
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.serviceCard, selected && { borderColor: GOLD, backgroundColor: GOLD + '15' }]}
                onPress={() => toggleCategory(cat.id)}
              >
                <View style={[styles.serviceIconBox, selected && { backgroundColor: GOLD + '30' }]}>
                  <MaterialIcons name={cat.icon} size={22} color={selected ? GOLD : MUTED} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.serviceLabel, selected && { color: GOLD }]}>{cat.label}</Text>
                  <Text style={styles.serviceDesc}>{cat.description}</Text>
                </View>
                <View style={[
                  { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: selected ? GOLD : (!selected && selectedCategories.length >= maxCategories && cat.id !== 'kantanka') ? '#3A3A3A' : BORDER, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? GOLD : 'transparent' }
                ]}>
                  {selected && <MaterialIcons name="check" size={14} color="#000" />}
                  {!selected && selectedCategories.length >= maxCategories && cat.id !== 'kantanka' && <MaterialIcons name="lock" size={12} color="#3A3A3A" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.primaryBtn, { opacity: !serviceType ? 0.5 : 1 }]}
        onPress={() => {
          if (!serviceType) { setError('Please select a service type.'); return; }
          if (!fullName.trim() || !phone.trim() || !city.trim()) { setError('Please fill in all fields including city.'); return; }
          if (selectedCategories.length === 0) { setError('Please select at least one ride category.'); return; }
          setError('');
          setStep(4);
        }}
        disabled={!serviceType}
      >
        <Text style={styles.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderStep4 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Vehicle & Documents</Text>
      <Text style={styles.stepSubtitle}>Upload your vehicle details and required documents</Text>

      <Text style={styles.sectionTitle}>Vehicle Details</Text>
      <Text style={styles.label}>{selectedService?.vehicleLabel || 'Vehicle'} Make</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="directions-car" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder={selectedService?.makePlaceholder || 'e.g. Toyota'} placeholderTextColor={MUTED} value={vehicleMake} onChangeText={setVehicleMake} />
      </View>

      <Text style={styles.label}>{selectedService?.vehicleLabel || 'Vehicle'} Model</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="directions-car" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="e.g. Camry" placeholderTextColor={MUTED} value={vehicleModel} onChangeText={setVehicleModel} />
      </View>

      <Text style={styles.label}>License Plate</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="badge" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="e.g. GR-1234-22" placeholderTextColor={MUTED} value={vehiclePlate} onChangeText={setVehiclePlate} autoCapitalize="characters" />
      </View>

      <Text style={styles.label}>Vehicle Color</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="palette" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="e.g. Silver" placeholderTextColor={MUTED} value={vehicleColor} onChangeText={setVehicleColor} />
      </View>

      <Text style={styles.label}>Vehicle Year</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="calendar-today" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} placeholder="e.g. 2022" placeholderTextColor={MUTED} value={vehicleFullModel} onChangeText={setVehicleFullModel} keyboardType="numeric" maxLength={4} />
      </View>

      <Text style={styles.sectionTitle}>Required Documents</Text>
      <FileUploadField label="Ghana Card (Front)" uri={ghanaCardFront} onPick={setGhanaCardFront} />
      <FileUploadField label="Ghana Card (Back)" uri={ghanaCardBack} onPick={setGhanaCardBack} />
      <FileUploadField label="Driver's License (Front)" uri={licenseFront} onPick={setLicenseFront} />
      <FileUploadField label="Driver's License (Back)" uri={licenseBack} onPick={setLicenseBack} />
      <FileUploadField label="Your Photo (Selfie)" uri={driverPhoto} onPick={setDriverPhoto} />
      <FileUploadField label="Vehicle Photo" uri={vehiclePhoto} onPick={setVehiclePhoto} />
      <FileUploadField label="Insurance Certificate" uri={insurancePhoto} onPick={setInsurancePhoto} />
      <FileUploadField label="Roadworthy Certificate" uri={roadworthyPhoto} onPick={setRoadworthyPhoto} />

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity style={[styles.primaryBtn, { opacity: loading ? 0.7 : 1 }]} onPress={handleSubmitApplication} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Submit Application</Text>}
      </TouchableOpacity>

      {!!error && <TouchableOpacity style={[styles.outlineBtn, { marginTop: 8 }]} onPress={retryRecovery} disabled={loading}>
        <MaterialIcons name="refresh" size={18} color={TEXT} />
        <Text style={styles.outlineBtnText}>Retry document verification</Text>
      </TouchableOpacity>}

      <TouchableOpacity style={[styles.outlineBtn, { marginTop: 8 }]} onPress={() => setStep(3)}>
        <MaterialIcons name="arrow-back" size={18} color={TEXT} />
        <Text style={styles.outlineBtnText}>Back</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  const renderStep5 = () => (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }} showsVerticalScrollIndicator={false}>
      {/* Success icon */}
      <View style={{ width: 100, height: 100, borderRadius: 50, backgroundColor: '#22C55E20', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
        <MaterialIcons name="check-circle" size={64} color="#22C55E" />
      </View>
      <Text style={[styles.stepTitle, { textAlign: 'center', marginTop: 12 }]}>Application Submitted!</Text>
      <Text style={[styles.stepSubtitle, { textAlign: 'center', marginBottom: 24 }]}>
        Our admin team will review your details and activate your account within 24–48 hours.
      </Text>

      {/* Timeline steps */}
      <View style={{ width: '100%', backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#2A2A2A', padding: 20, marginBottom: 20, gap: 0 }}>
        {[
          { icon: 'check-circle' as const, color: '#22C55E', title: 'Account Created', desc: 'Your account and profile have been saved.' },
          { icon: 'check-circle' as const, color: '#22C55E', title: 'Documents Uploaded', desc: 'Your vehicle details and documents are on file.' },
          { icon: 'access-time' as const, color: GOLD, title: 'Under Review', desc: 'Our team is verifying your documents (24–48 hrs).' },
          { icon: 'radio-button-unchecked' as const, color: '#2A2A2A', title: 'Approved & Ready', desc: 'You will receive a notification when approved.' },
        ].map((item, idx, arr) => (
          <View key={item.title} style={{ flexDirection: 'row', gap: 14, paddingVertical: 10 }}>
            {/* Icon + connector line */}
            <View style={{ alignItems: 'center', width: 28 }}>
              <MaterialIcons name={item.icon} size={24} color={item.color} />
              {idx < arr.length - 1 && (
                <View style={{ width: 2, flex: 1, backgroundColor: idx < 2 ? '#22C55E40' : '#2A2A2A', marginTop: 4, minHeight: 16 }} />
              )}
            </View>
            <View style={{ flex: 1, paddingBottom: idx < arr.length - 1 ? 8 : 0 }}>
              <Text style={{ color: idx < 3 ? '#FAFAFA' : '#9CA3AF', fontWeight: '700', fontSize: 14 }}>{item.title}</Text>
              <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 2, lineHeight: 17 }}>{item.desc}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Info box */}
      <View style={[styles.infoBox, { marginBottom: 20 }]}>
        <MaterialIcons name="notifications-active" size={16} color={GOLD} />
        <Text style={styles.infoText}>You will receive a push notification and email once your account is approved.</Text>
      </View>

      {/* Support */}
      <TouchableOpacity
        style={[styles.primaryBtn, { backgroundColor: '#1A1A1A', borderWidth: 1, borderColor: '#2A2A2A', marginBottom: 12 }]}
        onPress={() => openDriverSupportWhatsApp('Hi HY3N Support, I just applied to be an HY3N driver and need help.').catch(() => Alert.alert('WhatsApp unavailable', 'Please call HY3N Support on 055 727 8990.'))}
        activeOpacity={0.8}
      >
        <MaterialIcons name="support-agent" size={18} color={GOLD} />
        <Text style={[styles.primaryBtnText, { color: GOLD, marginLeft: 8 }]}>Contact Support</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/home')} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>Go to Driver App</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          {!checkingRecovery && !verificationFailed && visibleStep > 1 && visibleStep < 5 && (
            <TouchableOpacity onPress={() => setStep(s => Math.max(1, s - 1))} style={styles.backBtn}>
              <MaterialIcons name="arrow-back" size={22} color={TEXT} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Apply to Drive</Text>
            <Text style={styles.headerStep}>Step {visibleStep} of {TOTAL_STEPS}</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressBar}>
          <View style={[styles.progressFill, { width: `${(visibleStep / TOTAL_STEPS) * 100}%` }]} />
        </View>
        <View style={styles.stepLabelsRow}>
          {stepLabels.map((label, i) => (
            <Text key={label} style={[styles.stepLabelText, { color: i + 1 <= visibleStep ? GOLD : MUTED }]}>{label}</Text>
          ))}
        </View>

        {verificationFailed ? (
          <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
            <Text style={styles.stepTitle}>Verification unavailable</Text>
            <Text style={styles.stepSubtitle}>{verificationFailed}</Text>
            <Text style={styles.infoText}>Your draft has not been deleted. We cannot confirm whether documents are complete until verification succeeds.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={retryRecovery}>
              <Text style={styles.primaryBtnText}>Retry verification</Text>
            </TouchableOpacity>
          </View>
        ) : checkingRecovery ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 16 }}>
            <ActivityIndicator color={GOLD} />
            <Text style={styles.stepSubtitle}>Checking your account and saved application…</Text>
          </View>
        ) : (
          <>
            {rejected && <View style={[styles.infoBox, { marginHorizontal: 20 }]}>
              <Text style={styles.infoText}>Your application needs changes. {rejectionReason || 'Please review your details and documents before resubmitting.'}</Text>
            </View>}
            {visibleStep === 1 && renderStep1()}
            {visibleStep === 2 && renderStep2()}
            {visibleStep === 3 && renderStep3()}
            {visibleStep === 4 && renderStep4()}
            {canShowSubmitted && renderStep5()}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: TEXT },
  headerStep: { fontSize: 12, color: MUTED, marginTop: 1 },
  progressBar: { height: 4, marginHorizontal: 16, borderRadius: 2, backgroundColor: BORDER },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: GOLD },
  stepLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 6, marginBottom: 4 },
  stepLabelText: { fontSize: 9, fontWeight: '600', textTransform: 'uppercase' },
  stepContent: { padding: 20, gap: 2, paddingBottom: 40 },
  stepTitle: { fontSize: 22, fontWeight: '800', color: TEXT, marginBottom: 4 },
  stepSubtitle: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: TEXT, marginTop: 12, marginBottom: 8 },
  label: { color: MUTED, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 8 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, height: 48, marginBottom: 4 },
  inputIcon: { marginRight: 8 },
  input: { flex: 1, color: TEXT, fontSize: 15 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 14, height: 52, gap: 10, marginBottom: 16 },
  googleIconWrap: { width: 24, height: 24, backgroundColor: '#fff', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  googleBtnText: { color: TEXT, fontSize: 15, fontWeight: '600' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: BORDER },
  dividerText: { color: MUTED, fontSize: 13 },
  serviceCard: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: BORDER, borderRadius: 14, padding: 14, gap: 12, marginBottom: 8, backgroundColor: CARD },
  serviceIconBox: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: BORDER },
  serviceLabel: { fontSize: 15, fontWeight: '700', color: TEXT },
  serviceDesc: { fontSize: 12, color: MUTED, marginTop: 2 },
  tierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  tierCard: { width: '47%', borderWidth: 1.5, borderColor: BORDER, borderRadius: 12, padding: 12, gap: 4, backgroundColor: CARD },
  tierLabel: { fontSize: 14, fontWeight: '700', color: TEXT },
  tierDesc: { fontSize: 11, color: MUTED, lineHeight: 15 },
  uploadRow: { flexDirection: 'row', gap: 10 },
  uploadBtn: { flex: 1, height: 72, borderWidth: 1.5, borderStyle: 'dashed', borderColor: BORDER, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: CARD },
  uploadedRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: GOLD + '40', borderRadius: 12, padding: 10, gap: 10, backgroundColor: GOLD + '10' },
  uploadThumb: { width: 40, height: 40, borderRadius: 8 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1, borderColor: GOLD + '40', borderRadius: 12, padding: 12, gap: 8, backgroundColor: GOLD + '10', marginVertical: 16, width: '100%' },
  infoText: { flex: 1, color: GOLD, fontSize: 13, lineHeight: 18 },
  primaryBtn: { backgroundColor: GOLD, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  primaryBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  outlineBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 14, borderWidth: 1, borderColor: BORDER, gap: 8, marginTop: 8 },
  outlineBtnText: { color: TEXT, fontSize: 15, fontWeight: '600' },
  errorText: { color: '#EF4444', fontSize: 13, textAlign: 'center', marginTop: 4 },
  linkText: { color: MUTED, fontSize: 14 },
});
