import { router } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import type { ContactMethod } from '@/api/types';
import { BigButton, Card, Checkbox, Input, Label, Pill, ResidentScreen } from '@/components/resident';
import { ErrorBanner, success, type IconName } from '@/components/ui';
import { currentPlace, locationAllowed, LocationError, type Place } from '@/lib/location';
import { useSendRequest } from '@/services/requests';
import { useTheme } from '@/theme/tokens';

const METHODS: { value: ContactMethod; label: string; icon?: IconName }[] = [
  { value: 'call', label: 'Call', icon: 'call-outline' },
  { value: 'text', label: 'Text', icon: 'chatbox-outline' },
  { value: 'none', label: 'Don’t contact me' },
];

/** Get help (Figma A2): what's going on, where, and how (or whether) to reach them. */
export default function GetHelpScreen() {
  const theme = useTheme();
  const send = useSendRequest();
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [method, setMethod] = useState<ContactMethod>('call');
  const [phone, setPhone] = useState('');
  // Off until they say so: a voicemail can put someone at risk.
  const [safe, setSafe] = useState(false);
  const [tried, setTried] = useState(false);
  // Where the device says they are, while the field still shows that place.
  const [place, setPlace] = useState<Place | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const typed = useRef(location);
  useEffect(() => {
    typed.current = location;
  }, [location]);

  const locate = async ({ quiet = false } = {}) => {
    setLocating(true);
    setLocationError(null);
    try {
      const found = await currentPlace();
      // A quiet fill never overwrites what they've started typing.
      if (quiet && typed.current.trim()) return;
      setPlace(found);
      setLocation(found.label);
    } catch (e) {
      if (!quiet) setLocationError(e instanceof LocationError ? e.message : 'Couldn’t find your location. Type where you are instead.');
    } finally {
      setLocating(false);
    }
  };

  // Already allowed (no prompt): fill it in straight away.
  useEffect(() => {
    let active = true;
    locationAllowed().then((allowed) => {
      if (active && allowed) locate({ quiet: true });
    });
    return () => {
      active = false;
    };
  }, []);

  const editLocation = (text: string) => {
    setLocation(text);
    // They typed another place: the device's coordinates no longer describe it.
    if (place && text !== place.label) setPlace(null);
  };

  const reachable = method === 'none' || phone.trim().length >= 7;
  const ready = description.trim().length > 0 && reachable;

  const submit = () => {
    setTried(true);
    if (!ready) return;
    send.mutate(
      {
        description: description.trim(),
        location: location.trim() || null,
        latitude: place?.latitude ?? null,
        longitude: place?.longitude ?? null,
        contact_method: method,
        contact_phone: method === 'none' ? null : phone.trim(),
        safe_to_contact: method === 'none' ? null : safe,
      },
      {
        onSuccess: ({ request }) => {
          success();
          router.replace({ pathname: '/help/received', params: { id: request.id, number: String(request.number), method } });
        },
      },
    );
  };

  return (
    <ResidentScreen
      title="Get help"
      footer={
        // Feedback sits by the button: the fields it points at may be scrolled
        // out of view (or under the keyboard), which made a failed send look
        // like the button did nothing.
        <View style={{ gap: 8 }}>
          {send.error ? <ErrorBanner error={send.error} /> : null}
          {tried && !ready && !send.error ? (
            <Hint>{!description.trim() ? 'Tell us what’s going on first.' : `Add a phone number, or choose “Don’t contact me”.`}</Hint>
          ) : null}
          <BigButton label="Send request" onPress={submit} loading={send.isPending} />
        </View>
      }
    >
      <Text style={{ fontSize: 14, color: theme.textSecondary }}>Answer what you can. Everything else is optional.</Text>

      <Card tone="danger" style={{ paddingVertical: 12 }}>
        <Text style={{ fontSize: 14, color: theme.text }}>
          <Text style={{ fontWeight: '700', color: theme.red }}>In danger right now? </Text>
          Call 911 first.
        </Text>
      </Card>

      <View style={{ gap: 6 }}>
        <Input
          label="What’s going on?"
          value={description}
          onChangeText={setDescription}
          placeholder="Tell us what happened and what you need."
          multiline
          maxLength={4000}
          autoFocus
        />
        {tried && !description.trim() ? <Hint>Tell us a little about what’s going on.</Hint> : null}
      </View>

      <View style={{ gap: 8 }}>
        <Input
          label="Where are you?"
          icon="location-outline"
          value={location}
          onChangeText={editLocation}
          placeholder={locating ? 'Finding your location…' : 'Address, intersection or landmark'}
          maxLength={300}
          autoComplete="street-address"
        />
        {place ? (
          <Text style={{ fontSize: 13, color: theme.textSecondary, paddingHorizontal: 2 }}>
            From your current location. Staff will see the exact spot.
          </Text>
        ) : (
          <Pill
            label={locating ? 'Finding your location…' : 'Use my current location'}
            icon="navigate-outline"
            onPress={locating ? undefined : () => locate()}
          />
        )}
        {locationError ? <Hint>{locationError}</Hint> : null}
      </View>

      <View style={{ gap: 8 }}>
        <Label>How can we reach you?</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {METHODS.map((m) => (
            <Pill key={m.value} label={m.label} icon={m.icon} selected={method === m.value} onPress={() => setMethod(m.value)} />
          ))}
        </View>
      </View>

      {method === 'none' ? (
        <Text style={{ fontSize: 14, color: theme.textSecondary }}>
          We won’t call or text. Check “My requests” on this phone for updates from ComForce.
        </Text>
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Input
              label="Phone"
              icon="call-outline"
              value={phone}
              onChangeText={setPhone}
              placeholder="(414) 555-0142"
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={40}
            />
            {tried && !reachable ? <Hint>Add a number so we can {method === 'text' ? 'text' : 'call'} you.</Hint> : null}
          </View>
          <Checkbox
            label={method === 'text' ? 'It’s safe to text this number' : 'It’s safe to call or leave a voicemail'}
            checked={safe}
            onChange={setSafe}
          />
        </>
      )}

    </ResidentScreen>
  );
}

function Hint({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ fontSize: 13, color: theme.danger, paddingHorizontal: 2 }}>{children}</Text>;
}
