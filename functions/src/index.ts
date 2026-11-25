// TileTalk's Cloud Functions.
//
// scanTiles (TileScan): the app sends a photo of a mahjong hand, this sends it to the Roboflow
// tile recognition model and returns the tiles it found. It runs here, not in the app, so the
// Roboflow key stays secret. Set the key once with:
//   firebase functions:secrets:set ROBOFLOW_API_KEY --project <your-project-id>

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  cleanImage,
  nextUsage,
  parseRoboflowResponse,
  ROBOFLOW_TIMEOUT_MS,
  roboflowUrl,
  Usage,
} from './roboflow';

initializeApp();

const roboflowKey = defineSecret('ROBOFLOW_API_KEY');

export const scanTiles = onCall(
  {
    secrets: [roboflowKey],
    memory: '256MiB',
    timeoutSeconds: 30,
    // At most this many copies run at once, so a flood of requests can't run up a bill.
    maxInstances: 3,
  },
  async (request) => {
    const started = Date.now();
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to use TileScan.');

    const image = cleanImage((request.data as { image?: unknown } | undefined)?.image);
    if (!image) throw new HttpsError('invalid-argument', 'That photo couldn’t be read. Try taking it again.');

    // Each player gets a number of scans per hour. Saved where only this function can reach it:
    // firestore.rules doesn't let the app read or write this collection.
    const usageRef = getFirestore().collection('tileScanUsage').doc(uid);
    const check = await getFirestore().runTransaction(async (t) => {
      const result = nextUsage((await t.get(usageRef)).data() as Usage | undefined, Date.now());
      if (result.allowed) t.set(usageRef, result.usage);
      return result;
    });
    if (!check.allowed) {
      const minutes = Math.max(1, Math.ceil(check.retryInMs / 60_000));
      throw new HttpsError('resource-exhausted', `That’s a lot of scans. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`);
    }

    // The key goes in the address, so the address is never logged.
    const roboflowStarted = Date.now();
    let response: Response;
    try {
      response = await fetch(roboflowUrl(roboflowKey.value()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: image,
        signal: AbortSignal.timeout(ROBOFLOW_TIMEOUT_MS),
      });
    } catch (e) {
      logger.warn('Roboflow could not be reached', { error: (e as Error).name });
      throw new HttpsError('unavailable', 'The tile reader didn’t answer. Try again in a moment.');
    }
    const roboflowMs = Date.now() - roboflowStarted;

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      logger.error('Roboflow refused the scan', { status: response.status, detail });
      if (response.status === 401 || response.status === 403) {
        throw new HttpsError('failed-precondition', 'TileScan isn’t set up yet: the Roboflow key is missing or wrong.');
      }
      throw new HttpsError('unavailable', 'The tile reader had a problem. Try again in a moment.');
    }

    const { detections, image: size } = parseRoboflowResponse(await response.json().catch(() => null));
    logger.info('Scanned', { tiles: detections.length, roboflowMs, imageChars: image.length });
    return { detections, image: size, ms: { roboflow: roboflowMs, total: Date.now() - started } };
  },
);
