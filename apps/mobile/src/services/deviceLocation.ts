import * as Location from 'expo-location';
import { useState } from 'react';

export type DeviceLocation = { latitude: number; longitude: number };

export function useDeviceLocation() {
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = async () => {
    setLoading(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Location permission is needed to calculate nearby alerts.');
        return;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ latitude: result.coords.latitude, longitude: result.coords.longitude });
    } catch {
      setError('Your location is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  return { location, loading, error, locate };
}
