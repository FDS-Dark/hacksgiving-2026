/**
 * Building blocks for the resident app. ResidentScreen is the full-screen
 * page for flows pushed over the tabs (get help, a request, a place): they
 * work signed in or out, so they carry their own bar with back, a title,
 * and the red Quick exit that every resident screen has.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CaseCategory, CaseStatus } from '@/api/types';
import { tap, type IconName } from '@/components/ui';
import { quickExit } from '@/lib/quickExit';
import { requestStanding } from '@/lib/requestStatus';
import { space, useTheme, type Theme } from '@/theme/tokens';

/** Resident screens are phone-shaped; on a wide screen they sit in a column. */
const COLUMN = 560;

// ── Screen ──────────────────────────────────────────────────────────────

export function ResidentScreen({
  title,
  back = true,
  footer,
  children,
  refreshing,
  onRefresh,
  contentStyle,
}: {
  title?: string;
  back?: boolean;
  /** Pinned under the scrolling body (the main button). */
  footer?: ReactNode;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Pinned above the scroll body. The title shrinks and truncates; Quick exit keeps its width. */}
      <View style={[styles.bar, styles.column, { paddingTop: insets.top + space.sm }]}>
        {back ? <BackButton fallback="/" /> : null}
        <View style={styles.titleSlot}>
          {title ? (
            <Text style={[styles.barTitle, { color: theme.text }]} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </View>
        <QuickExitButton />
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.body, styles.column, { flexGrow: 1 }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} /> : undefined
        }
      >
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.column, styles.footer, { paddingBottom: insets.bottom + space.md }]}>{footer}</View>
      ) : (
        <View style={{ height: insets.bottom }} />
      )}
    </KeyboardAvoidingView>
  );
}

/** A 44 pt back chevron: back if there is history, else `fallback` (a link opened cold). */
function BackButton({ fallback }: { fallback: Href }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="chevron-back" size={24} color={theme.text} />
    </Pressable>
  );
}

/**
 * Leaves for a weather site at once (lib/quickExit.ts). It never shrinks
 * or wraps, so at 320 pt and large text the title next to it gives way.
 */
export function QuickExitButton() {
  const theme = useTheme();
  return (
    <Pressable
      onPress={quickExit}
      accessibilityRole="button"
      accessibilityLabel="Quick exit"
      accessibilityHint="Hides this app and opens a weather site"
      style={({ pressed }) => [styles.exit, { backgroundColor: theme.red }, pressed && { opacity: 0.8 }]}
    >
      <Ionicons name="close" size={16} color="#FFFFFF" />
      <Text style={styles.exitLabel} numberOfLines={1}>
        Quick exit
      </Text>
    </Pressable>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────

export function Card({ children, tone = 'plain', style }: { children: ReactNode; tone?: 'plain' | 'danger' | 'accent'; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const look =
    tone === 'danger'
      ? { backgroundColor: theme.dangerSoft, borderColor: 'transparent' }
      : tone === 'accent'
        ? { backgroundColor: theme.accentSoft, borderColor: 'transparent' }
        : { backgroundColor: theme.surface, borderColor: theme.separator };
  return <View style={[styles.card, look, style]}>{children}</View>;
}

/** The mockup's 52pt buttons: filled green, or outlined. */
export function BigButton({
  label,
  onPress,
  variant = 'filled',
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'filled' | 'outline';
  loading?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const filled = variant === 'filled';
  const inactive = loading || disabled;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.bigButton,
        filled
          ? { backgroundColor: theme.accent }
          : { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1.5 },
        pressed && { opacity: 0.75 },
        disabled && !loading && { opacity: 0.45 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={filled ? theme.onAccent : theme.text} />
      ) : (
        <Text style={[styles.bigButtonLabel, { color: filled ? theme.onAccent : theme.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Label({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[styles.label, { color: theme.textSecondary }]}>{children}</Text>;
}

/** A labelled white input, optionally with an icon. */
export function Input({ label, icon, style, ...rest }: TextInputProps & { label: string; icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <View style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.separator }, rest.multiline && styles.inputTall]}>
        {icon ? <Ionicons name={icon} size={18} color={theme.accent} style={rest.multiline ? { marginTop: 1 } : undefined} /> : null}
        <TextInput
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          accessibilityLabel={label}
          {...rest}
          style={[styles.inputText, { color: theme.text }, rest.multiline && { minHeight: 68, textAlignVertical: 'top' }, style]}
        />
      </View>
    </View>
  );
}

/** A round choice or quick-reply chip. */
export function Pill({
  label,
  icon,
  selected = false,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  icon?: IconName;
  selected?: boolean;
  onPress?: () => void;
  /** neutral: grey until selected. light: white with green text (on a green card). */
  tone?: 'neutral' | 'light';
}) {
  const theme = useTheme();
  const bg = selected ? theme.accent : tone === 'light' ? theme.surface : theme.fill;
  const fg = selected ? theme.onAccent : tone === 'light' ? theme.accent : theme.text;
  return (
    <Pressable
      onPress={
        onPress
          ? () => {
              tap();
              onPress();
            }
          : undefined
      }
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={label}
      accessibilityState={onPress ? { selected } : undefined}
      style={({ pressed }) => [styles.pill, { backgroundColor: bg }, pressed && { opacity: 0.7 }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={fg} /> : null}
      <Text style={[styles.pillLabel, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => {
        tap();
        onChange(!checked);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={styles.checkRow}
    >
      <View
        style={[
          styles.checkbox,
          checked ? { backgroundColor: theme.accent, borderColor: theme.accent } : { backgroundColor: theme.surface, borderColor: theme.separator },
        ]}
      >
        {checked ? <Ionicons name="checkmark" size={16} color={theme.onAccent} /> : null}
      </View>
      <Text style={[styles.checkLabel, { color: theme.text }]}>{label}</Text>
    </Pressable>
  );
}

// ── Status and labels ───────────────────────────────────────────────────

const STATUS_LABELS: Record<CaseStatus, string> = {
  new: 'Received',
  in_progress: 'In progress',
  awaiting_resources: 'Waiting on a partner',
  resolved: 'Resolved',
  closed: 'Closed',
};

function statusColors(theme: Theme, status: CaseStatus) {
  switch (status) {
    case 'in_progress':
      return { bg: theme.infoSoft, fg: theme.info };
    case 'awaiting_resources':
      return { bg: theme.warningSoft, fg: theme.soon };
    case 'resolved':
      return { bg: theme.accentSoft, fg: theme.accent };
    default:
      return { bg: theme.fill, fg: theme.textSecondary };
  }
}

export function StatusChip({ status }: { status: CaseStatus }) {
  const theme = useTheme();
  const { bg, fg } = statusColors(theme, status);
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillLabel, { color: fg }]}>{STATUS_LABELS[status]}</Text>
    </View>
  );
}

/** What a resident would call each kind of help. */
const HELP_LABELS: Record<CaseCategory, string> = {
  homelessness: 'Housing help',
  meal_programs: 'Food help',
  transportation: 'A ride',
  violence_prevention: 'Safety help',
  incident_deescalation: 'Calming a situation',
  missing_persons: 'Someone missing',
  burial_assistance: 'Burial help',
  bridge_to_employment: 'Jobs and training',
  other: 'Request for help',
};

export function requestHeading(request: { category: CaseCategory; number: number }) {
  return `${HELP_LABELS[request.category]} · #${request.number}`;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "6:12 PM" today, "Nov 19, 6:12 PM" before. */
export function when(iso: string) {
  const date = new Date(iso);
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return sameDay(date, new Date()) ? time : `${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/** "Opened today, 6:12 PM". */
export function opened(iso: string) {
  return sameDay(new Date(iso), new Date()) ? `Opened today, ${when(iso)}` : `Opened ${when(iso)}`;
}

/** "Updated 10 min ago". */
export function updatedAgo(iso: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Updated ${hours} h ago`;
  return `Updated ${when(iso)}`;
}

/** Still being worked on (not resolved or closed). */
export function isOpenStatus(status: CaseStatus) {
  return status === 'new' || status === 'in_progress' || status === 'awaiting_resources';
}

/** Who a request is waiting on and what happens next (lib/requestStatus.ts), on lists and the request screen. */
export function WaitingOn({ request }: { request: Parameters<typeof requestStanding>[0] }) {
  const theme = useTheme();
  const { owner, next } = requestStanding(request);
  return (
    <View style={{ gap: 2 }} accessible accessibilityLabel={`${owner}. ${next}`}>
      <Text style={[styles.owner, { color: theme.text }]}>{owner}</Text>
      <Text style={[styles.next, { color: theme.textSecondary }]}>{next}</Text>
    </View>
  );
}

/** "Sample listing": on directory entries made up for the demo, not real partners. */
export function SampleTag() {
  const theme = useTheme();
  return (
    <View style={[styles.sample, { backgroundColor: theme.fill }]}>
      <Text style={[styles.sampleText, { color: theme.textSecondary }]}>Sample listing</Text>
    </View>
  );
}

/**
 * The top of a resident screen under the tab bar (Home, Requests, Nearby,
 * Me, Safety map, Alerts): a large title, an optional kicker above it, and
 * Quick exit on the right. Pass it as Page's `header` so it stays pinned.
 * `back` adds a Back chevron, going to that route when there's no history.
 */
export function ResidentHeader({ title, kicker, back }: { title: string; kicker?: string; back?: Href }) {
  const theme = useTheme();
  return (
    <View style={styles.tabHeader}>
      {back ? <BackButton fallback={back} /> : null}
      <View style={styles.titleSlot}>
        {kicker ? <Text style={[styles.kicker, { color: theme.accent }]}>{kicker}</Text> : null}
        <Text style={[styles.tabTitle, { color: theme.text }]} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
      </View>
      <QuickExitButton />
    </View>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: COLUMN, alignSelf: 'center' },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 20, paddingBottom: 10 },
  barTitle: { fontSize: 20, fontWeight: '800' },
  titleSlot: { flex: 1, minWidth: 0, gap: 2 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -10, flexShrink: 0 },
  body: { paddingHorizontal: 20, paddingTop: space.md, paddingBottom: space.lg, gap: 16 },
  footer: { paddingHorizontal: 20, paddingTop: space.sm },
  exit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  exitLabel: { color: '#FFFFFF', fontSize: 14, fontWeight: '700', flexShrink: 0 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  bigButton: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  bigButtonLabel: { fontSize: 16, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600' },
  input: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  inputTall: { alignItems: 'flex-start', paddingVertical: 4 },
  inputText: { flex: 1, fontSize: 15, paddingVertical: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillLabel: { fontSize: 13, fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: '500' },
  owner: { fontSize: 14, fontWeight: '700' },
  next: { fontSize: 14, lineHeight: 19 },
  sample: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  sampleText: { fontSize: 11, fontWeight: '600' },
  tabHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  tabTitle: { fontSize: 28, fontWeight: '800' },
});
