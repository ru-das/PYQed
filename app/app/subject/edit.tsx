import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../../src/theme';
import { deleteSubject, emptySubject, getSubject, newId, saveSubject, Subject, Unit } from '../../src/store/subjects';
import { move } from '../../src/logic/list';

// Small 44px icon button used for up / down / delete.
function IconBtn({ name, label, onPress, color, disabled }: {
  name: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; color: string; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}
    >
      <Ionicons name={name} size={20} color={color} />
    </TouchableOpacity>
  );
}

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

  const patchUnit = (i: number, f: (u: Unit) => Unit) => setUnits((us) => us.map((u, k) => (k === i ? f(u) : u)));

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
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: id ? 'Edit subject' : 'New subject' }} />

      <Text style={[styles.label, { color: colors.textSecondary }]}>Name</Text>
      <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="e.g. Data Structures" placeholderTextColor={colors.textSecondary} />
      <Text style={[styles.label, { color: colors.textSecondary }]}>Code (optional)</Text>
      <TextInput style={inputStyle} value={code} onChangeText={setCode} placeholder="e.g. CS201" placeholderTextColor={colors.textSecondary} autoCapitalize="characters" />

      <Text style={[styles.h2, { color: colors.text }]}>Units & topics</Text>

      {units.map((u, i) => (
        <View key={u.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <TextInput style={[inputStyle, { flex: 1 }]} value={u.name} onChangeText={(t) => patchUnit(i, (x) => ({ ...x, name: t }))} placeholder="Unit name" placeholderTextColor={colors.textSecondary} />
            <IconBtn name="arrow-up" label="Move unit up" color={colors.text} disabled={i === 0} onPress={() => setUnits((us) => move(us, i, -1))} />
            <IconBtn name="arrow-down" label="Move unit down" color={colors.text} disabled={i === units.length - 1} onPress={() => setUnits((us) => move(us, i, 1))} />
            <IconBtn name="trash-outline" label="Delete unit" color={colors.red}
              onPress={() => confirmDelete('unit', usedCount((q) => q.unitId === u.id), () => setUnits((us) => us.filter((_, k) => k !== i)))} />
          </View>

          {u.topics.map((t, j) => (
            <View key={t.id} style={[styles.row, { marginLeft: Spacing.md }]}>
              <TextInput style={[inputStyle, { flex: 1 }]} value={t.name}
                onChangeText={(v) => patchUnit(i, (x) => ({ ...x, topics: x.topics.map((tt, k) => (k === j ? { ...tt, name: v } : tt)) }))}
                placeholder="Topic name" placeholderTextColor={colors.textSecondary} />
              <IconBtn name="arrow-up" label="Move topic up" color={colors.text} disabled={j === 0} onPress={() => patchUnit(i, (x) => ({ ...x, topics: move(x.topics, j, -1) }))} />
              <IconBtn name="arrow-down" label="Move topic down" color={colors.text} disabled={j === u.topics.length - 1} onPress={() => patchUnit(i, (x) => ({ ...x, topics: move(x.topics, j, 1) }))} />
              <IconBtn name="trash-outline" label="Delete topic" color={colors.red}
                onPress={() => confirmDelete('topic', usedCount((q) => q.topicId === t.id), () => patchUnit(i, (x) => ({ ...x, topics: x.topics.filter((_, k) => k !== j) })))} />
            </View>
          ))}

          <TouchableOpacity style={styles.addLink} accessibilityLabel="Add topic"
            onPress={() => patchUnit(i, (x) => ({ ...x, topics: [...x.topics, { id: newId(), name: '' }] }))}>
            <Ionicons name="add" size={18} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600' }}>Add topic</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity style={[styles.btn, { borderColor: colors.accent, borderWidth: 1 }]} accessibilityLabel="Add unit"
        onPress={() => setUnits((us) => [...us, { id: newId(), name: '', order: us.length, topics: [] }])}>
        <Ionicons name="add" size={20} color={colors.accent} />
        <Text style={{ color: colors.accent, fontWeight: '700' }}>Add unit</Text>
      </TouchableOpacity>

      <TouchableOpacity style={[styles.btn, { backgroundColor: colors.accent, marginTop: Spacing.lg }]} onPress={save} accessibilityLabel="Save subject">
        <Text style={{ color: colors.accentText, fontWeight: '700', fontSize: FontSize.body }}>Save</Text>
      </TouchableOpacity>

      {!!id && (
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.redBg }]} onPress={removeSubject} accessibilityLabel="Delete subject">
          <Text style={{ color: colors.red, fontWeight: '700' }}>Delete subject</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: Spacing.md, paddingBottom: Spacing.xl * 2, gap: Spacing.sm },
  label: { fontSize: FontSize.caption, fontWeight: '600', marginTop: Spacing.xs },
  h2: { fontSize: FontSize.h2, fontWeight: '700', marginTop: Spacing.md },
  input: { minHeight: 44, borderWidth: 1, borderRadius: BorderRadius.input, paddingHorizontal: Spacing.sm, fontSize: FontSize.body },
  card: { borderWidth: 1, borderRadius: BorderRadius.card, padding: Spacing.sm, gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center' },
  addLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, marginLeft: Spacing.md },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 48, borderRadius: BorderRadius.button, marginTop: Spacing.sm },
});
