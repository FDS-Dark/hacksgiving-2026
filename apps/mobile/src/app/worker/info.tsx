import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { BackLink } from '@/components/admin/BackLink';
import { PostForm } from '@/components/admin/PostForm';
import { Badge } from '@/components/admin/requestBits';
import { Page } from '@/components/Page';
import { RedRule, SectionHeading } from '@/components/brand';
import { Button, Chip, Chips, EmptyState, Field, Notice, Txt, success } from '@/components/ui';
import { useAdmin } from '@/lib/admin';
import { CURRENT_USER, PARTNERS, STAFF } from '@/lib/directory';
import { FOLDERS, KIND_ICON, KIND_LABEL, emptyPost, shareText, type InfoPost } from '@/lib/infohub';
import { ago, today } from '@/lib/requests';
import { radius, space, useTheme } from '@/theme/tokens';

type View_ = { mode: 'list' } | { mode: 'read'; id: string } | { mode: 'edit'; post: InfoPost; isNew: boolean };

const ALL = 'All';
const TO_CONFIRM = 'To confirm';

const isExpired = (p: InfoPost) => !!p.expiresOn && p.expiresOn < today();
const needsMyAck = (p: InfoPost) => p.requireAck && !p.acknowledgedBy.includes(CURRENT_USER);

/** Who should confirm a post: staff, plus partner orgs when it's shared with them. */
function ackAudience(p: InfoPost) {
  return [...STAFF.map((s) => s.name), ...(p.audience === 'partners' ? PARTNERS.map((x) => x.name) : [])];
}

/**
 * The info hub: announcements, guides, contacts, forms, and links for
 * staff and partners, organized by folder and tag, with read receipts.
 */
export default function InfoHubScreen() {
  const { posts, savePost, removePost } = useAdmin();
  const [view, setView] = useState<View_>({ mode: 'list' });

  if (view.mode === 'edit') {
    return (
      <Page contentStyle={{ maxWidth: 820 }}>
        <SectionHeading title={view.isNew ? 'New Post' : 'Edit Post'} />
        <PostForm
          key={view.post.id}
          initial={view.post}
          isNew={view.isNew}
          onCancel={() => setView(view.isNew ? { mode: 'list' } : { mode: 'read', id: view.post.id })}
          onSave={(p) => {
            success();
            savePost(p);
            setView({ mode: 'read', id: p.id });
          }}
        />
      </Page>
    );
  }

  if (view.mode === 'read') {
    const post = posts.find((p) => p.id === view.id);
    if (post) {
      return (
        <PostView
          post={post}
          onBack={() => setView({ mode: 'list' })}
          onEdit={() => setView({ mode: 'edit', post, isNew: false })}
          onChange={savePost}
          onDelete={() => {
            removePost(post.id);
            setView({ mode: 'list' });
          }}
        />
      );
    }
  }

  return <PostList posts={posts} onOpen={(id) => setView({ mode: 'read', id })} onNew={() => setView({ mode: 'edit', post: emptyPost(CURRENT_USER), isNew: true })} />;
}

function PostList({ posts, onOpen, onNew }: { posts: InfoPost[]; onOpen: (id: string) => void; onNew: () => void }) {
  const { setAdminMode } = useAdmin();
  const [folder, setFolder] = useState<string>(ALL);
  const [query, setQuery] = useState('');
  const [showExpired, setShowExpired] = useState(false);

  const q = query.trim().toLowerCase();
  const matches = (p: InfoPost) =>
    (folder === ALL || (folder === TO_CONFIRM ? needsMyAck(p) : p.folder === folder)) &&
    (showExpired || !isExpired(p)) &&
    (!q || [p.title, p.body, p.folder, ...p.tags].join(' ').toLowerCase().includes(q) || p.tags.includes(q.replace(/^#/, '')));
  const shown = posts.filter(matches).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const toConfirm = posts.filter(needsMyAck).length;
  const expired = posts.filter(isExpired).length;

  return (
    <Page contentStyle={{ maxWidth: 900 }}>
      <SectionHeading title="Info Hub" kicker="Announcements, guides, contacts, and forms for staff and partners." />

      {toConfirm ? (
        <Notice icon="checkmark-circle-outline" tone="warning">
          {toConfirm === 1 ? '1 post needs' : `${toConfirm} posts need`} you to confirm you’ve read {toConfirm === 1 ? 'it' : 'them'}.
        </Notice>
      ) : null}

      <View style={styles.toolbar}>
        <View style={{ flexGrow: 1, flexBasis: 240 }}>
          <Field icon="search" placeholder="Search posts and tags" value={query} onChangeText={setQuery} autoCapitalize="none" />
        </View>
        <Button label="New post" icon="add-circle-outline" onPress={onNew} />
        {/* Postings are managed in place on the community Opportunities page. */}
        <Button
          label="Post an opportunity"
          icon="briefcase-outline"
          variant="tinted"
          onPress={() => {
            setAdminMode(true);
            router.navigate('/opportunities');
          }}
        />
      </View>

      <Chips scroll>
        {[ALL, ...(toConfirm ? [TO_CONFIRM] : []), ...FOLDERS].map((f) => (
          <Chip
            key={f}
            label={f}
            count={f === ALL ? undefined : f === TO_CONFIRM ? toConfirm : posts.filter((p) => p.folder === f && !isExpired(p)).length}
            active={folder === f}
            onPress={() => setFolder(f)}
          />
        ))}
      </Chips>

      {shown.length ? (
        <View style={{ gap: space.sm }}>
          {shown.map((p) => (
            <PostCard key={p.id} post={p} onPress={() => onOpen(p.id)} />
          ))}
        </View>
      ) : (
        <EmptyState icon="folder-open-outline" title="Nothing here yet" body={q ? 'No posts match your search.' : 'Add the first post to this folder.'} />
      )}

      {expired ? (
        <Button
          label={showExpired ? 'Hide expired posts' : `Show ${expired} expired`}
          variant="plain"
          onPress={() => setShowExpired(!showExpired)}
        />
      ) : null}
    </Page>
  );
}

function PostCard({ post: p, onPress }: { post: InfoPost; onPress: () => void }) {
  const theme = useTheme();
  const audience = ackAudience(p);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${KIND_LABEL[p.kind]}: ${p.title}${p.pinned ? ', pinned' : ''}`}
      style={({ pressed }) => [styles.card, { backgroundColor: theme.surface, borderColor: p.pinned ? theme.accent : theme.separator }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.kindIcon, { backgroundColor: theme.accentSoft }]}>
        <Ionicons name={KIND_ICON[p.kind]} size={20} color={theme.accent} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.badges}>
          {p.pinned ? <Badge label="Pinned" icon="pin" fg={theme.onAccent} bg={theme.accent} /> : null}
          <AudienceBadge post={p} />
          {needsMyAck(p) ? <Badge label="Please confirm" icon="alert-circle" fg={theme.soon} bg={theme.warningSoft} /> : null}
          {isExpired(p) ? <Badge label="Expired" fg={theme.textSecondary} bg={theme.fill} /> : null}
        </View>
        <Txt variant="headline" numberOfLines={2}>
          {p.title}
        </Txt>
        {p.body ? (
          <Txt variant="subhead" tone="secondary" numberOfLines={2}>
            {p.body}
          </Txt>
        ) : null}
        <Txt variant="caption" tone="tertiary">
          {[p.folder, `${p.author}, ${ago(p.updatedAt)}`, p.requireAck ? `${p.acknowledgedBy.length}/${audience.length} confirmed` : '', ...p.tags.map((t) => `#${t}`)]
            .filter(Boolean)
            .join(' · ')}
        </Txt>
      </View>
    </Pressable>
  );
}

function AudienceBadge({ post }: { post: InfoPost }) {
  const theme = useTheme();
  return post.audience === 'staff' ? (
    <Badge label="Staff only" icon="lock-closed" fg={theme.text} bg={theme.fill} />
  ) : (
    <Badge label="Shared with partners" icon="people" fg={theme.accent} bg={theme.accentSoft} />
  );
}

function PostView({
  post: p,
  onBack,
  onEdit,
  onChange,
  onDelete,
}: {
  post: InfoPost;
  onBack: () => void;
  onEdit: () => void;
  onChange: (p: InfoPost) => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const audience = ackAudience(p);
  const pending = audience.filter((n) => !p.acknowledgedBy.includes(n));

  const share = async () => {
    setShareNote(null);
    try {
      await Share.share({ title: p.title, message: shareText(p) });
    } catch {
      setShareNote('Sharing isn’t available here. Copy the text from the post instead.');
    }
  };
  const open = (url: string) => Linking.openURL(url).catch(() => setShareNote(`Couldn’t open ${url}`));

  return (
    <Page contentStyle={{ maxWidth: 820 }}>
      <BackLink label="Info Hub" onPress={onBack} />

      <View style={{ gap: space.sm }}>
        <View style={styles.badges}>
          <Badge label={KIND_LABEL[p.kind]} icon={KIND_ICON[p.kind]} fg={theme.accent} bg={theme.accentSoft} />
          <AudienceBadge post={p} />
          {p.pinned ? <Badge label="Pinned" icon="pin" fg={theme.onAccent} bg={theme.accent} /> : null}
        </View>
        <Txt variant="title" accessibilityRole="header">
          {p.title}
        </Txt>
        <Txt variant="footnote" tone="secondary">
          {p.folder} · {p.author}, updated {ago(p.updatedAt)}
          {p.expiresOn ? ` · until ${p.expiresOn}` : ''}
        </Txt>
        <RedRule width={26} />
      </View>

      {p.body ? (
        <Text selectable style={[styles.body, { color: theme.text }]}>
          {p.body}
        </Text>
      ) : null}

      {p.phone || p.email || p.link || p.attachment ? (
        <View style={styles.actions}>
          {p.phone ? <Button label={p.phone} icon="call-outline" variant="tinted" onPress={() => open(`tel:${p.phone.replace(/[^\d+]/g, '')}`)} /> : null}
          {p.email ? <Button label={p.email} icon="mail-outline" variant="tinted" onPress={() => open(`mailto:${p.email}`)} /> : null}
          {p.link ? <Button label="Open link" icon="open-outline" variant="tinted" onPress={() => open(p.link)} /> : null}
          {p.attachment ? <Button label={p.attachment.name} icon="document-outline" variant="tinted" onPress={() => open(p.attachment!.uri)} /> : null}
        </View>
      ) : null}

      {p.tags.length ? (
        <Txt variant="footnote" tone="secondary">
          {p.tags.map((t) => `#${t}`).join('  ')}
        </Txt>
      ) : null}

      {p.requireAck ? (
        <View style={[styles.ack, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          <Txt variant="headline">
            Read receipts: {p.acknowledgedBy.length} of {audience.length}
          </Txt>
          <View style={[styles.track, { backgroundColor: theme.fill }]}>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.accent, width: `${(p.acknowledgedBy.length / audience.length) * 100}%` }} />
          </View>
          {p.acknowledgedBy.length ? (
            <Txt variant="footnote" tone="secondary">
              Confirmed: {p.acknowledgedBy.join(', ')}
            </Txt>
          ) : null}
          {pending.length ? (
            <Txt variant="footnote" tone="secondary">
              Waiting on: {pending.join(', ')}
            </Txt>
          ) : null}
          {needsMyAck(p) ? (
            <Button
              label="I’ve read this"
              icon="checkmark-circle-outline"
              onPress={() => {
                success();
                onChange({ ...p, acknowledgedBy: [...p.acknowledgedBy, CURRENT_USER] });
              }}
              style={{ alignSelf: 'flex-start' }}
            />
          ) : null}
        </View>
      ) : null}

      {p.audience === 'staff' ? (
        <Notice icon="lock-closed-outline">Staff only. Check before sharing it outside ComForce.</Notice>
      ) : null}
      {shareNote ? <Notice icon="information-circle-outline">{shareNote}</Notice> : null}

      <View style={styles.actions}>
        <Button label="Share" icon="share-outline" onPress={share} />
        <Button label="Edit" icon="create-outline" variant="tinted" onPress={onEdit} />
        <Button
          label={p.pinned ? 'Unpin' : 'Pin'}
          icon="pin-outline"
          variant="tinted"
          onPress={() => onChange({ ...p, pinned: !p.pinned })}
        />
        <Button
          label={confirmDelete ? 'Tap again to delete' : 'Delete'}
          icon="trash-outline"
          variant="destructive"
          onPress={() => (confirmDelete ? onDelete() : setConfirmDelete(true))}
        />
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md },
  card: { flexDirection: 'row', gap: space.md, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  kindIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  body: { fontSize: 17, lineHeight: 26 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  ack: { gap: space.sm, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
});
