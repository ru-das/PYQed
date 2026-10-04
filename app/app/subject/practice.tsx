import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Switch } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from '../../src/haptics';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import { getSubject, saveSubject, Subject, Question } from '../../src/store/subjects';
import { QuestionFilters, askedYears, highPriorityUnitIds } from '../../src/logic/ranking';
import { Button, Chip, Footer } from '../../src/components/ui';
import { practicePool, weightedShuffle, recordAnswer, topicProgress, UNASSIGNED } from '../../src/logic/practice';

const TYPES: Question['type'][] = ['mcq', 'short', 'long', 'other'];
const MARKS: { key: NonNullable<QuestionFilters['marksRange']>; label: string }[] = [
  { key: 'low', label: '≤ 2 marks' },
  { key: 'mid', label: '3–5 marks' },
  { key: 'high', label: '10+ marks' },
];

export default function PracticeScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { subjectId } = useLocalSearchParams<{ subjectId: string }>();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [phase, setPhase] = useState<'setup' | 'cards' | 'summary'>('setup');
  const [selected, setSelected] = useState<Set<string> | null>(null); // null = all topics
  const [hpOnly, setHpOnly] = useState(false);
  const [filters, setFilters] = useState<QuestionFilters>({});
  const [deck, setDeck] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [tally, setTally] = useState({ got: 0, revise: 0 });
  const [revised, setRevised] = useState<Question[]>([]);

  // Reload on focus so topic progress is fresh; keep user's choices.
  useFocusEffect(
    useCallback(() => {
      if (subjectId) getSubject(subjectId).then(setSubject);
    }, [subjectId]),
  );

  const unassignedCount = subject?.questions.filter((q) => q.topicId === null).length ?? 0;
  const allTopicIds = useMemo(
    () => new Set([
      ...(subject?.units.flatMap((u) => u.topics.map((t) => t.id)) ?? []),
      ...(unassignedCount > 0 ? [UNASSIGNED] : []),
    ]),
    [subject, unassignedCount],
  );
  const answering = useRef(false);
  const topicIds = selected ?? allTopicIds;

  if (!subject) return <View style={[styles.container, { backgroundColor: colors.background }]} />;

  const paperCount = subject.papers.length;
  const hpUnits = highPriorityUnitIds(subject.units, subject.questions, paperCount);
  const pool = practicePool(subject, { topicIds, highPriorityOnly: hpOnly, filters });

  const toggleTopic = (id: string) => {
    const next = new Set(topicIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleUnit = (ids: string[]) => {
    const next = new Set(topicIds);
    const allOn = ids.every((i) => next.has(i));
    ids.forEach((i) => (allOn ? next.delete(i) : next.add(i)));
    setSelected(next);
  };

  const start = (questions: Question[]) => {
    setDeck(weightedShuffle(questions, subject.practice));
    setIndex(0);
    setTally({ got: 0, revise: 0 });
    setRevised([]);
    setPhase('cards');
  };

  const answer = async (a: 'got' | 'revise') => {
    if (answering.current) return; // ignore a second tap on the same card
    answering.current = true;
    const q = deck[index];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Move on first, then save, so the next card shows instantly.
    setTally((t) => ({ ...t, [a]: t[a] + 1 }));
    if (a === 'revise') setRevised((r) => [...r, q]);
    if (index + 1 >= deck.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhase('summary');
    } else {
      setIndex(index + 1);
    }
    // Save right away so progress survives quitting mid-session.
    const updated = { ...subject, practice: recordAnswer(subject.practice, q.id, a) };
    setSubject(updated);
    try {
      await saveSubject(updated);
    } finally {
      answering.current = false;
    }
  };

  const chip = (label: string, active: boolean, onPress: () => void) => (
    <Chip key={label} label={label} active={active} onPress={onPress} accessibilityLabel={`Filter ${label}`} />
  );

  // ─── Cards ───
  if (phase === 'cards' && deck[index]) {
    const q = deck[index];
    const topic = subject.units.flatMap((u) => u.topics).find((t) => t.id === q.topicId);
    const years = askedYears(q, subject.questions);
    return (
      <View style={[styles.container, { backgroundColor: colors.background, padding: Spacing.md, gap: Spacing.md }]}>
        <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption }}>
          {index + 1} / {deck.length}
        </Text>
        <View style={[styles.track, { backgroundColor: colors.chip }]}>
          <View style={[styles.fill, { backgroundColor: colors.accent, width: `${((index + 1) / deck.length) * 100}%` }]} />
        </View>
        <ScrollView
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.md }}
        >
          <View style={styles.row}>
            <View style={[styles.chip, { backgroundColor: colors.chip }]}>
              <Text style={{ color: colors.text, fontSize: FontSize.caption, fontWeight: '600' }}>
                {q.marks === null ? '? marks' : `${q.marks} marks`}
              </Text>
            </View>
            {years.length > 0 && (
              <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption }}>{years.join(', ')}</Text>
            )}
          </View>
          <Text style={{ color: colors.text, fontSize: FontSize.h3, lineHeight: 26 }}>{q.text}</Text>
          {topic && <Text style={{ color: colors.accent, fontSize: FontSize.caption }}>{topic.name}</Text>}
        </ScrollView>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.answerBtn, { backgroundColor: colors.amberBg, borderColor: colors.amber }]}
            onPress={() => answer('revise')}
            accessibilityLabel="Revise this question later"
          >
            <Text style={{ color: colors.amber, fontWeight: '700', fontSize: FontSize.body }}>Revise</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.answerBtn, { backgroundColor: colors.successBg, borderColor: colors.success }]}
            onPress={() => answer('got')}
            accessibilityLabel="Got it"
          >
            <Text style={{ color: colors.success, fontWeight: '700', fontSize: FontSize.body }}>Got it</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ─── Summary ───
  if (phase === 'summary') {
    return (
      <View style={[styles.container, styles.center, { backgroundColor: colors.background, gap: Spacing.md }]}>
        <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        <Text style={{ color: colors.text, fontSize: FontSize.h2, fontWeight: '700' }}>Session done</Text>
        <Text style={{ color: colors.textSecondary, fontSize: FontSize.body }}>
          Got it {tally.got} · Revise {tally.revise}
        </Text>
        {revised.length > 0 && (
          <Button label="Practise the Revise ones again" variant="outline" onPress={() => start(revised)} />
        )}
        <Button label="Done" onPress={() => router.back()} />
      </View>
    );
  }

  // ─── Setup ───
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md }}>
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={{ color: colors.text, fontSize: FontSize.body, fontWeight: '600' }}>High priority only</Text>
          <Switch value={hpOnly} onValueChange={setHpOnly} trackColor={{ true: colors.accent }} />
        </View>

        <View style={[styles.row, { flexWrap: 'wrap' }]}>
          {TYPES.map((t) => chip(t, filters.type === t, () => setFilters((f) => ({ ...f, type: f.type === t ? null : t }))))}
          {MARKS.map((m) =>
            chip(m.label, filters.marksRange === m.key, () =>
              setFilters((f) => ({ ...f, marksRange: f.marksRange === m.key ? null : m.key })),
            ),
          )}
        </View>

        {subject.units
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((u) => {
            const ids = u.topics.map((t) => t.id);
            const allOn = ids.length > 0 && ids.every((i) => topicIds.has(i));
            return (
              <View key={u.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TouchableOpacity
                  style={[styles.row, { padding: Spacing.md }]}
                  onPress={() => toggleUnit(ids)}
                  accessibilityLabel={`Toggle all topics in ${u.name}`}
                >
                  <Ionicons name={allOn ? 'checkbox' : 'square-outline'} size={24} color={colors.accent} />
                  <Text style={{ flex: 1, color: colors.text, fontSize: FontSize.h3, fontWeight: '700' }}>{u.name}</Text>
                  {hpUnits.has(u.id) && (
                    <View style={[styles.chip, { backgroundColor: colors.amberBg }]}>
                      <Text style={{ color: colors.amber, fontSize: FontSize.caption, fontWeight: '700' }}>High priority</Text>
                    </View>
                  )}
                </TouchableOpacity>
                {u.topics.map((t) => {
                  const { done, total } = topicProgress(t.id, subject.questions, subject.practice);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.topicRow, { borderTopColor: colors.border }]}
                      onPress={() => toggleTopic(t.id)}
                      accessibilityLabel={`Toggle topic ${t.name}`}
                    >
                      <Ionicons name={topicIds.has(t.id) ? 'checkbox' : 'square-outline'} size={22} color={colors.accent} />
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={{ color: colors.text, fontSize: FontSize.body }}>{t.name}</Text>
                        <View style={[styles.track, { backgroundColor: colors.chip }]}>
                          <View
                            style={[styles.fill, { backgroundColor: colors.success, width: `${total ? (done / total) * 100 : 0}%` }]}
                          />
                        </View>
                      </View>
                      <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption }}>
                        {done}/{total}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

        {unassignedCount > 0 && (
          <TouchableOpacity
            style={[styles.card, styles.row, { backgroundColor: colors.card, borderColor: colors.border, padding: Spacing.md }]}
            onPress={() => toggleTopic(UNASSIGNED)}
            accessibilityLabel="Toggle unassigned questions"
          >
            <Ionicons name={topicIds.has(UNASSIGNED) ? 'checkbox' : 'square-outline'} size={24} color={colors.accent} />
            <Text style={{ flex: 1, color: colors.text, fontSize: FontSize.h3, fontWeight: '700' }}>Unassigned</Text>
            <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption }}>{unassignedCount}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <Footer>
        <Button label={`Start (${pool.length} cards)`} disabled={pool.length === 0} onPress={() => start(pool)} />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  card: { borderRadius: BorderRadius.card, borderWidth: 1, overflow: 'hidden' },
  chip: { paddingHorizontal: 12, minHeight: 36, justifyContent: 'center', borderRadius: BorderRadius.chip },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 48,
    borderTopWidth: 1,
  },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  answerBtn: {
    flex: 1,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.button,
    borderWidth: 1,
  },
});
