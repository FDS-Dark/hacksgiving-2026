import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { BackLink } from '@/components/BackLink';
import { Page } from '@/components/Page';
import { CaseListSkeleton } from '@/components/Skeleton';
import { PageTitle } from '@/components/staff/kit';
import { Button, EmptyState, ErrorBanner, Group, Row, type IconName } from '@/components/ui';
import { groupNotifications, notificationTime } from '@/lib/notifications';
import { useNotifications, useReadAll, useReadNotification, useUnreadCount, type NotificationItem } from '@/services/notifications';
import { useTheme } from '@/theme/tokens';

const KIND_ICON: Record<string, IconName> = {
  assignment: 'person-outline',
  reply: 'chatbubble-outline',
  task_due: 'time-outline',
  referral_update: 'checkmark',
  request_update: 'chatbubble-ellipses-outline',
};

/** Figma S7 "Notifications": everything a worker was sent, newest first, Today then Earlier; tap to open it. */
export default function NotificationsScreen() {
  const list = useNotifications();
  const readAll = useReadAll();
  const readOne = useReadNotification();
  const items = list.data ?? [];
  const unreadCount = useUnreadCount();
  const anyUnread = (unreadCount.data?.count ?? 0) > 0 || items.some((n) => !n.read_at);

  const open = (item: NotificationItem) => {
    if (!item.read_at) readOne.mutate(item.id);
    // A row whose case is gone has no route: marking it read is all there is.
    if (item.route) router.push(item.route as Href);
  };

  return (
    <Page refreshing={list.isRefetching} onRefresh={() => list.refetch()} contentStyle={{ maxWidth: 720, gap: 16 }}>
      <BackLink label="Today" fallback="/staff" />
      <PageTitle
        title="Notifications"
        right={<Button label="Mark read" variant="plain" disabled={!anyUnread} loading={readAll.isPending} onPress={() => readAll.mutate(null)} />}
      />
      {readAll.error ? <ErrorBanner error={readAll.error} /> : null}

      {list.isPending ? (
        <CaseListSkeleton rows={4} />
      ) : list.error && !list.data ? (
        <ErrorBanner error={list.error} onRetry={() => list.refetch()} />
      ) : items.length ? (
        groupNotifications(items, new Date()).map((group) => (
          <Group key={group.title} header={group.title}>
            {group.items.map((item) => (
              <NotificationRow key={item.id} item={item} onPress={() => open(item)} />
            ))}
          </Group>
        ))
      ) : (
        <EmptyState
          icon="notifications-outline"
          title="No notifications"
          body="Cases assigned to you, replies, tasks coming due and referral news show up here."
        />
      )}
    </Page>
  );
}

function NotificationRow({ item, onPress }: { item: NotificationItem; onPress: () => void }) {
  const theme = useTheme();
  const unread = !item.read_at;
  const time = notificationTime(item.created_at, new Date());
  return (
    <Row
      title={item.title}
      subtitle={item.body}
      detail={time}
      icon={KIND_ICON[item.kind] ?? 'notifications-outline'}
      accessory="chevron"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${item.title}. ${item.body}. ${time}`}
      right={unread ? <View style={[styles.dot, { backgroundColor: theme.accent }]} /> : undefined}
      onPress={onPress}
    />
  );
}

const styles = StyleSheet.create({
  dot: { width: 9, height: 9, borderRadius: 5 },
});
