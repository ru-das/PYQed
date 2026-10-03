import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import type { Question } from '../logic/subject';

export type QuestionFieldValues = {
  number: string;
  marks: string; // text while typing; blank = not printed (null)
  group: string;
  type: Question['type'];
  text: string;
};

const TYPES = ['short', 'long', 'mcq', 'other'] as const;

/** Marks field text -> number | null. Blank or invalid = null (never guessed). */
export function parseMarks(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The edit form for one question. Used by Paper review and by Edit question. */
export function QuestionFields({ value, onChange }: {
  value: QuestionFieldValues;
  onChange: (patch: Partial<QuestionFieldValues>) => void;
}) {
  const colors = useThemeColors();
  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];
  const label = [styles.label, { color: colors.textSecondary }];

  return (
    <View style={{ gap: Spacing.sm }}>
      <View style={styles.row}>
        <View style={{ width: 80 }}>
          <Text style={label}>Number</Text>
          <TextInput style={input} value={value.number} onChangeText={(t) => onChange({ number: t })}
            placeholder="e.g. 1a" placeholderTextColor={colors.textSecondary} />
        </View>
        <View style={{ width: 80 }}>
          <Text style={label}>Marks</Text>
          <TextInput style={input} value={value.marks} onChangeText={(t) => onChange({ marks: t })}
            placeholder="?" placeholderTextColor={colors.textSecondary} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={label}>Section</Text>
          <TextInput style={input} value={value.group} onChangeText={(t) => onChange({ group: t })}
            placeholder="Group A (optional)" placeholderTextColor={colors.textSecondary} />
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={label}>Type</Text>
        <View style={styles.row}>
          {TYPES.map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.typeBtn, { backgroundColor: value.type === t ? colors.accent : colors.chip }]}
              onPress={() => onChange({ type: t })}
              accessibilityLabel={`Type ${t}`}
            >
              <Text style={{ color: value.type === t ? colors.accentText : colors.textSecondary, fontSize: FontSize.caption, fontWeight: '600', textTransform: 'uppercase' }}>
                {t}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={label}>Question text</Text>
        <TextInput
          style={[input, styles.textArea]}
          value={value.text}
          onChangeText={(t) => onChange({ text: t })}
          placeholder="Question text..."
          placeholderTextColor={colors.textSecondary}
          multiline
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm },
  label: { fontSize: FontSize.tiny + 1, fontWeight: '600', marginBottom: 2 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: BorderRadius.input, paddingHorizontal: Spacing.sm, fontSize: FontSize.caption + 1 },
  typeBtn: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.chip },
  textArea: { minHeight: 90, textAlignVertical: 'top', paddingTop: Spacing.sm, lineHeight: 20 },
});
