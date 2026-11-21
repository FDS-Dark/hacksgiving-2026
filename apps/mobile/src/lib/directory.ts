/**
 * Staff and partner organizations. Sample data until the admin API exists;
 * the admin pages read every list of people and orgs from here.
 */

export const STAFF = [
  { name: 'Aisha Brown', role: 'Team lead', trainingDone: 8 },
  { name: 'Maria Santos', role: 'Outreach worker', trainingDone: 8 },
  { name: 'Jordan Ellis', role: 'Volunteer', trainingDone: 6 },
  { name: 'Devon Hughes', role: 'Volunteer', trainingDone: 2 },
  { name: 'Sam Nguyen', role: 'Partner staff', trainingDone: 0 },
] as const;

export const PARTNERS = [
  { name: 'Northside Food Pantry', kind: 'Food', status: 'Active' },
  { name: 'Harbor House Shelter', kind: 'Shelter', status: 'Active' },
  { name: 'MKE Rides Collective', kind: 'Transportation', status: 'Pending' },
  { name: 'Sojourner Family Peace Center', kind: 'Domestic violence', status: 'Active' },
] as const;

/** Who is using the admin pages. TODO: the signed-in user once admin requires sign-in. */
export const CURRENT_USER = 'Aisha Brown';

/** Staff who can own a request (partners get referrals instead). */
export const ASSIGNABLE = STAFF.filter((s) => s.role !== 'Volunteer' && s.role !== 'Partner staff').map((s) => s.name);
