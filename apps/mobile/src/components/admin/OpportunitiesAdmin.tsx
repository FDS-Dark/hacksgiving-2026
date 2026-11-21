import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { PostingForm } from '@/components/admin/PostingForm';
import { Page } from '@/components/Page';
import { SectionHeading } from '@/components/brand';
import { Button, Chip, Chips, EmptyState, Group, Notice, Row, Sheet, success } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { emptyPosting, newId, payLabel, whenLabel, type Posting, type PostingKind } from '@/lib/opportunities';
import { space, useTheme } from '@/theme/tokens';

type Filter = 'all' | PostingKind | 'draft';

/**
 * Opportunities as staff and partners see it in admin mode: every posting
 * with its status, and the form to add or edit one.
 */
export function OpportunitiesAdmin() {
  const theme = useTheme();
  const { postings, savePosting, removePosting, setAdminMode } = useAdmin();
  const [editing, setEditing] = useState<{ posting: Posting; isNew: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Posting | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (editing) {
    return (
      <Page contentStyle={{ maxWidth: 820 }}>
        <SectionHeading
          title={editing.isNew ? 'New Posting' : 'Edit Posting'}
          kicker="Fields marked * are needed to publish. Drafts only need a title."
        />
        <PostingForm
          key={editing.posting.id}
          initial={editing.posting}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={(posting) => {
            success();
            savePosting(posting);
            setEditing(null);
          }}
        />
      </Page>
    );
  }

  const shown = postings.filter((p) => (filter === 'all' ? true : filter === 'draft' ? p.status === 'draft' : p.kind === filter));
  const count = (f: Filter) => postings.filter((p) => (f === 'all' ? true : f === 'draft' ? p.status === 'draft' : p.kind === f)).length;

  const statusPill = (p: Posting) =>
    p.status === 'published'
      ? { detail: 'Live', detailTint: theme.accentSoft, detailColor: theme.accent }
      : p.status === 'draft'
        ? { detail: 'Draft', detailTint: theme.warningSoft, detailColor: theme.soon }
        : { detail: 'Closed', detailTint: theme.fill, detailColor: theme.textSecondary };

  return (
    <Page contentStyle={{ maxWidth: 820 }}>
      <SectionHeading title="Opportunities" kicker="Admin mode: post and manage jobs and volunteer openings." />

      <Notice icon="construct-outline" tone="warning">
        Residents don’t see postings yet. They’re kept on this device until the app is connected to the server.
      </Notice>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Button label="New job" icon="briefcase-outline" onPress={() => setEditing({ posting: emptyPosting('job'), isNew: true })} />
        <Button
          label="New volunteer opening"
          icon="hand-left-outline"
          onPress={() => setEditing({ posting: emptyPosting('volunteer'), isNew: true })}
        />
      </View>

      <Chips>
        {(['all', 'job', 'volunteer', 'draft'] as Filter[]).map((f) => (
          <Chip
            key={f}
            label={{ all: 'All', job: 'Jobs', volunteer: 'Volunteer', draft: 'Drafts' }[f]}
            count={count(f)}
            active={filter === f}
            onPress={() => setFilter(f)}
          />
        ))}
      </Chips>

      {shown.length ? (
        <Group footer={Platform.OS === 'web' ? 'Click a posting to edit, duplicate, close, or delete it.' : 'Tap a posting to edit, duplicate, close, or delete it.'}>
          {shown.map((p) => (
            <Row
              key={p.id}
              title={p.title || 'Untitled posting'}
              subtitle={[p.kind === 'job' ? 'Job' : 'Volunteer', p.organization, payLabel(p) ?? whenLabel(p)].filter(Boolean).join(' · ')}
              icon={p.kind === 'job' ? 'briefcase-outline' : 'hand-left-outline'}
              accessory="chevron"
              onPress={() => {
                setConfirmDelete(false);
                setSelected(p);
              }}
              {...statusPill(p)}
            />
          ))}
        </Group>
      ) : (
        <EmptyState icon="briefcase-outline" title="No postings here" body="Add a job or volunteer opening to get started." />
      )}

      <PostingActions
        posting={selected}
        confirmDelete={confirmDelete}
        onClose={() => setSelected(null)}
        onEdit={(p) => {
          setSelected(null);
          setEditing({ posting: p, isNew: false });
        }}
        onDuplicate={(p) => {
          setSelected(null);
          setEditing({ posting: { ...p, id: newId(), status: 'draft', title: `${p.title} (copy)` }, isNew: true });
        }}
        onToggleClosed={(p) => {
          setSelected(null);
          savePosting({ ...p, status: p.status === 'closed' ? 'draft' : 'closed' });
        }}
        onDelete={(p) => {
          if (!confirmDelete) return setConfirmDelete(true);
          setSelected(null);
          removePosting(p.id);
        }}
      />

      <Button
        label="Leave admin mode"
        variant="plain"
        onPress={() => {
          setAdminMode(false);
          router.navigate('/admin');
        }}
      />
    </Page>
  );
}

function PostingActions({
  posting,
  confirmDelete,
  onClose,
  onEdit,
  onDuplicate,
  onToggleClosed,
  onDelete,
}: {
  posting: Posting | null;
  confirmDelete: boolean;
  onClose: () => void;
  onEdit: (p: Posting) => void;
  onDuplicate: (p: Posting) => void;
  onToggleClosed: (p: Posting) => void;
  onDelete: (p: Posting) => void;
}) {
  return (
    <Sheet visible={!!posting} onClose={onClose} title={posting?.title || 'Untitled posting'} subtitle={posting?.organization}>
      {posting ? (
        <Group>
          <Row title="Edit" icon="create-outline" accessory="chevron" onPress={() => onEdit(posting)} />
          <Row title="Duplicate" subtitle="Start a new draft from this one" icon="copy-outline" onPress={() => onDuplicate(posting)} />
          <Row
            title={posting.status === 'closed' ? 'Reopen as draft' : 'Close posting'}
            subtitle={posting.status === 'closed' ? undefined : 'Stop taking applications'}
            icon={posting.status === 'closed' ? 'refresh-outline' : 'lock-closed-outline'}
            onPress={() => onToggleClosed(posting)}
          />
          <Row
            title={confirmDelete ? 'Tap again to delete for good' : 'Delete'}
            icon="trash-outline"
            tone="danger"
            onPress={() => onDelete(posting)}
          />
        </Group>
      ) : null}
    </Sheet>
  );
}
