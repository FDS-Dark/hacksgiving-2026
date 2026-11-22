import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { CaseListSkeleton } from '@/components/Skeleton';
import { Card, ChoiceRow, PageTitle } from '@/components/staff/kit';
import { Button, EmptyState, ErrorBanner, FieldLabel, Sheet, success, tap } from '@/components/ui';
import {
  SHIFT_BLOCKS,
  addDays,
  clock,
  dayKey,
  dayLabel,
  isCurrent,
  matchBlock,
  rangeLabel,
  shiftRange,
  shiftSubtitle,
  shiftsOnDay,
  startOfDay,
  weekStrip,
  type StripDay,
} from '@/lib/oncall';
import { shiftError, useCreateShift, useDeleteShift, useShifts, useUpdateShift, type OncallShift } from '@/services/oncall';
import { useStaffStatus, useWorkers } from '@/services/staff';
import { radius, space, type, useTheme } from '@/theme/tokens';

/**
 * Figma A3 "On-call schedule": a week strip from today and the chosen day's
 * shifts, the one on now highlighted. Everyone on staff can look; admins
 * get Edit to add, change or remove shifts.
 */
export default function OncallScheduleScreen() {
  const me = useStaffStatus();
  const isAdmin = !!me.data?.is_admin;
  const todayKey = dayKey(new Date());
  // One query for the whole week, keyed on today's date so it stays put between renders.
  const { strip, from, to } = useMemo(() => {
    const [y, m, d] = todayKey.split('-').map(Number);
    const today = new Date(y, m - 1, d);
    return { strip: weekStrip(today), from: today.toISOString(), to: addDays(today, 7).toISOString() };
  }, [todayKey]);
  const shifts = useShifts(from, to);
  const [selected, setSelected] = useState(todayKey);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState<{ shift: OncallShift | null } | null>(null);

  const day = strip.find((d) => d.key === selected) ?? strip[0];
  const now = new Date();
  const dayShifts = shiftsOnDay(shifts.data ?? [], day.date);

  return (
    <Page refreshing={shifts.isRefetching} onRefresh={() => shifts.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink label="Me" fallback="/staff/me" />
      <PageTitle
        title="On call"
        subtitle="Who is on and who is next."
        right={isAdmin ? <Button label={editing ? 'Done' : 'Edit'} variant="plain" onPress={() => setEditing((e) => !e)} /> : undefined}
      />

      <DayStrip days={strip} selected={day.key} onSelect={setSelected} />

      {shifts.isPending ? (
        <CaseListSkeleton rows={3} />
      ) : shifts.error && !shifts.data ? (
        <ErrorBanner error={shifts.error} onRetry={() => shifts.refetch()} />
      ) : (
        <View style={{ gap: space.sm }}>
          {dayShifts.length ? (
            dayShifts.map((s) => (
              <ShiftCard key={s.id} shift={s} now={now} onPress={editing ? () => setSheet({ shift: s }) : undefined} />
            ))
          ) : (
            <EmptyState icon="calendar-outline" title="Nobody scheduled" body={`No one is on call ${day.key === todayKey ? 'today' : `on ${dayLabel(day.date)}`}.`} />
          )}
        </View>
      )}

      {editing ? <Button label="Add shift" icon="add" variant="tinted" onPress={() => setSheet({ shift: null })} /> : null}

      {sheet ? <ShiftSheet shift={sheet.shift} day={day} strip={strip} onClose={() => setSheet(null)} /> : null}
    </Page>
  );
}

function DayStrip({ days, selected, onSelect }: { days: StripDay[]; selected: string; onSelect: (key: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.strip} accessibilityRole="tablist">
      {days.map((d) => {
        const active = d.key === selected;
        return (
          <Pressable
            key={d.key}
            onPress={() => {
              tap();
              onSelect(d.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={dayLabel(d.date)}
            style={({ pressed }) => [
              styles.stripDay,
              { backgroundColor: active ? theme.text : theme.surface, borderColor: active ? theme.text : theme.separator },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[type.caption, { color: active ? theme.bg : theme.textSecondary }]}>{d.weekday}</Text>
            <Text style={[styles.stripNumber, { color: active ? theme.bg : theme.text }]}>{d.day}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ShiftCard({ shift, now, onPress }: { shift: OncallShift; now: Date; onPress?: () => void }) {
  const theme = useTheme();
  const current = isCurrent(shift, now);
  const subtitle = shiftSubtitle(shift, now);
  const name = shift.display_name ?? 'Unnamed';
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${clock(shift.starts_at)} to ${clock(shift.ends_at)}, ${name}, ${subtitle}`}
      accessibilityHint={onPress ? 'Edit this shift' : undefined}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      <Card style={[styles.shift, current && { borderColor: theme.accent }]}>
        <View style={styles.shiftTime}>
          <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]}>{clock(shift.starts_at)}</Text>
          <Text style={[type.caption, { color: theme.textSecondary }]}>to {clock(shift.ends_at)}</Text>
        </View>
        <Avatar name={shift.display_name} size={36} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[type.subhead, { color: theme.text, fontWeight: '700' }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[type.footnote, { color: current ? theme.accent : theme.textSecondary }]}>{subtitle}</Text>
        </View>
        {onPress ? <Ionicons name="create-outline" size={18} color={theme.textTertiary} /> : null}
      </Card>
    </Pressable>
  );
}

// ── Add / edit (admins) ──────────────────────────────────────────────────

type BlockChoice = (typeof SHIFT_BLOCKS)[number]['key'] | 'custom';
type RankChoice = 'primary' | 'backup';

const BLOCK_OPTIONS = [...SHIFT_BLOCKS.map((b) => b.key), 'custom'] as const satisfies readonly BlockChoice[];
const BLOCK_LABELS = { ...Object.fromEntries(SHIFT_BLOCKS.map((b) => [b.key, b.label])), custom: 'Custom' } as Record<BlockChoice, string>;
const RANK_OPTIONS = ['primary', 'backup'] as const satisfies readonly RankChoice[];
const RANK_LABELS: Record<RankChoice, string> = { primary: 'Primary', backup: 'Backup' };

function ShiftSheet({ shift, day, strip, onClose }: { shift: OncallShift | null; day: StripDay; strip: StripDay[]; onClose: () => void }) {
  const theme = useTheme();
  const workers = useWorkers();
  const create = useCreateShift();
  const update = useUpdateShift();
  const remove = useDeleteShift();

  const initial = useMemo(() => {
    if (!shift) return { day: day.key, block: 'evening' as BlockChoice, startHour: 17, endHour: 23 };
    const start = new Date(shift.starts_at);
    const end = new Date(shift.ends_at);
    const block = matchBlock(shift);
    return { day: dayKey(start), block: (block?.key ?? 'custom') as BlockChoice, startHour: start.getHours(), endHour: end.getHours() };
  }, [shift, day.key]);

  const [userId, setUserId] = useState<string | null>(shift?.user_id ?? null);
  const [dayChoice, setDayChoice] = useState(initial.day);
  const [block, setBlock] = useState<BlockChoice>(initial.block);
  const [startHour, setStartHour] = useState(initial.startHour);
  const [endHour, setEndHour] = useState(initial.endHour);
  const [rank, setRank] = useState<RankChoice>(shift?.rank === 2 ? 'backup' : 'primary');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // The week, plus the edited shift's own day if it started before today.
  const days = useMemo(() => {
    const map = new Map(strip.map((d) => [d.key, d.date]));
    if (!map.has(initial.day) && shift) map.set(initial.day, startOfDay(new Date(shift.starts_at)));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [strip, initial.day, shift]);
  const dayDate = days.find(([k]) => k === dayChoice)?.[1] ?? day.date;
  const dayLabels = Object.fromEntries(days.map(([k, d]) => [k, dayLabel(d)]));

  const people = useMemo(() => {
    const list = (workers.data ?? []).map((w) => ({ id: w.id, name: w.display_name ?? 'Unnamed' }));
    if (shift && !list.some((p) => p.id === shift.user_id)) list.push({ id: shift.user_id, name: shift.display_name ?? 'Unnamed' });
    return list;
  }, [workers.data, shift]);
  const peopleLabels = Object.fromEntries(people.map((p) => [p.id, p.name]));

  const preset = SHIFT_BLOCKS.find((b) => b.key === block);
  const hours = preset ? { start: preset.startHour, end: preset.endHour } : { start: startHour, end: endHour };
  // An edit that leaves the day and hours alone keeps the shift's exact
  // times (a switch shift like 14:23-18:45 isn't on the hour).
  const timesChanged =
    dayChoice !== initial.day || block !== initial.block || startHour !== initial.startHour || endHour !== initial.endHour;
  const range = shift && !timesChanged ? { starts_at: shift.starts_at, ends_at: shift.ends_at } : shiftRange(dayDate, hours.start, hours.end);
  const saving = create.isPending || update.isPending;
  const error = create.error ?? update.error ?? remove.error;

  const done = () => {
    success();
    onClose();
  };
  const save = () => {
    if (!userId) return;
    const body = { user_id: userId, ...range, rank: rank === 'backup' ? (2 as const) : (1 as const) };
    if (shift) update.mutate({ id: shift.id, body }, { onSuccess: done });
    else create.mutate(body, { onSuccess: done });
  };

  return (
    <Sheet visible onClose={onClose} title={shift ? 'Edit shift' : 'Add shift'} subtitle={`${dayLabel(dayDate)} · ${rangeLabel(range.starts_at, range.ends_at)}`} dismissLabel="Cancel">
      {workers.error ? <ErrorBanner error={workers.error} onRetry={() => workers.refetch()} /> : null}
      <ChoiceRow label="Person" options={people.map((p) => p.id)} labels={peopleLabels} value={userId} onChange={setUserId} />
      <ChoiceRow label="Day" options={days.map(([k]) => k)} labels={dayLabels} value={dayChoice} onChange={(k) => k && setDayChoice(k)} />
      <ChoiceRow
        label="Hours"
        options={BLOCK_OPTIONS}
        labels={BLOCK_LABELS}
        value={block}
        onChange={(b) => {
          if (!b) return;
          if (b === 'custom') {
            setStartHour(hours.start);
            setEndHour(hours.end);
          }
          setBlock(b);
        }}
      />
      {block === 'custom' ? (
        <View style={styles.customHours}>
          <HourStepper label="Starts" hour={startHour} onChange={setStartHour} />
          <HourStepper label="Ends" hour={endHour} onChange={setEndHour} />
        </View>
      ) : null}
      <ChoiceRow label="Role" options={RANK_OPTIONS} labels={RANK_LABELS} value={rank} onChange={(r) => r && setRank(r)} />

      {error ? <ErrorBanner error={shiftError(error)} /> : null}
      <Button label={shift ? 'Save shift' : 'Add shift'} size="lg" disabled={!userId} loading={saving} onPress={save} />
      {shift ? (
        <Button
          label={confirmDelete ? 'Tap again to delete' : 'Delete shift'}
          icon="trash-outline"
          variant="destructive"
          loading={remove.isPending}
          onPress={() => (confirmDelete ? remove.mutate(shift.id, { onSuccess: done }) : setConfirmDelete(true))}
        />
      ) : null}
      <Text style={[type.footnote, { color: theme.textSecondary }]}>An end at or before the start runs into the next day.</Text>
    </Sheet>
  );
}

/** An hour of the day, stepped an hour at a time and wrapping around midnight. */
function HourStepper({ label, hour, onChange }: { label: string; hour: number; onChange: (hour: number) => void }) {
  const theme = useTheme();
  const step = (by: number) => {
    tap();
    onChange((hour + by + 24) % 24);
  };
  const shown = clock(new Date(2000, 0, 1, hour));
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <FieldLabel>{label}</FieldLabel>
      <View style={[styles.stepper, { backgroundColor: theme.fill }]}>
        <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel={`${label} an hour earlier`} style={styles.stepperButton}>
          <Ionicons name="remove" size={20} color={theme.accent} />
        </Pressable>
        <Text style={[type.body, { color: theme.text, flex: 1, textAlign: 'center' }]} accessibilityLabel={`${label} ${shown}`}>
          {shown}
        </Text>
        <Pressable onPress={() => step(1)} accessibilityRole="button" accessibilityLabel={`${label} an hour later`} style={styles.stepperButton}>
          <Ionicons name="add" size={20} color={theme.accent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 6 },
  stripDay: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.lg, borderWidth: 1, gap: 2 },
  stripNumber: { fontSize: 18, fontWeight: '800' },
  shift: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
  shiftTime: { width: 64, gap: 1 },
  customHours: { flexDirection: 'row', gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, minHeight: 44 },
  stepperButton: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
});
