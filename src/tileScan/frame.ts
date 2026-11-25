// TileScan: the guide frame drawn over the camera, and which part of the photo it covers.
// Settings here are starting points, to tune once real scans can be timed and checked.

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

/** The guide frame's width over its height: 3:1 holds a row of 14-18 tiles, or two rows. */
export const FRAME_ASPECT = 3;
/** How much of the camera view's width the frame spans. */
const FRAME_WIDTH_SHARE = 0.92;
/** Extra photo kept around the frame on each side, as a share of the frame, for tiles on its edge. */
export const FRAME_MARGIN = 0.06;
/** The photo sent for scanning is at most this many pixels on its long side. */
export const SCAN_LONG_SIDE = 1024;
/** JPEG quality, 0 to 1. */
export const SCAN_JPEG_QUALITY = 0.8;

/** The guide frame in a camera view of this size: centred, as wide as fits. */
export function frameIn(view: Size): Rect {
  const width = Math.min(view.width * FRAME_WIDTH_SHARE, view.height * FRAME_ASPECT * 0.9);
  const height = width / FRAME_ASPECT;
  return { x: (view.width - width) / 2, y: (view.height - height) / 2, width, height };
}

/**
 * The part of the photo, in its own pixels, that shows inside the frame plus the margin.
 * The camera view shows the photo scaled to fill the view and centred, with the overflow trimmed
 * (like CSS object-fit: cover), so the frame maps back to the photo through that scale.
 */
export function photoCropFor(view: Size, frame: Rect, photo: Size, margin = FRAME_MARGIN): Rect {
  const scale = Math.max(view.width / photo.width, view.height / photo.height);
  const offsetX = (photo.width * scale - view.width) / 2;
  const offsetY = (photo.height * scale - view.height) / 2;
  const padX = frame.width * margin;
  const padY = frame.height * margin;
  const left = Math.max(0, Math.floor((frame.x - padX + offsetX) / scale));
  const top = Math.max(0, Math.floor((frame.y - padY + offsetY) / scale));
  const right = Math.min(photo.width, Math.ceil((frame.x + frame.width + padX + offsetX) / scale));
  const bottom = Math.min(photo.height, Math.ceil((frame.y + frame.height + padY + offsetY) / scale));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * What to send for scanning: a square of the photo centred on the frame, and where the frame
 * (with its margin) sits inside that square. The model stretches every photo into a square, so a
 * strip of just the frame came out with its tiles stretched three times as tall, and tiles were
 * missed; a square isn't stretched. Tiles found outside the frame are then ignored (see `focus`
 * in readDetections), so other tiles on the table in the extra space don't count.
 * Where the photo is too short for a square, the crop is as tall as the photo.
 */
export function scanCropFor(view: Size, frame: Rect, photo: Size, margin = FRAME_MARGIN): { crop: Rect; focus: Rect } {
  const box = photoCropFor(view, frame, photo, margin);
  const side = Math.min(Math.max(box.width, box.height), photo.width, photo.height);
  const width = Math.max(box.width, side);
  const height = Math.max(box.height, side);
  const clamp = (start: number, length: number, limit: number) => Math.min(Math.max(0, Math.round(start)), Math.max(0, limit - length));
  const x = clamp(box.x + box.width / 2 - width / 2, width, photo.width);
  const y = clamp(box.y + box.height / 2 - height / 2, height, photo.height);
  return {
    crop: { x, y, width, height },
    focus: { x: box.x - x, y: box.y - y, width: box.width, height: box.height },
  };
}

/** A rectangle in an image of size `from`, moved to the same place in that image resized to `to`. */
export function rescaleRect(rect: Rect, from: Size, to: Size): Rect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

/** The size to shrink an image to so its long side is at most `longSide`. Never enlarges. */
export function scaledToFit(size: Size, longSide = SCAN_LONG_SIDE): Size {
  const factor = Math.min(1, longSide / Math.max(size.width, size.height));
  return { width: Math.round(size.width * factor), height: Math.round(size.height * factor) };
}
