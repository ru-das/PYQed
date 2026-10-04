import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import { Button } from '../../src/components/ui';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from '../../src/haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { listSubjects, importSubjectFile, summaryLine, SubjectMeta } from '../../src/store/subjects';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../src/components/Toast';
import { Logo } from '../../src/components/Logo';
import { getSyllabusJob, subscribe } from '../../src/ai/syllabusJob';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';

/** Shows a running or finished background syllabus import; tap to go back to it. */
function SyllabusBanner() {
  const colors = useThemeColors();
  const router = useRouter();
  const job = useSyncExternalStore(subscribe, getSyllabusJob);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (job.status !== 'running') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job.status]);

  if (job.status !== 'running' && job.status !== 'done') return null;
  const sec = Math.max(0, Math.floor((now - job.startedAt) / 1000));
  const text =
    job.status === 'done'
      ? 'Syllabus ready to review'
      : `Reading your syllabus... ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return (
    <TouchableOpacity
      style={[styles.banner, { backgroundColor: colors.accent + '15', borderColor: colors.accent }]}
      onPress={() => router.push('/syllabus-import')}
      accessibilityLabel={text}
    >
      <Ionicons
        name={job.status === 'done' ? 'checkmark-circle' : 'hourglass-outline'}
        size={20}
        color={colors.accent}
      />
      <Text style={[styles.bannerText, { color: colors.text }]}>{text}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.accent} />
    </TouchableOpacity>
  );
}

export default function HomeScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const [subjects, setSubjects] = useState<SubjectMeta[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      listSubjects().then(setSubjects);
    }, [])
  );

  // Pick a .pyqed.json, validate + save it as a new subject. No API key needed.
  const openShared = async () => {
    try {
      // No mime filter: WhatsApp often hands over .pyqed.json as octet-stream.
      const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
      if (r.canceled || !r.assets?.length) return;
      const s = await importSubjectFile(r.assets[0].uri);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast(`Opened ${s.name}`);
      router.push({ pathname: '/subject/[id]', params: { id: s.id } });
    } catch (e: any) {
      Alert.alert('Could not open file', e?.message || 'Something went wrong.');
    }
  };

  if (subjects === null) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  if (subjects.length > 0) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <SyllabusBanner />
        <FlatList
          data={subjects}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ gap: Spacing.md, paddingBottom: Spacing.md }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => router.push({ pathname: '/subject/[id]', params: { id: item.id } })}
              accessibilityLabel={`Open ${item.name}`}
            >
              <View style={styles.optionHeader}>
                <Text style={[styles.optionTitle, { color: colors.text, flex: 1 }]}>{item.name}</Text>
                {!!item.code && (
                  <Text style={[styles.codeChip, { backgroundColor: colors.chip, color: colors.textSecondary }]}>
                    {item.code}
                  </Text>
                )}
              </View>
              <Text style={[styles.optionBody, { color: colors.textSecondary }]}>{summaryLine(item)}</Text>
            </TouchableOpacity>
          )}
        />
        <View style={styles.actions}>
          <Button label="Add subject" icon="add" onPress={() => router.push('/subject/edit')} />
          <View style={styles.actionRow}>
            <Button
              label="Import syllabus"
              variant="outline"
              icon="document-text-outline"
              onPress={() => router.push('/syllabus-import')}
              style={styles.half}
            />
            <Button
              label="Open shared"
              variant="outline"
              icon="folder-open-outline"
              onPress={openShared}
              style={styles.half}
              accessibilityLabel="Open a shared subject file"
            />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SyllabusBanner />
      <View style={styles.content}>
        <View style={{ marginBottom: Spacing.lg }}>
          <Logo size={112} />
        </View>

        <Text style={[styles.title, { color: colors.text }]}>No subjects yet</Text>
        <Text style={[styles.description, { color: colors.textSecondary }]}>
          Start from a syllabus, or set up a subject yourself.
        </Text>

        <View style={styles.cardContainer}>
          <TouchableOpacity
            style={[
              styles.optionCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => router.push('/syllabus-import')}
            accessibilityLabel="Import a syllabus"
          >
            <View style={styles.optionHeader}>
              <Ionicons name="document-text-outline" size={20} color={colors.accent} />
              <Text style={[styles.optionTitle, { color: colors.text }]}>
                Import a syllabus
              </Text>
            </View>
            <Text style={[styles.optionBody, { color: colors.textSecondary }]}>
              Pick a syllabus PDF, photo, or paste text. AI detects subjects, units, and topics.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.optionCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
            onPress={() => router.push('/subject/edit')}
            accessibilityLabel="Add subject manually"
          >
            <View style={styles.optionHeader}>
              <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
              <Text style={[styles.optionTitle, { color: colors.text }]}>
                Add subject manually
              </Text>
            </View>
            <Text style={[styles.optionBody, { color: colors.textSecondary }]}>
              Create a subject folder and add your units, topics, and papers one by one.
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.optionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={openShared}
            accessibilityLabel="Open shared subject"
          >
            <View style={styles.optionHeader}>
              <Ionicons name="folder-open-outline" size={20} color={colors.accent} />
              <Text style={[styles.optionTitle, { color: colors.text }]}>Open shared subject</Text>
            </View>
            <Text style={[styles.optionBody, { color: colors.textSecondary }]}>
              Got a .pyqed.json file? Open it here. No API key needed.
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  half: { flex: 1, paddingHorizontal: Spacing.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: FontSize.body - 1, fontWeight: '600' },
  codeChip: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
    overflow: 'hidden',
  },
  actions: { gap: Spacing.sm },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  container: {
    flex: 1,
    padding: Spacing.md,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
  },
  title: {
    fontSize: FontSize.h1,
    fontWeight: '700',
    marginBottom: Spacing.xs,
    textAlign: 'center',
  },
  description: {
    fontSize: FontSize.body,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  cardContainer: {
    width: '100%',
    gap: Spacing.md,
  },
  optionCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  optionTitle: {
    fontSize: FontSize.h3,
    fontWeight: '600',
  },
  optionBody: {
    fontSize: FontSize.caption,
    lineHeight: 18,
  },
});
