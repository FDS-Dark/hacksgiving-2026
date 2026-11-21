import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BrandLogo } from '@/components/BrandLogo';
import { useNavItems, type NavItem } from '@/lib/navigation';
import { MAX_CONTENT_WIDTH, space, useTheme } from '@/theme/tokens';

/** At this width and up the links sit in one row beside the logo, like the website. */
const WIDE = 900;

/**
 * The top bar on every signed-in screen: logo (home), the section links,
 * and the account button. On narrow screens the links move to a second,
 * sideways-scrolling row, as they do on the website.
 */
export function AppHeader() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const wide = width >= WIDE;
  const navItems = useNavItems();

  return (
    <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.surface, borderBottomColor: theme.separator }]}>
      <View style={[styles.bar, wide && styles.barWide]}>
        <Pressable onPress={() => router.navigate('/')} accessibilityRole="link" accessibilityLabel="Community Task Force MKE home" hitSlop={8}>
          <BrandLogo width={wide ? 250 : Math.min(200, width * 0.55)} />
        </Pressable>

        {wide ? (
          <View style={styles.linksWide}>
            {navItems.map((item) => (
              <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
            ))}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        <AccountButton active={pathname.startsWith('/account')} />
      </View>

      {wide ? null : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.linksNarrow}>
          {navItems.map((item) => (
            <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

/** A bold text link with the site's green underline when active or hovered. */
function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  const lit = active || hovered;
  return (
    <Pressable
      onPress={() => router.navigate(item.href)}
      accessibilityRole="link"
      accessibilityState={{ selected: active }}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.linkText, { color: lit ? theme.accent : theme.text }]}>{item.label}</Text>
      <View style={[styles.underline, { backgroundColor: lit ? theme.accent : 'transparent' }]} />
    </Pressable>
  );
}

/** The round account button in the upper right. */
function AccountButton({ active }: { active: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => router.navigate('/account')}
      accessibilityRole="button"
      accessibilityLabel="Account"
      hitSlop={6}
      style={({ pressed }) => [
        styles.account,
        { backgroundColor: active ? theme.accent : theme.accentSoft },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Ionicons name="person" size={20} color={active ? theme.onAccent : theme.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 30 },
  bar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    minHeight: 64,
  },
  barWide: { minHeight: 88, gap: space.xxl, paddingTop: 0 },
  linksWide: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', gap: 36 },
  linksNarrow: { paddingHorizontal: space.lg, gap: space.xl },
  link: { paddingTop: space.md, paddingBottom: space.sm },
  linkText: { fontSize: 16, fontWeight: '800' },
  underline: { height: 3, marginTop: 6 },
  account: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
