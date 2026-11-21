/**
 * Every call button goes through callPhone(). Emergency numbers only dial
 * for real in a production release build; in Expo Go, dev and staging builds
 * the button shows what it would do instead, so testing never calls 911.
 */
import Constants from 'expo-constants';
import { Alert, Linking, Platform } from 'react-native';

const EMERGENCY = new Set(['911', '112']);

/** A release build of the production variant (app.config.ts sets `extra.variant`). */
export const IS_PRODUCTION = !__DEV__ && Constants.expoConfig?.extra?.variant === 'production';

export function isEmergencyNumber(number: string) {
  return EMERGENCY.has(number.replace(/[^\d]/g, ''));
}

export function callPhone(number: string) {
  const digits = number.replace(/[^\d+]/g, '');
  if (isEmergencyNumber(digits) && !IS_PRODUCTION) {
    const message = `This would call ${digits}. Emergency calls only dial in the production app.`;
    if (Platform.OS === 'web') window.alert(message);
    else Alert.alert('Test build', message);
    return;
  }
  Linking.openURL(`tel:${digits}`);
}
