import { FRAME_ASPECT, frameIn, photoCropFor, rescaleRect, SCAN_LONG_SIDE, scanCropFor, scaledToFit } from '../frame';

describe('frameIn', () => {
  test('is centred and keeps its shape on a phone held upright', () => {
    const f = frameIn({ width: 400, height: 600 });
    expect(f.width / f.height).toBeCloseTo(FRAME_ASPECT);
    expect(f.x * 2 + f.width).toBeCloseTo(400);
    expect(f.y * 2 + f.height).toBeCloseTo(600);
  });

  test('fits a short, wide view', () => {
    const f = frameIn({ width: 1000, height: 200 });
    expect(f.height).toBeLessThanOrEqual(200);
    expect(f.y).toBeGreaterThanOrEqual(0);
  });
});

describe('photoCropFor', () => {
  test('a photo the same shape as the view maps straight across', () => {
    const view = { width: 300, height: 400 };
    const frame = { x: 30, y: 150, width: 240, height: 80 };
    // Photo 10x the view.
    expect(photoCropFor(view, frame, { width: 3000, height: 4000 }, 0)).toEqual({ x: 300, y: 1500, width: 2400, height: 800 });
  });

  test('a photo wider than the view has its sides trimmed in the view', () => {
    // A 4:3 landscape photo shown in a square view: scaled to the view's height, 50 px cut off each side.
    const view = { width: 300, height: 300 };
    const crop = photoCropFor(view, { x: 0, y: 100, width: 300, height: 100 }, { width: 400, height: 300 }, 0);
    expect(crop).toEqual({ x: 50, y: 100, width: 300, height: 100 });
  });

  test('a photo taller than the view has its top and bottom trimmed', () => {
    // Portrait 3:4 photo in a square view: 50 px cut off top and bottom.
    const crop = photoCropFor({ width: 300, height: 300 }, { x: 0, y: 100, width: 300, height: 100 }, { width: 300, height: 400 }, 0);
    expect(crop).toEqual({ x: 0, y: 150, width: 300, height: 100 });
  });

  test('adds the margin, but never goes past the photo', () => {
    const view = { width: 300, height: 400 };
    const crop = photoCropFor(view, { x: 0, y: 150, width: 300, height: 100 }, { width: 300, height: 400 }, 0.1);
    expect(crop).toEqual({ x: 0, y: 140, width: 300, height: 120 });
  });
});

describe('scanCropFor', () => {
  const inside = (inner: { x: number; y: number; width: number; height: number }, outer: { width: number; height: number }) =>
    inner.x >= 0 && inner.y >= 0 && inner.x + inner.width <= outer.width && inner.y + inner.height <= outer.height;

  test('a phone photo held upright gives a square around the frame, with the frame inside it', () => {
    const view = { width: 400, height: 700 };
    const photo = { width: 3000, height: 4000 };
    const frame = frameIn(view);
    const box = photoCropFor(view, frame, photo);
    const { crop, focus } = scanCropFor(view, frame, photo);
    expect(crop.width).toBe(crop.height);
    expect(crop.width).toBe(box.width);
    expect(inside(crop, photo)).toBe(true);
    expect(inside(focus, crop)).toBe(true);
    // The focus is the frame's own area, moved into the crop.
    expect({ ...focus, x: focus.x + crop.x, y: focus.y + crop.y }).toEqual(box);
    // Centred on the frame.
    expect(Math.abs(crop.y + crop.height / 2 - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
  });

  test('a frame near the top of the photo keeps the square inside the photo', () => {
    const view = { width: 300, height: 400 };
    const photo = { width: 3000, height: 4000 };
    const frame = { x: 15, y: 10, width: 270, height: 90 };
    const { crop, focus } = scanCropFor(view, frame, photo, 0);
    expect(crop.y).toBe(0);
    expect(crop.width).toBe(crop.height);
    expect(focus.y).toBe(100);
  });

  test('a photo too short for a square uses its full height', () => {
    // A computer webcam: wide and short.
    const view = { width: 640, height: 480 };
    const photo = { width: 640, height: 480 };
    const { crop } = scanCropFor(view, frameIn(view), photo);
    expect(crop.height).toBe(480);
    expect(crop.y).toBe(0);
    expect(inside(crop, photo)).toBe(true);
  });
});

describe('rescaleRect', () => {
  test('moves a rectangle into a resized image', () => {
    expect(rescaleRect({ x: 100, y: 200, width: 300, height: 100 }, { width: 2000, height: 2000 }, { width: 1000, height: 1000 })).toEqual({
      x: 50,
      y: 100,
      width: 150,
      height: 50,
    });
  });
});

describe('scaledToFit', () => {
  test('shrinks the long side, keeping the shape', () => {
    expect(scaledToFit({ width: 3000, height: 1000 })).toEqual({ width: SCAN_LONG_SIDE, height: Math.round(SCAN_LONG_SIDE / 3) });
    expect(scaledToFit({ width: 1000, height: 4000 }, 1000)).toEqual({ width: 250, height: 1000 });
  });

  test('never enlarges a small photo', () => {
    expect(scaledToFit({ width: 600, height: 200 })).toEqual({ width: 600, height: 200 });
  });
});
