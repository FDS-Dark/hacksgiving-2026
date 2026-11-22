import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, CASE_PRIORITIES, CASE_STATUSES, type Case, type UpdateCase } from '@/api/types';
import { Avatar } from '@/components/Avatar';
import { ChoiceRow, MoreDetails, priorityColor, statusColor } from '@/components/staff/kit';
import { Button, ErrorBanner, Field, Sheet, success } from '@/components/ui';
import { CATEGORY_LABEL, PRIORITY_LABEL, STATUS_LABEL } from '@/lib/cases';
import { useUpdateCase } from '@/services/cases';
import { useStaffStatus, useWorkers } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/** Only what changed, so the history records just those changes. */
export function caseChanges(c: Case, next: Required<Pick<UpdateCase, 'status' | 'priority' | 'category'>> & { assigned_worker_id: string | null }): UpdateCase {
  const out: UpdateCase = {};
  if (next.status !== c.status) out.status = next.status;
  if (next.priority !== c.priority) out.priority = next.priority;
  if (next.category !== c.category) out.category = next.category;
  if (next.assigned_worker_id !== (c.assigned_worker_id ?? null)) out.assigned_worker_id = next.assigned_worker_id;
  return out;
}

/**
 * Figma S4 "Update case", as a short sheet (cognitive-load review, top 10
 * #9: 44 controls at once). Status, who has it, priority and Save come
 * first; who has it and priority open in place when tapped, and the type of
 * help sits under "More details". Nothing saves until "Save changes"; each
 * change is logged in the history.
 */
export function UpdateCaseSheet({ item: c, visible, onClose }: { item: Case; visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Update case" subtitle={`#${c.number} ${c.title}`} dismissLabel="Cancel">
      {/* Mounted per opening, so it always starts from the case as it is now. */}
      {visible ? <Form item={c} onDone={onClose} /> : null}
    </Sheet>
  );
}

type Open = 'owner' | 'priority' | null;

function Form({ item: c, onDone }: { item: Case; onDone: () => void }) {
  const theme = useTheme();
  const me = useStaffStatus();
  const workers = useWorkers();
  const update = useUpdateCase(c.id);
  const [status, setStatus] = useState(c.status);
  const [priority, setPriority] = useState(c.priority);
  const [category, setCategory] = useState(c.category);
  const [owner, setOwner] = useState<string | null>(c.assigned_worker_id ?? null);
  const [handoff, setHandoff] = useState('');
  const [open, setOpen] = useState<Open>(null);

  const changes = caseChanges(c, { status, priority, category, assigned_worker_id: owner });
  const dirty = Object.keys(changes).length > 0;
  // Handing the case to someone else: a note for them, saved on the history and sent with their notification.
  const handingOff = 'assigned_worker_id' in changes && owner !== null && owner !== me.data?.id;
  const ownerName =
    owner === null
      ? 'No worker assigned'
      : owner === me.data?.id
        ? 'You'
        : (workers.data?.find((w) => w.id === owner)?.display_name ?? (owner === c.assigned_worker_id ? c.assigned_worker_name : null) ?? 'Someone on staff');
  const people = [...(workers.data ?? [])].sort((a, b) => (a.id === me.data?.id ? -1 : b.id === me.data?.id ? 1 : 0));
  const toggle = (which: Exclude<Open, null>) => setOpen((o) => (o === which ? null : which));
  const resolving = 'status' in changes && (status === 'resolved' || status === 'closed');

  return (
    <View style={{ gap: space.lg }}>
      <ChoiceRow label="Status" options={CASE_STATUSES} labels={STATUS_LABEL} value={status} onChange={(s) => s && setStatus(s)} colorOf={(s) => statusColor(theme, s)} />

      <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
        <Summary label="Assigned to" value={ownerName} expanded={open === 'owner'} onPress={() => toggle('owner')} first />
        {open === 'owner' ? (
          workers.isPending ? (
            <View style={styles.state} accessible accessibilityLabel="Loading staff">
              <ActivityIndicator color={theme.textSecondary} />
              <Text style={[type.footnote, { color: theme.textSecondary }]}>Loading staff…</Text>
            </View>
          ) : !workers.data ? (
            <View style={styles.state}>
              <ErrorBanner error={workers.error} onRetry={() => workers.refetch()} />
              <Text style={[type.footnote, { color: theme.textSecondary }]}>You can still change the status or priority. Who has it stays the same.</Text>
            </View>
          ) : (
            <>
              {people.map((w) => (
                <Owner
                  key={w.id}
                  name={w.id === me.data?.id ? `${w.display_name ?? 'Me'} (you)` : (w.display_name ?? 'Unnamed')}
                  detail={`${w.open_cases} open`}
                  selected={owner === w.id}
                  onPress={() => setOwner(w.id)}
                />
              ))}
              <Owner name="No worker assigned" selected={owner === null} onPress={() => setOwner(null)} />
            </>
          )
        ) : null}
        <Summary label="Priority" value={PRIORITY_LABEL[priority]} color={priorityColor(theme, priority)} expanded={open === 'priority'} onPress={() => toggle('priority')} />
        {open === 'priority' ? (
          <View style={styles.inline}>
            <ChoiceRow options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={priority} onChange={(p) => p && setPriority(p)} colorOf={(p) => priorityColor(theme, p)} />
          </View>
        ) : null}
      </View>

      {handingOff ? (
        <Field
          label={`Handoff note for ${ownerName} (optional)`}
          placeholder="Where things stand, what’s next, anything they should know before they call"
          value={handoff}
          onChangeText={setHandoff}
          multiline
          maxLength={2000}
          style={styles.note}
          accessibilityLabel={`Handoff note for ${ownerName}`}
        />
      ) : null}

      {update.error ? <ErrorBanner error={update.error} /> : null}
      <Button
        label={resolving ? `Save and mark ${STATUS_LABEL[status].toLowerCase()}` : 'Save changes'}
        size="lg"
        // The assignee list must load first, so "No worker assigned" is never saved by mistake.
        disabled={!dirty || workers.isPending}
        loading={update.isPending}
        onPress={() =>
          update.mutate(handingOff && handoff.trim() ? { ...changes, handoff_note: handoff.trim() } : changes, {
            onSuccess: () => {
              success();
              onDone();
            },
          })
        }
      />

      <MoreDetails hint={`Type of help: ${CATEGORY_LABEL[category]}`}>
        <ChoiceRow label="Type of help" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={(v) => v && setCategory(v)} />
      </MoreDetails>
    </View>
  );
}

/** One collapsed choice: "Priority · High ›". Tapping opens its options in place. */
function Summary({ label, value, color, expanded, onPress, first = false }: { label: string; value: string; color?: string; expanded: boolean; onPress: () => void; first?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${label}: ${value}. ${expanded ? 'Hide choices' : 'Change'}`}
      style={({ pressed }) => [styles.summary, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
    >
      <Text style={[type.subhead, { color: theme.textSecondary, width: 96 }]}>{label}</Text>
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={[type.subhead, { color: theme.text, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
        {value}
      </Text>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textTertiary} />
    </Pressable>
  );
}

function Owner({ name, detail, selected, onPress }: { name: string; detail?: string; selected: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      style={({ pressed }) => [styles.owner, { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
    >
      {detail ? <Avatar name={name} size={30} /> : <View style={[styles.none, { backgroundColor: theme.fill }]}><Ionicons name="remove" size={16} color={theme.textSecondary} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]}>{name}</Text>
        {detail ? <Text style={[type.caption, { color: theme.textSecondary }]}>{detail}</Text> : null}
      </View>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? theme.accent : theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 48 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  inline: { paddingHorizontal: space.md, paddingBottom: space.md },
  state: { gap: space.sm, padding: space.md, alignItems: 'stretch' },
  owner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, minHeight: 44 },
  none: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  note: { minHeight: 96, textAlignVertical: 'top', paddingTop: space.sm },
});
