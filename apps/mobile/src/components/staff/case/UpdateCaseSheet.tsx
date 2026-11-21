import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CASE_CATEGORIES, CASE_PRIORITIES, CASE_STATUSES, type Case, type UpdateCase } from '@/api/types';
import { Avatar } from '@/components/Avatar';
import { ChoiceRow, priorityColor, statusColor } from '@/components/staff/kit';
import { Button, ErrorBanner, Sheet, success } from '@/components/ui';
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
 * Figma S4 "Update case": status, priority, service and owner in one sheet.
 * Nothing saves until "Save changes"; each change is logged in the history.
 */
export function UpdateCaseSheet({ item: c, visible, onClose }: { item: Case; visible: boolean; onClose: () => void }) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Update case" subtitle={`#${c.number} ${c.title}`} dismissLabel="Cancel">
      {/* Mounted per opening, so it always starts from the case as it is now. */}
      {visible ? <Form item={c} onDone={onClose} /> : null}
    </Sheet>
  );
}

function Form({ item: c, onDone }: { item: Case; onDone: () => void }) {
  const theme = useTheme();
  const me = useStaffStatus();
  const workers = useWorkers();
  const update = useUpdateCase(c.id);
  const [status, setStatus] = useState(c.status);
  const [priority, setPriority] = useState(c.priority);
  const [category, setCategory] = useState(c.category);
  const [owner, setOwner] = useState<string | null>(c.assigned_worker_id ?? null);

  const changes = caseChanges(c, { status, priority, category, assigned_worker_id: owner });
  const dirty = Object.keys(changes).length > 0;

  const people = [...(workers.data ?? [])].sort((a, b) => (a.id === me.data?.id ? -1 : b.id === me.data?.id ? 1 : 0));

  return (
    <View style={{ gap: space.lg }}>
      <ChoiceRow label="Status" options={CASE_STATUSES} labels={STATUS_LABEL} value={status} onChange={(s) => s && setStatus(s)} colorOf={(s) => statusColor(theme, s)} />
      <ChoiceRow label="Priority" options={CASE_PRIORITIES} labels={PRIORITY_LABEL} value={priority} onChange={(p) => p && setPriority(p)} colorOf={(p) => priorityColor(theme, p)} />
      <ChoiceRow label="Service" options={CASE_CATEGORIES} labels={CATEGORY_LABEL} value={category} onChange={(v) => v && setCategory(v)} />

      <View style={{ gap: 6 }}>
        <Text style={[type.footnote, { color: theme.textSecondary, fontWeight: '600' }]}>Assigned to</Text>
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          {people.map((w, i) => (
            <Owner
              key={w.id}
              name={w.id === me.data?.id ? `${w.display_name ?? 'Me'} (you)` : (w.display_name ?? 'Unnamed')}
              detail={`${w.open_cases} open`}
              selected={owner === w.id}
              first={i === 0}
              onPress={() => setOwner(w.id)}
            />
          ))}
          <Owner name="Unassigned" selected={owner === null} first={!people.length} onPress={() => setOwner(null)} />
        </View>
      </View>

      {update.error ? <ErrorBanner error={update.error} /> : null}
      <Button
        label="Save changes"
        size="lg"
        disabled={!dirty}
        loading={update.isPending}
        onPress={() =>
          update.mutate(changes, {
            onSuccess: () => {
              success();
              onDone();
            },
          })
        }
      />
    </View>
  );
}

function Owner({ name, detail, selected, first, onPress }: { name: string; detail?: string; selected: boolean; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      style={({ pressed }) => [styles.owner, !first && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
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
  owner: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md },
  none: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
