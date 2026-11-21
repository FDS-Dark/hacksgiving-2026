import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toApiError } from '@/api/client';
import { BrandLogo } from '@/components/BrandLogo';
import { Button, ErrorBanner, Loading, Notice, type IconName } from '@/components/ui';
import { Card, ROLE_LABEL } from '@/components/worker/kit';
import { useBootstrapStaff, useStaffStatus } from '@/services/cases';
import { MAX_CONTENT_WIDTH, SERIF, space, type, useTheme } from '@/theme/tokens';

const NAV: { label: string; href: Href; match: (path: string) => boolean; icon: IconName; adminOnly?: boolean }[] = [
  { label: 'Dashboard', href: '/worker', match: (p) => p === '/worker', icon: 'grid-outline' },
  { label: 'Cases', href: '/worker/cases', match: (p) => p.startsWith('/worker/cases'), icon: 'file-tray-full-outline' },
  { label: 'Resources', href: '/worker/resources', match: (p) => p.startsWith('/worker/resources'), icon: 'library-outline' },
  { label: 'Insights', href: '/worker/insights', match: (p) => p.startsWith('/worker/insights'), icon: 'bulb-outline' },
  { label: 'Response', href: '/worker/response', match: (p) => p.startsWith('/worker/response'), icon: 'pulse-outline' },
  { label: 'Info hub', href: '/worker/info', match: (p) => p.startsWith('/worker/info'), icon: 'folder-open-outline' },
  { label: 'Team', href: '/worker/team', match: (p) => p.startsWith('/worker/team'), icon: 'people-outline' },
];

/**
 * The ComForce worker portal: staff only. Anyone else signed in gets the
 * gate below (the first person can claim admin; everyone else asks one).
 */
export default function WorkerLayout() {
  const theme = useTheme();
  const status = useStaffStatus();

  let body;
  if (status.isPending) body = <Loading label="Checking your staff access" />;
  else if (status.error) body = <Centered><ErrorBanner error={status.error} onRetry={() => status.refetch()} /></Centered>;
  else if (!status.data.is_worker) body = <StaffGate name={status.data.display_name} />;
  else
    body = (
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="cases/index" />
        <Stack.Screen name="cases/new" />
        <Stack.Screen name="cases/[id]" />
        <Stack.Screen name="resources" />
        <Stack.Screen name="insights" />
        <Stack.Screen name="response" />
        <Stack.Screen name="info" />
        <Stack.Screen name="team" />
      </Stack>
    );

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <WorkerHeader name={status.data?.display_name} role={status.data?.role} showNav={!!status.data?.is_worker} />
      {body}
    </View>
  );
}

function WorkerHeader({ name, role, showNav }: { name?: string | null; role?: keyof typeof ROLE_LABEL; showNav: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  // Seven links plus the brand and account need about 1200px; below that they scroll in a row.
  const wide = width >= 1200;

  const links = NAV.map((item) => <NavLink key={item.label} item={item} active={item.match(pathname)} />);

  return (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.charcoal }]}>
      <View style={styles.bar}>
        <Pressable onPress={() => router.navigate('/worker')} accessibilityRole="link" accessibilityLabel="Worker dashboard" style={styles.brand}>
          <View style={[styles.logoPlate]}>
            <BrandLogo mark width={34} />
          </View>
          <View>
            <Text style={[styles.brandTitle, { color: theme.onCharcoal }]}>ComForce MKE</Text>
            <Text style={styles.brandSub}>Staff portal</Text>
          </View>
        </Pressable>
        {wide && showNav ? <View style={styles.linksWide}>{links}</View> : <View style={{ flex: 1 }} />}
        <View style={styles.right}>
          {wide && name ? (
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[type.footnote, { color: theme.onCharcoal, fontWeight: '700' }]}>{name}</Text>
              {role ? <Text style={styles.brandSub}>{ROLE_LABEL[role]}</Text> : null}
            </View>
          ) : null}
          <Pressable
            onPress={() => router.navigate('/')}
            accessibilityRole="link"
            accessibilityLabel="Back to the community site"
            style={({ pressed }) => [styles.exit, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="exit-outline" size={18} color={theme.onCharcoal} />
            {wide ? <Text style={[type.footnote, { color: theme.onCharcoal }]}>Community site</Text> : null}
          </Pressable>
        </View>
      </View>
      {!wide && showNav ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.linksNarrow}>
          {links}
        </ScrollView>
      ) : null}
    </View>
  );
}

function NavLink({ item, active }: { item: (typeof NAV)[number]; active: boolean }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const lit = active || hovered;
  return (
    <Pressable
      onPress={() => router.navigate(item.href)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <View style={styles.linkInner}>
        <Ionicons name={item.icon} size={16} color={lit ? '#7BD9A2' : 'rgba(255,255,255,0.75)'} />
        <Text style={[styles.linkText, { color: lit ? '#FFFFFF' : 'rgba(255,255,255,0.8)' }]}>{item.label}</Text>
      </View>
      <View style={[styles.underline, { backgroundColor: active ? theme.red : 'transparent' }]} />
    </Pressable>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

/** For signed-in people who aren't staff (yet). */
function StaffGate({ name }: { name?: string | null }) {
  const theme = useTheme();
  const bootstrap = useBootstrapStaff();
  const taken = bootstrap.error && toApiError(bootstrap.error).status === 409;
  return (
    <Centered>
      <Card style={{ gap: space.lg }}>
        <Ionicons name="lock-closed-outline" size={32} color={theme.accent} />
        <Text style={[styles.gateTitle, { color: theme.text }]}>ComForce staff only</Text>
        <Text style={[type.subhead, { color: theme.textSecondary }]}>
          The worker portal is for Community Task Force MKE staff. Ask a staff admin to add you on their Team page
          {name ? <>, and tell them you signed in as <Text style={{ fontWeight: '700', color: theme.text }}>{name}</Text></> : null}.
        </Text>
        {taken ? (
          <Notice icon="information-circle-outline">Staff are already set up here, so an admin needs to add you.</Notice>
        ) : (
          <View style={{ gap: space.sm }}>
            <Text style={[type.footnote, { color: theme.textSecondary }]}>
              Setting up a new deployment? The first person to claim it becomes its admin.
            </Text>
            <Button label="Claim staff admin" icon="key-outline" variant="tinted" loading={bootstrap.isPending} onPress={() => bootstrap.mutate()} />
          </View>
        )}
        {bootstrap.error && !taken ? <ErrorBanner error={bootstrap.error} /> : null}
        <Button label="Back to the community site" variant="plain" onPress={() => router.navigate('/')} />
      </Card>
    </Centered>
  );
}

const styles = StyleSheet.create({
  header: { zIndex: 30 },
  bar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xl,
    paddingHorizontal: space.lg,
    minHeight: 64,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  logoPlate: { backgroundColor: '#FFFFFF', borderRadius: 8, padding: 4 },
  brandTitle: { fontFamily: SERIF, fontSize: 18, fontWeight: '800' },
  brandSub: { fontSize: 12, color: 'rgba(255,255,255,0.65)', fontWeight: '600' },
  linksWide: { flex: 1, flexDirection: 'row', gap: space.xl },
  linksNarrow: { paddingHorizontal: space.lg, gap: space.xl },
  link: { paddingTop: space.md },
  linkInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontSize: 15, fontWeight: '700' },
  underline: { height: 3, marginTop: space.sm },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  exit: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  centered: { flex: 1, padding: space.lg, alignItems: 'center', justifyContent: 'center', width: '100%', maxWidth: 560, alignSelf: 'center' },
  gateTitle: { fontFamily: SERIF, fontSize: 26, fontWeight: '700' },
});
