import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import {
  getSubject,
  saveSubject,
  exportSubjectFile,
  summarize,
  summaryLine,
  Subject,
  Question,
  Unit,
} from '../../src/store/subjects';
import {
  sortQuestions,
  filterQuestions,
  SortOption,
  QuestionFilters,
  unitWeight,
  highPriorityUnitIds,
  maxUnitWeight,
  topicAvgMarks,
  distinctYears,
  timesAsked,
  askedYears,
  collapseRepeats,
} from '../../src/logic/ranking';
import * as Sharing from 'expo-sharing';
import { topicProgress } from '../../src/logic/practice';

async function shareSubject(s: Subject, withImages: boolean) {
  try {
    const uri = await exportSubjectFile(s, withImages);
    await Sharing.shareAsync(uri, { mimeType: 'application/json', dialogTitle: `Share ${s.name}` });
  } catch (e: any) {
    Alert.alert('Could not share', e?.message || 'Something went wrong.');
  }
}

const TABS = ['Topics', 'All questions', 'Papers'] as const;

export default function SubjectScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Topics');

  // Sorting and Filtering state for All Questions tab
  const [sortBy, setSortBy] = useState<SortOption>('marks');
  const [filters, setFilters] = useState<QuestionFilters>({});
  const [versionsOpenIds, setVersionsOpenIds] = useState<Set<string>>(new Set());
  const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!id) return;
    const s = await getSubject(id);
    setSubject(s);
    // Expand all units by default on load
    if (s) {
      setExpandedUnitIds(new Set(s.units.map((u) => u.id)));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (!subject) {
    return <View style={[styles.container, { backgroundColor: colors.background }]} />;
  }

  const paperCount = subject.papers.length;
  const highPrioritySet = highPriorityUnitIds(subject.units, subject.questions, paperCount);
  const maxWeight = maxUnitWeight(subject.units, subject.questions, paperCount);

  const toggleUnitExpanded = (unitId: string) => {
    setExpandedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const emptyView = (
    icon: keyof typeof Ionicons.glyphMap,
    title: string,
    body: string,
    action?: React.ReactNode,
  ) => (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.textSecondary} />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>{body}</Text>
      {action}
    </View>
  );

  // Unassigned questions
  const unassignedQs = subject.questions.filter((q) => q.topicId === null);

  // All questions tab: apply filters then sort
  const filteredQs = filterQuestions(subject.questions, filters);
  const displayedQuestions = sortQuestions(
    filteredQs,
    subject.questions,
    sortBy,
    subject.units,
  );

  const availableYears = distinctYears(subject.questions);
  const hasActiveFilters =
    Boolean(filters.unitId) ||
    Boolean(filters.type) ||
    Boolean(filters.marksRange) ||
    filters.year !== undefined && filters.year !== null ||
    Boolean(filters.needsReview);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: subject.name,
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity
              onPress={() =>
                Alert.alert('Share subject', 'Page images make the file much bigger.', [
                  { text: 'Share', onPress: () => shareSubject(subject, false) },
                  { text: 'Include page images', onPress: () => shareSubject(subject, true) },
                  { text: 'Cancel', style: 'cancel' },
                ])
              }
              accessibilityLabel="Share subject"
              style={styles.headerBtn}
            >
              <Ionicons name="share-outline" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                router.push({ pathname: '/subject/edit', params: { id: subject.id } })
              }
              accessibilityLabel="Edit subject"
              style={styles.headerBtn}
            >
              <Ionicons name="pencil" size={20} color={colors.text} />
            </TouchableOpacity>
            </View>
          ),
        }}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Subject Header */}
        <View style={styles.headerBlock}>
          <Text style={[styles.title, { color: colors.text }]}>{subject.name}</Text>
          <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
            {[subject.code, summaryLine(summarize(subject))].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {/* Tab Segment Bar */}
        <View style={[styles.seg, { backgroundColor: colors.chip }]}>
          {TABS.map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              accessibilityLabel={`${t} tab`}
              style={[styles.segItem, tab === t && { backgroundColor: colors.card }]}
            >
              <Text
                style={{
                  color: tab === t ? colors.text : colors.textSecondary,
                  fontWeight: '700',
                  fontSize: FontSize.caption,
                }}
              >
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ─── TAB 1: TOPICS ────────────────────────────────────────── */}
        {tab === 'Topics' && (
          <View style={{ gap: Spacing.md }}>
            {subject.units.length === 0 ? (
              emptyView(
                'list-outline',
                'No syllabus yet',
                'Add units and topics manually, or import a syllabus to calculate topic weights and prioritize topics.',
                <View style={{ flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm }}>
                  <TouchableOpacity
                    style={[
                      styles.btn,
                      { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                    ]}
                    onPress={() => router.push('/syllabus-import')}
                  >
                    <Text style={{ color: colors.text, fontWeight: '700' }}>
                      Import syllabus
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: colors.accent }]}
                    onPress={() =>
                      router.push({
                        pathname: '/subject/edit',
                        params: { id: subject.id },
                      })
                    }
                  >
                    <Text style={{ color: colors.accentText, fontWeight: '700' }}>
                      Add units
                    </Text>
                  </TouchableOpacity>
                </View>,
              )
            ) : (
              <>
                {/* Units List */}
                {subject.units
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((u) => {
                    const uWeight = unitWeight(u, subject.questions, paperCount);
                    const isHighPriority = highPrioritySet.has(u.id);
                    const uQuestions = subject.questions.filter((q) => q.unitId === u.id);
                    const isExpanded = expandedUnitIds.has(u.id);

                    // Proportional bar width (percentage)
                    const barWidthPercent =
                      maxWeight > 0 ? Math.min(100, Math.round((uWeight / maxWeight) * 100)) : 0;

                    return (
                      <View
                        key={u.id}
                        style={[
                          styles.unitCard,
                          {
                            backgroundColor: colors.card,
                            borderColor: isHighPriority ? colors.amber : colors.border,
                          },
                        ]}
                      >
                        {/* Unit Header Row */}
                        <TouchableOpacity
                          activeOpacity={0.7}
                          onPress={() => toggleUnitExpanded(u.id)}
                          style={styles.unitHeaderTouchable}
                          accessibilityLabel={`Toggle ${u.name}`}
                        >
                          <View style={{ flex: 1, gap: 4 }}>
                            <View style={styles.unitTitleRow}>
                              <Text style={[styles.unitTitle, { color: colors.text }]}>
                                {u.name}
                              </Text>
                              {isHighPriority && (
                                <View
                                  style={[
                                    styles.priorityBadge,
                                    { backgroundColor: colors.amberBg },
                                  ]}
                                >
                                  <Ionicons name="flame" size={12} color={colors.amber} />
                                  <Text style={[styles.priorityBadgeText, { color: colors.amber }]}>
                                    High priority
                                  </Text>
                                </View>
                              )}
                            </View>

                            <Text style={[styles.unitStats, { color: colors.textSecondary }]}>
                              {uQuestions.length} question{uQuestions.length !== 1 ? 's' : ''}
                              {paperCount > 0
                                ? ` · avg ${uWeight.toFixed(1)} marks/paper`
                                : ''}
                            </Text>

                            {/* Proportional Weight Bar */}
                            {paperCount > 0 && (
                              <View style={[styles.weightBarTrack, { backgroundColor: colors.chip }]}>
                                <View
                                  style={[
                                    styles.weightBarFill,
                                    {
                                      width: `${Math.max(5, barWidthPercent)}%`,
                                      backgroundColor: isHighPriority
                                        ? colors.amber
                                        : colors.accent,
                                    },
                                  ]}
                                />
                              </View>
                            )}
                          </View>

                          <Ionicons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={20}
                            color={colors.textSecondary}
                            style={{ marginLeft: Spacing.sm }}
                          />
                        </TouchableOpacity>

                        {/* Topics List within Unit */}
                        {isExpanded && (
                          <View style={[styles.topicsList, { borderTopColor: colors.border }]}>
                            {u.topics.length === 0 ? (
                              <Text style={[styles.noTopicsText, { color: colors.textSecondary }]}>
                                No topics in this unit yet.
                              </Text>
                            ) : (
                              u.topics.map((t) => {
                                const tQuestions = subject.questions.filter(
                                  (q) => q.topicId === t.id,
                                );
                                const avgMarks = topicAvgMarks(
                                  t.id,
                                  subject.questions,
                                  paperCount,
                                );
                                const hasLowConf = tQuestions.some(
                                  (q) => q.topicConfidence === 'low' && !q.editedByUser,
                                );

                                return (
                                  <TouchableOpacity
                                    key={t.id}
                                    style={[
                                      styles.topicRow,
                                      {
                                        backgroundColor: colors.surface,
                                        borderColor: colors.border,
                                      },
                                    ]}
                                    onPress={() =>
                                      router.push({
                                        pathname: '/subject/topic',
                                        params: { subjectId: subject.id, topicId: t.id },
                                      })
                                    }
                                    accessibilityLabel={`View topic ${t.name}`}
                                  >
                                    <View style={{ flex: 1, gap: 2 }}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                                        <Text
                                          style={[styles.topicName, { color: colors.text }]}
                                          numberOfLines={1}
                                        >
                                          {t.name}
                                        </Text>
                                        {hasLowConf && (
                                          <View
                                            style={[
                                              styles.miniBadge,
                                              { backgroundColor: colors.amberBg },
                                            ]}
                                          >
                                            <Text
                                              style={[
                                                styles.miniBadgeText,
                                                { color: colors.amber },
                                              ]}
                                            >
                                              Low conf
                                            </Text>
                                          </View>
                                        )}
                                      </View>
                                      <Text style={[styles.topicSub, { color: colors.textSecondary }]}>
                                        {tQuestions.length} q
                                        {paperCount > 0
                                          ? ` · avg ${avgMarks.toFixed(1)} m/paper`
                                          : ''}
                                        {tQuestions.length > 0
                                          ? ` · ${Math.round(
                                              (topicProgress(t.id, subject.questions, subject.practice).done /
                                                tQuestions.length) * 100,
                                            )}% practised`
                                          : ''}
                                      </Text>
                                    </View>
                                    <Ionicons
                                      name="chevron-forward"
                                      size={18}
                                      color={colors.textSecondary}
                                    />
                                  </TouchableOpacity>
                                );
                              })
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}

                {/* Unassigned Questions Card */}
                {unassignedQs.length > 0 && (
                  <TouchableOpacity
                    style={[
                      styles.unitCard,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      },
                    ]}
                    onPress={() =>
                      router.push({
                        pathname: '/subject/topic',
                        params: { subjectId: subject.id, topicId: 'unassigned' },
                      })
                    }
                    accessibilityLabel="View unassigned questions"
                  >
                    <View style={{ gap: 4, flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
                        <Ionicons name="help-circle-outline" size={18} color={colors.amber} />
                        <Text style={[styles.unitTitle, { color: colors.text }]}>
                          Unassigned Questions
                        </Text>
                      </View>
                      <Text style={[styles.unitStats, { color: colors.textSecondary }]}>
                        {unassignedQs.length} question{unassignedQs.length !== 1 ? 's' : ''} not
                        yet assigned to a syllabus topic. Tap to view or reassign.
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        {/* ─── TAB 2: ALL QUESTIONS ─────────────────────────────────── */}
        {tab === 'All questions' && (
          <View style={{ gap: Spacing.md }}>
            {subject.questions.length === 0 ? (
              emptyView(
                'help-circle-outline',
                'No questions yet',
                'Add past exam papers to extract and bank questions.',
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.accent, marginTop: Spacing.sm }]}
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
            ) : (
              <>
                {/* Sort Selector Bar */}
                <View style={styles.sortSelectorContainer}>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                    SORT BY
                  </Text>
                  <View style={[styles.sortSegment, { backgroundColor: colors.chip }]}>
                    {(
                      [
                        { key: 'marks', label: 'Marks' },
                        { key: 'timesAsked', label: 'Frequency' },
                        { key: 'year', label: 'Year' },
                        { key: 'unitOrder', label: 'Unit' },
                      ] as const
                    ).map((s) => (
                      <TouchableOpacity
                        key={s.key}
                        style={[
                          styles.sortSegmentItem,
                          sortBy === s.key && { backgroundColor: colors.card },
                        ]}
                        onPress={() => setSortBy(s.key)}
                        accessibilityLabel={`Sort by ${s.label}`}
                      >
                        <Text
                          style={[
                            styles.sortSegmentText,
                            {
                              color: sortBy === s.key ? colors.text : colors.textSecondary,
                              fontWeight: sortBy === s.key ? '700' : '500',
                            },
                          ]}
                        >
                          {s.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Filter Chips Scroll View */}
                <View style={styles.filterSection}>
                  <View style={styles.filterHeaderRow}>
                    <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
                      FILTERS
                    </Text>
                    {hasActiveFilters && (
                      <TouchableOpacity
                        onPress={() => setFilters({})}
                        accessibilityLabel="Clear all filters"
                      >
                        <Text style={[styles.clearFilterText, { color: colors.accent }]}>
                          Reset all
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.filterChipsScroll}
                  >
                    {/* Unit Filters */}
                    {subject.units.map((u) => {
                      const active = filters.unitId === u.id;
                      return (
                        <TouchableOpacity
                          key={u.id}
                          style={[
                            styles.filterChip,
                            {
                              backgroundColor: active ? colors.accent : colors.card,
                              borderColor: active ? colors.accent : colors.border,
                            },
                          ]}
                          onPress={() =>
                            setFilters((prev) => ({
                              ...prev,
                              unitId: active ? undefined : u.id,
                            }))
                          }
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              { color: active ? colors.accentText : colors.text },
                            ]}
                          >
                            {u.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Unassigned Filter */}
                    {unassignedQs.length > 0 && (
                      <TouchableOpacity
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor:
                              filters.unitId === 'unassigned'
                                ? colors.amber
                                : colors.card,
                            borderColor:
                              filters.unitId === 'unassigned'
                                ? colors.amber
                                : colors.border,
                          },
                        ]}
                        onPress={() =>
                          setFilters((prev) => ({
                            ...prev,
                            unitId: prev.unitId === 'unassigned' ? undefined : 'unassigned',
                          }))
                        }
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            {
                              color:
                                filters.unitId === 'unassigned'
                                  ? '#FFFFFF'
                                  : colors.text,
                            },
                          ]}
                        >
                          Unassigned ({unassignedQs.length})
                        </Text>
                      </TouchableOpacity>
                    )}

                    {/* Question Type Filter */}
                    {(['mcq', 'short', 'long', 'other'] as const).map((t) => {
                      const active = filters.type === t;
                      return (
                        <TouchableOpacity
                          key={t}
                          style={[
                            styles.filterChip,
                            {
                              backgroundColor: active ? colors.accent : colors.card,
                              borderColor: active ? colors.accent : colors.border,
                            },
                          ]}
                          onPress={() =>
                            setFilters((prev) => ({
                              ...prev,
                              type: active ? undefined : t,
                            }))
                          }
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              { color: active ? colors.accentText : colors.text },
                            ]}
                          >
                            {t.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Marks Filter */}
                    {(
                      [
                        { key: 'low', label: '≤ 2 marks' },
                        { key: 'mid', label: '3–5 marks' },
                        { key: 'high', label: '10+ marks' },
                      ] as const
                    ).map((m) => {
                      const active = filters.marksRange === m.key;
                      return (
                        <TouchableOpacity
                          key={m.key}
                          style={[
                            styles.filterChip,
                            {
                              backgroundColor: active ? colors.accent : colors.card,
                              borderColor: active ? colors.accent : colors.border,
                            },
                          ]}
                          onPress={() =>
                            setFilters((prev) => ({
                              ...prev,
                              marksRange: active ? undefined : m.key,
                            }))
                          }
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              { color: active ? colors.accentText : colors.text },
                            ]}
                          >
                            {m.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Years Filter */}
                    {availableYears.map((yr) => {
                      const active = filters.year === yr;
                      return (
                        <TouchableOpacity
                          key={yr}
                          style={[
                            styles.filterChip,
                            {
                              backgroundColor: active ? colors.accent : colors.card,
                              borderColor: active ? colors.accent : colors.border,
                            },
                          ]}
                          onPress={() =>
                            setFilters((prev) => ({
                              ...prev,
                              year: active ? undefined : yr,
                            }))
                          }
                        >
                          <Text
                            style={[
                              styles.filterChipText,
                              { color: active ? colors.accentText : colors.text },
                            ]}
                          >
                            {yr}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}

                    {/* Needs Review Filter */}
                    <TouchableOpacity
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: filters.needsReview
                            ? colors.amber
                            : colors.card,
                          borderColor: filters.needsReview
                            ? colors.amber
                            : colors.border,
                        },
                      ]}
                      onPress={() =>
                        setFilters((prev) => ({
                          ...prev,
                          needsReview: !prev.needsReview ? true : undefined,
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          {
                            color: filters.needsReview
                              ? '#FFFFFF'
                              : colors.amber,
                          },
                        ]}
                      >
                        Needs review
                      </Text>
                    </TouchableOpacity>
                  </ScrollView>
                </View>

                {/* Filter count indicator */}
                <View style={styles.resultsInfoRow}>
                  <Text style={[styles.resultsInfoText, { color: colors.textSecondary }]}>
                    Showing {displayedQuestions.length} of {subject.questions.length} questions
                  </Text>
                </View>

                {/* Questions Cards */}
                {collapseRepeats(displayedQuestions).map(([q, ...otherVersions]) => {
                  const times = timesAsked(q, subject.questions);
                  const years = askedYears(q, subject.questions);
                  const versionsOpen = versionsOpenIds.has(q.id);
                  // Find topic name
                  let topicName: string | null = null;
                  if (q.topicId) {
                    for (const u of subject.units) {
                      const t = u.topics.find((item) => item.id === q.topicId);
                      if (t) {
                        topicName = t.name;
                        break;
                      }
                    }
                  }

                  return (
                    <TouchableOpacity
                      key={q.id}
                      style={[
                        styles.questionCard,
                        {
                          backgroundColor: colors.card,
                          borderColor: q.needsReview ? colors.amber : colors.border,
                        },
                      ]}
                      onPress={() => {
                        if (q.topicId) {
                          router.push({
                            pathname: '/subject/topic',
                            params: { subjectId: subject.id, topicId: q.topicId },
                          });
                        } else {
                          router.push({
                            pathname: '/subject/topic',
                            params: { subjectId: subject.id, topicId: 'unassigned' },
                          });
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={styles.qHeaderRow}>
                        <View style={styles.chipsRow}>
                          <View style={[styles.badge, { backgroundColor: colors.chip }]}>
                            <Text style={[styles.badgeText, { color: colors.text }]}>
                              Q{q.number}
                            </Text>
                          </View>
                          {q.marks !== null ? (
                            <View
                              style={[
                                styles.badge,
                                {
                                  backgroundColor: colors.surface,
                                  borderColor: colors.border,
                                  borderWidth: 1,
                                },
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
                          <View style={[styles.badge, { backgroundColor: colors.chip }]}>
                            <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                              {q.type}
                            </Text>
                          </View>
                          {times > 1 && (
                            <View
                              style={[
                                styles.badge,
                                {
                                  backgroundColor: colors.amberBg,
                                  borderColor: colors.amber,
                                  borderWidth: 1,
                                },
                              ]}
                            >
                              <Text style={[styles.badgeText, { color: colors.amber }]}>
                                Asked {times}×{years.length > 0 ? ` (${years.join(', ')})` : ''}
                              </Text>
                            </View>
                          )}
                          {q.year && (
                            <View style={[styles.badge, { backgroundColor: colors.chip }]}>
                              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                                {q.year}
                              </Text>
                            </View>
                          )}
                          {q.topicConfidence === 'low' && !q.editedByUser && (
                            <View style={[styles.badge, { backgroundColor: colors.amberBg }]}>
                              <Text style={[styles.badgeText, { color: colors.amber }]}>
                                Low conf
                              </Text>
                            </View>
                          )}
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                      </View>

                      <Text
                        style={[styles.questionBody, { color: colors.text }]}
                        numberOfLines={3}
                      >
                        {q.text}
                      </Text>

                      <View style={styles.cardFooter}>
                        {topicName ? (
                          <View style={[styles.topicChip, { backgroundColor: colors.chip }]}>
                            <Ionicons name="folder-outline" size={12} color={colors.accent} />
                            <Text
                              style={[styles.topicChipText, { color: colors.accent }]}
                              numberOfLines={1}
                            >
                              {topicName}
                            </Text>
                          </View>
                        ) : (
                          <View style={[styles.topicChip, { backgroundColor: colors.amberBg }]}>
                            <Text style={[styles.topicChipText, { color: colors.amber }]}>
                              Unassigned
                            </Text>
                          </View>
                        )}
                        {q.group ? (
                          <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>
                            {q.group}
                          </Text>
                        ) : null}
                      </View>

                      {/* Other versions from the same repeat group */}
                      {otherVersions.length > 0 && (
                        <View style={{ marginTop: Spacing.xs }}>
                          <TouchableOpacity
                            onPress={() =>
                              setVersionsOpenIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(q.id)) next.delete(q.id);
                                else next.add(q.id);
                                return next;
                              })
                            }
                            accessibilityLabel="Toggle other versions of this question"
                          >
                            <Text style={{ color: colors.accent, fontWeight: '600' }}>
                              {versionsOpen
                                ? 'Hide other versions'
                                : `Show ${otherVersions.length} other version${otherVersions.length > 1 ? 's' : ''}`}
                            </Text>
                          </TouchableOpacity>
                          {versionsOpen &&
                            otherVersions.map((v) => (
                              <Text
                                key={v.id}
                                style={[styles.groupLabel, { color: colors.textSecondary, marginTop: 4 }]}
                              >
                                {v.year ?? '?'} · Q{v.number} · {v.text}
                              </Text>
                            ))}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* ─── TAB 3: PAPERS ────────────────────────────────────────── */}
        {tab === 'Papers' && (
          <View style={{ gap: Spacing.md }}>
            {subject.papers.length === 0 ? (
              emptyView(
                'document-text-outline',
                'No papers yet',
                'Add past university question papers (PDF or photos) to extract and bank questions.',
                <TouchableOpacity
                  style={[styles.btn, { backgroundColor: colors.accent, marginTop: Spacing.sm }]}
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
            ) : (
              <View style={{ gap: Spacing.md }}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
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
                    <Text
                      style={{
                        color: colors.accentText,
                        fontWeight: '700',
                        fontSize: FontSize.caption,
                      }}
                    >
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
                        styles.paperCard,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[styles.h3, { color: colors.text }]}>
                          {p.year ? `${p.year} Paper` : p.title || 'Exam Paper'}
                          {p.session ? ` · ${p.session}` : ''}
                        </Text>
                        <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption }}>
                          {p.pageCount} page{p.pageCount !== 1 ? 's' : ''} · {qCount} question
                          {qCount !== 1 ? 's' : ''}
                        </Text>
                      </View>

                      <TouchableOpacity
                        onPress={() => {
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
                                    questions: subject.questions.filter(
                                      (q) => q.paperId !== p.id,
                                    ),
                                  };
                                  await saveSubject(updatedSubject);
                                  setSubject(updatedSubject);
                                },
                              },
                            ],
                          );
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
            )}
          </View>
        )}
      </ScrollView>

      {subject.questions.length > 0 && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: colors.accent }]}
          onPress={() =>
            router.push({ pathname: '/subject/practice', params: { subjectId: subject.id } })
          }
          accessibilityLabel="Start practice"
        >
          <Ionicons name="flash" size={20} color={colors.accentText} />
          <Text style={{ color: colors.accentText, fontWeight: '700' }}>Practice</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  fab: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderRadius: 24,
    elevation: 4,
  },
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.sm,
    paddingBottom: Spacing.xl * 2,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBlock: {
    gap: 4,
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: FontSize.h1,
    fontWeight: '700',
  },
  summaryLine: {
    fontSize: FontSize.caption,
  },
  seg: {
    flexDirection: 'row',
    borderRadius: BorderRadius.button,
    padding: 3,
    marginVertical: Spacing.sm,
  },
  segItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.button - 3,
  },
  empty: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl * 1.5,
  },
  emptyTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  emptyBody: {
    textAlign: 'center',
    fontSize: FontSize.caption,
    maxWidth: 280,
  },
  btn: {
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.button,
    justifyContent: 'center',
  },
  h3: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  unitCard: {
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  unitHeaderTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  unitTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  unitTitle: {
    fontSize: FontSize.h3,
    fontWeight: '700',
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
  },
  priorityBadgeText: {
    fontSize: FontSize.tiny,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  unitStats: {
    fontSize: FontSize.caption,
  },
  weightBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginTop: 4,
  },
  weightBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  topicsList: {
    borderTopWidth: 1,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.sm,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
  },
  topicName: {
    fontSize: FontSize.body - 1,
    fontWeight: '600',
  },
  topicSub: {
    fontSize: FontSize.tiny,
  },
  noTopicsText: {
    fontSize: FontSize.caption,
    fontStyle: 'italic',
    paddingVertical: Spacing.xs,
  },
  sortSelectorContainer: {
    gap: Spacing.xs,
  },
  sectionLabel: {
    fontSize: FontSize.tiny,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  sortSegment: {
    flexDirection: 'row',
    borderRadius: BorderRadius.button,
    padding: 3,
  },
  sortSegmentItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: BorderRadius.button - 3,
  },
  sortSegmentText: {
    fontSize: FontSize.caption,
  },
  filterSection: {
    gap: Spacing.xs,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearFilterText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  filterChipsScroll: {
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
  },
  resultsInfoRow: {
    paddingHorizontal: Spacing.xs,
  },
  resultsInfoText: {
    fontSize: FontSize.caption,
  },
  questionCard: {
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    gap: Spacing.xs,
  },
  qHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
  },
  badgeText: {
    fontSize: FontSize.tiny + 1,
    fontWeight: '700',
  },
  miniBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: BorderRadius.chip,
  },
  miniBadgeText: {
    fontSize: FontSize.tiny,
    fontWeight: '700',
  },
  questionBody: {
    fontSize: FontSize.body - 1,
    lineHeight: 22,
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: BorderRadius.chip,
    maxWidth: '70%',
  },
  topicChipText: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
  },
  groupLabel: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
  },
  paperCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
});
