/**
 * Every call button goes through callPhone(). The app never dials an
 * emergency number, in any build: the screens tell people to call 911
 * themselves, and callPhone('911') only says so.
 */
import { Alert, Linking, Platform } from 'react-native';

const EMERGENCY = new Set(['911', '112']);

export function isEmergencyNumber(number: string) {
  return EMERGENCY.has(number.replace(/[^\d]/g, ''));
}

export function callPhone(number: string) {
  const digits = number.replace(/[^\d+]/g, '');
  if (isEmergencyNumber(digits)) {
    const message = `Call ${digits} from your phone. This app doesn't place emergency calls.`;
    if (Platform.OS === 'web') window.alert(message);
    else Alert.alert(`Call ${digits}`, message);
    return;
  }
  Linking.openURL(`tel:${digits}`);
}
