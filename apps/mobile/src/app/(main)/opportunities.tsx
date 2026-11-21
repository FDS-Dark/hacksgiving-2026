import { ComingSoon } from '@/components/ComingSoon';
import { OpportunitiesAdmin } from '@/components/admin/OpportunitiesAdmin';
import { useAdmin } from '@/lib/admin';
import { NAV_ITEMS } from '@/lib/navigation';

export default function OpportunitiesScreen() {
  const { adminMode } = useAdmin();
  // Residents still get the placeholder; only admin mode shows the posting tools.
  if (adminMode) return <OpportunitiesAdmin />;
  return <ComingSoon item={NAV_ITEMS[1]} />;
}
