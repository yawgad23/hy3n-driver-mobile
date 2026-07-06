import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { firebaseAuth } from '@/lib/firebase';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#1A1A1A';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';

export default function DriverForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async () => {
    if (!email.trim()) { Alert.alert('Error', 'Please enter your email address'); return; }
    setLoading(true);
    try {
      await firebaseAuth.resetPassword(email.trim());
      setSent(true);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.inner}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.title}>Reset Password</Text>
        <Text style={styles.subtitle}>Enter your email and we'll send you a reset link</Text>

        {sent ? (
          <View style={styles.successCard}>
            <MaterialIcons name="check-circle" size={48} color="#22C55E" />
            <Text style={styles.successTitle}>Email Sent!</Text>
            <Text style={styles.successText}>Check your inbox for the password reset link.</Text>
            <TouchableOpacity style={styles.backToLoginBtn} onPress={() => router.push('/login' as any)}>
              <Text style={styles.backToLoginText}>Back to Login</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.label}>Email Address</Text>
            <View style={styles.inputWrap}>
              <MaterialIcons name="email" size={18} color={MUTED} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor={MUTED}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleReset}
              />
            </View>
            <TouchableOpacity style={[styles.resetBtn, loading && { opacity: 0.7 }]} onPress={handleReset} disabled={loading} activeOpacity={0.85}>
              {loading ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.resetBtnText}>Send Reset Link</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  inner: { flex: 1, paddingHorizontal: 24, paddingTop: 64 },
  backBtn: { marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '800', color: TEXT, marginBottom: 8 },
  subtitle: { fontSize: 14, color: MUTED, marginBottom: 28, lineHeight: 20 },
  card: { backgroundColor: CARD, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: BORDER },
  label: { color: MUTED, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111', borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, height: 48, marginBottom: 16 },
  input: { flex: 1, color: TEXT, fontSize: 15 },
  resetBtn: { backgroundColor: GOLD, borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  resetBtnText: { color: '#000', fontSize: 16, fontWeight: '800' },
  successCard: { backgroundColor: CARD, borderRadius: 20, padding: 28, borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: 12 },
  successTitle: { fontSize: 22, fontWeight: '800', color: TEXT },
  successText: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
  backToLoginBtn: { backgroundColor: GOLD, borderRadius: 12, paddingHorizontal: 32, paddingVertical: 14, marginTop: 8 },
  backToLoginText: { color: '#000', fontSize: 15, fontWeight: '800' },
});
