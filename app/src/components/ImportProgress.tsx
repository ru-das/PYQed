import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useThemeColors, Spacing, FontSize, BorderRadius } from '../theme';

type Props = {
  message: string;
  elapsedSec: number;
  current?: number;
  total?: number;
};

/** Shared "AI is working" screen: big running timer, live message, optional page bar. */
export function ImportProgress({ message, elapsedSec, current = 0, total = 0 }: Props) {
  const colors = useThemeColors();
  const pulse = useRef(new Animated.Value(1)).current;

  // Gentle pulse on the dot so the user can see the call is still alive
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const m = Math.floor(elapsedSec / 60);
  const s = String(elapsedSec % 60).padStart(2, '0');
  const showBar = total > 1;

  return (
    <View style={styles.wrap}>
      <View style={[styles.timerPanel, { backgroundColor: colors.chip }]}>
        <Animated.View style={[styles.dot, { backgroundColor: colors.accent, opacity: pulse }]} />
        <Text style={[styles.timer, { color: colors.text }]} accessibilityLabel={`${elapsedSec} seconds elapsed`}>
          {m}:{s}
        </Text>
      </View>
      <Text style={[styles.message, { color: colors.text }]}>{message}</Text>
      {showBar && (
        <View style={styles.barRow}>
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: colors.accent, width: `${Math.min(100, (current / total) * 100)}%` },
              ]}
            />
          </View>
          <Text style={[styles.count, { color: colors.textSecondary }]}>
            {current} / {total}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.md, width: '100%', paddingHorizontal: Spacing.lg },
  timerPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.card,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  timer: { fontSize: 48, fontWeight: '700', fontVariant: ['tabular-nums'] },
  message: { fontSize: FontSize.h3, fontWeight: '700', textAlign: 'center' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, width: '100%' },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  count: { fontSize: FontSize.caption, fontVariant: ['tabular-nums'] },
});
