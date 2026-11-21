import { ComingSoon } from '@/components/ComingSoon';
import { OpportunitiesAdmin } from '@/components/admin/OpportunitiesAdmin';
import { useAdmin } from '@/lib/admin';
import { NAV_ITEMS } from '@/lib/navigation';
import { useStaffStatus } from '@/services/cases';

export default function OpportunitiesScreen() {
  const { adminMode } = useAdmin();
  const staff = useStaffStatus();
  // Residents still get the placeholder; staff in admin mode get the posting tools.
  if (adminMode && staff.data?.is_worker) return <OpportunitiesAdmin />;
  return <ComingSoon item={NAV_ITEMS[1]} />;
}
