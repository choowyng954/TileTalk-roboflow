// TileScan: crop a photo to the guide frame and shrink it, ready to send for scanning.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Rect, SCAN_JPEG_QUALITY, scaledToFit, Size } from './frame';

export interface PreparedPhoto {
  /** For showing the photo in the app. */
  uri: string;
  /** JPEG data, base64 encoded, as it will be sent. */
  base64: string;
  width: number;
  height: number;
  /** Size of the JPEG in bytes. */
  bytes: number;
  /** The photo before cropping and shrinking. */
  original: Size;
  /** How long cropping and shrinking took, in milliseconds. */
  ms: number;
}

/** Crops the photo (when given a crop) and shrinks it to at most SCAN_LONG_SIDE on its long side. */
export async function preparePhoto(uri: string, original: Size, crop?: Rect): Promise<PreparedPhoto> {
  const started = Date.now();
  const context = ImageManipulator.manipulate(uri);
  if (crop) context.crop({ originX: crop.x, originY: crop.y, width: crop.width, height: crop.height });
  const cropped = crop ?? original;
  const target = scaledToFit(cropped);
  // A size of 0 means it wasn't known (some browsers), so the photo is left as it is.
  if (cropped.width > 0 && target.width < cropped.width) context.resize({ width: target.width, height: target.height });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: SCAN_JPEG_QUALITY, base64: true });
  const base64 = saved.base64 ?? '';
  // Every 4 base64 characters hold 3 bytes, less any "=" padding at the end.
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  return { uri: saved.uri, base64, width: saved.width, height: saved.height, bytes, original, ms: Date.now() - started };
}
