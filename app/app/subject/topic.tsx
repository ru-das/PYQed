/**
 * Topic view: syllabus details for the topic, then its questions sorted by
 * marks, times asked, then most recent year. Questions can be moved, edited or deleted;
 * any manual change sets editedByUser so AI re-runs never overwrite it.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
  Alert,
} from 'react-native';
import { Stack, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import { displayNumber, getSubject, saveSubject, Subject, Question, Unit, Topic } from '../../src/store/subjects';
import { collapseRepeats, defaultSort, groupIndex } from '../../src/logic/ranking';
import { QuestionCard } from '../../src/components/QuestionCard';
import { QuestionEditModal } from '../../src/components/QuestionEditModal';

export default function TopicScreen() {
  const colors = useThemeColors();
  const { subjectId, topicId } = useLocalSearchParams<{
    subjectId: string;
    topicId?: string;
  }>();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [movingQuestion, setMovingQuestion] = useState<Question | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  const load = useCallback(async () => {
    if (!subjectId) return;
    setSubject(await getSubject(subjectId));
  }, [subjectId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isUnassigned = topicId === 'unassigned' || !topicId;

  const groups = useMemo(() => groupIndex(subject?.questions ?? []), [subject]);

  if (!subject) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  // Find topic and parent unit if assigned
  let currentTopic: Topic | null = null;
  let currentUnit: Unit | null = null;
  if (!isUnassigned) {
    for (const u of subject.units) {
      const found = u.topics.find((t) => t.id === topicId);
      if (found) {
        currentTopic = found;
        currentUnit = u;
        break;
      }
    }
  }

  const rawQuestions = subject.questions.filter((q) => (isUnassigned ? q.topicId === null : q.topicId === topicId));
  const questions = defaultSort(rawQuestions, subject.questions);
  const title = isUnassigned ? 'Unassigned questions' : currentTopic?.name || 'Topic';

  const update = async (next: Subject) => {
    await saveSubject(next);
    setSubject(next);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleMoveToTopic = async (targetTopicId: string | null, targetUnitId: string | null) => {
    if (!movingQuestion) return;
    const id = movingQuestion.id;
    setMovingQuestion(null);
    await update({
      ...subject,
      questions: subject.questions.map((q) =>
        q.id !== id
          ? q
          : {
              ...q,
              topicId: targetTopicId,
              unitId: targetUnitId,
              editedByUser: true, // user edit wins: AI never overwrites
              topicConfidence: null,
              repeatGroupId: null, // repeat groups are per topic
            },
      ),
    });
  };

  const handleSaveEdit = async (updated: Question) => {
    setEditingQuestion(null);
    await update({ ...subject, questions: subject.questions.map((q) => (q.id === updated.id ? updated : q)) });
  };

  const handleDelete = (q: Question) =>
    Alert.alert('Delete question?', 'This removes it from the subject.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          const { [q.id]: _gone, ...practice } = subject.practice;
          update({ ...subject, questions: subject.questions.filter((x) => x.id !== q.id), practice });
        },
      },
    ]);

  const openMenu = (q: Question) =>
    Alert.alert(`${displayNumber(q.number)} options`, undefined, [
      { text: 'Move to topic', onPress: () => setMovingQuestion(q) },
      { text: 'Edit', onPress: () => setEditingQuestion(q) },
      { text: 'Delete', style: 'destructive', onPress: () => handleDelete(q) },
    ], { cancelable: true });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title, headerBackTitle: 'Back' }} />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {currentUnit && (
            <Text style={[styles.unitBadgeText, { color: colors.accent }]}>{currentUnit.name}</Text>
          )}
          <Text style={[styles.topicTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.statsLine, { color: colors.textSecondary }]}>
            {questions.length} question{questions.length !== 1 ? 's' : ''}
            {subject.papers.length > 0
              ? ` across ${subject.papers.length} paper${subject.papers.length !== 1 ? 's' : ''}`
              : ''}
          </Text>

          {currentTopic?.details ? (
            <View style={[styles.detailsBox, { backgroundColor: colors.chip, borderColor: colors.border }]}>
              <View style={styles.detailsHeaderRow}>
                <Ionicons name="book-outline" size={16} color={colors.accent} />
                <Text style={[styles.detailsHeader, { color: colors.accent }]}>Syllabus details</Text>
              </View>
              <Text style={[styles.detailsText, { color: colors.text }]}>{currentTopic.details}</Text>
            </View>
          ) : null}
        </View>

        {questions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="help-circle-outline" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No questions here</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              {isUnassigned
                ? 'Every question has a topic.'
                : 'Questions from imported papers that match this topic will appear here.'}
            </Text>
          </View>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            {collapseRepeats(questions).map(([q, ...otherVersions]) => (
              <QuestionCard
                key={q.id}
                q={q}
                versions={otherVersions}
                all={subject.questions}
                groups={groups}
                onMenu={() => openMenu(q)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <QuestionEditModal question={editingQuestion} onSave={handleSaveEdit} onClose={() => setEditingQuestion(null)} />

      {/* Move to Topic Modal */}
      <Modal
        visible={movingQuestion !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setMovingQuestion(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setMovingQuestion(null)} />
          <View style={[styles.modalSheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Move to topic</Text>
                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  {movingQuestion ? displayNumber(movingQuestion.number) : ''}: {movingQuestion?.text}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setMovingQuestion(null)} style={styles.closeBtn} accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.modalScroll}>
              {/* Option to Unassign */}
              <TouchableOpacity
                style={[
                  styles.topicOption,
                  { borderColor: colors.border, backgroundColor: colors.card },
                  movingQuestion?.topicId === null && { borderColor: colors.accent },
                ]}
                onPress={() => handleMoveToTopic(null, null)}
              >
                <Ionicons name="help-circle-outline" size={20} color={colors.amber} />
                <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                  <Text style={[styles.topicOptionTitle, { color: colors.text }]}>
                    Unassigned
                  </Text>
                  <Text style={[styles.topicOptionSub, { color: colors.textSecondary }]}>
                    Remove from topic assignment
                  </Text>
                </View>
                {movingQuestion?.topicId === null && (
                  <Ionicons name="checkmark" size={20} color={colors.accent} />
                )}
              </TouchableOpacity>

              {/* Units and Topics */}
              {subject.units.map((unit) => (
                <View key={unit.id} style={styles.unitGroup}>
                  <Text style={[styles.unitGroupTitle, { color: colors.accent }]}>
                    {unit.name}
                  </Text>
                  {unit.topics.map((t) => {
                    const isSelected = movingQuestion?.topicId === t.id;
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={[
                          styles.topicOption,
                          { borderColor: colors.border, backgroundColor: colors.card },
                          isSelected && { borderColor: colors.accent, backgroundColor: colors.chip },
                        ]}
                        onPress={() => handleMoveToTopic(t.id, unit.id)}
                      >
                        <Ionicons
                          name="folder-outline"
                          size={18}
                          color={isSelected ? colors.accent : colors.textSecondary}
                        />
                        <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                          <Text style={[styles.topicOptionTitle, { color: colors.text }]}>
                            {t.name}
                          </Text>
                          {t.details ? (
                            <Text
                              style={[styles.topicOptionSub, { color: colors.textSecondary }]}
                              numberOfLines={1}
                            >
                              {t.details}
                            </Text>
                          ) : null}
                        </View>
                        {isSelected && (
                          <Ionicons name="checkmark" size={20} color={colors.accent} />
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
    paddingBottom: Spacing.xl * 2,
  },
  headerCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  unitBadgeText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  topicTitle: {
    fontSize: FontSize.h2,
    fontWeight: '700',
  },
  statsLine: {
    fontSize: FontSize.caption,
  },
  detailsBox: {
    marginTop: Spacing.sm,
    padding: Spacing.sm,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    gap: 4,
  },
  detailsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailsHeader: {
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
  detailsText: {
    fontSize: FontSize.caption,
    lineHeight: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: Spacing.xl * 2,
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: FontSize.caption,
    textAlign: 'center',
    maxWidth: 280,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalSheet: {
    borderTopLeftRadius: BorderRadius.card + 4,
    borderTopRightRadius: BorderRadius.card + 4,
    borderTopWidth: 1,
    maxHeight: '80%',
    padding: Spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: FontSize.caption,
    marginTop: 2,
  },
  closeBtn: {
    padding: Spacing.xs,
  },
  modalScroll: {
    marginBottom: Spacing.md,
  },
  unitGroup: {
    marginTop: Spacing.md,
    gap: Spacing.xs,
  },
  unitGroupTitle: {
    fontSize: FontSize.caption,
    fontWeight: '700',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  topicOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Spacing.sm,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    marginBottom: 6,
  },
  topicOptionTitle: {
    fontSize: FontSize.caption + 1,
    fontWeight: '600',
  },
  topicOptionSub: {
    fontSize: FontSize.tiny,
    marginTop: 2,
  },
});
