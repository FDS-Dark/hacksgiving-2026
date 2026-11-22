import { useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';

import { toApiError } from '@/api/client';
import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { HandoffBriefView, handoffCounts, handoffTitle } from '@/components/staff/HandoffBriefView';
import { Button, ErrorBanner, Loading, Notice } from '@/components/ui';
import { useHandoff, useSummarizeHandoff } from '@/services/oncall';
import { useStaffStatus } from '@/services/staff';
import { space, type, useTheme } from '@/theme/tokens';

/** One shift handoff brief, with "Summarize with AI" when the assistant is set up. */
export default function HandoffScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const me = useStaffStatus();
  const handoff = useHandoff(id);
  const summarize = useSummarizeHandoff(id);
  const aiOff = summarize.error ? toApiError(summarize.error).status === 503 : false;
  const h = handoff.data;

  return (
    <Page refreshing={handoff.isRefetching} onRefresh={() => handoff.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink label="Handoffs" fallback="/staff/handoffs" />
      {handoff.isPending ? (
        <Loading label="Loading the handoff" />
      ) : !h ? (
        <ErrorBanner error={handoff.error} onRetry={() => handoff.refetch()} />
      ) : (
        <>
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={{ fontSize: 26, fontWeight: '800', color: theme.text }}>
              {handoffTitle(h, me.data?.id)}
            </Text>
            <Text style={[type.subhead, { color: theme.textSecondary }]}>{handoffCounts(h)}</Text>
          </View>
          <HandoffBriefView handoff={h} />
          {h.summary_source === 'rules' ? (
            <Button label="Summarize with AI" icon="sparkles-outline" variant="tinted" loading={summarize.isPending} onPress={() => summarize.mutate()} />
          ) : null}
          {aiOff ? (
            <Notice icon="information-circle-outline">AI isn’t set up on this server. The summary above is still accurate.</Notice>
          ) : summarize.error ? (
            <ErrorBanner error={summarize.error} />
          ) : null}
        </>
      )}
    </Page>
  );
}
