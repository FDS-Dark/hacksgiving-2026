import { router } from 'expo-router';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { RefreshError } from '@/components/RefreshError';
import { CaseListSkeleton } from '@/components/Skeleton';
import { PageTitle } from '@/components/staff/kit';
import { EmptyState, ErrorBanner, Group, Row } from '@/components/ui';
import { channelSubtitle, unreadLabel } from '@/lib/chat';
import { useChatChannels, type ChatChannel } from '@/services/chat';
import { space, useTheme } from '@/theme/tokens';

/**
 * Team chat: Team (all staff), On call (whoever is on now, plus admins), then
 * the case channels you belong to. Staff only; residents never see these.
 */
export default function ChatChannelsScreen() {
  const channels = useChatChannels();
  const all = channels.data ?? [];
  const shared = all.filter((c) => c.channel !== 'case');
  const cases = all.filter((c) => c.channel === 'case');

  return (
    <Page refreshing={channels.isRefetching} onRefresh={() => channels.refetch()} contentStyle={{ maxWidth: 720, gap: space.lg }}>
      <BackLink label="Today" fallback="/staff" />
      <PageTitle title="Team chat" subtitle="Coordinate with the team. Rapid response pings the channel's phones." />
      {channels.isPending ? (
        <CaseListSkeleton rows={3} />
      ) : !channels.data ? (
        <ErrorBanner error={channels.error} onRetry={() => channels.refetch()} />
      ) : (
        <>
          <RefreshError query={channels} what="the chat" />
          <Group header="Channels">
            {shared.map((c) => (
              <ChannelRow key={c.key} channel={c} />
            ))}
          </Group>
          {cases.length ? (
            <Group header="Case chats" footer="Staff only. The resident never sees these.">
              {cases.map((c) => (
                <ChannelRow key={c.key} channel={c} />
              ))}
            </Group>
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title="No case chats yet"
              body="Open a case and tap “Discuss this case” to talk it over with the team."
            />
          )}
        </>
      )}
    </Page>
  );
}

function ChannelRow({ channel: c }: { channel: ChatChannel }) {
  const theme = useTheme();
  const unread = unreadLabel(c);
  return (
    <Row
      title={c.channel === 'case' && c.case_title ? `${c.name} · ${c.case_title}` : c.name}
      subtitle={channelSubtitle(c)}
      icon={c.channel === 'team' ? 'people-outline' : c.channel === 'oncall' ? 'radio-outline' : 'folder-open-outline'}
      detail={unread}
      detailTint={unread ? (c.rapid_unread ? theme.dangerSoft : theme.accentSoft) : undefined}
      detailColor={unread ? (c.rapid_unread ? theme.danger : theme.accent) : undefined}
      accessory="chevron"
      accessibilityLabel={`${c.name}${unread ? `, ${unread}` : ''}`}
      onPress={() => router.push({ pathname: '/staff/chat/[id]', params: { id: c.key } })}
    />
  );
}
