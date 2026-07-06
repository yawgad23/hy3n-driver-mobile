import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Alert, ActivityIndicator, Image, Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { firestoreDB, COLLECTIONS, auth as firebaseAuthObj, firebaseStorage } from '@/lib/firebase';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const RED = '#EF4444';

interface DocSlot {
  key: string;
  label: string;
  firestoreField: string;
  required: boolean;
}

const DOC_SLOTS: DocSlot[] = [
  { key: 'ghana_card_front', label: 'Ghana Card (Front)', firestoreField: 'ghana_card_front_url', required: true },
  { key: 'ghana_card_back', label: 'Ghana Card (Back)', firestoreField: 'ghana_card_back_url', required: true },
  { key: 'license_front', label: "Driver's License (Front)", firestoreField: 'drivers_license_front_url', required: true },
  { key: 'license_back', label: "Driver's License (Back)", firestoreField: 'drivers_license_back_url', required: true },
  { key: 'selfie', label: 'Your Photo (Selfie)', firestoreField: 'profile_photo_url', required: true },
  { key: 'vehicle_photo', label: 'Vehicle Photo', firestoreField: 'vehicle_registration_url', required: true },
  { key: 'insurance', label: 'Insurance Certificate', firestoreField: 'insurance_url', required: false },
  { key: 'roadworthy', label: 'Roadworthy Certificate', firestoreField: 'roadworthy_url', required: false },
];

export default function ReuploadDocsScreen() {
  const insets = useSafeAreaInsets();
  const { driverProfile } = useDriverAuth();
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [changed, setChanged] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [profileDocId, setProfileDocId] = useState<string | null>(null);

  // Load existing document URLs from the driver profile
  useEffect(() => {
    if (!driverProfile) return;
    const initial: Record<string, string> = {};
    DOC_SLOTS.forEach(slot => {
      initial[slot.key] = (driverProfile as any)[slot.firestoreField] || '';
    });
    setDocs(initial);
  }, [driverProfile]);

  // Load the Firestore document ID for the driver profile
  useEffect(() => {
    const loadProfileId = async () => {
      const user = firebaseAuthObj.currentUser;
      if (!user) return;
      try {
        const existing = await firestoreDB.list(COLLECTIONS.DRIVER_PROFILES, { user_id: user.uid });
        if (existing.length > 0) setProfileDocId(existing[0].id);
      } catch {}
    };
    loadProfileId();
  }, []);

  const pickImage = async (key: string) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow access to your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setDocs(prev => ({ ...prev, [key]: result.assets[0].uri }));
      setChanged(prev => ({ ...prev, [key]: true }));
    }
  };

  const takePhoto = async (key: string) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Required', 'Please allow camera access.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      setDocs(prev => ({ ...prev, [key]: result.assets[0].uri }));
      setChanged(prev => ({ ...prev, [key]: true }));
    }
  };

  const handlePickDoc = (key: string) => {
    Alert.alert('Upload Document', 'Choose a source', [
      { text: 'Camera', onPress: () => takePhoto(key) },
      { text: 'Photo Library', onPress: () => pickImage(key) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const changedCount = Object.values(changed).filter(Boolean).length;

  const handleSubmit = async () => {
    if (changedCount === 0) {
      Alert.alert('No Changes', 'You have not replaced any documents yet.');
      return;
    }
    if (!profileDocId) {
      Alert.alert('Error', 'Could not find your driver profile. Please try again.');
      return;
    }

    setLoading(true);
    try {
      const user = firebaseAuthObj.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Helper to upload a file if it's a local URI
      const uploadIfLocal = async (uri: string, path: string) => {
        if (!uri || (!uri.startsWith('file://') && !uri.startsWith('content://'))) return uri;
        try {
          const response = await fetch(uri);
          const blob = await response.blob();
          return await firebaseStorage.uploadFile(blob, path);
        } catch (e) {
          console.error(`Failed to upload ${path}:`, e);
          return uri;
        }
      };

      // Build update object with only the changed fields
      const updates: Record<string, string> = {};
      
      // Upload changed documents in parallel
      const uploadPromises = DOC_SLOTS.map(async (slot) => {
        if (changed[slot.key]) {
          const uploadedUrl = await uploadIfLocal(docs[slot.key], `drivers/${user.uid}/${slot.key}.jpg`);
          updates[slot.firestoreField] = uploadedUrl;
        }
      });

      await Promise.all(uploadPromises);

      // Reset approval status to pending so admin sees the resubmission
      updates.approval_status = 'pending';
      updates.rejection_reason = '';

      await firestoreDB.update(COLLECTIONS.DRIVER_PROFILES, profileDocId, updates);

      Alert.alert(
        'Resubmitted!',
        'Your updated documents have been submitted. The admin will review your application within 24–48 hours.',
        [{ text: 'OK', onPress: () => router.replace('/home') }],
      );
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to submit. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={22} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Fix & Resubmit Documents</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {/* Info banner */}
        <View style={styles.infoBanner}>
          <MaterialIcons name="info" size={18} color={GOLD} />
          <Text style={styles.infoText}>
            Replace only the documents that need updating. Unchanged documents will be kept as-is.
            {changedCount > 0 ? ` (${changedCount} document${changedCount > 1 ? 's' : ''} updated)` : ''}
          </Text>
        </View>

        {/* Document slots */}
        {DOC_SLOTS.map(slot => {
          const uri = docs[slot.key] || '';
          const isChanged = changed[slot.key];
          return (
            <View key={slot.key} style={[styles.docCard, isChanged && styles.docCardChanged]}>
              <View style={styles.docCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docLabel}>
                    {slot.label}
                    {slot.required && <Text style={{ color: RED }}> *</Text>}
                  </Text>
                  {isChanged && (
                    <Text style={styles.changedBadge}>✓ Updated</Text>
                  )}
                  {!uri && !isChanged && (
                    <Text style={styles.missingBadge}>Not uploaded</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.replaceBtn, isChanged && styles.replaceBtnChanged]}
                  onPress={() => handlePickDoc(slot.key)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons
                    name={isChanged ? 'check' : 'upload'}
                    size={16}
                    color={isChanged ? BG : GOLD}
                  />
                  <Text style={[styles.replaceBtnText, isChanged && { color: BG }]}>
                    {isChanged ? 'Changed' : uri ? 'Replace' : 'Upload'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Thumbnail */}
              {uri ? (
                <TouchableOpacity
                  onPress={() => handlePickDoc(slot.key)}
                  activeOpacity={0.8}
                  style={styles.thumbContainer}
                >
                  <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                  <View style={styles.thumbOverlay}>
                    <MaterialIcons name="edit" size={20} color={TEXT} />
                    <Text style={styles.thumbOverlayText}>Tap to replace</Text>
                  </View>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.emptyThumb}
                  onPress={() => handlePickDoc(slot.key)}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="add-photo-alternate" size={32} color={MUTED} />
                  <Text style={styles.emptyThumbText}>Tap to upload</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        {/* Submit button */}
        <TouchableOpacity
          style={[styles.submitBtn, (loading || changedCount === 0) && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading || changedCount === 0}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator size="small" color={BG} />
          ) : (
            <>
              <MaterialIcons name="send" size={18} color={BG} />
              <Text style={styles.submitBtnText}>
                {changedCount === 0
                  ? 'Replace at least one document'
                  : `Resubmit ${changedCount} Updated Document${changedCount > 1 ? 's' : ''}`}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  infoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: GOLD + '18', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: GOLD + '40', marginBottom: 20,
  },
  infoText: { flex: 1, fontSize: 13, color: GOLD, lineHeight: 19 },
  docCard: {
    backgroundColor: CARD, borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: BORDER,
  },
  docCardChanged: { borderColor: GREEN + '80', backgroundColor: GREEN + '08' },
  docCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  docLabel: { fontSize: 14, fontWeight: '600', color: TEXT, marginBottom: 2 },
  changedBadge: { fontSize: 12, color: GREEN, fontWeight: '600' },
  missingBadge: { fontSize: 12, color: MUTED },
  replaceBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1, borderColor: GOLD, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  replaceBtnChanged: { backgroundColor: GREEN, borderColor: GREEN },
  replaceBtnText: { fontSize: 13, fontWeight: '600', color: GOLD },
  thumbContainer: { borderRadius: 10, overflow: 'hidden', position: 'relative' },
  thumb: { width: '100%', height: 140, borderRadius: 10 },
  thumbOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.55)', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8,
  },
  thumbOverlayText: { fontSize: 13, color: TEXT, fontWeight: '500' },
  emptyThumb: {
    height: 100, borderRadius: 10, borderWidth: 1.5, borderColor: BORDER,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  emptyThumbText: { fontSize: 13, color: MUTED },
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD, borderRadius: 14, paddingVertical: 16,
    marginTop: 8,
  },
  submitBtnDisabled: { opacity: 0.45 },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: BG },
});
