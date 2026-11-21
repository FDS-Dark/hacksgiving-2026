/**
 * Building blocks for the ComForce worker portal (src/app/worker): badges,
 * cards, metric tiles, bar lists and pickers, in the brand tokens. Kept
 * apart from the community app's components so the two can change freely.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { CaseCategory, CasePriority, CaseStatus, ReferralStatus, Role } from '@/api/types';
import { tap, type IconName } from '@/components/ui';
import { SERIF, radius, space, type, useTheme, type Theme } from '@/theme/tokens';

// ── Labels ─────────────────────────────────────────────────────────────────

export const CATEGORY_LABEL: Record<CaseCategory, string> = {
  homelessness: 'Housing & shelter',
  meal_programs: 'Food & meals',
  transportation: 'Transportation',
  violence_prevention: 'Violence prevention',
  incident_deescalation: 'De-escalation',
  missing_persons: 'Missing persons',
  burial_assistance: 'Burial assistance',
  bridge_to_employment: 'Employment',
  other: 'Other',
};

export const CATEGORY_ICON: Record<CaseCategory, IconName> = {
  homelessness: 'home-outline',
  meal_programs: 'restaurant-outline',
  transportation: 'bus-outline',
  violence_prevention: 'shield-outline',
  incident_deescalation: 'hand-left-outline',
  missing_persons: 'search-outline',
  burial_assistance: 'flower-outline',
  bridge_to_employment: 'briefcase-outline',
  other: 'ellipsis-horizontal-circle-outline',
};

export const STATUS_LABEL: Record<CaseStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  awaiting_resources: 'Awaiting resources',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABEL: Record<CasePriority, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const REFERRAL_LABEL: Record<ReferralStatus, string> = {
  suggested: 'Suggested',
  shared: 'Shared',
  accepted: 'Accepted',
  completed: 'Completed',
  declined: 'Declined',
};

export const ROLE_LABEL: Record<Role, string> = { member: 'Community member', worker: 'Worker', admin: 'Admin' };

// ── Colors (status and priority read the same in light and dark) ──────────

function palette(theme: Theme) {
  const dark = theme.scheme === 'dark';
  return {
    blue: dark ? '#7AB2FF' : '#1D5FD1',
    amber: theme.soon,
    green: theme.accent,
    red: theme.danger,
    gray: theme.textSecondary,
    purple: dark ? '#C3A6FF' : '#6B3FC9',
  };
}

export function statusColor(theme: Theme, status: CaseStatus) {
  const p = palette(theme);
  return { new: p.blue, in_progress: p.purple, awaiting_resources: p.amber, resolved: p.green, closed: p.gray }[status];
}

export function priorityColor(theme: Theme, priority: CasePriority) {
  const p = palette(theme);
  return { critical: p.red, high: p.amber, medium: p.blue, low: p.gray }[priority];
}

export function referralColor(theme: Theme, status: ReferralStatus) {
  const p = palette(theme);
  return { suggested: p.gray, shared: p.blue, accepted: p.purple, completed: p.green, declined: p.red }[status];
}

/** A translucent background for a color: #RRGGBB plus alpha. */
export function soft(color: string, alpha = 0.12) {
  const a = Math.round(alpha * 255).toString(16).padStart(2, '0');
  return color.startsWith('#') && color.length === 7 ? `${color}${a}` : color;
}

// ── Time ───────────────────────────────────────────────────────────────────

export function timeAgo(iso: string, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function dateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function hours(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value < 1) return `${Math.max(1, Math.round(value * 60))} min`;
  if (value < 48) return `${value.toFixed(1)} h`;
  return `${(value / 24).toFixed(1)} days`;
}

// ── Badges ─────────────────────────────────────────────────────────────────

export function Badge({ label, color, icon, solid = false }: { label: string; color: string; icon?: IconName; solid?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: solid ? color : soft(color, theme.scheme === 'dark' ? 0.2 : 0.12) }]}>
      {icon ? <Ionicons name={icon} size={12} color={solid ? '#FFFFFF' : color} /> : <View style={[styles.badgeDot, { backgroundColor: color }]} />}
      <Text style={[styles.badgeText, { color: solid ? '#FFFFFF' : color }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const theme = useTheme();
  return <Badge label={STATUS_LABEL[status]} color={statusColor(theme, status)} />;
}

export function PriorityBadge({ priority }: { priority: CasePriority }) {
  const theme = useTheme();
  const urgent = priority === 'critical';
  return <Badge label={PRIORITY_LABEL[priority]} color={priorityColor(theme, priority)} solid={urgent} icon={urgent ? 'warning' : undefined} />;
}

export function SampleBadge() {
  const theme = useTheme();
  return <Badge label="Sample data" color={theme.textSecondary} icon="flask-outline" />;
}

// ── Layout ─────────────────────────────────────────────────────────────────

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, padded && { padding: space.lg }, { backgroundColor: theme.surface, borderColor: theme.separator }, style]}>
      {children}
    </View>
  );
}

export function CardTitle({ title, right, icon }: { title: string; right?: ReactNode; icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={styles.cardTitleRow}>
      {icon ? <Ionicons name={icon} size={18} color={theme.accent} /> : null}
      <Text accessibilityRole="header" style={[styles.cardTitle, { color: theme.text }]}>
        {title}
      </Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

export function PageTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.pageTitleRow}>
      <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
        <Text accessibilityRole="header" style={[styles.pageTitle, { color: theme.text }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[type.subhead, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

/** A dashboard number: what it counts, the count, and an optional link. */
export function MetricCard({
  label,
  value,
  icon,
  color,
  hint,
  onPress,
}: {
  label: string;
  value: string | number;
  icon: IconName;
  color: string;
  hint?: string;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        styles.metric,
        { backgroundColor: theme.surface, borderColor: hovered && onPress ? color : theme.separator },
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={[styles.metricIcon, { backgroundColor: soft(color, 0.14) }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[styles.metricValue, { color: theme.text }]}>{value}</Text>
      <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]}>{label}</Text>
      {hint ? <Text style={[type.caption, { color: theme.textSecondary }]}>{hint}</Text> : null}
    </Pressable>
  );
}

/** Horizontal bars for counts, scaled to the largest. */
export function BarList({ items, empty }: { items: { key: string; label: string; value: number; color: string; detail?: string }[]; empty: string }) {
  const theme = useTheme();
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <Text style={[type.subhead, { color: theme.textSecondary }]}>{empty}</Text>;
  return (
    <View style={{ gap: space.md }}>
      {items.map((item) => (
        <View key={item.key} style={{ gap: 4 }} accessible accessibilityLabel={`${item.label}: ${item.value}${item.detail ? `, ${item.detail}` : ''}`}>
          <View style={styles.barLabelRow}>
            <Text style={[type.subhead, { color: theme.text, flex: 1 }]} numberOfLines={1}>
              {item.label}
            </Text>
            {item.detail ? <Text style={[type.caption, { color: theme.textSecondary }]}>{item.detail}</Text> : null}
            <Text style={[type.subhead, { color: theme.text, fontWeight: '700', minWidth: 24, textAlign: 'right' }]}>{item.value}</Text>
          </View>
          <View style={[styles.barTrack, { backgroundColor: theme.fill }]}>
            <View style={[styles.barFill, { width: `${(item.value / max) * 100}%`, backgroundColor: item.color }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Pick one value from a short list, shown as tokens. */
export function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
  colorOf,
  disabled,
  allowNone,
  noneLabel = 'Any',
}: {
  label?: string;
  options: readonly T[];
  value: T | null | undefined;
  onChange: (value: T | null) => void;
  labels: Record<T, string>;
  colorOf?: (value: T) => string;
  disabled?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const theme = useTheme();
  const token = (key: string, text: string, active: boolean, onPress: () => void, color?: string) => (
    <Pressable
      key={key}
      disabled={disabled}
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={label ? `${label}: ${text}` : text}
      style={({ pressed }) => [
        styles.token,
        { backgroundColor: active ? (color ?? theme.accent) : theme.fill },
        pressed && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
    >
      {color && !active ? <View style={[styles.badgeDot, { backgroundColor: color }]} /> : null}
      <Text style={[type.footnote, { color: active ? '#FFFFFF' : theme.text, fontWeight: '600' }]}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '600' }]}>{label}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tokens}>
        {allowNone ? token('__none', noneLabel, value === null || value === undefined, () => onChange(null)) : null}
        {options.map((o) => token(o, labels[o], value === o, () => onChange(o), colorOf?.(o)))}
      </ScrollView>
    </View>
  );
}

/** Label / value pairs in a case's details. */
export function Detail({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 2, minWidth: 140, flexGrow: 1, flexBasis: 160 }}>
      <Text style={[type.caption, { color: theme.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 }]}>{label}</Text>
      {typeof children === 'string' ? <Text style={[type.subhead, { color: theme.text }]} selectable>{children}</Text> : children}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: radius.lg, gap: space.md },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  pageTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  pageTitle: { fontFamily: SERIF, fontSize: 30, fontWeight: '700' },
  metric: { padding: space.lg, gap: 4, flexGrow: 1, flexBasis: 170, minWidth: 150 },
  metricIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  metricValue: { fontFamily: SERIF, fontSize: 34, lineHeight: 38, fontWeight: '800' },
  barLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  tokens: { gap: 6, paddingRight: space.sm },
  token: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
});
