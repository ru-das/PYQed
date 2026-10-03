import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import { getSubject, summarize, summaryLine, Subject } from '../../src/store/subjects';

const TABS = ['Topics', 'All questions', 'Papers'] as const;

export default function SubjectScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [subject, setSubject] = useState<Subject | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Topics');

  useFocusEffect(useCallback(() => { getSubject(id).then(setSubject); }, [id]));

  if (!subject) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const empty = (icon: keyof typeof Ionicons.glyphMap, title: string, body: string, action?: React.ReactNode) => (
    <View style={styles.empty}>
      <Ionicons name={icon} size={40} color={colors.textSecondary} />
      <Text style={[styles.h3, { color: colors.text }]}>{title}</Text>
      <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>{body}</Text>
      {action}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Stack.Screen
        options={{
          title: subject.name,
          headerRight: () => (
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/subject/edit', params: { id: subject.id } })}
              accessibilityLabel="Edit subject"
              style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="pencil" size={20} color={colors.text} />
            </TouchableOpacity>
          ),
        }}
      />

      <Text style={[styles.title, { color: colors.text }]}>{subject.name}</Text>
      <Text style={{ color: colors.textSecondary }}>
        {[subject.code, summaryLine(summarize(subject))].filter(Boolean).join(' · ')}
      </Text>

      <View style={[styles.seg, { backgroundColor: colors.chip }]}>
        {TABS.map((t) => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} accessibilityLabel={`${t} tab`}
            style={[styles.segItem, tab === t && { backgroundColor: colors.card }]}>
            <Text style={{ color: tab === t ? colors.text : colors.textSecondary, fontWeight: '600', fontSize: FontSize.caption }}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'Topics' &&
        (subject.units.length === 0
          ? empty('list-outline', 'No syllabus yet', 'Add units and topics manually, or import a syllabus using Gemma 4.',
              <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={() => router.push('/syllabus-import')}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Import syllabus</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent }]}
                  onPress={() => router.push({ pathname: '/subject/edit', params: { id: subject.id } })}>
                  <Text style={{ color: colors.accentText, fontWeight: '700' }}>Add units</Text>
                </TouchableOpacity>
              </View>)
          : subject.units.map((u) => (
              <View key={u.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.h3, { color: colors.text }]}>{u.name}</Text>
                {u.topics.map((t) => (
                  <Text key={t.id} style={{ color: colors.textSecondary }}>• {t.name}</Text>
                ))}
              </View>
            )))}

      {tab === 'All questions' && empty('help-circle-outline', 'No questions yet', 'Add a past paper and its questions will show up here.')}
      {tab === 'Papers' && empty('document-text-outline', 'No papers yet', 'Paper import arrives in a later update.')}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.xl * 2 },
  title: { fontSize: FontSize.h1, fontWeight: '700' },
  h3: { fontSize: FontSize.h3, fontWeight: '700' },
  seg: { flexDirection: 'row', borderRadius: BorderRadius.button, padding: 3, marginVertical: Spacing.sm },
  segItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.button - 3 },
  card: { borderWidth: 1, borderRadius: BorderRadius.card, padding: Spacing.md, gap: 4 },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  btn: { minHeight: 48, paddingHorizontal: Spacing.lg, borderRadius: BorderRadius.button, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm },
});
