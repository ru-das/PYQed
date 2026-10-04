import React, { useState } from 'react';
import { View } from 'react-native';
import { Spacing } from '../theme';
import type { Question } from '../logic/subject';
import { checkNeedsReview } from '../ai/validators';
import { QuestionFields, QuestionFieldValues, parseMarks } from './QuestionFields';
import { Button, Sheet, SheetScroll } from './ui';

/** A saved question as form fields */
export function toFields(q: Question): QuestionFieldValues {
  return { number: q.number, marks: q.marks === null ? '' : String(q.marks), group: q.group ?? '', type: q.type, text: q.text };
}

/** The edited fields applied to a saved question. Marks it as user-edited so AI re-runs never overwrite it. */
export function applyFields(q: Question, f: QuestionFieldValues): Question {
  const marks = parseMarks(f.marks);
  return {
    ...q,
    number: f.number.trim(),
    marks,
    group: f.group.trim() || undefined,
    type: f.type,
    text: f.text.trim(),
    needsReview: checkNeedsReview(f.text, marks),
    editedByUser: true,
  };
}

/** The form inside the sheet. Mounted only while the sheet is open, so it starts fresh each time. */
function EditForm({ initial, onSave, onClose }: {
  initial: QuestionFieldValues;
  onSave: (v: QuestionFieldValues) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(initial);
  return (
    <>
      <SheetScroll>
        <QuestionFields value={fields} onChange={(p) => setFields({ ...fields, ...p })} />
      </SheetScroll>
      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        <Button label="Cancel" variant="outline" onPress={onClose} style={{ flex: 1 }} />
        <Button label="Save" onPress={() => onSave(fields)} style={{ flex: 1 }} accessibilityLabel="Save question" />
      </View>
    </>
  );
}

/**
 * Bottom sheet to edit one question: the only place a question is edited, in saved papers, topics and the
 * import review. Pass the fields to open it, null to close it. A saved question goes through toFields/applyFields.
 */
export function QuestionEditModal({ values, onSave, onClose }: {
  values: QuestionFieldValues | null;
  onSave: (v: QuestionFieldValues) => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={values !== null} title="Edit question" onClose={onClose}>
      {values && <EditForm initial={values} onSave={onSave} onClose={onClose} />}
    </Sheet>
  );
}
