// TileScan's server side: talking to the Roboflow tile recognition model, and the limits that
// keep scans from costing money if someone misuses them. Kept apart from index.ts so it can be
// tested without Firebase.

/** The model, as "project/version" on Roboflow Universe. */
export const ROBOFLOW_MODEL = 'mahjong-baq4s/83';
export const ROBOFLOW_URL = 'https://serverless.roboflow.com';
/** How long to wait for Roboflow before giving up. */
export const ROBOFLOW_TIMEOUT_MS = 20_000;

/** A photo is about 60-100 KB; this allows about 1.5 MB, as base64. */
export const MAX_IMAGE_CHARS = 2_000_000;
/** Scans each player can make per window. */
export const SCANS_PER_WINDOW = 30;
export const WINDOW_MS = 60 * 60 * 1000;

/** One tile the model found: its class name, confidence (0 to 1) and box centre and size in pixels. */
export interface Detection {
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Roboflow's answer, keeping only what TileScan uses. Anything malformed is left out rather than
 * passed on.
 */
export function parseRoboflowResponse(body: unknown): { detections: Detection[]; image: ImageSize | null } {
  const data = (body ?? {}) as { predictions?: unknown; image?: { width?: unknown; height?: unknown } };
  const predictions = Array.isArray(data.predictions) ? data.predictions : [];
  const detections: Detection[] = [];
  for (const p of predictions as Record<string, unknown>[]) {
    if (!p || typeof p.class !== 'string') continue;
    const { x, y, width, height, confidence } = p;
    if (![x, y, width, height, confidence].every(isNumber)) continue;
    detections.push({ label: p.class, confidence: confidence as number, x: x as number, y: y as number, width: width as number, height: height as number });
  }
  const w = Number(data.image?.width);
  const h = Number(data.image?.height);
  return { detections, image: w > 0 && h > 0 ? { width: w, height: h } : null };
}

/**
 * The photo as plain base64, or null if it isn't one we'll send: not text, too big, or not
 * base64. A "data:image/jpeg;base64," prefix is taken off.
 */
export function cleanImage(image: unknown): string | null {
  if (typeof image !== 'string') return null;
  const plain = image.replace(/^data:image\/[a-z]+;base64,/, '');
  if (plain.length === 0 || plain.length > MAX_IMAGE_CHARS) return null;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(plain) ? plain : null;
}

export interface Usage {
  /** Milliseconds. */
  windowStart: number;
  count: number;
}

/** Whether one more scan is allowed, and the usage to save if it is. */
export function nextUsage(previous: Usage | undefined, now: number): { allowed: boolean; usage: Usage; retryInMs: number } {
  if (!previous || now - previous.windowStart >= WINDOW_MS) {
    return { allowed: true, usage: { windowStart: now, count: 1 }, retryInMs: 0 };
  }
  if (previous.count >= SCANS_PER_WINDOW) {
    return { allowed: false, usage: previous, retryInMs: previous.windowStart + WINDOW_MS - now };
  }
  return { allowed: true, usage: { ...previous, count: previous.count + 1 }, retryInMs: 0 };
}
