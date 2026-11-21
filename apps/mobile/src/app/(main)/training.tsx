import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Page } from '@/components/Page';
import { RedRule, SectionHeading } from '@/components/brand';
import { Button, Notice, success, tap } from '@/components/ui';
import { REQUIRED_MODULES, TRAINING_MODULES, type TrainingModule } from '@/lib/training';
import { radius, space, useTheme } from '@/theme/tokens';

/** The worker training course: modules to read through and mark done. Opened from Account. */
export default function TrainingScreen() {
  const theme = useTheme();
  // TODO: store progress with the API; for now it resets when the app restarts.
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<string | null>(TRAINING_MODULES[0].id);

  const requiredDone = REQUIRED_MODULES.filter((m) => done.has(m.id)).length;
  const ready = requiredDone === REQUIRED_MODULES.length;
  const progress = done.size / TRAINING_MODULES.length;

  const complete = (module: TrainingModule) => {
    success();
    setDone((prev) => new Set(prev).add(module.id));
    const next = TRAINING_MODULES.find((m) => m.id !== module.id && !done.has(m.id));
    setOpen(next?.id ?? null);
  };

  const undo = (module: TrainingModule) => {
    setDone((prev) => {
      const copy = new Set(prev);
      copy.delete(module.id);
      return copy;
    });
  };

  return (
    <Page contentStyle={{ maxWidth: 760 }}>
      <SectionHeading title="Worker Training" kicker="Everything you need before and between shifts." />

      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator, boxShadow: theme.shadow }]}>
        <View style={styles.progressHead}>
          <Text style={[styles.progressTitle, { color: theme.text }]}>
            {done.size} of {TRAINING_MODULES.length} modules done
          </Text>
          <Text style={[styles.progressDetail, { color: ready ? theme.accent : theme.textSecondary }]}>
            {ready ? 'Ready for the field' : `${REQUIRED_MODULES.length - requiredDone} required left`}
          </Text>
        </View>
        <View style={[styles.track, { backgroundColor: theme.fill }]}>
          <View style={[styles.bar, { backgroundColor: theme.accent, width: `${progress * 100}%` }]} />
        </View>
      </View>

      <Notice icon="information-circle-outline">Progress isn’t saved yet. It resets when you close the app.</Notice>

      <View style={{ gap: space.md }}>
        {TRAINING_MODULES.map((module, i) => (
          <ModuleCard
            key={module.id}
            module={module}
            number={i + 1}
            done={done.has(module.id)}
            open={open === module.id}
            onToggle={() => {
              tap();
              setOpen(open === module.id ? null : module.id);
            }}
            onComplete={() => complete(module)}
            onUndo={() => undo(module)}
          />
        ))}
      </View>
    </Page>
  );
}

function ModuleCard({
  module,
  number,
  done,
  open,
  onToggle,
  onComplete,
  onUndo,
}: {
  module: TrainingModule;
  number: number;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  onComplete: () => void;
  onUndo: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.module, { backgroundColor: theme.surface, borderColor: open ? theme.accent : theme.separator }]}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, checked: done }}
        accessibilityLabel={`Module ${number}: ${module.title}, ${module.minutes} minutes${module.required ? ', required' : ''}${done ? ', done' : ''}`}
        style={({ pressed }) => [styles.moduleHead, pressed && { opacity: 0.7 }]}
      >
        <View style={[styles.badge, { backgroundColor: done ? theme.accent : theme.accentSoft }]}>
          {done ? (
            <Ionicons name="checkmark" size={20} color={theme.onAccent} />
          ) : (
            <Ionicons name={module.icon} size={20} color={theme.accent} />
          )}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.moduleTitle, { color: theme.text }]}>
            {number}. {module.title}
          </Text>
          <Text style={[styles.moduleMeta, { color: theme.textSecondary }]}>
            {module.minutes} min{module.required ? ' · Required' : ' · Optional'}
          </Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textTertiary} />
      </Pressable>

      {open ? (
        <View style={styles.moduleBody}>
          <Text style={[styles.summary, { color: theme.textSecondary }]}>{module.summary}</Text>
          <RedRule width={26} />
          <View style={{ gap: space.sm }}>
            {module.points.map((point) => (
              <View key={point} style={styles.point}>
                <Ionicons name="ellipse" size={7} color={theme.accent} style={{ marginTop: 8 }} />
                <Text style={[styles.pointText, { color: theme.text }]}>{point}</Text>
              </View>
            ))}
          </View>
          {done ? (
            <Button label="Mark as not done" variant="plain" onPress={onUndo} style={{ alignSelf: 'flex-start' }} />
          ) : (
            <Button label="Mark as done" icon="checkmark-circle-outline" onPress={onComplete} style={{ alignSelf: 'flex-start' }} />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.xl, borderWidth: 1, borderRadius: radius.md },
  progressHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space.sm },
  progressTitle: { fontSize: 17, fontWeight: '800' },
  progressDetail: { fontSize: 15, fontWeight: '700' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  module: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  moduleHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  moduleTitle: { fontSize: 16, fontWeight: '800' },
  moduleMeta: { fontSize: 13 },
  moduleBody: { gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.lg, paddingLeft: space.lg + 40 + space.md },
  summary: { fontSize: 15, lineHeight: 22 },
  point: { flexDirection: 'row', gap: space.sm },
  pointText: { flex: 1, fontSize: 15, lineHeight: 22 },
});
