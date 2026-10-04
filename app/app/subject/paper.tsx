import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../src/components/Toast';
import * as Haptics from '../../src/haptics';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import {
  displayNumber, getSubject, saveSubject, pageImageUri, hasPageImage, newId, Subject, Question,
} from '../../src/store/subjects';
import { ZoomableImage } from '../../src/components/ZoomableImage';
import { QuestionEditModal } from '../../src/components/QuestionEditModal';

/** Re-open a saved paper: check each page against its scan, fix questions, change year or session. */
export default function PaperScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const navigation = useNavigation();
  const { subjectId, paperId } = useLocalSearchParams<{ subjectId: string; paperId: string }>();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [qs, setQs] = useState<Question[]>([]);
  const [year, setYear] = useState('');
  const [session, setSession] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Question | null>(null);
  const [dirty, setDirty] = useState(false);
  const savedRef = useRef(false);

  useEffect(() => {
    if (!subjectId) return;
    getSubject(subjectId).then((s) => {
      const paper = s?.papers.find((p) => p.id === paperId);
      if (!s || !paper) return;
      setSubject(s);
      setQs(s.questions.filter((q) => q.paperId === paperId));
      setYear(paper.year === null ? '' : String(paper.year));
      setSession(paper.session ?? '');
    });
  }, [subjectId, paperId]);

  useEffect(() => {
    if (!dirty) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (savedRef.current) return;
      e.preventDefault();
      Alert.alert('Discard changes?', 'Your edits to this paper will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(e.data.action) },
      ]);
    });
  }, [navigation, dirty]);

  const paper = subject?.papers.find((p) => p.id === paperId);
  if (!subject || !paper) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const pageQs = qs.filter((q) => q.page === page);
  const showImage = hasPageImage(subject.id, paper.id, page);

  const commit = (updated: Question) => {
    setEditing(null);
    setDirty(true);
    setQs((all) => (all.some((q) => q.id === updated.id) ? all.map((q) => (q.id === updated.id ? updated : q)) : [...all, updated]));
  };

  const addQuestion = () =>
    setEditing({
      id: newId(), paperId: paper.id, year: parseInt(year, 10) || null, page,
      number: String(pageQs.length + 1), text: '', marks: null, type: 'other',
      unitId: null, topicId: null, topicConfidence: null, repeatGroupId: null,
      needsReview: true, editedByUser: true,
    });

  const remove = (id: string) => {
    setDirty(true);
    setQs((all) => all.filter((q) => q.id !== id));
  };

  const save = async () => {
    const y = parseInt(year.trim(), 10);
    const finalYear = Number.isFinite(y) ? y : null;
    const kept = new Set(qs.map((q) => q.id));
    const removed = subject.questions.filter((q) => q.paperId === paper.id && !kept.has(q.id)).map((q) => q.id);
    const practice = { ...subject.practice };
    removed.forEach((id) => delete practice[id]);
    await saveSubject({
      ...subject,
      papers: subject.papers.map((p) => (p.id === paper.id ? { ...p, year: finalYear, session: session.trim() || undefined } : p)),
      questions: [
        ...subject.questions.filter((q) => q.paperId !== paper.id),
        ...qs.map((q) => ({ ...q, year: finalYear })),
      ],
      practice,
    });
    savedRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast('Changes saved');
    router.back();
  };

  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: paper.year ? `${paper.year} paper` : paper.title || 'Paper' }} />
      <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Year</Text>
            <TextInput style={input} value={year} onChangeText={(t) => { setYear(t); setDirty(true); }} keyboardType="numeric" maxLength={4} placeholder="e.g. 2023" placeholderTextColor={colors.textSecondary} />
          </View>
          <View style={{ flex: 1.2 }}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Session</Text>
            <TextInput style={input} value={session} onChangeText={(t) => { setSession(t); setDirty(true); }} placeholder="e.g. Winter" placeholderTextColor={colors.textSecondary} />
          </View>
        </View>

        {paper.pageCount > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.xs }}>
            {Array.from({ length: paper.pageCount }, (_, i) => i + 1).map((n) => (
              <TouchableOpacity
                key={n}
                onPress={() => setPage(n)}
                style={[styles.pageTab, { backgroundColor: n === page ? colors.accent : colors.card, borderColor: n === page ? colors.accent : colors.border }]}
                accessibilityLabel={`Page ${n}`}
              >
                <Text style={{ color: n === page ? colors.accentText : colors.text, fontWeight: '600', fontSize: FontSize.caption }}>
                  Page {n} ({qs.filter((q) => q.page === n).length})
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {showImage && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, overflow: 'hidden' }]}>
            <ZoomableImage uri={pageImageUri(subject.id, paper.id, page)} />
          </View>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: colors.text, fontSize: FontSize.h3, fontWeight: '700' }}>Questions ({pageQs.length})</Text>
          <TouchableOpacity onPress={addQuestion} style={[styles.addBtn, { borderColor: colors.accent }]} accessibilityLabel="Add question">
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '700', fontSize: FontSize.caption }}>Add question</Text>
          </TouchableOpacity>
        </View>

        {pageQs.length === 0 && (
          <Text style={{ color: colors.textSecondary }}>No questions on this page.</Text>
        )}
        {pageQs.map((q) => (
          <View key={q.id} style={[styles.card, { backgroundColor: colors.card, borderColor: q.needsReview ? colors.amber : colors.border, padding: Spacing.md, gap: Spacing.xs }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ flex: 1, color: colors.textSecondary, fontSize: FontSize.caption, fontWeight: '700' }}>
                {displayNumber(q.number)} · {q.marks === null ? '? marks' : `${q.marks} marks`} · {q.type}
              </Text>
              <TouchableOpacity style={styles.iconBtn} onPress={() => setEditing(q)} onLongPress={() => toast('Edit question', 'info')} accessibilityLabel="Edit question">
                <Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => remove(q.id)} onLongPress={() => toast('Delete question', 'info')} accessibilityLabel="Delete question">
                <Ionicons name="trash-outline" size={18} color={colors.red} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.text, fontSize: FontSize.body - 1, lineHeight: 22 }}>{q.text}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.accent, opacity: dirty ? 1 : 0.4 }]}
          onPress={save}
          disabled={!dirty}
          accessibilityLabel="Save changes"
        >
          <Text style={{ color: colors.accentText, fontWeight: '700', fontSize: FontSize.body }}>Save changes</Text>
        </TouchableOpacity>
      </View>

      <QuestionEditModal question={editing} onSave={commit} onClose={() => setEditing(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.tiny + 1, fontWeight: '600', marginBottom: 2 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: BorderRadius.input, paddingHorizontal: Spacing.sm, fontSize: FontSize.body },
  card: { borderWidth: 1, borderRadius: BorderRadius.card },
  pageTab: { minHeight: 44, paddingHorizontal: Spacing.md, justifyContent: 'center', borderRadius: BorderRadius.button, borderWidth: 1 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.button, borderWidth: 1 },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.md, borderTopWidth: 1 },
  saveBtn: { minHeight: 48, borderRadius: BorderRadius.button, alignItems: 'center', justifyContent: 'center' },
});
