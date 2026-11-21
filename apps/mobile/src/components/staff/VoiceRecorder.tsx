import Ionicons from '@expo/vector-icons/Ionicons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Button, Notice, tap } from '@/components/ui';
import { space, type, useTheme } from '@/theme/tokens';

/** Speech, not music: mono at 64 kbps keeps a ten-minute debrief around 5 MB (.m4a). */
const SPEECH: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  numberOfChannels: 1,
  bitRate: 64_000,
  isMeteringEnabled: true,
};

/** Stops by itself here: the server and the transcription service cap length. */
export const MAX_RECORDING_MS = 10 * 60 * 1000;

const BARS = 24;

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Metering is in dBFS (about -60 quiet to 0 loud); 0..1 for the bars. */
function level(db: number | undefined) {
  if (db === undefined) return 0;
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/**
 * Figma "Recording": a big mic button, a timer and a level meter. When it
 * stops, the parent gets the file to upload (`onRecorded`).
 */
export function VoiceRecorder({ onRecorded, disabled = false }: { onRecorded: (uri: string, durationMs: number) => void; disabled?: boolean }) {
  const theme = useTheme();
  const recorder = useAudioRecorder(SPEECH);
  const state = useAudioRecorderState(recorder, 120);
  const [denied, setDenied] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [seenAt, setSeenAt] = useState(-1);
  const stopping = useRef(false);

  // Rolling level history for the meter: one bar per new reading (React's
  // "adjust state while rendering" pattern, so no effect re-renders twice).
  if (state.isRecording && state.durationMillis !== seenAt) {
    setSeenAt(state.durationMillis);
    setLevels((prev) => [...prev.slice(1), level(state.metering)]);
  }

  const stop = async () => {
    if (stopping.current) return;
    stopping.current = true;
    try {
      const duration = state.durationMillis;
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (recorder.uri) onRecorded(recorder.uri, duration);
    } finally {
      stopping.current = false;
    }
  };

  // Long enough: stop for them.
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= MAX_RECORDING_MS) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRecording, state.durationMillis]);

  const start = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setDenied(true);
      return;
    }
    setDenied(false);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setLevels(Array(BARS).fill(0));
  };

  const recording = state.isRecording;
  return (
    <View style={{ gap: space.lg, alignItems: 'center' }}>
      <Text style={[styles.clock, { color: recording ? theme.text : theme.textTertiary }]} accessibilityLiveRegion="polite">
        {clock(state.durationMillis)}
      </Text>

      <View style={styles.meter} accessible accessibilityLabel={recording ? 'Recording' : 'Not recording'}>
        {levels.map((v, i) => (
          <View key={i} style={[styles.bar, { height: 6 + v * 46, backgroundColor: recording ? theme.accent : theme.separator }]} />
        ))}
      </View>

      <Pressable
        onPress={() => {
          tap();
          void (recording ? stop() : start());
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
        style={({ pressed }) => [
          styles.mic,
          { backgroundColor: recording ? theme.danger : theme.accent },
          (pressed || disabled) && { opacity: 0.7 },
        ]}
      >
        <Ionicons name={recording ? 'stop' : 'mic'} size={36} color="#FFFFFF" />
      </Pressable>
      <Text style={[type.footnote, { color: theme.textSecondary }]}>
        {recording ? `Tap to stop · up to ${MAX_RECORDING_MS / 60000} minutes` : 'Tap to start talking'}
      </Text>

      {denied ? (
        <View style={{ gap: space.sm, alignSelf: 'stretch' }}>
          <Notice icon="mic-off-outline" tone="warning">
            The microphone is off for this app. Turn it on in Settings, or type the debrief instead.
          </Notice>
          <Button label="Open Settings" variant="plain" onPress={() => Linking.openSettings()} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  clock: { fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 56 },
  bar: { width: 5, borderRadius: 3 },
  mic: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
});
