import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import type { SyllabusImportProgress } from '../ai/importSyllabus';

export type ProgressStep = { label: string; state: 'done' | 'current' | 'pending'; detail?: string };

type Props = {
  title: string;
  elapsedSec: number;
  steps?: ProgressStep[];
  /** Fun rotating lines under the title (shuffled, a new one every few seconds) */
  phrases?: string[];
  /** Tail of the model's own thinking. While it streams, it takes the place of the rotating phrases. */
  peek?: string;
  /** Tells the user they can leave this screen while the import keeps running */
  canLeave?: boolean;
  current?: number;
  total?: number;
};

/** Phrases for the syllabus import. Just for fun, in the spirit of a coding agent's spinner words. */
export const SYLLABUS_PHRASES = [
  'Hunting for unit headings...',
  'Squinting at the tables...',
  'Ignoring the book list...',
  'Untangling sub-topics...',
  'Counting topics twice...',
  'Asking the AI nicely...',
  'Skipping the course outcomes...',
  'Matching topics to units...',
  'Reading between the table lines...',
  'Double-checking Unit 3...',
  'Sharpening imaginary pencils...',
  'Decoding the credit hours...',
  'Sorting modules from marginalia...',
  'Copying names exactly, as promised...',
  'Not inventing any topics...',
  'Deciphering the fine print...',
  'Finding where Unit 1 ends...',
  'Flipping through the syllabus...',
  'Highlighting the important bits...',
  'Making a study map...',
  'Turning tables into topics...',
  'Dusting off the semester plan...',
  'Spotting the lab sessions...',
  'Reading the footnotes so you do not have to...',
  'Lining up units in order...',
  'Pondering prerequisites...',
  'Cross-checking subject codes...',
  'Neatly filing every topic...',
  'Warming up the question bank...',
  'Almost like having a topper friend...',
];

/** Phrases while a paper's pages are read */
export const PAPER_PHRASES = [
  'Finding where Q3 ends...',
  'Reading the marks in the margin...',
  'Spotting OR questions...',
  'Copying, not solving...',
  'Squinting at the scan...',
  'Skipping the instructions box...',
  'Hunting for the year...',
  'Counting sub-parts (a), (b), (c)...',
  'Reading formulas carefully...',
  'Checking the question numbers...',
  'Ignoring page numbers...',
  'Working out "Answer any five"...',
  'Not guessing any marks...',
  'Straightening the page in my head...',
  'Looking for Group A, Group B...',
  'Copying the lead-in text to each part...',
  'Peeking at the previous page...',
  'Turning a scan into text...',
  'Flipping through old papers...',
  'Making the question bank longer...',
];

/** Phrases while questions are matched to topics and repeats are found */
export const LABEL_PHRASES = [
  'Matching questions to topics...',
  'Spotting repeat offenders...',
  "Finding the examiner's favourite topics...",
  'Reading the syllabus again...',
  'Checking which questions came back...',
  'Sorting questions into units...',
  'Comparing wording across years...',
  'Same question, new numbers...',
  'Leaving unsure ones for you to check...',
  'Building the topic list...',
  'Counting how often things repeat...',
  'Looking for déjà vu questions...',
  'Filing questions under topics...',
  'Sharpening the question bank...',
  'Almost like having a topper friend...',
];

type Live = { phase: 'thinking' | 'writing'; peek?: string; found?: number } | undefined;
type Pos = { current: number; total: number; live?: Live };

/** "AI is thinking" or "6 questions so far", for the current step's detail line */
function liveDetail(live: Live, noun: string): string | undefined {
  if (!live) return undefined;
  if (live.phase === 'thinking') return 'AI is thinking';
  if (live.found === undefined) return 'Writing the result';
  return `${live.found} ${noun}${live.found === 1 ? '' : 's'} so far`;
}

const stepsAt = (labels: string[], cur: number, detail?: string): ProgressStep[] =>
  labels.map((label, i) => ({
    label,
    state: i < cur ? 'done' : i === cur ? 'current' : 'pending',
    detail: i === cur ? detail : undefined,
  }));

/** Steps while a paper is read: prepare, one AI call per page, then check. */
export function paperSteps(stage: 'reading' | 'extracting' | 'done', p: Pos): ProgressStep[] {
  const live = liveDetail(p.live, 'question');
  const detail = `Page ${p.current} of ${p.total}${live ? ` · ${live}` : ''}`;
  const cur = stage === 'reading' ? 0 : stage === 'extracting' ? 1 : 2;
  return stepsAt(['Prepare pages', 'Read pages', 'Check & organise'], cur, cur === 1 ? detail : undefined);
}

/** Steps while a syllabus is read: prepare pages, one AI call (or one per page), then check. */
export function syllabusSteps(p: SyllabusImportProgress): ProgressStep[] {
  const { live, stage, current, total } = p;
  const found = live?.found;
  const liveText = !live
    ? undefined
    : live.phase === 'thinking'
      ? 'AI is thinking'
      : found && (found.units || found.topics)
        ? `${found.units} unit${found.units === 1 ? '' : 's'} · ${found.topics} topic${found.topics === 1 ? '' : 's'} so far`
        : 'Writing the result';
  const parts = [total > 1 ? `${stage === 'reading' ? 'Page' : 'Batch'} ${current} of ${total}` : undefined, stage === 'retrying' ? 'Answer was messy, asking again' : liveText];
  const cur = stage === 'reading' ? 0 : stage === 'merging' ? 2 : 1;
  return stepsAt(['Prepare pages', 'Read syllabus', 'Check & organise'], cur, parts.filter(Boolean).join(' · ') || undefined);
}

/** Steps while questions are matched to topics. */
export function labelSteps(p: Pos): ProgressStep[] {
  const live = liveDetail(p.live, 'label');
  const detail = `Batch ${p.current} of ${p.total}${live ? ` · ${live}` : ''}`;
  return stepsAt(['Match questions to topics'], 0, detail);
}

// Fisher-Yates, so each import shows the lines in a different order
function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Shared "AI is working" screen: looping scan animation, live step list, elapsed time. */
export function ImportProgress({
  title,
  elapsedSec,
  steps,
  phrases,
  peek,
  canLeave,
  current = 0,
  total = 0,
}: Props) {
  const colors = useThemeColors();
  const scan = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const [order] = useState(() => (phrases ? shuffled(phrases) : []));
  const [phraseIdx, setPhraseIdx] = useState(0);

  // Scan line sweeping down the page icon, forever
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(scan, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const dot = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    dot.start();
    return () => {
      loop.stop();
      dot.stop();
    };
  }, [scan, pulse]);

  // New phrase every 3 s with a quick fade out/in
  useEffect(() => {
    if (order.length < 2) return;
    const t = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setPhraseIdx((i) => (i + 1) % order.length);
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
    }, 3000);
    return () => clearInterval(t);
  }, [order, fade]);

  const m = Math.floor(elapsedSec / 60);
  const s = String(elapsedSec % 60).padStart(2, '0');
  const showBar = total > 1;

  return (
    <View style={styles.wrap}>
      {/* Page icon with a scan line sweeping over it */}
      <View style={[styles.page, { backgroundColor: colors.chip, borderColor: colors.border }]}>
        <Ionicons name="document-text-outline" size={56} color={colors.textSecondary} />
        <Animated.View
          style={[
            styles.scanLine,
            {
              backgroundColor: colors.accent,
              transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [0, 84] }) }],
            },
          ]}
        />
      </View>

      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {/* The model's live thinking when we have it, otherwise the rotating phrases. Same slot, same height. */}
      {peek ? (
        // ellipsizeMode head keeps the newest words visible as the text grows
        <Text style={[styles.phrase, { color: colors.textSecondary }]} numberOfLines={2} ellipsizeMode="head">
          {peek}
        </Text>
      ) : order.length > 0 ? (
        <Animated.Text style={[styles.phrase, { color: colors.textSecondary, opacity: fade }]}>
          {order[phraseIdx]}
        </Animated.Text>
      ) : null}
      <Text
        style={[styles.elapsed, { color: colors.textSecondary }]}
        accessibilityLabel={`${elapsedSec} seconds elapsed`}
      >
        Elapsed time: {m}:{s}
      </Text>

      {showBar && (
        <View style={styles.barRow}>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: colors.accent, width: `${Math.min(100, (current / total) * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {current} / {total}
          </Text>
        </View>
      )}

      {steps && (
        <View style={[styles.steps, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {steps.map((st) => (
            <View key={st.label} style={styles.stepRow}>
              {st.state === 'done' ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
              ) : st.state === 'current' ? (
                <Animated.View style={[styles.dotBox, { opacity: pulse }]}>
                  <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                </Animated.View>
              ) : (
                <Ionicons name="ellipse-outline" size={20} color={colors.border} />
              )}
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: st.state === 'pending' ? colors.textSecondary : colors.text,
                    fontWeight: st.state === 'current' ? '700' : '500',
                    fontSize: FontSize.body - 1,
                  }}
                >
                  {st.label}
                </Text>
                {st.state === 'current' && st.detail ? (
                  <Text style={[styles.detail, { color: colors.textSecondary }]}>{st.detail}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      )}

      {canLeave && (
        <View style={[styles.hint, { backgroundColor: colors.accent + '15', borderColor: colors.accent }]}>
          <Ionicons name="information-circle-outline" size={20} color={colors.accent} />
          <Text style={[styles.hintText, { color: colors.text }]}>
            Tables can take the AI a few minutes. You can leave this screen and do something else; we'll keep
            going and notify you when it's ready.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.md, width: '100%', paddingHorizontal: Spacing.lg },
  page: {
    width: 96,
    height: 96,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Sits at the top of the page box; translateY moves it down and back
  scanLine: { position: 'absolute', top: 6, left: 8, right: 8, height: 3, borderRadius: 2 },
  title: { fontSize: FontSize.h3, fontWeight: '700', textAlign: 'center' },
  phrase: { fontSize: FontSize.body, textAlign: 'center', minHeight: 44, lineHeight: 22 },
  elapsed: { fontSize: FontSize.caption, fontVariant: ['tabular-nums'] },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, width: '100%' },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  count: { fontSize: FontSize.caption, fontVariant: ['tabular-nums'] },
  steps: {
    width: '100%',
    borderWidth: 1,
    borderRadius: BorderRadius.card,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  dotBox: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  detail: { fontSize: FontSize.caption, marginTop: 2 },
  hint: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  hintText: { flex: 1, fontSize: FontSize.caption + 1, lineHeight: 20 },
});
