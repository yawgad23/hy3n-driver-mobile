import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useDriverAuth } from '@/lib/driver-auth-context';
import { openDriverSupportWhatsApp } from '@/lib/support-whatsapp';

const GOLD = '#D4AF37'; const BG = '#0A0A0A'; const CARD = '#111111'; const BORDER = '#2A2A2A'; const TEXT = '#FAFAFA'; const MUTED = '#9CA3AF'; const GREEN = '#22C55E';
const TOPICS = [
  { label: 'Trip issue', value: 'trip' },
  { label: 'Payment & earnings', value: 'payment' },
  { label: 'Account & documents', value: 'account' },
  { label: 'Safety issue', value: 'safety' },
  { label: 'Technical issue', value: 'technical' },
  { label: 'Other', value: 'other' },
] as const;

type SupportCategory = (typeof TOPICS)[number]['value'];

export default function DriverSupportScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useDriverAuth();
  const [topic, setTopic] = useState<SupportCategory>('trip');
  const [message, setMessage] = useState('');

  const openWhatsApp = (text: string) => openDriverSupportWhatsApp(text).catch(() => {
    Alert.alert('WhatsApp unavailable', 'This device could not open WhatsApp. Please call HY3N Support on 055 727 8990.');
  });

  const submit = () => {
    if (message.trim().length < 10) {
      Alert.alert('More details needed', 'Please describe the issue in at least a few words so HY3N Support can help.');
      return;
    }
    const selectedTopic = TOPICS.find((item) => item.value === topic);
    openWhatsApp([
      'HY3N DRIVER SUPPORT',
      `Topic: ${selectedTopic?.label || 'Driver support request'}`,
      `Driver: ${user?.displayName || user?.uid || 'Driver'}`,
      '',
      message.trim(),
    ].join('\n'));
  };

  return <View style={[styles.container, { paddingTop: insets.top }]}>
    <View style={styles.header}><TouchableOpacity style={styles.backButton} onPress={() => router.back()}><MaterialIcons name="arrow-back" size={22} color={TEXT} /></TouchableOpacity><View><Text style={styles.headerTitle}>Driver support</Text><Text style={styles.headerSub}>We are here to help</Text></View></View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.contactCard}><View style={{ flex: 1 }}><Text style={styles.contactTitle}>Need immediate help?</Text><Text style={styles.contactText}>Message our Driver Support team on WhatsApp, or call emergency services if anyone is in danger.</Text></View><TouchableOpacity style={styles.whatsapp} onPress={() => openWhatsApp('Hi HY3N Support, I need driver assistance.')}><MaterialIcons name="chat" size={20} color="#000" /><Text style={styles.whatsappText}>Chat</Text></TouchableOpacity></View>
      <Text style={styles.sectionTitle}>Message support on WhatsApp</Text>
      <Text style={styles.label}>What can we help with?</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.topics}>{TOPICS.map((item) => <TouchableOpacity key={item.value} style={[styles.topic, topic === item.value && styles.topicActive]} onPress={() => setTopic(item.value)}><Text style={[styles.topicText, topic === item.value && styles.topicTextActive]}>{item.label}</Text></TouchableOpacity>)}</ScrollView>
      <Text style={styles.label}>Describe the issue</Text><TextInput style={styles.messageInput} value={message} onChangeText={setMessage} multiline textAlignVertical="top" placeholder="Include the ride details, time, or payment reference if relevant." placeholderTextColor="#6B7280" maxLength={1200} />
      <Text style={styles.counter}>{message.length}/1200</Text><TouchableOpacity style={styles.submitButton} onPress={submit}><MaterialIcons name="chat" size={19} color="#000" /><Text style={styles.submitText}>Continue in WhatsApp</Text></TouchableOpacity>
      <Text style={styles.whatsappHint}>Your topic and message will be prefilled in the HY3N Support WhatsApp chat.</Text>
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG }, header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: BORDER }, backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: TEXT, fontSize: 21, fontWeight: '900' }, headerSub: { color: MUTED, fontSize: 12, marginTop: 2 }, content: { padding: 16, paddingBottom: 44 }, contactCard: { flexDirection: 'row', gap: 13, padding: 15, backgroundColor: '#1A1400', borderWidth: 1, borderColor: '#3A2E00', borderRadius: 15 }, contactTitle: { color: '#FDE68A', fontSize: 14, fontWeight: '900' }, contactText: { color: '#D6C784', fontSize: 12, lineHeight: 17, marginTop: 4 }, whatsapp: { alignSelf: 'center', flexDirection: 'row', gap: 5, backgroundColor: GOLD, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 10 }, whatsappText: { color: '#000', fontWeight: '900', fontSize: 12 }, sectionTitle: { color: TEXT, fontSize: 17, fontWeight: '900', marginTop: 25, marginBottom: 15 }, label: { color: MUTED, fontSize: 11, fontWeight: '900', letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 8 }, topics: { gap: 8, paddingBottom: 4 }, topic: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 9 }, topicActive: { backgroundColor: '#1A1400', borderColor: GOLD }, topicText: { color: MUTED, fontSize: 12, fontWeight: '700' }, topicTextActive: { color: GOLD }, messageInput: { minHeight: 130, backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 12, padding: 13, color: TEXT, fontSize: 14 }, counter: { color: MUTED, fontSize: 11, textAlign: 'right', marginTop: 6 }, submitButton: { height: 52, backgroundColor: GOLD, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 14 }, submitText: { color: '#000', fontSize: 14, fontWeight: '900' }, whatsappHint: { color: MUTED, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 16 },
});
