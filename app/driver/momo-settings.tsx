import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';

const GOLD = '#D4AF37';
const BG = '#0A0A0A';
const CARD = '#111111';
const BORDER = '#2A2A2A';
const TEXT = '#FAFAFA';
const MUTED = '#9CA3AF';
const GREEN = '#22C55E';

export default function MoMoSettingsScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Back to profile">
          <MaterialIcons name="arrow-back" size={22} color={TEXT} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>MoMo & fee information</Text>
          <Text style={styles.headerSub}>How Driver payments work on HY3N</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.directCard}>
          <MaterialIcons name="payments" size={28} color={GREEN} />
          <Text style={styles.directTitle}>Riders pay you directly</Text>
          <Text style={styles.directText}>
            Cash and direct MoMo fares are paid to you by the Rider. HY3N does not hold these fares, so there is nothing to withdraw.
          </Text>
        </View>
        <View style={styles.infoCard}>
          <MaterialIcons name="event-repeat" size={24} color={GOLD} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Daily platform fee</Text>
            <Text style={styles.infoText}>
              The GH₵50 daily platform fee is handled separately through the Driver’s verified MoMo account. It is not deducted from a cash trip fare.
            </Text>
          </View>
        </View>
        <View style={styles.infoCard}>
          <MaterialIcons name="verified-user" size={24} color={GOLD} />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>Account safety</Text>
            <Text style={styles.infoText}>
              Never share your MoMo PIN or OTP. Contact HY3N support if your registered number needs to be changed.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: TEXT, fontSize: 20, fontWeight: '900' },
  headerSub: { color: MUTED, fontSize: 12, marginTop: 2 },
  content: { padding: 16, paddingBottom: 44, gap: 14 },
  directCard: { backgroundColor: '#052E16', borderWidth: 1, borderColor: '#14532D', borderRadius: 16, padding: 18, alignItems: 'flex-start' },
  directTitle: { color: '#BBF7D0', fontWeight: '900', fontSize: 18, marginTop: 12 },
  directText: { color: '#86EFAC', fontSize: 13, lineHeight: 19, marginTop: 6 },
  infoCard: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 15, padding: 15, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  infoTitle: { color: TEXT, fontSize: 15, fontWeight: '900' },
  infoText: { color: MUTED, fontSize: 12, lineHeight: 18, marginTop: 4 },
});
