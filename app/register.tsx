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
import { firestoreDB, COLLECTIONS, auth as firebaseAuthObj, firebaseAuth, firebaseStorage } from '@/lib/firebase';
import { Linking } from 'react-native';
import { trpc } from '@/lib/trpc';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    label: 'Okada Driver',
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
  const { signUp, signIn, signInWithGoogle, user, driverProfile } = useDriverAuth();
  const sendVerification = trpc.auth.sendVerification.useMutation();

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

  useEffect(() => {
    AsyncStorage.getItem('hy3n_driver_register_draft').then(val => {
      if (val) {
        try {
          const draft = JSON.parse(val);
          if (draft.step) setStep(draft.step);
          if (draft.fullName) setFullName(draft.fullName);
          if (draft.email) setEmail(draft.email);
          if (draft.phone) setPhone(draft.phone);
          if (draft.momoNumber) setMomoNumber(draft.momoNumber);
          if (draft.momoNetwork) setMomoNetwork(draft.momoNetwork);
          if (draft.vehicleMake) setVehicleMake(draft.vehicleMake);
          if (draft.vehicleModel) setVehicleModel(draft.vehicleModel);
          if (draft.vehiclePlate) setVehiclePlate(draft.vehiclePlate);
          if (draft.vehicleColor) setVehicleColor(draft.vehicleColor);
          if (draft.vehicleFullModel) setVehicleFullModel(draft.vehicleFullModel);
          if (draft.city) setCity(draft.city);
          if (draft.serviceType) setServiceType(draft.serviceType);
          if (draft.selectedCategories) setSelectedCategories(draft.selectedCategories);
          
          if (draft.ghanaCardFront) setGhanaCardFront(draft.ghanaCardFront);
          if (draft.ghanaCardBack) setGhanaCardBack(draft.ghanaCardBack);
          if (draft.licenseFront) setLicenseFront(draft.licenseFront);
          if (draft.licenseBack) setLicenseBack(draft.licenseBack);
          if (draft.driverPhoto) setDriverPhoto(draft.driverPhoto);
          if (draft.vehiclePhoto) setVehiclePhoto(draft.vehiclePhoto);
          if (draft.insurancePhoto) setInsurancePhoto(draft.insurancePhoto);
          if (draft.roadworthyPhoto) setRoadworthyPhoto(draft.roadworthyPhoto);
        } catch (e) {}
      }
    });
  }, []);

  useEffect(() => {
    const draft = {
      step, fullName, email, phone, momoNumber, momoNetwork,
      vehicleMake, vehicleModel, vehiclePlate, vehicleColor, vehicleFullModel,
      city, serviceType, selectedCategories,
      ghanaCardFront, ghanaCardBack, licenseFront, licenseBack,
      driverPhoto, vehiclePhoto, insurancePhoto, roadworthyPhoto
    };
    AsyncStorage.setItem('hy3n_driver_register_draft', JSON.stringify(draft)).catch(() => {});
  }, [
    step, fullName, email, phone, momoNumber, momoNetwork,
    vehicleMake, vehicleModel, vehiclePlate, vehicleColor, vehicleFullModel,
    city, serviceType, selectedCategories,
    ghanaCardFront, ghanaCardBack, licenseFront, licenseBack,
    driverPhoto, vehiclePhoto, insurancePhoto, roadworthyPhoto
  ]);

  const toggleCategory = (id: string) => {
    setSelectedCategories(prev => {
      if (prev.includes(id)) return prev.filter(c => c !== id);
      if (id === 'kantanka') return ['standard', 'comfort', 'kantanka', 'executive'];
      if (prev.length >= 2) return prev;
      return [...prev, id];
    });
  };

  const availableCategories = serviceType ? ALL_CATEGORIES.filter(c => CATEGORIES_BY_SERVICE[serviceType]?.includes(c.id)) : [];
  const selectedService = SERVICE_TYPES.find(s => s.id === serviceType);

  const handleCreateAccount = async () => {
    setError('');
    if (!fullName.trim() || !email.trim() || password.length < 6) {
      setError('Please complete all fields.');
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim(), password, fullName.trim());
      setStep(2);
    } catch (err: any) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitApplication = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const docs = {
        ghana_card_front: await firebaseStorage.uploadFile(`drivers/${user.uid}/ghana_card_front.jpg`, ghanaCardFront),
        ghana_card_back: await firebaseStorage.uploadFile(`drivers/${user.uid}/ghana_card_back.jpg`, ghanaCardBack),
        license_front: await firebaseStorage.uploadFile(`drivers/${user.uid}/license_front.jpg`, licenseFront),
        license_back: await firebaseStorage.uploadFile(`drivers/${user.uid}/license_back.jpg`, licenseBack),
        driver_photo: await firebaseStorage.uploadFile(`drivers/${user.uid}/driver_photo.jpg`, driverPhoto),
        vehicle_photo: await firebaseStorage.uploadFile(`drivers/${user.uid}/vehicle_photo.jpg`, vehiclePhoto),
        insurance_photo: insurancePhoto ? await firebaseStorage.uploadFile(`drivers/${user.uid}/insurance.jpg`, insurancePhoto) : null,
        roadworthy_photo: roadworthyPhoto ? await firebaseStorage.uploadFile(`drivers/${user.uid}/roadworthy.jpg`, roadworthyPhoto) : null,
      };

      await firestoreDB.create(COLLECTIONS.DRIVER_PROFILES, {
        user_id: user.uid,
        full_name: fullName,
        email: email,
        phone: phone,
        momo_number: momoNumber,
        momo_network: momoNetwork,
        city: city,
        service_type: serviceType,
        accepted_categories: selectedCategories,
        vehicle_make: vehicleMake,
        vehicle_model: vehicleModel,
        vehicle_plate: vehiclePlate,
        vehicle_color: vehicleColor,
        vehicle_year: vehicleFullModel,
        documents: docs,
        approval_status: 'pending',
        is_online: false,
        created_at: new Date().toISOString()
      });
      setStep(5);
    } catch (err: any) {
      setError(err.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Create Account</Text>
      <Text style={styles.stepSubtitle}>Join the HY3N driver community</Text>
      <Text style={styles.label}>Full Name</Text>
      <View style={styles.inputWrap}><TextInput style={styles.input} placeholder="e.g. Kwame Mensah" value={fullName} onChangeText={setFullName} /></View>
      <Text style={styles.label}>Email Address</Text>
      <View style={styles.inputWrap}><TextInput style={styles.input} placeholder="email@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" /></View>
      <Text style={styles.label}>Password</Text>
      <View style={styles.inputWrap}><TextInput style={styles.input} placeholder="Min. 6 characters" value={password} onChangeText={setPassword} secureTextEntry /></View>
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      <TouchableOpacity style={styles.primaryBtn} onPress={handleCreateAccount} disabled={loading}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Create Account</Text>}
      </TouchableOpacity>
    </ScrollView>
  );

  const renderStep3 = () => (
    <ScrollView contentContainerStyle={styles.stepContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.stepTitle}>Service & Categories</Text>
      <Text style={styles.stepSubtitle}>Choose your vehicle type and categories</Text>
      
      <Text style={styles.label}>Service Type</Text>
      {SERVICE_TYPES.map((type) => (
        <TouchableOpacity
          key={type.id}
          style={[styles.serviceCard, serviceType === type.id && { borderColor: GOLD, backgroundColor: GOLD + '10' }]}
          onPress={() => { setServiceType(type.id); setSelectedCategories([]); }}
        >
          <MaterialIcons name={type.icon} size={24} color={serviceType === type.id ? GOLD : MUTED} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.serviceLabel}>{type.label}</Text>
            <Text style={styles.serviceDesc}>{type.description}</Text>
          </View>
        </TouchableOpacity>
      ))}

      {serviceType === 'car' && (
        <>
          <Text style={[styles.label, { marginTop: 20 }]}>Ride Categories (Select up to 2)</Text>
          <View style={styles.tierGrid}>
            {availableCategories.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                style={[styles.tierCard, selectedCategories.includes(cat.id) && { borderColor: GOLD, backgroundColor: GOLD + '10' }]}
                onPress={() => toggleCategory(cat.id)}
              >
                <Text style={[styles.tierLabel, selectedCategories.includes(cat.id) && { color: GOLD }]}>{cat.label}</Text>
                <Text style={styles.tierDesc}>{cat.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}

      <TouchableOpacity style={[styles.primaryBtn, { marginTop: 24 }]} onPress={() => setStep(4)} disabled={!serviceType || (serviceType === 'car' && selectedCategories.length === 0)}>
        <Text style={styles.primaryBtnText}>Continue</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {step === 1 && renderStep1()}
        {step === 3 && renderStep3()}
        {/* Other steps simplified for brevity */}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  stepContent: { padding: 20, paddingBottom: 40 },
  stepTitle: { fontSize: 24, fontWeight: '900', color: TEXT },
  stepSubtitle: { fontSize: 14, color: MUTED, marginBottom: 20 },
  label: { color: MUTED, fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginBottom: 8 },
  inputWrap: { height: 52, backgroundColor: CARD, borderRadius: 12, paddingHorizontal: 16, marginBottom: 16, justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  input: { color: TEXT, fontSize: 15 },
  primaryBtn: { height: 56, backgroundColor: GOLD, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  serviceCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: BORDER, marginBottom: 10, backgroundColor: CARD },
  serviceLabel: { fontSize: 16, fontWeight: '800', color: TEXT },
  serviceDesc: { fontSize: 12, color: MUTED, marginTop: 2 },
  tierGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tierCard: { width: '48%', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  tierLabel: { fontSize: 14, fontWeight: '800', color: TEXT },
  tierDesc: { fontSize: 11, color: MUTED, marginTop: 4 },
  errorText: { color: RED, fontSize: 13, textAlign: 'center', marginBottom: 16 },
  uploadRow: { flexDirection: 'row', gap: 10 },
  uploadBtn: { flex: 1, height: 60, borderRadius: 12, borderStyle: 'dashed', borderWidth: 1, borderColor: BORDER, alignItems: 'center', justifyContent: 'center', gap: 4 },
  uploadedRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderRadius: 12, backgroundColor: GOLD + '10', borderWidth: 1, borderColor: GOLD + '40' },
  uploadThumb: { width: 40, height: 40, borderRadius: 8 },
});
