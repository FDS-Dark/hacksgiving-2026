/**
 * "Where are you?" from the device's location. Phones turn the position into
 * a street address with their own geocoder (expo-location). Expo has no
 * reverse geocoding on the web, and we don't send anyone's location to a
 * third party, so the web reads "Near 43.0712, -87.9531". Either way the
 * exact coordinates go to staff with the request.
 */
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface Place {
  /** What goes in the "Where are you?" field. */
  label: string;
  latitude: number;
  longitude: number;
}

export class LocationError extends Error {}

/** True when the app may already read the location (no prompt needed). */
export async function locationAllowed(): Promise<boolean> {
  try {
    return (await Location.getForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Asks for permission if needed, then finds the person's position and address. */
export async function currentPlace(): Promise<Place> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new LocationError('Location is off for this app. Type where you are instead.');
  }

  let position: Location.LocationObject | null = null;
  try {
    // A fix from the last minute is quick and good enough for an address.
    position = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
    position ??= await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    position = null;
  }
  if (!position) throw new LocationError('Couldn’t find your location. Type where you are instead.');

  const { latitude, longitude } = position.coords;
  return { label: (await addressAt(latitude, longitude)) ?? near(latitude, longitude), latitude, longitude };
}

function near(latitude: number, longitude: number) {
  return `Near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

/** "1234 N 35th St, Milwaukee", or null where there's no geocoder (web) or no answer. */
async function addressAt(latitude: number, longitude: number): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!place) return null;
    const street = [place.streetNumber, place.street].filter(Boolean).join(' ') || place.name;
    const label = [street, place.city ?? place.district].filter(Boolean).join(', ');
    return label || place.formattedAddress || null;
  } catch {
    return null;
  }
}
