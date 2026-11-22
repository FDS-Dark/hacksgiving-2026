import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { KnowledgeHit } from '@/api/types';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { EmptyState, ErrorBanner, Field, Loading } from '@/components/ui';
import { timeAgo } from '@/lib/format';
import { useKnowledgeSearch } from '@/services/attachments';
import { space, type, useTheme } from '@/theme/tokens';

const KIND: Record<KnowledgeHit['kind'], { label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  resource: { label: 'Resource', icon: 'business-outline' },
  case: { label: 'Resolved case', icon: 'checkmark-done-outline' },
  note: { label: 'Note on a resolved case', icon: 'document-text-outline' },
  attachment: { label: 'File', icon: 'attach-outline' },
};

/** "«matched» words" → text runs, the matches bold. */
function Snippet({ text }: { text: string }) {
  const theme = useTheme();
  const parts = text.split(/(«[^»]*»)/g).filter(Boolean);
  return (
    <Text style={[type.footnote, { color: theme.textSecondary }]} numberOfLines={3}>
      {parts.map((p, i) =>
        p.startsWith('«') ? (
          <Text key={i} style={{ color: theme.text, fontWeight: '700' }}>
            {p.slice(1, -1)}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

/**
 * Knowledge search: what the team already knows, in one box. The resource
 * directory, cases that were resolved or closed, the notes on them, and the
 * notes on attached files. Plain full-text search, no AI.
 */
export default function KnowledgeScreen() {
  const theme = useTheme();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  // Search as you type, a moment after the typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 300);
    return () => clearTimeout(t);
  }, [text]);
  const search = useKnowledgeSearch(query);

  const open = (hit: KnowledgeHit) => {
    if (hit.case_id) router.push({ pathname: '/staff/cases/[id]', params: { id: hit.case_id } });
  };

  return (
    <Page contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink to="/staff/me" label="Me" />
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Knowledge search
        </Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          Resources, resolved cases and their notes, and attached files: what worked before.
        </Text>
      </View>
      <Field icon="search-outline" placeholder="e.g. burial grant, eviction notice, Spanish shelter" value={text} onChangeText={setText} autoFocus returnKeyType="search" />

      {query.trim().length < 2 ? null : search.isPending ? (
        <Loading label="Searching" />
      ) : search.error ? (
        <ErrorBanner error={search.error} onRetry={() => search.refetch()} />
      ) : search.data?.length ? (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
          {search.data.map((hit, i) => (
            <Pressable
              key={`${hit.kind}-${hit.id}`}
              onPress={() => open(hit)}
              disabled={!hit.case_id}
              accessibilityRole={hit.case_id ? 'button' : 'text'}
              style={({ pressed }) => [styles.row, i > 0 && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth }, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name={KIND[hit.kind].icon} size={20} color={theme.accent} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[type.caption, { color: theme.textSecondary, fontWeight: '700' }]}>
                  {KIND[hit.kind].label.toUpperCase()}
                  {hit.at ? ` · ${timeAgo(hit.at)}` : ''}
                </Text>
                <Text style={[type.subhead, { color: theme.text, fontWeight: '600' }]} numberOfLines={2}>
                  {hit.title}
                </Text>
                <Snippet text={hit.snippet} />
              </View>
              {hit.case_id ? <Ionicons name="chevron-forward" size={18} color={theme.textTertiary} /> : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <EmptyState icon="search-outline" title="Nothing found" body="Try fewer or different words. Only resolved and closed cases are searched." />
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '800' },
  list: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.md },
});
