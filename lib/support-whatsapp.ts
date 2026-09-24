import { Linking } from 'react-native';

/** Verified HY3N Driver support WhatsApp number: 055 727 8990. */
export const HY3N_SUPPORT_WHATSAPP_NUMBER = '233557278990';

export function getDriverSupportWhatsAppUrl(message: string) {
  return `https://wa.me/${HY3N_SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** Opens the existing HY3N support chat with a contextual prefilled message. */
export function openDriverSupportWhatsApp(message: string) {
  return Linking.openURL(getDriverSupportWhatsAppUrl(message));
}
