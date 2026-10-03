import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { IMAGE_LONG_EDGE, IMAGE_JPEG_QUALITY } from './config';

export type PickedPhotos = { base64s: string[]; names: string[] };

/**
 * Let the user pick photos, then shrink each to a ~1600 px JPEG (base64) for the AI.
 * Returns null if they cancel. `onStart` fires once photos are chosen, `onEach` after each is prepared.
 */
export async function pickPhotos(
  onStart?: (count: number) => void,
  onEach?: (done: number, total: number) => void,
): Promise<PickedPhotos | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return null;

  const total = result.assets.length;
  onStart?.(total);

  const base64s: string[] = [];
  const names: string[] = [];
  for (let i = 0; i < total; i++) {
    const { width, height, uri, fileName } = result.assets[i];
    names.push(fileName || `Photo_${i + 1}`);
    onEach?.(i + 1, total);

    const resize =
      Math.max(width, height) > IMAGE_LONG_EDGE
        ? [{ resize: width > height ? { width: IMAGE_LONG_EDGE } : { height: IMAGE_LONG_EDGE } }]
        : [];
    const out = await ImageManipulator.manipulateAsync(uri, resize, {
      compress: IMAGE_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (out.base64) base64s.push(out.base64);
  }
  return { base64s, names };
}
