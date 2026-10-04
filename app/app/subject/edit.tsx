import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, StyleSheet, Alert } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from '../../src/haptics';
import { toast } from '../../src/components/Toast';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import { deleteSubject, emptySubject, getSubject, saveSubject, Subject, Unit } from '../../src/store/subjects';
import { UnitsEditor } from '../../src/components/UnitsEditor';
import { Button, Footer } from '../../src/components/ui';

export default function EditSubject() {
  const colors = useThemeColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [subject, setSubject] = useState<Subject>(() => emptySubject());
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [units, setUnits] = useState<Unit[]>([]);

  useEffect(() => {
    if (!id) return;
    getSubject(id).then((s) => {
      if (!s) return;
      setSubject(s);
      setName(s.name);
      setCode(s.code ?? '');
      setUnits(s.units);
    });
  }, [id]);

  const inputStyle = [styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }];

  // Questions that point at a unit/topic about to be removed fall back to Unassigned.
  const usedCount = (pred: (q: Subject['questions'][number]) => boolean) => subject.questions.filter(pred).length;

  function confirmDelete(what: string, used: number, doIt: () => void) {
    if (used === 0) return doIt();
    Alert.alert(`Delete ${what}?`, `${used} question(s) will become Unassigned.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: doIt },
    ]);
  }

  async function save() {
    if (!name.trim()) return Alert.alert('Name required', 'Give the subject a name.');
    const cleaned: Unit[] = units
      .map((u) => ({ ...u, name: u.name.trim(), topics: u.topics.map((t) => ({ ...t, name: t.name.trim() })).filter((t) => t.name) }))
      .filter((u) => u.name)
      .map((u, order) => ({ ...u, order }));
    const unitIds = new Set(cleaned.map((u) => u.id));
    const topicIds = new Set(cleaned.flatMap((u) => u.topics.map((t) => t.id)));
    const questions = subject.questions.map((q) =>
      q.topicId && topicIds.has(q.topicId)
        ? q
        : { ...q, topicId: null, unitId: q.unitId && unitIds.has(q.unitId) && !q.topicId ? q.unitId : null }
    );
    await saveSubject({ ...subject, name: name.trim(), code: code.trim() || undefined, units: cleaned, questions });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast(id ? 'Changes saved' : 'Subject created');
    if (id) router.back();
    else router.replace({ pathname: '/subject/[id]', params: { id: subject.id } });
  }

  function removeSubject() {
    Alert.alert('Delete subject?', 'Its papers and questions will be removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => { await deleteSubject(subject.id); router.dismissAll(); },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
        <Stack.Screen options={{ title: id ? 'Edit subject' : 'New subject' }} />

        <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
        <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Data Structures" placeholderTextColor={colors.textSecondary} />
        <Text style={[styles.label, { color: colors.textSecondary }]}>Code (optional)</Text>
        <TextInput style={inputStyle} value={code} onChangeText={setCode} placeholder="e.g. CS201" placeholderTextColor={colors.textSecondary} autoCapitalize="characters" />

        <Text style={[styles.h2, { color: colors.text }]}>Units & topics</Text>

        <UnitsEditor
          units={units}
          onChange={setUnits}
          confirmRemove={(kind, rid, remove) =>
            confirmDelete(kind, usedCount((q) => (kind === 'unit' ? q.unitId : q.topicId) === rid), remove)
          }
        />

        {!!id && <Button label="Delete subject" variant="danger" onPress={removeSubject} style={{ marginTop: Spacing.lg }} />}
      </ScrollView>
      <Footer>
        <Button label="Save" onPress={save} accessibilityLabel="Save subject" />
      </Footer>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing.md, paddingBottom: Spacing.xl * 2, gap: Spacing.sm },
  label: { fontSize: FontSize.caption, fontWeight: '600', marginTop: Spacing.xs },
  h2: { fontSize: FontSize.h2, fontWeight: '700', marginTop: Spacing.md },
  input: { minHeight: 44, borderWidth: 1, borderRadius: BorderRadius.input, paddingHorizontal: Spacing.sm, fontSize: FontSize.body },
});
