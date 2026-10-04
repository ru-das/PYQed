import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Modal,
} from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import {
  getSubject,
  saveSubject,
  exportSubjectFile,
  deletePaperImages,
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
  topicWeight,
  distinctYears,
  collapseRepeats,
  groupIndex,
} from '../../src/logic/ranking';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import { ImportProgress, LABEL_PHRASES, labelSteps } from '../../src/components/ImportProgress';
import { QuestionCard } from '../../src/components/QuestionCard';
import { getApiSettings } from '../../src/ai/settings';
import { labelQuestions } from '../../src/ai/labelQuestions';
import { groupRepeats } from '../../src/ai/groupRepeats';
import type { StreamProgress } from '../../src/ai/client';
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
const PAGE_SIZE = 40; // cards rendered at a time in All questions


function topicNameOf(units: Unit[], topicId: string | null): string | null {
  if (!topicId) return null;
  for (const u of units) {
    const t = u.topics.find((x) => x.id === topicId);
    if (t) return t.name;
  }
  return null;
}

/** One labelled, horizontally scrolling row of single-select chips. Tapping the active chip clears it. */
function FilterRow<K extends string>({ label, options, value, onSelect }: {
  label: string;
  options: { key: K; label: string }[];
  value: K | undefined;
  onSelect: (key: K | undefined) => void;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }}>
      <Text style={{ width: 44, fontSize: FontSize.tiny + 1, fontWeight: '600', color: colors.textSecondary }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: Spacing.xs }}>
        {options.map((o) => {
          const active = value === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              hitSlop={{ top: 6, bottom: 6 }}
              style={[
                styles.filterChip,
                { backgroundColor: active ? colors.accent : colors.card, borderColor: active ? colors.accent : colors.border },
              ]}
              onPress={() => onSelect(active ? undefined : o.key)}
              accessibilityLabel={`${label} ${o.label}`}
            >
              <Text style={[styles.filterChipText, { color: active ? colors.accentText : colors.text }]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function SubjectScreen() {
  const colors = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>('Topics');

  // Sorting and Filtering state for All Questions tab
  const [sortBy, setSortBy] = useState<SortOption>('marks');
  const [filters, setFilters] = useState<QuestionFilters>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [relabelling, setRelabelling] = useState(false);
  // Live state of the "Sort unassigned" run, shown on the same progress page as a paper import
  const [relabelKind, setRelabelKind] = useState<'labels' | 'repeats'>('labels');
  const [relabelProg, setRelabelProg] = useState<{ current: number; total: number; live?: StreamProgress }>({ current: 0, total: 0 });
  const [relabelSec, setRelabelSec] = useState(0);
  useEffect(() => {
    if (!relabelling) return;
    const start = Date.now();
    setRelabelSec(0);
    const tick = setInterval(() => setRelabelSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(tick);
  }, [relabelling]);
  const [expandedUnitIds, setExpandedUnitIds] = useState<Set<string>>(new Set());

  const initialisedRef = useRef(false);
  const load = useCallback(async () => {
    if (!id) return;
    const s = await getSubject(id);
    setSubject(s);
    // Expand all units the first time only, so returning from a topic keeps the user's collapsed units
    if (s && !initialisedRef.current) {
      initialisedRef.current = true;
      setExpandedUnitIds(new Set(s.units.map((u) => u.id)));
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  // Show the first page again whenever the list changes
  useEffect(() => setVisibleCount(PAGE_SIZE), [filters, sortBy]);

  const groups = useMemo(() => groupIndex(subject?.questions ?? []), [subject]);

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

  // Try again to match unassigned questions to topics (e.g. after a failed run or after adding topics)
  const relabelUnassigned = async () => {
    const { provider, apiKey, modelId } = await getApiSettings();
    if (!apiKey.trim()) {
      Alert.alert('API key needed', 'Add your API key in Settings, then try again.');
      return;
    }
    setRelabelKind('labels');
    setRelabelProg({ current: 0, total: 0 });
    setRelabelling(true);
    try {
      const ids = unassignedQs.filter((q) => !q.editedByUser).map((q) => q.id);
      let next: Subject = { ...subject, questions: await labelQuestions(subject, ids, provider, apiKey, modelId, setRelabelProg) };
      setRelabelKind('repeats');
      next = { ...next, questions: await groupRepeats(next, ids, provider, apiKey, modelId, setRelabelProg) };
      await saveSubject(next);
      setSubject(next);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const left = next.questions.filter((q) => q.topicId === null).length;
      Alert.alert('Done', left === 0 ? 'Every question now has a topic.' : `${left} still couldn't be matched. You can move them by hand.`);
    } catch (e: any) {
      Alert.alert('Could not sort questions', e?.message || 'Something went wrong.');
    } finally {
      setRelabelling(false);
    }
  };

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
                                ? ` · ~${uWeight.toFixed(1)} marks/paper`
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
                                const avgMarks = topicWeight(
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
                                              Low confidence
                                            </Text>
                                          </View>
                                        )}
                                      </View>
                                      <Text style={[styles.topicSub, { color: colors.textSecondary }]}>
                                        {tQuestions.length} question{tQuestions.length !== 1 ? 's' : ''}
                                        {paperCount > 0
                                          ? ` · ~${avgMarks.toFixed(1)} marks/paper`
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
                {unassignedQs.length > 0 && (
                  <TouchableOpacity
                    style={[styles.btn, { borderColor: colors.accent, borderWidth: 1, opacity: relabelling ? 0.6 : 1 }]}
                    onPress={relabelUnassigned}
                    disabled={relabelling}
                    accessibilityLabel="Sort unassigned questions into topics"
                  >
                    <Text style={{ color: colors.accent, fontWeight: '700' }}>
                      {relabelling ? 'Sorting…' : 'Sort unassigned into topics'}
                    </Text>
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
                <View style={{ gap: Spacing.xs }}>
                  <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>SORT BY</Text>
                  <View style={[styles.sortSegment, { backgroundColor: colors.chip }]}>
                    {(
                      [
                        { key: 'marks', label: 'Marks' },
                        { key: 'timesAsked', label: 'Times asked' },
                        { key: 'year', label: 'Year' },
                        { key: 'unitOrder', label: 'Unit' },
                      ] as const
                    ).map((o) => (
                      <TouchableOpacity
                        key={o.key}
                        style={[styles.sortSegmentItem, sortBy === o.key && { backgroundColor: colors.card }]}
                        onPress={() => setSortBy(o.key)}
                        accessibilityLabel={`Sort by ${o.label}`}
                      >
                        <Text
                          style={{
                            fontSize: FontSize.caption,
                            color: sortBy === o.key ? colors.text : colors.textSecondary,
                            fontWeight: sortBy === o.key ? '700' : '500',
                          }}
                        >
                          {o.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>

                {/* Filters: one labelled row per kind */}
                <View style={{ gap: Spacing.xs }}>
                  <View style={styles.filterHeaderRow}>
                    <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>FILTERS</Text>
                    {hasActiveFilters && (
                      <TouchableOpacity onPress={() => setFilters({})} accessibilityLabel="Clear all filters" style={{ minHeight: 32, justifyContent: 'center' }}>
                        <Text style={[styles.clearFilterText, { color: colors.accent }]}>Reset all</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <FilterRow
                    label="Unit"
                    options={[
                      ...subject.units.map((u) => ({ key: u.id, label: u.name })),
                      ...(unassignedQs.length > 0 ? [{ key: 'unassigned', label: `Unassigned (${unassignedQs.length})` }] : []),
                    ]}
                    value={filters.unitId ?? undefined}
                    onSelect={(unitId) => setFilters((f) => ({ ...f, unitId }))}
                  />
                  <FilterRow
                    label="Type"
                    options={(['mcq', 'short', 'long', 'other'] as const).map((t) => ({ key: t, label: t.toUpperCase() }))}
                    value={filters.type ?? undefined}
                    onSelect={(type) => setFilters((f) => ({ ...f, type }))}
                  />
                  <FilterRow
                    label="Marks"
                    options={[
                      { key: 'low', label: '≤ 2' },
                      { key: 'mid', label: '3–5' },
                      { key: 'high', label: '10+' },
                    ]}
                    value={filters.marksRange ?? undefined}
                    onSelect={(marksRange) => setFilters((f) => ({ ...f, marksRange }))}
                  />
                  {availableYears.length > 0 && (
                    <FilterRow
                      label="Year"
                      options={availableYears.map((y) => ({ key: String(y), label: String(y) }))}
                      value={filters.year != null ? String(filters.year) : undefined}
                      onSelect={(y) => setFilters((f) => ({ ...f, year: y ? Number(y) : undefined }))}
                    />
                  )}
                  <FilterRow
                    label="Show"
                    options={[{ key: 'review', label: 'Needs review' }]}
                    value={filters.needsReview ? 'review' : undefined}
                    onSelect={(v) => setFilters((f) => ({ ...f, needsReview: v ? true : undefined }))}
                  />
                </View>

                <Text style={[styles.resultsInfoText, { color: colors.textSecondary }]}>
                  Showing {displayedQuestions.length} of {subject.questions.length} questions
                </Text>

                {(() => {
                  const cards = collapseRepeats(displayedQuestions);
                  return (
                    <>
                      {cards.slice(0, visibleCount).map(([q, ...otherVersions]) => (
                        <QuestionCard
                          key={q.id}
                          q={q}
                          versions={otherVersions}
                          all={subject.questions}
                          groups={groups}
                          showTopic
                          topicName={topicNameOf(subject.units, q.topicId)}
                          onPress={() =>
                            router.push({
                              pathname: '/subject/topic',
                              params: { subjectId: subject.id, topicId: q.topicId ?? 'unassigned' },
                            })
                          }
                        />
                      ))}
                      {cards.length > visibleCount && (
                        <TouchableOpacity
                          style={[styles.btn, { borderColor: colors.border, borderWidth: 1 }]}
                          onPress={() => setVisibleCount((n) => n + PAGE_SIZE)}
                        >
                          <Text style={{ color: colors.accent, fontWeight: '700' }}>
                            Show {Math.min(PAGE_SIZE, cards.length - visibleCount)} more
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  );
                })()}
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
                    Papers ({subject.papers.length})
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
                    <TouchableOpacity
                      key={p.id}
                      activeOpacity={0.8}
                      onPress={() => router.push({ pathname: '/subject/paper', params: { subjectId: subject.id, paperId: p.id } })}
                      accessibilityLabel={`Review ${p.year ?? p.title ?? 'paper'}`}
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
                            'Delete paper?',
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
                                  deletePaperImages(subject.id, p.id);
                                  setSubject(updatedSubject);
                                },
                              },
                            ],
                          );
                        }}
                        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                        accessibilityLabel="Delete paper"
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.red} />
                      </TouchableOpacity>
                    </TouchableOpacity>
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

      {/* Same progress page as a paper import while unassigned questions are sorted */}
      <Modal visible={relabelling} animationType="fade" onRequestClose={() => {}}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg, backgroundColor: colors.background }}>
          <ImportProgress
            title="Sorting questions into topics..."
            elapsedSec={relabelSec}
            steps={labelSteps(relabelKind, relabelProg)}
            phrases={LABEL_PHRASES}
            peek={relabelProg.live?.phase === 'thinking' ? relabelProg.live.peek : undefined}
            current={relabelProg.current}
            total={relabelProg.total}
          />
        </View>
      </Modal>
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
  filterHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  clearFilterText: {
    fontSize: FontSize.caption,
    fontWeight: '600',
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
  resultsInfoText: {
    fontSize: FontSize.caption,
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
  paperCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
  },
});
