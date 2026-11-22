import * as Location from 'expo-location';
import { useCallback, useEffect, useState } from 'react';

import { locationAllowed } from '@/lib/location';

export type DeviceLocation = { latitude: number; longitude: number };

/**
 * The phone's position, for distances only; it never leaves the device.
 * `locate()` asks for permission. With `auto`, a screen that opens with
 * permission already given finds the position without asking again.
 */
export function useDeviceLocation({ auto = false }: { auto?: boolean } = {}) {
  const [location, setLocation] = useState<DeviceLocation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Location is off for this app. Turn it on in Settings to see distances.');
        return;
      }
      const result = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ latitude: result.coords.latitude, longitude: result.coords.longitude });
    } catch {
      setError('We can’t find your location right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    let live = true;
    locationAllowed().then((allowed) => {
      if (allowed && live) void locate();
    });
    return () => {
      live = false;
    };
  }, [auto, locate]);

  return { location, loading, error, locate };
}
