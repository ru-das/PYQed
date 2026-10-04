/**
 * Small shared UI pieces, so the same idea looks the same on every screen:
 * Button, Chip, Segmented (tabs / sort), EmptyState, Sheet (slide-up panel) and Footer (sticky save bar).
 * Use these instead of per-screen styles.
 */
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet,
  Text, TouchableOpacity, View, ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';

type IconName = keyof typeof Ionicons.glyphMap;

// ─── Button ───

export function Button({ label, onPress, variant = 'primary', icon, disabled, loading, compact, style, accessibilityLabel }: {
  label: string;
  onPress: () => void;
  /** primary = accent fill, outline = bordered, danger = red text on a red tint */
  variant?: 'primary' | 'outline' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** 44 px high instead of 48, for buttons that sit in a row with other controls */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  const fg = variant === 'primary' ? colors.accentText : variant === 'danger' ? colors.red : colors.text;
  const bg = variant === 'primary' ? colors.accent : variant === 'danger' ? colors.redBg : colors.card;
  const off = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={off}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.btn,
        { backgroundColor: bg, minHeight: compact ? 44 : 48, opacity: disabled ? 0.4 : 1 },
        variant === 'outline' && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={{ color: fg, fontWeight: '700', fontSize: FontSize.body - 1 }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ─── Chip ───

/** One selectable chip: bordered, accent fill when active. */
export function Chip({ label, active, onPress, icon, accessibilityRole, accessibilityLabel }: {
  label: string;
  active: boolean;
  onPress: () => void;
  icon?: IconName;
  accessibilityRole?: 'radio' | 'button';
  accessibilityLabel?: string;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 4, bottom: 4 }}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityRole === 'radio' ? { selected: active } : undefined}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.chip,
        { backgroundColor: active ? colors.accent : colors.card, borderColor: active ? colors.accent : colors.border },
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={active ? colors.accentText : colors.textSecondary} /> : null}
      <Text style={{ color: active ? colors.accentText : colors.text, fontSize: FontSize.caption, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Segmented ───

/** A row of equal-width options on a tinted track (tabs, sort order). */
export function Segmented<K extends string>({ options, value, onChange, style }: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  return (
    <View style={[styles.seg, { backgroundColor: colors.chip }, style]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
            style={[styles.segItem, on && { backgroundColor: colors.card }]}
          >
            <Text style={{ color: on ? colors.text : colors.textSecondary, fontWeight: on ? '700' : '500', fontSize: FontSize.caption }}>
              {o.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── EmptyState ───

export function EmptyState({ icon, title, body, action }: {
  icon: IconName;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.textSecondary} />
      <Text style={{ color: colors.text, fontSize: FontSize.h3, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption, textAlign: 'center', maxWidth: 280 }}>{body}</Text>
      {action}
    </View>
  );
}

// ─── Sheet ───

/** Slide-up panel with a dimmed backdrop (tap to close), a title row and a close button. */
export function Sheet({ visible, title, subtitle, onClose, children }: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: FontSize.h3, fontWeight: '700' }}>{title}</Text>
              {subtitle ? (
                <Text style={{ color: colors.textSecondary, fontSize: FontSize.caption }} numberOfLines={2}>{subtitle}</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Scrolling body for a Sheet, so long content never pushes the buttons off screen. */
export function SheetScroll({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ marginVertical: Spacing.sm }}>
      {children}
    </ScrollView>
  );
}

// ─── Footer ───

/** Sticky bar under a screen's content, for its Save button. */
export function Footer({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  return (
    <View style={[styles.footer, { backgroundColor: colors.background, borderTopColor: colors.border }]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.button,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.chip,
    borderWidth: 1,
  },
  seg: { flexDirection: 'row', borderRadius: BorderRadius.button, padding: 3 },
  segItem: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.button - 3,
  },
  empty: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl * 1.5 },
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: BorderRadius.card + 4,
    borderTopRightRadius: BorderRadius.card + 4,
    borderTopWidth: 1,
    padding: Spacing.md,
    maxHeight: '90%',
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  footer: { padding: Spacing.md, borderTopWidth: 1 },
});
