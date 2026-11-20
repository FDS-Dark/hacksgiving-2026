import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { IconName } from '@/components/ui';
import { SERIF, radius, space, useTheme } from '@/theme/tokens';

/**
 * Pieces that carry the ComForce website's look: the green ribbon, the
 * ruled section heading, the short red rule, and the site's buttons.
 */

/** The short red bar under card titles and callouts. */
export function RedRule({ width = 40, style }: { width?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View accessible={false} style={[{ width, height: width > 30 ? 4 : 3, backgroundColor: theme.red }, style]} />;
}

/** The green arrow-ended banner above the hero headline. */
export function Ribbon({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <View style={styles.ribbonRow}>
      <View style={[styles.ribbon, { backgroundColor: theme.accent }]}>
        <Text style={[styles.ribbonText, { color: theme.onAccent }]}>{children}</Text>
      </View>
      {/* The point: a right-facing triangle drawn with borders. */}
      <View style={[styles.ribbonTip, { borderLeftColor: theme.accent }]} />
    </View>
  );
}

/** An uppercase heading centered between two green rules. */
export function SectionHeading({ title, kicker }: { title: string; kicker?: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.headingRow}>
        <View style={[styles.headingRule, { backgroundColor: theme.accent }]} />
        <Text accessibilityRole="header" style={[styles.heading, { color: theme.text }]}>
          {title}
        </Text>
        <View style={[styles.headingRule, { backgroundColor: theme.accent }]} />
      </View>
      {kicker ? <Text style={[styles.kicker, { color: theme.textSecondary }]}>{kicker}</Text> : null}
    </View>
  );
}

/** Serif display text, with optional green words: pass strings and <Green>…</Green>. */
export function Display({ children, size = 44 }: { children: ReactNode; size?: number }) {
  const theme = useTheme();
  return (
    <Text accessibilityRole="header" style={{ fontFamily: SERIF, fontSize: size, lineHeight: size * 1.02, fontWeight: '700', color: theme.text }}>
      {children}
    </Text>
  );
}

export function Green({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ color: theme.accent }}>{children}</Text>;
}

/** The site's button: solid green ("primary") or white with a gray border ("outline"). */
export function LinkButton({
  href,
  label,
  variant = 'primary',
  icon = 'arrow-forward',
}: {
  href: Href;
  label: string;
  variant?: 'primary' | 'outline';
  icon?: IconName;
}) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const fg = primary ? theme.onAccent : theme.text;
  return (
    <Pressable
      onPress={() => router.navigate(href)}
      accessibilityRole="link"
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: pressed ? theme.accentPressed : theme.accent, boxShadow: '0 10px 20px rgba(15, 107, 58, 0.18)' }
          : { backgroundColor: theme.surface, borderColor: pressed ? theme.accent : theme.separator },
      ]}
    >
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
      <Ionicons name={icon} size={17} color={fg} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ribbonRow: { flexDirection: 'row', alignSelf: 'flex-start' },
  ribbon: { paddingVertical: 5, paddingLeft: 14, paddingRight: 8 },
  ribbonText: { fontSize: 13, lineHeight: 18, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' },
  ribbonTip: {
    width: 0,
    height: 0,
    borderTopWidth: 14,
    borderBottomWidth: 14,
    borderLeftWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  headingRule: { flex: 1, height: 2, minWidth: 28 },
  heading: { fontSize: 24, fontWeight: '900', textTransform: 'uppercase', textAlign: 'center', flexShrink: 1 },
  kicker: { fontSize: 16, lineHeight: 24, textAlign: 'center', maxWidth: 720, alignSelf: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    minHeight: 46,
    paddingHorizontal: 22,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  buttonText: { fontSize: 15, fontWeight: '800' },
});
