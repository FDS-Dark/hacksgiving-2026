import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NotificationKind, NotificationPreferences, UpdateNotificationPreferences } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { Chip, ErrorBanner, Group, Loading, Notice, Row, Toggle, tap } from '@/components/ui';
import { DEFAULT_QUIET, QUIET_PRESETS, label, length, sameTime, shift } from '@/lib/quietHours';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '@/services/notifications';
import { space, type, useTheme } from '@/theme/tokens';

/** The everyday kinds a worker can mute. Urgent alerts can't be muted: they're how on-call works. */
const MUTABLE: { kind: NotificationKind; title: string; subtitle: string }[] = [
  { kind: 'assignment', title: 'Assigned to me', subtitle: 'Someone gives you a case' },
  { kind: 'reply', title: 'Resident replies', subtitle: 'New messages on your cases' },
  { kind: 'task_due', title: 'Task reminders', subtitle: 'Follow-ups coming due' },
  { kind: 'referral_update', title: 'Referral updates', subtitle: 'A partner accepted, declined or finished one' },
  { kind: 'chat_rapid', title: 'Rapid response messages', subtitle: 'A teammate flags a chat message urgent' },
];

/**
 * Notification settings: push on or off, quiet hours (no buzzing overnight;
 * the bell still collects everything), and which everyday notifications to
 * mute. Urgent alerts always come through. Each change saves right away.
 */
export default function NotificationSettingsScreen() {
  const theme = useTheme();
  const prefs = useNotificationPreferences();
  const save = useUpdateNotificationPreferences();
  const p = prefs.data;

  const set = (changes: UpdateNotificationPreferences) => save.mutate(changes);

  return (
    <Page refreshing={prefs.isRefetching} onRefresh={() => prefs.refetch()} contentStyle={{ maxWidth: 640, gap: space.lg }}>
      <BackLink to="/staff/me" label="Me" />
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Notifications
        </Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          When your phone buzzes. Everything still lands in the bell on Today.
        </Text>
      </View>

      {prefs.isPending ? (
        <Loading label="Loading your settings" />
      ) : !p ? (
        <ErrorBanner error={prefs.error} onRetry={() => prefs.refetch()} />
      ) : (
        <>
          <Group footer="Off: nothing is pushed to this account’s phones, except urgent alerts while you’re on call.">
            <Row
              title="Push notifications"
              icon="notifications-outline"
              right={<Toggle value={p.push_enabled} onChange={(v) => set({ push_enabled: v })} disabled={save.isPending} label="Push notifications" />}
            />
          </Group>

          <QuietHours prefs={p} busy={save.isPending} onChange={set} />

          <Group header="Mute" footer="Muted notifications still show in the bell; they just don’t buzz.">
            {MUTABLE.map((m) => {
              const muted = p.muted_kinds.includes(m.kind);
              return (
                <Row
                  key={m.kind}
                  title={m.title}
                  subtitle={m.subtitle}
                  right={
                    <Toggle
                      value={!muted}
                      disabled={save.isPending}
                      label={m.title}
                      onChange={(on) =>
                        set({ muted_kinds: on ? p.muted_kinds.filter((k) => k !== m.kind) : [...p.muted_kinds, m.kind] })
                      }
                    />
                  }
                />
              );
            })}
          </Group>

          <Notice icon="alert-circle-outline">
            Urgent alerts (a case that needs someone now) always come through, even in quiet hours, while you’re on call.
          </Notice>
          {save.error ? <ErrorBanner error={save.error} /> : null}
        </>
      )}
    </Page>
  );
}

function QuietHours({ prefs: p, busy, onChange }: { prefs: NotificationPreferences; busy: boolean; onChange: (c: UpdateNotificationPreferences) => void }) {
  const theme = useTheme();
  const on = Boolean(p.quiet_start && p.quiet_end);
  const start = p.quiet_start ?? DEFAULT_QUIET.start;
  const end = p.quiet_end ?? DEFAULT_QUIET.end;

  return (
    <Group
      header="Quiet hours"
      footer={on ? `No buzzing from ${label(start)} to ${label(end)} (${length(start, end)}), in your time zone.` : 'Pause notifications overnight or during off hours.'}
    >
      <Row
        title="Quiet hours"
        icon="moon-outline"
        right={
          <Toggle
            value={on}
            disabled={busy}
            label="Quiet hours"
            onChange={(v) => onChange(v ? { quiet_start: start, quiet_end: end } : { quiet_start: null, quiet_end: null })}
          />
        }
      />
      {on ? (
        <View style={[styles.quiet, { borderTopColor: theme.separator }]}>
          <View style={styles.presets}>
            {QUIET_PRESETS.map((q) => (
              <Chip
                key={q.start}
                label={`${label(q.start)} – ${label(q.end)}`}
                active={sameTime(q.start, start) && sameTime(q.end, end)}
                onPress={() => onChange({ quiet_start: q.start, quiet_end: q.end })}
              />
            ))}
          </View>
          <Stepper title="From" value={start} busy={busy} onChange={(v) => onChange({ quiet_start: v, quiet_end: end })} />
          <Stepper title="Until" value={end} busy={busy} onChange={(v) => onChange({ quiet_start: start, quiet_end: v })} />
        </View>
      ) : null}
    </Group>
  );
}

/** A clock time in 30-minute steps (no native picker, so it works in Expo Go and on the web). */
function Stepper({ title, value, busy, onChange }: { title: string; value: string; busy: boolean; onChange: (v: string) => void }) {
  const theme = useTheme();
  const step = (delta: number) => {
    tap();
    onChange(shift(value, delta));
  };
  return (
    <View style={styles.stepper}>
      <Text style={[type.subhead, { color: theme.textSecondary, width: 52 }]}>{title}</Text>
      <StepButton icon="remove" label={`${title} 30 minutes earlier`} disabled={busy} onPress={() => step(-30)} />
      <Text style={[type.headline, styles.time, { color: theme.text }]} accessibilityLabel={`${title} ${label(value)}`}>
        {label(value)}
      </Text>
      <StepButton icon="add" label={`${title} 30 minutes later`} disabled={busy} onPress={() => step(30)} />
    </View>
  );
}

function StepButton({ icon, label: a11y, disabled, onPress }: { icon: 'add' | 'remove'; label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      style={({ pressed }) => [styles.stepButton, { backgroundColor: theme.fill }, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={18} color={theme.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800' },
  quiet: { gap: space.md, padding: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  stepButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  time: { minWidth: 92, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
