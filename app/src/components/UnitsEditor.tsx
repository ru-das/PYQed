import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { toast } from './Toast';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import { newId } from '../logic/subject';
import { move } from '../logic/list';

type EditorUnit = { id: string; name: string; topics: { id: string; name: string }[] };

// 44px icon button for move up / down / delete.
function IconBtn({ name, label, onPress, color, disabled }: {
  name: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; color: string; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      onLongPress={() => toast(label, 'info')}
      style={[styles.iconBtn, disabled && { opacity: 0.3 }]}
    >
      <Ionicons name={name} size={20} color={color} />
    </TouchableOpacity>
  );
}

type Props<T extends EditorUnit> = {
  units: T[];
  onChange: (units: T[]) => void;
  /** Called before a unit/topic is removed; lets the caller confirm (e.g. when questions use it). */
  confirmRemove?: (kind: 'unit' | 'topic', id: string, remove: () => void) => void;
};

/** Edit a list of units and their topics: rename, reorder, delete, add. Shared by Edit subject and Syllabus review. */
export function UnitsEditor<T extends EditorUnit>({ units, onChange, confirmRemove }: Props<T>) {
  const colors = useThemeColors();
  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];
  const ask = confirmRemove ?? ((_k, _id, remove) => remove());

  const patchUnit = (i: number, f: (u: T) => T) => onChange(units.map((u, k) => (k === i ? f(u) : u)));

  return (
    <View style={{ gap: Spacing.sm }}>
      {units.map((u, i) => (
        <View key={u.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.row}>
            <TextInput
              style={[input, { flex: 1, fontWeight: '600' }]}
              value={u.name}
              onChangeText={(t) => patchUnit(i, (x) => ({ ...x, name: t }))}
              placeholder="Unit name"
              placeholderTextColor={colors.textSecondary}
            />
            <IconBtn name="arrow-up" label="Move unit up" color={colors.text} disabled={i === 0} onPress={() => onChange(move(units, i, -1))} />
            <IconBtn name="arrow-down" label="Move unit down" color={colors.text} disabled={i === units.length - 1} onPress={() => onChange(move(units, i, 1))} />
            <IconBtn name="trash-outline" label="Delete unit" color={colors.red}
              onPress={() => ask('unit', u.id, () => onChange(units.filter((_, k) => k !== i)))} />
          </View>

          {u.topics.map((t, j) => (
            <View key={t.id} style={[styles.row, { marginLeft: Spacing.md }]}>
              <TextInput
                style={[input, { flex: 1 }]}
                value={t.name}
                onChangeText={(v) => patchUnit(i, (x) => ({ ...x, topics: x.topics.map((tt, k) => (k === j ? { ...tt, name: v } : tt)) }))}
                placeholder="Topic name"
                placeholderTextColor={colors.textSecondary}
              />
              <IconBtn name="arrow-up" label="Move topic up" color={colors.text} disabled={j === 0}
                onPress={() => patchUnit(i, (x) => ({ ...x, topics: move(x.topics, j, -1) }))} />
              <IconBtn name="arrow-down" label="Move topic down" color={colors.text} disabled={j === u.topics.length - 1}
                onPress={() => patchUnit(i, (x) => ({ ...x, topics: move(x.topics, j, 1) }))} />
              <IconBtn name="trash-outline" label="Delete topic" color={colors.red}
                onPress={() => ask('topic', t.id, () => patchUnit(i, (x) => ({ ...x, topics: x.topics.filter((_, k) => k !== j) })))} />
            </View>
          ))}

          <TouchableOpacity
            style={styles.addLink}
            accessibilityLabel="Add topic"
            onPress={() => patchUnit(i, (x) => ({ ...x, topics: [...x.topics, { id: newId(), name: '' }] }))}
          >
            <Ionicons name="add" size={18} color={colors.accent} />
            <Text style={{ color: colors.accent, fontWeight: '600' }}>Add topic</Text>
          </TouchableOpacity>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.addUnit, { borderColor: colors.accent }]}
        accessibilityLabel="Add unit"
        // order is re-assigned from list position on save
        onPress={() => onChange([...units, { id: newId(), name: '', order: units.length, topics: [] } as unknown as T])}
      >
        <Ionicons name="add" size={20} color={colors.accent} />
        <Text style={{ color: colors.accent, fontWeight: '700' }}>Add unit</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: BorderRadius.card, padding: Spacing.sm, gap: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center' },
  input: { minHeight: 44, borderWidth: 1, borderRadius: BorderRadius.input, paddingHorizontal: Spacing.sm, fontSize: FontSize.body },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  addLink: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, marginLeft: Spacing.md },
  addUnit: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    minHeight: 48, borderRadius: BorderRadius.button, borderWidth: 1,
  },
});
