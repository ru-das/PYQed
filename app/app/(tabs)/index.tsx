import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { useRouter, useFocusEffect } from 'expo-router';
import { listSubjects, importSubjectFile, summaryLine, SubjectMeta } from '../../src/store/subjects';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';

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
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.importBtn, { borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: Spacing.sm }]}
            onPress={openShared}
            accessibilityLabel="Open shared subject"
          >
            <Ionicons name="download-outline" size={20} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.importBtn, { borderColor: colors.accent, backgroundColor: colors.card }]}
            onPress={() => router.push('/syllabus-import')}
            accessibilityLabel="Import syllabus"
          >
            <Ionicons name="document-text-outline" size={18} color={colors.accent} />
            <Text style={[styles.importBtnText, { color: colors.accent }]}>Import syllabus</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.accent, flex: 1 }]}
            onPress={() => router.push('/subject/edit')}
            accessibilityLabel="Add subject"
          >
            <Ionicons name="add" size={20} color={colors.accentText} />
            <Text style={[styles.addBtnText, { color: colors.accentText }]}>Add subject</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Ionicons name="documents-outline" size={44} color={colors.accent} />
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
              <Ionicons name="download-outline" size={20} color={colors.accent} />
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
  codeChip: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
    overflow: 'hidden',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 48,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },
  importBtnText: {
    fontSize: FontSize.body - 1,
    fontWeight: '700',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 48,
    borderRadius: BorderRadius.button,
  },
  addBtnText: { fontSize: FontSize.body, fontWeight: '700' },
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
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.lg,
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
