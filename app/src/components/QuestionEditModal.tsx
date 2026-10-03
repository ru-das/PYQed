import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, Pressable, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import type { Question } from '../logic/subject';
import { checkNeedsReview } from '../ai/validators';
import { QuestionFields, QuestionFieldValues, parseMarks } from './QuestionFields';

function toFields(q: Question): QuestionFieldValues {
  return { number: q.number, marks: q.marks === null ? '' : String(q.marks), group: q.group ?? '', type: q.type, text: q.text };
}

/** Bottom sheet to edit one saved question. Marks the question as user-edited so AI re-runs never overwrite it. */
export function QuestionEditModal({ question, onSave, onClose }: {
  question: Question | null;
  onSave: (updated: Question) => void;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const [fields, setFields] = useState<QuestionFieldValues | null>(null);
  const [year, setYear] = useState('');

  useEffect(() => {
    if (!question) return;
    setFields(toFields(question));
    setYear(question.year === null ? '' : String(question.year));
  }, [question]);

  const save = () => {
    if (!question || !fields) return;
    const marks = parseMarks(fields.marks);
    const y = parseInt(year.trim(), 10);
    onSave({
      ...question,
      number: fields.number.trim(),
      marks,
      group: fields.group.trim() || undefined,
      type: fields.type,
      text: fields.text.trim(),
      year: Number.isFinite(y) ? y : null,
      needsReview: checkNeedsReview(fields.text, marks),
      editedByUser: true,
    });
  };

  return (
    <Modal visible={question !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>Edit question</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ marginVertical: Spacing.sm }}>
            {fields && (
              <View style={{ gap: Spacing.sm }}>
                <QuestionFields value={fields} onChange={(p) => setFields({ ...fields, ...p })} />
                <View style={{ width: 100 }}>
                  <Text style={{ color: colors.textSecondary, fontSize: FontSize.tiny + 1, fontWeight: '600', marginBottom: 2 }}>Year</Text>
                  <TextInput
                    style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                    value={year} onChangeText={setYear} keyboardType="numeric" maxLength={4}
                    placeholder="e.g. 2023" placeholderTextColor={colors.textSecondary}
                  />
                </View>
              </View>
            )}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.chip, flex: 1 }]} onPress={onClose}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent, flex: 1 }]} onPress={save} accessibilityLabel="Save question">
              <Text style={{ color: colors.accentText, fontWeight: '700' }}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { borderTopLeftRadius: BorderRadius.card + 4, borderTopRightRadius: BorderRadius.card + 4, borderTopWidth: 1, padding: Spacing.md, maxHeight: '90%' },
  title: { fontSize: FontSize.h3, fontWeight: '700' },
  input: { minHeight: 44, borderWidth: 1, borderRadius: BorderRadius.input, paddingHorizontal: Spacing.sm, fontSize: FontSize.caption + 1 },
  btn: { minHeight: 48, borderRadius: BorderRadius.button, alignItems: 'center', justifyContent: 'center' },
});
