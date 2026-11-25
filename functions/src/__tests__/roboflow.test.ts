import { cleanImage, MAX_IMAGE_CHARS, MIN_CONFIDENCE, nextUsage, parseRoboflowResponse, roboflowUrl, SCANS_PER_WINDOW, WINDOW_MS } from '../roboflow';

describe('parseRoboflowResponse', () => {
  test('keeps each prediction’s class, confidence and box, and the image size', () => {
    const body = {
      inference_id: 'abc',
      time: 0.1,
      image: { width: 1024, height: 342 },
      predictions: [
        { x: 100.5, y: 170, width: 60, height: 80, confidence: 0.93, class: '9D', class_id: 26, detection_id: 'd1' },
        { x: 170, y: 171, width: 61, height: 79, confidence: 0.41, class: 'EW', class_id: 36, detection_id: 'd2' },
      ],
    };
    expect(parseRoboflowResponse(body)).toEqual({
      detections: [
        { label: '9D', confidence: 0.93, x: 100.5, y: 170, width: 60, height: 80 },
        { label: 'EW', confidence: 0.41, x: 170, y: 171, width: 61, height: 79 },
      ],
      image: { width: 1024, height: 342 },
    });
  });

  test('leaves out tiles below the confidence cut-off', () => {
    const tile = { x: 1, y: 2, width: 3, height: 4, class: '1B' };
    const body = { predictions: [{ ...tile, confidence: MIN_CONFIDENCE }, { ...tile, confidence: MIN_CONFIDENCE - 0.01 }] };
    expect(parseRoboflowResponse(body).detections.map((d) => d.confidence)).toEqual([MIN_CONFIDENCE]);
  });

  test('leaves out malformed predictions and copes with an empty or odd answer', () => {
    const body = { predictions: [{ x: 1, y: 2, width: 3, height: 4, confidence: 0.5 }, { class: '1B', x: 'a' }, null] };
    expect(parseRoboflowResponse(body)).toEqual({ detections: [], image: null });
    expect(parseRoboflowResponse(null)).toEqual({ detections: [], image: null });
    expect(parseRoboflowResponse({ predictions: 'nope' })).toEqual({ detections: [], image: null });
  });
});

describe('cleanImage', () => {
  test('accepts base64, with or without a data: prefix', () => {
    expect(cleanImage('/9j/4AAQSkZJRg==')).toBe('/9j/4AAQSkZJRg==');
    expect(cleanImage('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ');
  });

  test('refuses anything else', () => {
    for (const bad of [undefined, 42, '', 'not base64!', 'https://example.com/photo.jpg', 'A'.repeat(MAX_IMAGE_CHARS + 4)]) {
      expect(cleanImage(bad)).toBeNull();
    }
  });
});

describe('nextUsage', () => {
  const now = 1_000_000_000;

  test('a first scan starts a window', () => {
    expect(nextUsage(undefined, now)).toEqual({ allowed: true, usage: { windowStart: now, count: 1 }, retryInMs: 0 });
  });

  test('counts scans within the window, then refuses', () => {
    expect(nextUsage({ windowStart: now, count: 3 }, now + 1000).usage.count).toBe(4);
    const full = nextUsage({ windowStart: now, count: SCANS_PER_WINDOW }, now + 10 * 60_000);
    expect(full.allowed).toBe(false);
    expect(full.retryInMs).toBe(WINDOW_MS - 10 * 60_000);
  });

  test('a new window starts once the last one is over', () => {
    expect(nextUsage({ windowStart: now, count: SCANS_PER_WINDOW }, now + WINDOW_MS)).toEqual({
      allowed: true,
      usage: { windowStart: now + WINDOW_MS, count: 1 },
      retryInMs: 0,
    });
  });
});

describe('roboflowUrl', () => {
  test('asks for the model with the key and the confidence cut-off', () => {
    expect(roboflowUrl('a b&c')).toBe(`https://serverless.roboflow.com/mahjong-baq4s/83?api_key=a%20b%26c&confidence=${MIN_CONFIDENCE}`);
  });
});
