// TileScan: send a prepared photo to the scanTiles Cloud Function (functions/src/index.ts), which
// asks the tile recognition model, and turn its answer into tiles.

import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import '../firebase';
import { Detection, ReadOptions, readDetections, TileScan } from './readDetections';

interface ScanTilesResult {
  detections: Detection[];
  image: { width: number; height: number } | null;
  ms: { roboflow: number; total: number };
}

export interface PhotoReading {
  scan: TileScan;
  /** What the model said, before sorting and checking. */
  detections: Detection[];
  ms: {
    /** From pressing the button to having the answer. */
    total: number;
    /** Time spent in the Cloud Function. */
    server: number;
    /** Of which, waiting for Roboflow. */
    roboflow: number;
  };
}

const MESSAGES: Record<string, string> = {
  'functions/unauthenticated': 'Sign in to use TileScan.',
  // A function that isn't deployed answers like this on the web.
  'functions/not-found': 'TileScan’s server isn’t set up: the scanTiles function isn’t deployed to this Firebase project.',
  'functions/internal': 'TileScan’s server couldn’t be reached. Check your connection, and that the scanTiles function is deployed.',
};

/**
 * Reads the tiles in a photo (base64 JPEG), counting only those in `focus` when given.
 * Throws an Error with a message to show the player.
 */
export async function readTilesInPhoto(base64: string, focus?: ReadOptions['focus']): Promise<PhotoReading> {
  const started = Date.now();
  const scanTiles = httpsCallable<{ image: string }, ScanTilesResult>(getFunctions(getApp()), 'scanTiles');
  try {
    const { data } = await scanTiles({ image: base64 });
    return {
      scan: readDetections(data.detections, { focus }),
      detections: data.detections,
      ms: { total: Date.now() - started, server: data.ms.total, roboflow: data.ms.roboflow },
    };
  } catch (e) {
    const { code, message } = e as { code?: string; message?: string };
    throw new Error((code && MESSAGES[code]) ?? message ?? 'TileScan didn’t work. Try again.');
  }
}
