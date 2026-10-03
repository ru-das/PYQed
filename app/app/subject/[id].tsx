import React, { useCallback, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import { getSubject, saveSubject, summarize, summaryLine, Subject } from '../../src/store/subjects';

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

      {tab === 'All questions' &&
        (subject.questions.length === 0
          ? empty(
              'help-circle-outline',
              'No questions yet',
              'Add past exam papers to extract and organize questions.',
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.accent }]}
                onPress={() =>
                  router.push({
                    pathname: '/paper-import',
                    params: { subjectId: subject.id },
                  })
                }
              >
                <Text style={{ color: colors.accentText, fontWeight: '700' }}>
                  Add past papers
                </Text>
              </TouchableOpacity>,
            )
          : (
            <View style={{ gap: Spacing.sm }}>
              <Text style={[styles.h3, { color: colors.text }]}>
                All Questions ({subject.questions.length})
              </Text>
              {subject.questions.map((q) => (
                <View
                  key={q.id}
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor: q.needsReview ? colors.amber : colors.border,
                    },
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                    <View style={[styles.chip, { backgroundColor: colors.chip }]}>
                      <Text style={[styles.chipText, { color: colors.text }]}>{q.number}</Text>
                    </View>
                    {q.marks !== null ? (
                      <View style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}>
                        <Text style={[styles.chipText, { color: colors.text }]}>{q.marks} m</Text>
                      </View>
                    ) : (
                      <View style={[styles.chip, { backgroundColor: colors.amberBg }]}>
                        <Text style={[styles.chipText, { color: colors.amber }]}>? marks</Text>
                      </View>
                    )}
                    <View style={[styles.chip, { backgroundColor: colors.chip }]}>
                      <Text style={[styles.chipText, { color: colors.textSecondary }]}>{q.type}</Text>
                    </View>
                    {q.year && (
                      <View style={[styles.chip, { backgroundColor: colors.chip }]}>
                        <Text style={[styles.chipText, { color: colors.textSecondary }]}>{q.year}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ color: colors.text, fontSize: FontSize.body - 1, lineHeight: 22, marginTop: 4 }}>
                    {q.text}
                  </Text>
                  {q.group ? (
                    <Text style={{ color: colors.textSecondary, fontSize: FontSize.tiny, fontWeight: '600' }}>
                      {q.group}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ))}

      {tab === 'Papers' &&
        (subject.papers.length === 0
          ? empty(
              'document-text-outline',
              'No papers yet',
              'Add past university question papers (PDF or photos) to extract and bank questions.',
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: colors.accent }]}
                onPress={() =>
                  router.push({
                    pathname: '/paper-import',
                    params: { subjectId: subject.id },
                  })
                }
              >
                <Text style={{ color: colors.accentText, fontWeight: '700' }}>
                  Add past papers
                </Text>
              </TouchableOpacity>,
            )
          : (
            <View style={{ gap: Spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={[styles.h3, { color: colors.text }]}>
                  Past Papers ({subject.papers.length})
                </Text>
                <TouchableOpacity
                  style={[styles.smallBtn, { backgroundColor: colors.accent }]}
                  onPress={() =>
                    router.push({
                      pathname: '/paper-import',
                      params: { subjectId: subject.id },
                    })
                  }
                >
                  <Ionicons name="add" size={16} color={colors.accentText} />
                  <Text style={{ color: colors.accentText, fontWeight: '700', fontSize: FontSize.caption }}>
                    Add paper
                  </Text>
                </TouchableOpacity>
              </View>

              {subject.papers.map((p) => {
                const qCount = subject.questions.filter((q) => q.paperId === p.id).length;
                return (
                  <View
                    key={p.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[styles.h3, { color: colors.text }]}>
                        {p.year ? `${p.year} Paper` : p.title || 'Exam Paper'}
                        {p.session ? ` · ${p.session}` : ''}
                      </Text>
                      <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption }}>
                        {p.pageCount} page{p.pageCount !== 1 ? 's' : ''} · {qCount} question{qCount !== 1 ? 's' : ''}
                      </Text>
                    </View>

                    <TouchableOpacity
                      onPress={() => {
                        import('react-native').then(({ Alert }) => {
                          Alert.alert(
                            'Delete Paper?',
                            `Remove this paper and its ${qCount} questions from the subject?`,
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: async () => {
                                  const updatedSubject: Subject = {
                                    ...subject,
                                    papers: subject.papers.filter((item) => item.id !== p.id),
                                    questions: subject.questions.filter((q) => q.paperId !== p.id),
                                  };
                                  await saveSubject(updatedSubject);
                                  setSubject(updatedSubject);
                                },
                              },
                            ],
                          );
                        });
                      }}
                      style={{ padding: Spacing.sm }}
                      accessibilityLabel="Delete paper"
                    >
                      <Ionicons name="trash-outline" size={20} color={colors.red} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}
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
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 36, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.button, justifyContent: 'center' },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.chip },
  chipText: { fontSize: FontSize.tiny + 1, fontWeight: '700' },
});
