import { FRAME_ASPECT, frameIn, photoCropFor, SCAN_LONG_SIDE, scaledToFit } from '../frame';

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

describe('scaledToFit', () => {
  test('shrinks the long side, keeping the shape', () => {
    expect(scaledToFit({ width: 3000, height: 1000 })).toEqual({ width: SCAN_LONG_SIDE, height: Math.round(SCAN_LONG_SIDE / 3) });
    expect(scaledToFit({ width: 1000, height: 4000 }, 1000)).toEqual({ width: 250, height: 1000 });
  });

  test('never enlarges a small photo', () => {
    expect(scaledToFit({ width: 600, height: 200 })).toEqual({ width: 600, height: 200 });
  });
});
