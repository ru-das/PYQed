import React, { useState } from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';
import { Provider, PROVIDER_LABELS } from '../config';
import { Sheet } from './ui';

const PROVIDERS = Object.keys(PROVIDER_LABELS) as Provider[];

type Props = {
  value: Provider;
  onChange: (provider: Provider) => void;
};

/** Dropdown: a field showing the current provider; tap to pick another from a small list. */
export function ProviderSelect({ value, onChange }: Props) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);

  return (
    <>
      <TouchableOpacity
        style={[styles.field, { backgroundColor: colors.card, borderColor: colors.border }]}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`AI provider: ${PROVIDER_LABELS[value]}. Tap to change.`}
      >
        <Text style={[styles.fieldText, { color: colors.text }]}>{PROVIDER_LABELS[value]}</Text>
        <Ionicons name="chevron-down" size={20} color={colors.textSecondary} />
      </TouchableOpacity>

      <Sheet visible={open} title="AI provider" onClose={() => setOpen(false)}>
        {PROVIDERS.map((p) => (
          <TouchableOpacity
            key={p}
            style={styles.row}
            onPress={() => {
              setOpen(false);
              if (p !== value) onChange(p);
            }}
            accessibilityRole="menuitem"
            accessibilityLabel={PROVIDER_LABELS[p]}
          >
            <Text
              style={[
                styles.rowText,
                { color: p === value ? colors.accent : colors.text },
                p === value && { fontWeight: '700' },
              ]}
            >
              {PROVIDER_LABELS[p]}
            </Text>
            {p === value && <Ionicons name="checkmark" size={20} color={colors.accent} />}
          </TouchableOpacity>
        ))}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.button,
    borderWidth: 1,
    marginTop: Spacing.xs,
  },
  fieldText: {
    fontSize: FontSize.body,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: Spacing.md,
  },
  rowText: {
    fontSize: FontSize.body,
  },
});
