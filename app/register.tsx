import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, Image, ActivityIndicator, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import * as ImagePicker from 'expo-image-picker';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS, auth as firebaseAuthObj, firebaseAuth } from '@/lib/firebase';
import { Linking } from 'react-native';

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
  { id: 'executive',        label: 'Executive',          description: 'Luxury high-end vehicles',               icon: 'star' as const },
  { id: 'okada',            label: 'Okada',              description: 'Fast motorbike rides',                   icon: 'two-wheeler' as const },
  { id: 'express_delivery', label: 'Express Delivery',   description: 'Package and parcel deliveries',          icon: 'inventory' as const },
];

const CATEGORIES_BY_SERVICE: Record<string, string[]> = {
  car:      ['standard', 'comfort', 'kantanka', 'executive'],
  okada:    ['okada'],
  delivery: ['express_delivery'],
};

const SERVICE_TYPES = [
  {
    id: 'car',
    label: 'Car Driver',
    description: 'Standard, Comfort, Kantanka or Executive rides',
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
  const { signUp, signInWithGoogle } = useDriverAuth();

  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+233');
  const [momoNumber, setMomoNumber] = useState('+233');
  const [momoNetwork, setMomoNetwork] = useState<'mtn-gh' | 'vodafone-gh' | 'tigo-gh'>('mtn-gh');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [vehicleFullModel, setVehicleFullModel] = useState('');
  const [city, setCity] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

  const isKantanka = selectedCategories.includes('kantanka') || serviceType === 'okada' || serviceType === 'delivery';
  const maxCategories = isKantanka ? 99 : 2;

  const toggleCategory = (id: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(id)) return prev.filter(c => c !== id);
      // Kantanka unlocks all; others capped at 2
      if (id === 'kantanka') return ['standard', 'comfort', 'kantanka', 'executive'];
      if (prev.length >= maxCategories) return prev; // silently ignore if at cap
      return [...prev, id];
    });
  };

  const availableCategories = serviceType ? ALL_CATEGORIES.filter(c => CATEGORIES_BY_SERVICE[serviceType]?.includes(c.id)) : [];
  const [ghanaCardFront, setGhanaCardFront] = useState('');
  const [ghanaCardBack, setGhanaCardBack] = useState('');
  const [licenseFront, setLicenseFront] = useState('');
  const [licenseBack, setLicenseBack] = useState('');
  const [driverPhoto, setDriverPhoto] = useState('');
  const [vehiclePhoto, setVehiclePhoto] = useState('');
  const [insurancePhoto, setInsurancePhoto] = useState('');
  const [roadworthyPhoto, setRoadworthyPhoto] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedService = SERVICE_TYPES.find(s => s.id === serviceType);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startVerificationPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const user = firebaseAuthObj.currentUser;
        if (user) {
          await user.reload();
          if (user.emailVerified) {
            if (pollRef.current) clearInterval(pollRef.current);
            setStep(3);
          }
        }
      } catch {}
    }, 3000);
  };

  const handleCreateAccount = async () => {
    setError('');
    if (!fullName.trim()) { setError('Please enter your full name.'); return; }
    if (!email.trim()) { setError('Please enter your email.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await signUp(email.trim(), password);
      const user = firebaseAuthObj.currentUser;
      if (user) {
        const { sendEmailVerification: sendVerif } = await import('firebase/auth');
        await sendVerif(user);
      }
      setStep(2);
      startVerificationPolling();
    } catch (err: any) {
      setError(err.message || 'Failed to create account.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
      const user = firebaseAuthObj.currentUser;
      if (user) {
        setEmail(user.email || '');
        setFullName(user.displayName || '');
      }
      setStep(3);
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitApplication = async () => {
    if (!serviceType) { setError('Please select a service type.'); return; }
    if (!vehicleMake.trim() || !vehicleModel.trim() || !vehiclePlate.trim()) {
      setError('Please fill in all vehicle details.'); return;
    }
    setError('');
    setLoading(true);
    try {
      const user = firebaseAuthObj.currentUser;
      if (!user) throw new Error('Not authenticated');

      const defaultCats = serviceType === 'okada' ? ['okada'] : serviceType === 'delivery' ? ['express_delivery'] : ['standard'];
      const rideCategories = selectedCategories.length > 0 ? selectedCategories : defaultCats;

      const profileData = {
        user_id: user.uid,
        full_name: fullName,
        phone,
        email: email || user.email || '',
        momo_number: momoNumber,
        momo_network: momoNetwork,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        license_plate: vehiclePlate,
        vehicle_color: vehicleColor,
        vehicle_full_model: vehicleFullModel,
        city,
        service_type: serviceType,
        ride_categories: rideCategories,
        ghana_card_front_url: ghanaCardFront,
        ghana_card_back_url: ghanaCardBack,
        drivers_license_front_url: licenseFront,
        drivers_license_back_url: licenseBack,
        profile_photo_url: driverPhoto,
        vehicle_registration_url: vehiclePhoto,
        insurance_url: insurancePhoto,
        roadworthy_url: roadworthyPhoto,
        approval_status: 'pending',
        is_online: false,
        total_earnings: 0,
        total_rides: 0,
        rating: 5,
      };

      const existing = await firestoreDB.list(COLLECTIONS.DRIVER_PROFILES, { user_id: user.uid });
      if (existing.length > 0) {
        await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, existing[0].id, profileData);
      } else {
        await firestoreDB.create(COLLECTIONS.DRIVER_PROFILES, profileData);
      }
      setStep(5);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit application.');
    } finally {
      setLoading(false);
    }
  };

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

      <TouchableOpacity onPress={() => router.push('/driver/login' as any)} style={{ marginTop: 16, alignItems: 'center' }}>
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
        try {
          const user = firebaseAuthObj.currentUser;
          if (user) {
            const { sendEmailVerification: sendVerif } = await import('firebase/auth');
            await sendVerif(user);
          }
          Alert.alert('Sent!', 'Verification email resent. Check your inbox.');
        } catch { Alert.alert('Error', 'Could not resend email.'); }
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

      <Text style={styles.label}>MoMo Number (for daily commission)</Text>
      <View style={styles.inputWrap}>
        <MaterialIcons name="account-balance-wallet" size={18} color={MUTED} style={styles.inputIcon} />
        <TextInput style={styles.input} value={momoNumber} onChangeText={setMomoNumber} placeholder="+233XXXXXXXXX" placeholderTextColor={MUTED} keyboardType="phone-pad" />
      </View>

      <Text style={styles.label}>MoMo Network</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
        {[
          { id: 'mtn-gh' as const, label: 'MTN', color: '#FFCC00' },
          { id: 'vodafone-gh' as const, label: 'Vodafone', color: '#E60000' },
          { id: 'tigo-gh' as const, label: 'AirtelTigo', color: '#F77F00' },
        ].map((net) => (
          <TouchableOpacity
            key={net.id}
            style={[
              { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, alignItems: 'center',
                borderColor: momoNetwork === net.id ? net.color : BORDER,
                backgroundColor: momoNetwork === net.id ? net.color + '20' : '#1A1A1A' },
            ]}
            onPress={() => setMomoNetwork(net.id)}
          >
            <Text style={{ color: momoNetwork === net.id ? net.color : MUTED, fontWeight: '700', fontSize: 13 }}>
              {net.label}
            </Text>
          </TouchableOpacity>
        ))}
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
        onPress={() => Linking.openURL('https://wa.me/233546728330?text=Hi%2C%20I%20just%20applied%20to%20be%20an%20HY3N%20driver%20and%20need%20help.')}
        activeOpacity={0.8}
      >
        <MaterialIcons name="support-agent" size={18} color={GOLD} />
        <Text style={[styles.primaryBtnText, { color: GOLD, marginLeft: 8 }]}>Contact Support</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace('/driver/(tabs)' as any)} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>Go to Driver App</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        {step > 1 && step < 5 && (
          <TouchableOpacity onPress={() => setStep(s => Math.max(1, s - 1))} style={styles.backBtn}>
            <MaterialIcons name="arrow-back" size={22} color={TEXT} />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Apply to Drive</Text>
          <Text style={styles.headerStep}>Step {step} of {TOTAL_STEPS}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${(step / TOTAL_STEPS) * 100}%` }]} />
      </View>
      <View style={styles.stepLabelsRow}>
        {stepLabels.map((label, i) => (
          <Text key={label} style={[styles.stepLabelText, { color: i + 1 <= step ? GOLD : MUTED }]}>{label}</Text>
        ))}
      </View>

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
      {step === 5 && renderStep5()}
    </View>
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
