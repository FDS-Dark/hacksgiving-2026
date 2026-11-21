import { StyleSheet, Text, View } from 'react-native';

import { toApiError } from '@/api/client';
import type { Case } from '@/api/types';
import { Card, CardTitle } from '@/components/staff/kit';
import { Button, ErrorBanner, Notice } from '@/components/ui';
import { useCaseAssist } from '@/services/cases';
import { space, type, useTheme } from '@/theme/tokens';

/** On-demand AI help. Suggestions only: the worker reads, edits and decides. */
export function CaseAssist({ item: c }: { item: Case }) {
  const theme = useTheme();
  const assist = useCaseAssist(c.id);
  const unavailable = [assist.summary.error].some((e) => e && toApiError(e).status === 503);

  return (
    <Card>
      <CardTitle title="Assistant" icon="sparkles-outline" />
      <View style={styles.quick}>
        <Button label="Summarize case" icon="reader-outline" variant="tinted" loading={assist.summary.isPending} onPress={() => assist.summary.mutate()} />
      </View>
      {unavailable ? (
        <Notice icon="cloud-offline-outline">AI assistance isn’t configured on this server. Everything else works without it.</Notice>
      ) : null}
      {assist.summary.data ? (
        <View style={[styles.summary, { backgroundColor: theme.accentSoft }]}>
          <Text style={[type.subhead, { color: theme.text }]} selectable>{assist.summary.data.summary}</Text>
          {assist.summary.data.next_steps.length ? (
            <View style={{ gap: 4 }}>
              <Text style={[type.caption, { color: theme.textSecondary, fontWeight: '700' }]}>SUGGESTED NEXT STEPS</Text>
              {assist.summary.data.next_steps.map((s) => (
                <Text key={s} style={[type.footnote, { color: theme.text }]}>• {s}</Text>
              ))}
            </View>
          ) : null}
          <Text style={[type.caption, { color: theme.textSecondary }]}>AI-generated from this case’s record. Check it before relying on it.</Text>
        </View>
      ) : null}
      {[assist.summary.error].map((e, i) => (e && !unavailable ? <ErrorBanner key={i} error={e} /> : null))}
    </Card>
  );
}

const styles = StyleSheet.create({
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  summary: { borderRadius: 8, padding: space.md, gap: space.sm },
});
