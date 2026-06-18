/**
 * InCallScreen — Full-screen in-call UI for HY3N (React Native)
 * Ported from web app's InCallScreen.jsx
 */
import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  StatusBar, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { VoiceCallHook } from '@/hooks/use-voice-call';

const GOLD = '#D4AF37';
const GREEN = '#22C55E';
const RED = '#EF4444';

interface InCallScreenProps {
  call: VoiceCallHook;
  otherName?: string;
  otherRole?: string;
  /** Phone number for mobile-network fallback */
  otherPhone?: string;
}

export function InCallScreen({ call, otherName, otherRole = 'rider', otherPhone }: InCallScreenProps) {
  const insets = useSafeAreaInsets();
  const { status, isMuted, isSpeaker, formattedDuration, callError, endCall, toggleMute, toggleSpeaker } = call;

  const isVisible = status === 'calling' || status === 'active' || status === 'answering';
  if (!isVisible) return null;

  const isCalling = status === 'calling';
  const initial = (otherName || otherRole)[0]?.toUpperCase() || '?';

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent>
      <StatusBar barStyle="light-content" backgroundColor="#0f2027" />
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        {/* Top section */}
        <View style={styles.top}>
          <View style={styles.avatarRing}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          </View>
          <Text style={styles.name}>{otherName || (otherRole === 'driver' ? 'Driver' : 'Rider')}</Text>
          <Text style={styles.role}>{otherRole}</Text>

          <View style={styles.statusRow}>
            {isCalling ? (
              <>
                <View style={styles.pulseDot} />
                <Text style={styles.callingText}>Calling...</Text>
              </>
            ) : (
              <Text style={styles.timer}>{formattedDuration}</Text>
            )}
          </View>

          {!!callError && <Text style={styles.errorText}>{callError}</Text>}
        </View>

        {/* Bottom controls */}
        <View style={styles.controls}>
          {/* Mute */}
          <View style={styles.controlItem}>
            <TouchableOpacity
              style={[styles.controlBtn, isMuted && styles.controlBtnActive]}
              onPress={toggleMute}
            >
              <MaterialIcons name={isMuted ? 'mic-off' : 'mic'} size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
          </View>

          {/* End call */}
          <View style={styles.controlItem}>
            <TouchableOpacity style={styles.endBtn} onPress={endCall}>
              <MaterialIcons name="call-end" size={30} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.controlLabel}>End</Text>
          </View>

          {/* Speaker */}
          <View style={styles.controlItem}>
            <TouchableOpacity
              style={[styles.controlBtn, isSpeaker && styles.controlBtnSpeaker]}
              onPress={toggleSpeaker}
            >
              <MaterialIcons name={isSpeaker ? 'volume-up' : 'volume-off'} size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.controlLabel}>Speaker</Text>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** IncomingCallModal — shown when a call arrives */
interface IncomingCallModalProps {
  call: VoiceCallHook;
  otherName?: string;
  otherRole?: string;
}

export function IncomingCallModal({ call, otherName, otherRole = 'rider' }: IncomingCallModalProps) {
  const insets = useSafeAreaInsets();
  const { isIncoming, status, callerName, acceptCall, declineCall } = call;

  if (!isIncoming || status !== 'ringing') return null;

  const displayName = callerName || otherName || (otherRole === 'driver' ? 'Driver' : 'Rider');
  const initial = displayName[0]?.toUpperCase() || '?';

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent>
      <View style={[incomingStyles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={incomingStyles.card}>
          <Text style={incomingStyles.label}>Incoming call from</Text>
          <View style={incomingStyles.avatar}>
            <Text style={incomingStyles.avatarText}>{initial}</Text>
          </View>
          <Text style={incomingStyles.name}>{displayName}</Text>
          <Text style={incomingStyles.role}>{otherRole}</Text>

          <View style={incomingStyles.buttons}>
            <TouchableOpacity style={incomingStyles.declineBtn} onPress={declineCall}>
              <MaterialIcons name="call-end" size={28} color="#fff" />
              <Text style={incomingStyles.btnLabel}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={incomingStyles.acceptBtn} onPress={acceptCall}>
              <MaterialIcons name="call" size={28} color="#fff" />
              <Text style={incomingStyles.btnLabel}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f2027',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  top: { alignItems: 'center', gap: 10, marginTop: 40 },
  avatarRing: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 2, borderColor: '#3B82F6',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  avatar: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(59,130,246,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 36, fontWeight: '800', color: '#93C5FD' },
  name: { fontSize: 26, fontWeight: '800', color: '#fff', marginTop: 8 },
  role: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textTransform: 'capitalize' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3B82F6' },
  callingText: { fontSize: 16, color: '#3B82F6', fontWeight: '500' },
  timer: { fontSize: 28, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontWeight: '600', color: GREEN },
  errorText: { color: RED, fontSize: 13, textAlign: 'center', marginTop: 8, paddingHorizontal: 20 },
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
    width: '100%',
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  controlItem: { alignItems: 'center', gap: 8 },
  controlBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlBtnActive: { backgroundColor: 'rgba(239,68,68,0.7)' },
  controlBtnSpeaker: { backgroundColor: 'rgba(59,130,246,0.7)' },
  controlLabel: { fontSize: 11, color: 'rgba(255,255,255,0.6)' },
  endBtn: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: RED, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.5, shadowRadius: 8,
    elevation: 8,
  },
});

const incomingStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    backgroundColor: '#0f2027',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.3)',
  },
  label: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  avatar: {
    width: 90, height: 90, borderRadius: 45,
    backgroundColor: 'rgba(59,130,246,0.25)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#3B82F6',
    marginVertical: 8,
  },
  avatarText: { fontSize: 34, fontWeight: '800', color: '#93C5FD' },
  name: { fontSize: 24, fontWeight: '800', color: '#fff' },
  role: { fontSize: 13, color: 'rgba(255,255,255,0.5)', textTransform: 'capitalize' },
  buttons: { flexDirection: 'row', gap: 32, marginTop: 24 },
  declineBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: RED,
    alignItems: 'center', justifyContent: 'center',
    gap: 4,
  },
  acceptBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: GREEN,
    alignItems: 'center', justifyContent: 'center',
    gap: 4,
  },
  btnLabel: { fontSize: 10, color: '#fff', fontWeight: '700' },
});
