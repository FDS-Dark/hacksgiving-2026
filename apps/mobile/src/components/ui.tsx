import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toApiError } from '@/api/client';
import { radius, space, type, useTheme, type Theme } from '@/theme/tokens';

export type IconName = ComponentProps<typeof Ionicons>['name'];
/** An icon for an IconTile (MaterialCommunityIcons names). */
export type TileIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** A light tick for selection changes (checkboxes, filters). */
export function tap() {
  Haptics.selectionAsync().catch(() => undefined);
}

/** Confirms that something was saved. */
export function success() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

// ── Text ────────────────────────────────────────────────────────────────

type Variant = keyof typeof type;
type Tone = 'default' | 'secondary' | 'tertiary' | 'accent' | 'danger';

function toneColor(theme: Theme, tone: Tone) {
  return {
    default: theme.text,
    secondary: theme.textSecondary,
    tertiary: theme.textTertiary,
    accent: theme.accent,
    danger: theme.danger,
  }[tone];
}

export function Txt({
  variant = 'body',
  tone = 'default',
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone; color?: string }) {
  const theme = useTheme();
  return <Text {...rest} style={[type[variant], { color: color ?? toneColor(theme, tone) }, style]} />;
}

// ── Screens ─────────────────────────────────────────────────────────────

/** Screen padding. On iOS the scroll view's automatic content insets clear
 *  the status bar and the tab bar; elsewhere the top is padded by hand. */
function useScreenPadding(): ViewStyle {
  const insets = useSafeAreaInsets();
  return {
    paddingTop: Platform.OS === 'ios' ? space.sm : insets.top + space.sm,
    paddingBottom: space.xxl,
    paddingHorizontal: space.lg,
  };
}

function refresher(theme: Theme, refreshing?: boolean, onRefresh?: () => void) {
  return onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} /> : undefined;
}

/** A scrolling screen on the grouped background. */
export function Screen({
  children,
  refreshing,
  onRefresh,
  contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const padding = useScreenPadding();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.bg }}
      contentContainerStyle={[padding, { gap: space.xl }, contentStyle]}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={refresher(theme, refreshing, onRefresh)}
    >
      {children}
    </ScrollView>
  );
}

// ── Grouped lists ───────────────────────────────────────────────────────

function Separator() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.separator }]} />;
}

function GroupHeader({ children, color, icon }: { children: ReactNode; color?: string; icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={styles.groupHeaderRow}>
      {icon ? <Ionicons name={icon} size={15} color={color ?? theme.textSecondary} /> : null}
      <Txt variant="subhead" tone="secondary" color={color} style={styles.groupHeader} accessibilityRole="header">
        {children}
      </Txt>
    </View>
  );
}

/** A small rounded square with a white glyph, as in iOS Settings. Its
 *  color names a kind of thing (a storage kind, an action). */
export function IconTile({ icon, color, size = 30 }: { icon: TileIcon; color: string; size?: number }) {
  const theme = useTheme();
  return (
    <View
      accessible={false}
      style={{ width: size, height: size, borderRadius: size * 0.24, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}
    >
      <MaterialCommunityIcons name={icon} size={size * 0.6} color={theme.onTile} />
    </View>
  );
}

/** An inset grouped list: rows on one rounded surface, hairlines between. */
export function Group({
  header,
  headerColor,
  headerIcon,
  footer,
  children,
  style,
}: {
  header?: string;
  headerColor?: string;
  headerIcon?: IconName;
  footer?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={style}>
      {header ? (
        <GroupHeader color={headerColor} icon={headerIcon}>
          {header}
        </GroupHeader>
      ) : null}
      <View style={[styles.group, { backgroundColor: theme.surface }]}>
        {rows.map((row, i) => (
          <Fragment key={row.key ?? i}>
            {i > 0 ? <Separator /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <Txt variant="footnote" tone="secondary" style={styles.groupFooter}>
          {footer}
        </Txt>
      ) : null}
    </View>
  );
}

/** One row of a grouped list rendered by a FlatList, which can't wrap its
 *  rows in a <Group>. */
export function GroupItem({ index, count, children }: { index: number; count: number; children: ReactNode }) {
  const theme = useTheme();
  const first = index === 0;
  const last = index === count - 1;
  return (
    <View
      style={[
        { backgroundColor: theme.surface, overflow: 'hidden' },
        first && { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
        last && { borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
      ]}
    >
      {first ? null : <Separator />}
      {children}
    </View>
  );
}

type Accessory = 'chevron' | 'check' | 'none';

/** A list row: title, optional subtitle, optional detail on the right. */
export function Row({
  title,
  subtitle,
  detail,
  detailColor,
  detailTint,
  icon,
  tile,
  leading,
  tone = 'default',
  accessory,
  onPress,
  disabled,
  accessibilityLabel,
  accessibilityHint,
  right,
}: {
  title: string;
  subtitle?: string | null;
  detail?: string | null;
  detailColor?: string;
  /** Puts the detail in a pill on this background, for a status. */
  detailTint?: string;
  icon?: IconName;
  /** A colored icon tile before the title. */
  tile?: { icon: TileIcon; color: string };
  /** Custom content before the title, e.g. an avatar. */
  leading?: ReactNode;
  /** Accent and danger rows are actions ("Invite someone", "Sign out"). */
  tone?: 'default' | 'accent' | 'danger';
  accessory?: Accessory;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  right?: ReactNode;
}) {
  const theme = useTheme();
  const titleColor = tone === 'accent' ? theme.accent : tone === 'danger' ? theme.danger : theme.text;
  const content = (
    <>
      {leading}
      {tile ? <IconTile icon={tile.icon} color={tile.color} /> : null}
      {icon ? <Ionicons name={icon} size={22} color={tone === 'default' ? theme.textSecondary : titleColor} /> : null}
      <View style={{ flex: 1, gap: 1 }}>
        <Txt color={titleColor} numberOfLines={2}>
          {title}
        </Txt>
        {subtitle ? (
          <Txt variant="subhead" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Txt>
        ) : null}
      </View>
      {detail && detailTint ? (
        <View style={[styles.pill, { backgroundColor: detailTint }]}>
          <Txt variant="footnote" color={detailColor ?? theme.textSecondary} style={{ fontWeight: '600' }}>
            {detail}
          </Txt>
        </View>
      ) : detail ? (
        <Txt variant="subhead" color={detailColor ?? theme.textSecondary} style={{ textAlign: 'right' }}>
          {detail}
        </Txt>
      ) : null}
      {right}
      {accessory === 'chevron' ? <Ionicons name="chevron-forward" size={17} color={theme.textTertiary} /> : null}
      {accessory === 'check' ? <Ionicons name="checkmark" size={20} color={theme.accent} /> : null}
    </>
  );
  if (!onPress) {
    return (
      // A row with its own control (right) leaves that control reachable.
      <View style={styles.row} accessible={!right} accessibilityLabel={right ? undefined : accessibilityLabel}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, selected: accessory === 'check' }}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.fill }]}
    >
      {content}
    </Pressable>
  );
}

// ── Buttons ─────────────────────────────────────────────────────────────

type ButtonVariant = 'filled' | 'tinted' | 'plain' | 'destructive';

function buttonColors(theme: Theme, variant: ButtonVariant) {
  switch (variant) {
    case 'filled':
      return { bg: theme.accent, fg: theme.onAccent };
    case 'tinted':
      return { bg: theme.accentSoft, fg: theme.accent };
    case 'destructive':
      return { bg: theme.dangerSoft, fg: theme.danger };
    case 'plain':
      return { bg: 'transparent', fg: theme.accent };
  }
}

export function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'filled',
  icon,
  size = 'md',
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: ButtonVariant;
  icon?: IconName;
  size?: 'md' | 'lg';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { bg, fg } = buttonColors(theme, variant);
  const inactive = disabled || loading;
  const plain = variant === 'plain';
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        size === 'lg' && styles.buttonLg,
        plain && styles.buttonPlain,
        { backgroundColor: bg },
        pressed && { opacity: 0.6 },
        inactive && !loading && { opacity: 0.4 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={19} color={fg} /> : null}
          <Text style={[type.body, { color: fg, fontWeight: plain ? '400' : '600' }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** A filter or choice token. */
export function Chip({
  label,
  active,
  onPress,
  count,
  color,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  count?: number;
  /** The color of what the chip stands for (a storage kind, "use soon"):
   *  a dot when off, the fill when on. */
  color?: string;
}) {
  const theme = useTheme();
  const fg = active ? theme.onAccent : theme.text;
  const on = color ?? theme.accent;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      style={({ pressed }) => [styles.chip, { backgroundColor: active ? on : theme.fill }, pressed && { opacity: 0.7 }]}
    >
      {color && !active ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <Text style={[type.subhead, { color: fg, fontWeight: '500' }]}>{label}</Text>
      {count !== undefined ? <Text style={[type.subhead, { color: fg, opacity: 0.6 }]}>{count}</Text> : null}
    </Pressable>
  );
}

/** A row of chips. `scroll` makes it a horizontal strip that bleeds to the
 *  edges of a container with `inset` horizontal padding. */
export function Chips({ children, scroll = false, inset = space.lg }: { children: ReactNode; scroll?: boolean; inset?: number }) {
  if (scroll) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chipsRow, { paddingHorizontal: inset }]}
        style={{ marginHorizontal: -inset, flexGrow: 0 }}
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={styles.chipsWrap}>{children}</View>;
}

// ── Inputs ──────────────────────────────────────────────────────────────

/** A small label above a control in a form. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Txt variant="footnote" tone="secondary" style={{ paddingHorizontal: space.xs }}>
      {children}
    </Txt>
  );
}

export function Field({ label, icon, style, ...rest }: TextInputProps & { label?: string; icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <View style={[styles.field, { backgroundColor: theme.fill }]}>
        {icon ? <Ionicons name={icon} size={18} color={theme.textSecondary} /> : null}
        <TextInput
          placeholderTextColor={theme.textTertiary}
          selectionColor={theme.accent}
          {...rest}
          style={[styles.fieldInput, { color: theme.text }, style]}
        />
      </View>
    </View>
  );
}

// ── Feedback ────────────────────────────────────────────────────────────

/** What an empty list is for and what to do next. */
export function EmptyState({ icon, title, body, action }: { icon?: IconName; title: string; body: string; action?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      {icon ? <Ionicons name={icon} size={36} color={theme.textTertiary} style={{ marginBottom: space.xs }} /> : null}
      <Txt variant="headline" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt variant="subhead" tone="secondary" style={{ textAlign: 'center', maxWidth: 300 }}>
        {body}
      </Txt>
      {action ? <View style={{ marginTop: space.md, alignSelf: 'stretch', alignItems: 'center' }}>{action}</View> : null}
    </View>
  );
}

/** A failed request, with the API's request id when it sent one. */
export function ErrorBanner({ error: failure, onRetry }: { error: unknown; onRetry?: () => void }) {
  const theme = useTheme();
  const error = toApiError(failure);
  return (
    <View style={[styles.banner, { backgroundColor: theme.dangerSoft }]}>
      <Ionicons name="alert-circle" size={20} color={theme.danger} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt variant="subhead" tone="danger">
          {error.message}
        </Txt>
        {error.requestId ? (
          <Txt variant="caption" tone="secondary" selectable>
            Request {error.requestId}
          </Txt>
        ) : null}
      </View>
      {onRetry ? <Button label="Retry" variant="plain" onPress={onRetry} /> : null}
    </View>
  );
}

/** A neutral note, e.g. "You're offline". */
export function Notice({ icon, children, tone = 'neutral' }: { icon: IconName; children: ReactNode; tone?: 'neutral' | 'warning' }) {
  const theme = useTheme();
  const color = tone === 'warning' ? theme.soon : theme.textSecondary;
  return (
    <View style={[styles.banner, { backgroundColor: tone === 'warning' ? theme.warningSoft : theme.fill }]}>
      <Ionicons name={icon} size={18} color={color} />
      <Txt variant="subhead" color={color} style={{ flex: 1 }}>
        {children}
      </Txt>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.loading} accessible accessibilityLabel={label ?? 'Loading'}>
      <ActivityIndicator color={theme.textSecondary} />
      {label ? (
        <Txt variant="subhead" tone="secondary">
          {label}
        </Txt>
      ) : null}
    </View>
  );
}

// ── Sheet ───────────────────────────────────────────────────────────────

/** Bottom sheet over a dimmed backdrop. Tap the backdrop or the dismiss button to close. */
export function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  dismissLabel = 'Done',
  onShow,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Once the sheet has finished appearing: the moment another full-screen
   *  page may be presented over it (iOS drops one presented mid-animation). */
  onShow?: () => void;
  title?: string;
  subtitle?: string;
  /** "Cancel" when closing throws away what was entered. */
  dismissLabel?: 'Done' | 'Cancel';
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={onShow} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={onClose} accessibilityLabel="Close" />
        <View style={{ flex: 1 }} pointerEvents="box-none" />
        <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + space.lg }]}>
          <View style={[styles.sheetHandle, { backgroundColor: theme.separator }]} />
          <View style={styles.sheetHeader}>
            <View style={{ flex: 1, gap: 2 }}>
              {title ? <Txt variant="title">{title}</Txt> : null}
              {subtitle ? (
                <Txt variant="subhead" tone="secondary">
                  {subtitle}
                </Txt>
              ) : null}
            </View>
            <Button label={dismissLabel} variant="plain" onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.xl, paddingBottom: space.sm }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, marginHorizontal: -space.sm },
  topBarSide: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  group: { borderRadius: radius.lg, overflow: 'hidden' },
  groupHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, marginBottom: 6 },
  groupHeader: { fontWeight: '600' },
  pill: { borderRadius: 6, paddingHorizontal: space.sm, paddingVertical: 3 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  groupFooter: { paddingHorizontal: space.lg, marginTop: 6 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 44, paddingVertical: 11, paddingHorizontal: space.lg },
  button: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
    minHeight: 44,
  },
  buttonLg: { minHeight: 50 },
  buttonPlain: { paddingHorizontal: space.sm },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.sm, paddingHorizontal: space.md, minHeight: 32 },
  chipsRow: { gap: space.sm },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 44 },
  fieldInput: { flex: 1, fontSize: 17, paddingVertical: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, minHeight: 44 },
  stepperButton: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepperValue: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 6,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
  },
  stepperInput: { minWidth: 40, textAlign: 'center', padding: 0 },
  empty: { alignItems: 'center', gap: space.xs, paddingVertical: space.xl, paddingHorizontal: space.lg },
  banner: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.lg, paddingVertical: space.sm, paddingLeft: space.md, paddingRight: space.xs, minHeight: 44 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xl },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.lg, maxHeight: '90%' },
  sheetHandle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginRight: -space.sm },
});
