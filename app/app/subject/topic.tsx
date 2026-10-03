/**
 * Topic view screen (AGENTS.md §10 Screen 5).
 * Shows syllabus details for the topic, then sorted question cards.
 * Default sort: marks (desc), then times asked (desc), then most recent year.
 * Allows "Move to topic", which sets editedByUser = true so AI never overwrites it.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import { getSubject, saveSubject, Subject, Question, Unit, Topic } from '../../src/store/subjects';
import { defaultSort, timesAsked } from '../../src/logic/ranking';

export default function TopicScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { subjectId, topicId } = useLocalSearchParams<{
    subjectId: string;
    topicId?: string;
  }>();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [movingQuestion, setMovingQuestion] = useState<Question | null>(null);
  const [expandedQuestionIds, setExpandedQuestionIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!subjectId) return;
    const s = await getSubject(subjectId);
    setSubject(s);
  }, [subjectId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!subject) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  const isUnassigned = topicId === 'unassigned' || !topicId;

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

  // Filter questions for this topic
  const rawQuestions = isUnassigned
    ? subject.questions.filter((q) => q.topicId === null)
    : subject.questions.filter((q) => q.topicId === topicId);

  // Apply default sort (marks desc, times asked desc, year desc)
  const questions = defaultSort(rawQuestions, subject.questions);

  const title = isUnassigned
    ? 'Unassigned Questions'
    : currentTopic?.name || 'Topic Questions';

  const toggleExpand = (id: string) => {
    setExpandedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMoveToTopic = async (targetTopicId: string | null, targetUnitId: string | null) => {
    if (!movingQuestion || !subject) return;

    const targetQId = movingQuestion.id;
    const updatedQuestions = subject.questions.map((q) => {
      if (q.id !== targetQId) return q;
      return {
        ...q,
        topicId: targetTopicId,
        unitId: targetUnitId,
        editedByUser: true, // User edit wins! AI will never overwrite
        topicConfidence: null,
      };
    });

    const updatedSubject: Subject = {
      ...subject,
      questions: updatedQuestions,
    };

    await saveSubject(updatedSubject);
    setSubject(updatedSubject);
    setMovingQuestion(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title,
          headerBackTitle: 'Back',
        }}
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Block */}
        <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {currentUnit && (
            <Text style={[styles.unitBadgeText, { color: colors.accent }]}>
              {currentUnit.name}
            </Text>
          )}
          <Text style={[styles.topicTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.statsLine, { color: colors.textSecondary }]}>
            {questions.length} question{questions.length !== 1 ? 's' : ''}
            {subject.papers.length > 0
              ? ` across ${subject.papers.length} paper${subject.papers.length !== 1 ? 's' : ''}`
              : ''}
          </Text>

          {/* Syllabus Details */}
          {currentTopic?.details ? (
            <View style={[styles.detailsBox, { backgroundColor: colors.chip, borderColor: colors.border }]}>
              <View style={styles.detailsHeaderRow}>
                <Ionicons name="book-outline" size={16} color={colors.accent} />
                <Text style={[styles.detailsHeader, { color: colors.accent }]}>
                  Syllabus Details
                </Text>
              </View>
              <Text style={[styles.detailsText, { color: colors.text }]}>
                {currentTopic.details}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Questions List */}
        {questions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="help-circle-outline" size={48} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No questions yet</Text>
            <Text style={[styles.emptySub, { color: colors.textSecondary }]}>
              {isUnassigned
                ? 'All questions have been assigned to syllabus topics.'
                : 'Questions matching this topic from imported papers will appear here.'}
            </Text>
          </View>
        ) : (
          <View style={{ gap: Spacing.sm }}>
            <View style={styles.sortHeaderRow}>
              <Text style={[styles.listHeader, { color: colors.textSecondary }]}>
                Sorted by Marks, Frequency & Recency
              </Text>
              <Text style={[styles.listCount, { color: colors.textSecondary }]}>
                {questions.length} total
              </Text>
            </View>

            {questions.map((q) => {
              const times = timesAsked(q, subject.questions);
              const isExpanded = expandedQuestionIds.has(q.id);

              return (
                <View
                  key={q.id}
                  style={[
                    styles.qCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: q.needsReview ? colors.amber : colors.border,
                    },
                  ]}
                >
                  {/* Card Header Chips */}
                  <View style={styles.cardHeaderRow}>
                    <View style={styles.chipsLeft}>
                      {/* Question Number */}
                      <View style={[styles.badge, { backgroundColor: colors.chip }]}>
                        <Text style={[styles.badgeText, { color: colors.text }]}>
                          Q{q.number}
                        </Text>
                      </View>

                      {/* Marks Chip */}
                      {q.marks !== null ? (
                        <View
                          style={[
                            styles.badge,
                            { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
                          ]}
                        >
                          <Text style={[styles.badgeText, { color: colors.text }]}>
                            {q.marks} m
                          </Text>
                        </View>
                      ) : (
                        <View style={[styles.badge, { backgroundColor: colors.amberBg }]}>
                          <Text style={[styles.badgeText, { color: colors.amber }]}>
                            ? marks
                          </Text>
                        </View>
                      )}

                      {/* Question Type */}
                      <View style={[styles.badge, { backgroundColor: colors.chip }]}>
                        <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                          {q.type}
                        </Text>
                      </View>

                      {/* Frequency Badge (Asked nX) */}
                      <View
                        style={[
                          styles.badge,
                          {
                            backgroundColor: times > 1 ? colors.amberBg : colors.chip,
                            borderColor: times > 1 ? colors.amber : colors.border,
                            borderWidth: times > 1 ? 1 : 0,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.badgeText,
                            { color: times > 1 ? colors.amber : colors.textSecondary },
                          ]}
                        >
                          Asked {times}×
                        </Text>
                      </View>

                      {/* Year */}
                      {q.year ? (
                        <View style={[styles.badge, { backgroundColor: colors.chip }]}>
                          <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                            {q.year}
                          </Text>
                        </View>
                      ) : null}

                      {/* Low Confidence Chip */}
                      {q.topicConfidence === 'low' && !q.editedByUser && (
                        <View style={[styles.badge, { backgroundColor: colors.amberBg }]}>
                          <Ionicons name="alert-circle-outline" size={12} color={colors.amber} />
                          <Text style={[styles.badgeText, { color: colors.amber, marginLeft: 2 }]}>
                            Low confidence
                          </Text>
                        </View>
                      )}

                      {/* User Edited Marker */}
                      {q.editedByUser && (
                        <View style={[styles.badge, { backgroundColor: colors.chip }]}>
                          <Ionicons name="checkmark-done" size={12} color={colors.accent} />
                          <Text style={[styles.badgeText, { color: colors.accent, marginLeft: 2 }]}>
                            Manual
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Move to Topic Button */}
                    <TouchableOpacity
                      style={[styles.moveBtn, { borderColor: colors.border }]}
                      onPress={() => setMovingQuestion(q)}
                      accessibilityLabel="Move question to another topic"
                    >
                      <Ionicons name="folder-open-outline" size={16} color={colors.accent} />
                      <Text style={[styles.moveBtnText, { color: colors.accent }]}>Move</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Question Text */}
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => toggleExpand(q.id)}
                    accessibilityLabel="Toggle question details"
                  >
                    <Text
                      style={[styles.qText, { color: colors.text }]}
                      numberOfLines={isExpanded ? undefined : 3}
                    >
                      {q.text}
                    </Text>
                  </TouchableOpacity>

                  {/* Footer / Group */}
                  <View style={styles.cardFooter}>
                    {q.group ? (
                      <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>
                        {q.group}
                      </Text>
                    ) : (
                      <View />
                    )}
                    {q.text.length > 120 && (
                      <TouchableOpacity onPress={() => toggleExpand(q.id)}>
                        <Text style={[styles.expandText, { color: colors.accent }]}>
                          {isExpanded ? 'Show less' : 'Show more'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

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
                <Text style={[styles.modalTitle, { color: colors.text }]}>Move to Topic</Text>
                <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                  Q{movingQuestion?.number}: {movingQuestion?.text}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setMovingQuestion(null)}
                style={styles.closeBtn}
                accessibilityLabel="Close"
              >
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
  sortHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xs,
  },
  listHeader: {
    fontSize: FontSize.tiny + 1,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  listCount: {
    fontSize: FontSize.tiny + 1,
  },
  qCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  chipsLeft: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    flex: 1,
    marginRight: Spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: BorderRadius.chip,
  },
  badgeText: {
    fontSize: FontSize.tiny + 1,
    fontWeight: '700',
  },
  moveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    minHeight: 32,
  },
  moveBtnText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  qText: {
    fontSize: FontSize.body - 1,
    lineHeight: 22,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  groupLabel: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
  },
  expandText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
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
