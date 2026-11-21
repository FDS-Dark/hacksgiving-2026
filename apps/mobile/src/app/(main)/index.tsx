import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BrandLogo } from '@/components/BrandLogo';
import { Container, Page } from '@/components/Page';
import { Display, Green, RedRule, Ribbon, SectionHeading } from '@/components/brand';
import { useNavItems, type NavItem } from '@/lib/navigation';
import { SERIF, radius, space, useTheme } from '@/theme/tokens';

/** From the "trust row" and stats band on comforcemilwaukee.com. */
const VALUES = [
  { icon: 'location' as const, title: 'Community Driven', detail: 'Resident Focused' },
  { icon: 'time' as const, title: 'Always Ready', detail: '24/7 Response Mindset' },
  { icon: 'people' as const, title: 'Stronger Together', detail: 'Building Better Futures' },
];

const STATS = [
  { number: '10K+', label: 'Residents Served', small: 'Across Milwaukee' },
  { number: '75+', label: 'Community Initiatives', small: '& Projects' },
  { number: '24/7', label: 'Response & Support', small: 'When It Matters Most' },
  { number: '300+', label: 'Volunteers & Partners', small: 'Stronger Together' },
];

export default function HomeScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const columns = width >= 1100 ? 3 : width >= 640 ? 2 : 1;
  const navItems = useNavItems();

  return (
    <Page bleed>
      {/* Hero */}
      <View style={{ backgroundColor: theme.surface }}>
        <Container style={[styles.hero, wide && styles.heroWide]}>
          <View style={[styles.heroCopy, wide && { flex: 1.2 }]}>
            <Ribbon>We Empower. We Protect. We Uplift.</Ribbon>
            <Display size={wide ? 60 : 40}>
              Building Safer, <Green>Stronger</Green> Communities in <Green>Milwaukee</Green>
            </Display>
            <Text style={[styles.lede, { color: theme.textSecondary }]}>
              Find jobs and volunteer opportunities, connect with resources, and get the support you and your family need to thrive.
            </Text>
          </View>

          {wide ? (
            <View style={[styles.heroCard, { backgroundColor: theme.bg, borderColor: theme.separator }]}>
              <BrandLogo mark width={120} />
              <Text style={[styles.heroCardTitle, { color: theme.text }]}>Serving Milwaukee</Text>
              <Text style={[styles.heroCardBody, { color: theme.textSecondary }]}>With Compassion, Courage & Commitment</Text>
              <RedRule />
            </View>
          ) : null}
        </Container>

        <Container style={[styles.values, { borderTopColor: theme.separator }]}>
          {VALUES.map((v) => (
            <View key={v.title} style={styles.value}>
              <View style={[styles.valueIcon, { backgroundColor: theme.accentSoft }]}>
                <Ionicons name={v.icon} size={18} color={theme.accent} />
              </View>
              <View>
                <Text style={[styles.valueTitle, { color: theme.text }]}>{v.title}</Text>
                <Text style={[styles.valueDetail, { color: theme.textSecondary }]}>{v.detail}</Text>
              </View>
            </View>
          ))}
        </Container>
      </View>

      {/* Sections: the same places as the header bar, with a line on each. */}
      {navItems.length ? (
        <Container style={styles.section}>
          <SectionHeading title="How Can We Help?" kicker="Everything ComForce MKE offers, in one place." />
          <View style={styles.grid}>
            {navItems.map((item) => (
              <View key={item.href} style={{ width: `${100 / columns}%`, padding: space.sm }}>
                <SectionCard item={item} />
              </View>
            ))}
          </View>
        </Container>
      ) : null}

      {/* Stats band */}
      <View style={{ backgroundColor: theme.charcoal }}>
        <Container style={[styles.stats, { flexDirection: width >= 640 ? 'row' : 'column' }]}>
          {STATS.map((s) => (
            <View key={s.label} style={styles.stat}>
              <Text style={[styles.statNumber, { color: theme.onCharcoal }]}>{s.number}</Text>
              <Text style={[styles.statLabel, { color: theme.onCharcoal }]}>{s.label}</Text>
              <Text style={styles.statSmall}>{s.small}</Text>
            </View>
          ))}
        </Container>
      </View>
    </Page>
  );
}

/** A tappable card in the site's "service card" style: icon, title, line, red rule. */
function SectionCard({ item }: { item: NavItem }) {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={() => router.navigate(item.href)}
      accessibilityRole="link"
      accessibilityLabel={`${item.label}. ${item.blurb}`}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.surface,
          borderColor: hovered ? theme.accent : theme.separator,
          boxShadow: theme.shadow,
          transform: [{ translateY: hovered ? -2 : 0 }],
        },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={item.icon} size={36} color={theme.accent} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardTitle, { color: theme.text }]}>{item.label}</Text>
        <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{item.blurb}</Text>
        <RedRule width={26} style={{ marginTop: space.md }} />
      </View>
      <Ionicons name="chevron-forward" size={20} color={theme.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: { paddingVertical: space.xxl, gap: space.xxl },
  heroWide: { flexDirection: 'row', alignItems: 'center', paddingVertical: 64 },
  heroCopy: { gap: space.lg },
  lede: { fontSize: 17, lineHeight: 26, maxWidth: 560 },
  heroCard: { flex: 0.8, alignItems: 'center', gap: space.sm, padding: 40, borderWidth: 1, borderRadius: radius.md },
  heroCardTitle: { fontFamily: SERIF, fontSize: 28, fontWeight: '700', marginTop: space.md },
  heroCardBody: { fontSize: 16, textAlign: 'center' },
  values: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xl, paddingVertical: space.xl, borderTopWidth: StyleSheet.hairlineWidth },
  value: { flexDirection: 'row', alignItems: 'center', gap: space.md, minWidth: 200 },
  valueIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  valueTitle: { fontSize: 15, fontWeight: '800' },
  valueDetail: { fontSize: 13 },
  section: { paddingTop: 48, paddingBottom: 40, gap: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -space.sm },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.xl, borderWidth: 1, borderRadius: radius.md, minHeight: 130 },
  cardTitle: { fontSize: 18, fontWeight: '800' },
  cardBody: { fontSize: 15, lineHeight: 21, marginTop: 2 },
  stats: { paddingVertical: 40, gap: space.xl, justifyContent: 'space-between' },
  stat: { flex: 1, gap: 2 },
  statNumber: { fontFamily: SERIF, fontSize: 44, lineHeight: 46, fontWeight: '900' },
  statLabel: { fontSize: 16, fontWeight: '800', marginTop: space.xs },
  statSmall: { fontSize: 13, color: 'rgba(255,255,255,0.65)' },
});
