import { Badge } from '@/components/admin/requestBits';
import { PARTNER_STATUS_LABEL, type PartnerStatus } from '@/lib/services';
import { useTheme } from '@/theme/tokens';

/** Partner / In contact / Listed only / Inactive, with an icon so it isn't color alone. */
export function ServiceStatusBadge({ status }: { status: PartnerStatus }) {
  const theme = useTheme();
  const look = {
    partner: { fg: theme.onAccent, bg: theme.accent, icon: 'ribbon' as const },
    contacted: { fg: theme.accent, bg: theme.accentSoft, icon: 'chatbubbles' as const },
    listed: { fg: theme.textSecondary, bg: theme.fill, icon: 'list' as const },
    inactive: { fg: theme.textTertiary, bg: theme.fill, icon: 'pause' as const },
  }[status];
  return <Badge label={PARTNER_STATUS_LABEL[status]} icon={look.icon} fg={look.fg} bg={look.bg} />;
}
