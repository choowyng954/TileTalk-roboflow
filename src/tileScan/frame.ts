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

/**
 * The guide frame's width over its height. The model fits each photo into a square, so a very
 * narrow strip leaves the tiles small; 3:1 holds a row of 14-18 tiles, or two rows.
 */
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

/** The size to shrink an image to so its long side is at most `longSide`. Never enlarges. */
export function scaledToFit(size: Size, longSide = SCAN_LONG_SIDE): Size {
  const factor = Math.min(1, longSide / Math.max(size.width, size.height));
  return { width: Math.round(size.width * factor), height: Math.round(size.height * factor) };
}
