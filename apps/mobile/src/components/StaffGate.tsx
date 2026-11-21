import type { ReactNode } from 'react';

import { EmptyState, ErrorBanner, Loading } from '@/components/ui';
import { useStaffStatus } from '@/services/cases';

/**
 * Shows its children only to ComForce workers and admins. The API enforces
 * this too (403 on /cases for members); this just explains it nicely.
 */
export function StaffGate({ children }: { children: ReactNode }) {
  const staff = useStaffStatus();
  if (staff.isPending) return <Loading label="Checking your access" />;
  if (staff.isError) return <ErrorBanner error={staff.error} onRetry={() => staff.refetch()} />;
  if (!staff.data.is_worker) {
    return (
      <EmptyState
        icon="lock-closed-outline"
        title="ComForce staff only"
        body="This portal is for ComForce MKE workers. If you work here, ask an admin to give your account the worker role."
      />
    );
  }
  return <>{children}</>;
}
