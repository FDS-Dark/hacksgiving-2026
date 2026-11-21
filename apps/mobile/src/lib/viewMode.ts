/**
 * Staff land on the staff app (/staff). "Switch to community view" on the
 * Me tab opens the resident home instead, for the rest of this session.
 */
import { router } from 'expo-router';

let communityView = false;

export function prefersCommunityView() {
  return communityView;
}

export function showCommunityView() {
  communityView = true;
  router.replace('/');
}
