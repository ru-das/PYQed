import React, { useState } from 'react';
import { Image, Modal, ScrollView, TouchableOpacity, View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { toast } from './Toast';
import { useThemeColors, Spacing } from '../theme';

const ZOOM = 2.5;

/** Page preview; tap to open a full-screen view you can pan around at 2.5x. */
export function ZoomableImage({ uri, height = 280 }: { uri: string; height?: number }) {
  const colors = useThemeColors();
  const { width, height: screenH } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [ratio, setRatio] = useState(1.4); // height / width, until the real size is known

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          Image.getSize(uri, (w, h) => w > 0 && setRatio(h / w), () => {});
          setOpen(true);
        }}
        accessibilityLabel="Zoom page image"
      >
        <Image source={{ uri }} style={{ width: '100%', height }} resizeMode="contain" />
        <View style={[styles.hint, { backgroundColor: colors.chip }]}>
          <Ionicons name="expand-outline" size={14} color={colors.textSecondary} />
          <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600' }}>Tap to zoom</Text>
        </View>
      </TouchableOpacity>

      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <ScrollView>
            <ScrollView horizontal>
              <Image
                source={{ uri }}
                style={{ width: width * ZOOM, height: Math.max(width * ZOOM * ratio, screenH) }}
                resizeMode="contain"
              />
            </ScrollView>
          </ScrollView>
          <TouchableOpacity style={styles.close} onPress={() => setOpen(false)} onLongPress={() => toast('Close', 'info')} accessibilityLabel="Close zoom">
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  hint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 4 },
  close: {
    position: 'absolute', top: Spacing.lg, right: Spacing.md, width: 44, height: 44,
    borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
});
