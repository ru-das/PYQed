import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { toast } from './Toast';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import { displayNumber, Question } from '../logic/subject';
import { askedYears, timesAsked, GroupIndex } from '../logic/ranking';

/** What the card needs from a question: a saved Question fits, and so does a draft in Paper review. */
export type CardQuestion = Pick<Question, 'id' | 'number' | 'text' | 'type' | 'needsReview'> & {
  marks: number | null;
  group?: string;
  year?: number | null;
  topicConfidence?: Question['topicConfidence'];
  editedByUser?: boolean;
};

type Props = {
  q: CardQuestion;
  /** Other wordings from the same repeat group (q is the most recent). */
  versions?: Question[];
  /** The subject's questions and repeat groups, to work out "Asked 3×". Omit for a draft. */
  all?: Question[];
  groups?: GroupIndex;
  /** Topic name to show in the footer; null shows "Unassigned". Omit to hide the footer chip. */
  topicName?: string | null;
  showTopic?: boolean;
  /** Tapping the card runs this (e.g. open the topic). Without it, long text expands in place. */
  onPress?: () => void;
  /** Icon buttons in the card header. Each shows only when its handler is given. */
  onMove?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Review screens: spell out what is wrong (marks missing, very short text) */
  warnings?: boolean;
};

/** The one question card: All questions, Topic view, Paper review and the import review. */
export function QuestionCard({ q, versions = [], all, groups, topicName, showTopic, onPress, onMove, onEdit, onDelete, warnings }: Props) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  // Without the subject's questions (a draft) nothing can repeat: asked once, no year list
  const times = all ? timesAsked(q as Question, all, groups) : 1;
  const years = all ? askedYears(q as Question, all, groups) : [];

  const chip = (text: string, fg: string, bg: string, border?: string) => (
    <View style={[styles.badge, { backgroundColor: bg }, border ? { borderColor: border, borderWidth: 1 } : null]}>
      <Text style={[styles.badgeText, { color: fg }]}>{text}</Text>
    </View>
  );

  // Long-press names an icon button, since the icons have no text
  const iconBtn = (name: keyof typeof Ionicons.glyphMap, label: string, onPress: () => void, color: string) => (
    <TouchableOpacity key={name} onPress={onPress} onLongPress={() => toast(label, 'info')} style={styles.iconBtn} accessibilityLabel={label}>
      <Ionicons name={name} size={18} color={color} />
    </TouchableOpacity>
  );

  const warning = (icon: keyof typeof Ionicons.glyphMap, text: string) => (
    <View style={styles.warningLine}>
      <Ionicons name={icon} size={14} color={colors.amber} />
      <Text style={{ color: colors.amber, fontSize: FontSize.caption, flex: 1 }}>{text}</Text>
    </View>
  );

  const body = (
    <>
      <View style={styles.header}>
        <View style={styles.chips}>
          {chip(q.number.trim() ? displayNumber(q.number) : '—', colors.text, colors.chip)}
          {q.marks !== null
            ? chip(`${q.marks} marks`, colors.text, colors.surface, colors.border)
            : chip('? marks', colors.amber, colors.amberBg)}
          {chip(q.type, colors.textSecondary, colors.chip)}
          {times > 1 &&
            chip(`Asked ${times}×${years.length ? ` (${years.join(', ')})` : ''}`, colors.amber, colors.amberBg, colors.amber)}
          {times <= 1 && q.year ? chip(String(q.year), colors.textSecondary, colors.chip) : null}
          {q.topicConfidence === 'low' && !q.editedByUser && chip('Low confidence', colors.amber, colors.amberBg)}
        </View>
        <View style={styles.actions}>
          {onMove && iconBtn('folder-open-outline', 'Move to topic', onMove, colors.textSecondary)}
          {onEdit && iconBtn('pencil-outline', 'Edit question', onEdit, colors.textSecondary)}
          {onDelete && iconBtn('trash-outline', 'Delete question', onDelete, colors.red)}
          {!onMove && !onEdit && !onDelete && onPress ? (
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          ) : null}
        </View>
      </View>

      {warnings && q.marks === null && warning('alert-circle-outline', 'Marks not printed. Enter marks if known or leave blank.')}
      {warnings && q.text.trim().length > 0 && q.text.trim().length < 10 && warning('information-circle-outline', 'Question text is very short. Check scan.')}

      <Text style={[styles.text, { color: colors.text }]} numberOfLines={expanded ? undefined : 3}>
        {q.text}
      </Text>

      {(showTopic || q.group || (!onPress && q.text.length > 120)) && (
        <View style={styles.footer}>
          {showTopic ? (
            <View style={[styles.topicChip, { backgroundColor: topicName ? colors.chip : colors.amberBg }]}>
              {topicName ? <Ionicons name="folder-outline" size={12} color={colors.accent} /> : null}
              <Text style={{ color: topicName ? colors.accent : colors.amber, fontSize: FontSize.tiny, fontWeight: '600' }} numberOfLines={1}>
                {topicName ?? 'Unassigned'}
              </Text>
            </View>
          ) : (
            <Text style={[styles.group, { color: colors.textSecondary }]}>{q.group ?? ''}</Text>
          )}
          {!onPress && q.text.length > 120 && (
            <TouchableOpacity onPress={() => setExpanded(!expanded)} style={styles.linkBtn}>
              <Text style={[styles.link, { color: colors.accent }]}>{expanded ? 'Show less' : 'Show more'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </>
  );

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: q.needsReview ? colors.amber : colors.border }]}>
      {onPress ? (
        <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={{ gap: Spacing.xs }}>
          {body}
        </TouchableOpacity>
      ) : (
        <View style={{ gap: Spacing.xs }}>{body}</View>
      )}

      {versions.length > 0 && (
        <View style={{ marginTop: Spacing.xs }}>
          <TouchableOpacity onPress={() => setVersionsOpen(!versionsOpen)} style={styles.linkBtn} accessibilityLabel="Toggle other versions of this question">
            <Text style={[styles.link, { color: colors.accent }]}>
              {versionsOpen ? 'Hide other versions' : `Show ${versions.length} other version${versions.length > 1 ? 's' : ''}`}
            </Text>
          </TouchableOpacity>
          {versionsOpen &&
            versions.map((v) => (
              <Text key={v.id} style={[styles.group, { color: colors.textSecondary, marginTop: 4 }]}>
                {v.year ?? '?'} · {displayNumber(v.number)} · {v.text}
              </Text>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md, borderRadius: BorderRadius.card, borderWidth: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.xs, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: BorderRadius.chip },
  badgeText: { fontSize: FontSize.tiny + 1, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 44, height: 44, marginTop: -10, marginBottom: -10, alignItems: 'center', justifyContent: 'center' },
  warningLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: FontSize.body - 1, lineHeight: 22 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, borderRadius: BorderRadius.chip, maxWidth: '70%' },
  group: { fontSize: FontSize.tiny, fontWeight: '600' },
  linkBtn: { minHeight: 36, justifyContent: 'center' },
  link: { fontSize: FontSize.caption, fontWeight: '600' },
});
