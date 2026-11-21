import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Switch, Text, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Button, Chip, Chips, Field, FieldLabel, Txt, tap, type IconName } from '@/components/ui';
import type { Attachment } from '@/lib/opportunities';
import { radius, space, useTheme } from '@/theme/tokens';

/** Building blocks shared by the admin forms (postings, requests, info hub). */

/** A titled card that groups related fields. */
export function Section({ title, icon, children, style }: { title: string; icon: IconName; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.separator }, style]}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={20} color={theme.accent} />
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.text }]}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return (
    <Txt variant="footnote" tone="danger" style={{ paddingHorizontal: space.xs }}>
      {children}
    </Txt>
  );
}

/** A labeled text field with an error line. `half` sits it beside another in a <Pair>. */
export function Input({
  error,
  multiline,
  half,
  ...rest
}: TextInputProps & { label: string; icon?: IconName; error?: string; half?: boolean }) {
  return (
    <View style={[styles.input, half && styles.half]}>
      <Field
        {...rest}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : undefined}
        style={multiline ? { minHeight: 96 } : undefined}
        accessibilityHint={error}
      />
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

/** Two `half` inputs side by side; they stack when the screen is narrow. */
export function Pair({ children }: { children: ReactNode }) {
  return <View style={styles.pair}>{children}</View>;
}

/** Chips for one choice (value) or several (multi). */
export function Picker({
  label,
  options,
  labels,
  value,
  multi,
  onChange,
  error,
}: {
  label: string;
  options: readonly string[];
  labels?: Record<string, string>;
  value?: string | null;
  multi?: readonly string[];
  onChange: (option: string) => void;
  error?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <FieldLabel>{label}</FieldLabel>
      <Chips>
        {options.map((o) => (
          <Chip key={o} label={labels?.[o] ?? o} active={multi ? multi.includes(o) : value === o} onPress={() => onChange(o)} />
        ))}
      </Chips>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </View>
  );
}

export function Toggle({ label, detail, value, onChange }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
        {detail ? (
          <Txt variant="footnote" tone="secondary">
            {detail}
          </Txt>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          tap();
          onChange(v);
        }}
        accessibilityLabel={label}
        trackColor={{ true: theme.accent, false: theme.separator }}
        thumbColor="#FFFFFF"
        // react-native-web colors the "on" thumb separately.
        {...(Platform.OS === 'web' ? { activeThumbColor: '#FFFFFF' } : {})}
      />
    </View>
  );
}

/** Large radio cards for the first, defining choice of a form. */
export function ChoiceCards<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; icon: IconName; title: string; body: string }[];
}) {
  const theme = useTheme();
  return (
    <View style={styles.cards}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              tap();
              onChange(o.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={[styles.card, { borderColor: on ? theme.accent : theme.separator, backgroundColor: on ? theme.accentSoft : theme.surface }]}
          >
            <Ionicons name={o.icon} size={26} color={theme.accent} />
            <Text style={[styles.cardTitle, { color: theme.text }]}>{o.title}</Text>
            <Text style={[styles.cardBody, { color: theme.textSecondary }]}>{o.body}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Upload one PDF or image (up to 10 MB), shown with its name and size. */
export function AttachmentField({
  value,
  onChange,
  label = 'Upload a PDF or image',
  hint = 'Optional. Up to 10 MB.',
  error,
}: {
  value: Attachment | null;
  onChange: (file: Attachment | null) => void;
  label?: string;
  hint?: string;
  error?: string;
}) {
  const theme = useTheme();
  const [pickError, setPickError] = useState<string | null>(null);
  const pick = async () => {
    setPickError(null);
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (result.canceled) return;
    const file = result.assets[0];
    if (file.size && file.size > MAX_ATTACHMENT_BYTES) {
      setPickError('That file is over 10 MB.');
      return;
    }
    onChange({ name: file.name, uri: file.uri, mimeType: file.mimeType, size: file.size });
  };
  return (
    <View style={{ gap: space.sm }}>
      {value ? (
        <View style={[styles.file, { backgroundColor: theme.fill }]}>
          <Ionicons name={value.mimeType?.startsWith('image/') ? 'image-outline' : 'document-outline'} size={22} color={theme.accent} />
          <View style={{ flex: 1 }}>
            <Txt numberOfLines={1}>{value.name}</Txt>
            {value.size ? (
              <Txt variant="footnote" tone="secondary">
                {(value.size / 1024).toFixed(0)} KB
              </Txt>
            ) : null}
          </View>
          <Button label="Remove" variant="plain" onPress={() => onChange(null)} />
        </View>
      ) : (
        <Button label={label} variant="tinted" icon="cloud-upload-outline" onPress={pick} style={{ alignSelf: 'flex-start' }} />
      )}
      {pickError || error ? <ErrorText>{pickError ?? error}</ErrorText> : null}
      <Txt variant="footnote" tone="secondary">
        {hint}
      </Txt>
    </View>
  );
}

/** The "fix these fields" box above a form's buttons. */
export function FormErrors({ fields }: { fields: string[] }) {
  const theme = useTheme();
  if (!fields.length) return null;
  return (
    <View style={[styles.errorBox, { backgroundColor: theme.dangerSoft }]}>
      <Ionicons name="alert-circle" size={20} color={theme.danger} />
      <Txt variant="subhead" tone="danger" style={{ flex: 1 }}>
        Fix {fields.length === 1 ? 'this field' : `these ${fields.length} fields`}: {fields.join(', ')}
      </Txt>
    </View>
  );
}

/** A row of buttons that wraps. */
export function Actions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}

const styles = StyleSheet.create({
  section: { gap: space.lg, padding: space.lg, borderWidth: 1, borderRadius: radius.md },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  input: { gap: 4 },
  half: { flexGrow: 1, flexBasis: 200 },
  pair: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  file: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  card: { flexGrow: 1, flexBasis: 200, gap: space.xs, padding: space.lg, borderWidth: 2, borderRadius: radius.md },
  cardTitle: { fontSize: 17, fontWeight: '800', marginTop: space.xs },
  cardBody: { fontSize: 14, lineHeight: 20 },
});
