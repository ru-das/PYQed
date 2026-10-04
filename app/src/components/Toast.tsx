import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';

type Kind = 'success' | 'info';
type Msg = { id: number; text: string; kind: Kind };

let nextId = 1;
let show: ((m: Msg) => void) | null = null;

/** Short message at the bottom of the screen. Callable from anywhere; a new one replaces the old. */
export function toast(text: string, kind: Kind = 'success') {
  show?.({ id: nextId++, text, kind });
}

const SHOW_MS = 2800;

/** Mount once in the root layout. */
export function Toaster() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<Msg | null>(null);
  const slide = useRef(new Animated.Value(0)).current; // 0 hidden, 1 shown
  const pop = useRef(new Animated.Value(0.6)).current; // icon scale
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const hide = () => {
    clearTimeout(timer.current);
    Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setMsg(null);
    });
  };

  useEffect(() => {
    show = (m) => {
      clearTimeout(timer.current);
      setMsg(m);
      slide.setValue(0);
      pop.setValue(0.6);
      Animated.parallel([
        Animated.timing(slide, { toValue: 1, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
      timer.current = setTimeout(hide, SHOW_MS);
    };
    return () => {
      show = null;
      clearTimeout(timer.current);
    };
  }, []);

  if (!msg) return null;
  const tone = msg.kind === 'info' ? colors.accent : colors.success;
  const icon = msg.kind === 'info' ? 'information-circle' : 'checkmark-circle';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        {
          bottom: insets.bottom + 72,
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={hide}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={msg.text}
        style={[styles.toast, { backgroundColor: colors.card, borderColor: tone }]}
      >
        <Animated.View style={{ transform: [{ scale: pop }] }}>
          <Ionicons name={icon} size={22} color={tone} />
        </Animated.View>
        <Text style={[styles.text, { color: colors.text }]}>{msg.text}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.md, right: Spacing.md, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.card,
    borderWidth: 1,
    maxWidth: 520,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  text: { flexShrink: 1, fontSize: FontSize.body - 1, fontWeight: '500' },
});
