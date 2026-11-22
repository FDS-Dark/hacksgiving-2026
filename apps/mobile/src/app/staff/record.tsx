import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Group, Row, Txt } from '@/components/ui';
import { radius, space, useTheme } from '@/theme/tokens';

/**
 * The raised Record tab: a small chooser between the two ways to start
 * work (cognitive-load review, top 10 #7: "Record meant Debrief", and New
 * case hid under Queue). Presented over the current screen; picking one
 * swaps this chooser for that form, so Back from the form returns to where
 * the worker was.
 */
export default function RecordChooser() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/staff'));
  return (
    <View style={styles.fill}>
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: theme.overlay }]} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: theme.bg, paddingBottom: insets.bottom + space.lg }]} accessibilityViewIsModal>
        <View style={[styles.handle, { backgroundColor: theme.separator }]} />
        <View style={styles.head}>
          <Txt variant="title" style={{ flex: 1 }} accessibilityRole="header">
            Record
          </Txt>
          <Button label="Cancel" variant="plain" onPress={close} />
        </View>
        <Group>
          <Row
            title="New case"
            subtitle="Someone on the street, on the phone or walking in"
            tile={{ icon: 'folder-plus-outline', color: theme.accent }}
            accessory="chevron"
            accessibilityLabel="New case: someone on the street, on the phone or walking in"
            onPress={() => router.replace('/staff/cases/new')}
          />
          <Row
            title="Debrief"
            subtitle="A note after a visit or call, typed or spoken"
            tile={{ icon: 'microphone-outline', color: theme.accent }}
            accessory="chevron"
            accessibilityLabel="Debrief: a note after a visit or call, typed or spoken"
            onPress={() => router.replace('/staff/records/new')}
          />
        </Group>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.lg },
  handle: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3 },
  head: { flexDirection: 'row', alignItems: 'center', marginRight: -space.sm },
});
