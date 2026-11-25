// TileScan: passing scanned tiles from the TileScan screen back to the Record hand screen, where
// they're laid out in the tile calculator like tiles tapped in by hand.

import { tileName } from '../game/tiles';
import { scanToHand, ScannedTile, TileScan } from './readDetections';

export interface ScannedHand {
  tiles: string[];
  flowers: string[];
  /** Laid out, but the model wasn't sure of them: worth a look. */
  toCheck: string[];
  /** Found but not laid out: labels the app doesn't know, or a copy too many. */
  leftOut: string[];
}

const percent = (t: ScannedTile) => `${Math.round(t.confidence * 100)}%`;

/** What to lay out from a scan, and what to tell the player about it. */
export function scannedHandFrom(scan: TileScan): ScannedHand {
  const all = [...scan.tiles, ...scan.flowers];
  const { tiles, flowers } = scanToHand(scan);
  return {
    tiles,
    flowers,
    toCheck: all
      .filter((t) => t.code && t.flags.includes('unsure') && !t.flags.includes('tooMany'))
      .map((t) => `${tileName(t.code!)} (${percent(t)} sure)`),
    leftOut: all
      .filter((t) => !t.code || t.flags.includes('tooMany'))
      .map((t) => (t.code ? `a 5th ${tileName(t.code)}` : `an unknown tile (“${t.label}”)`)),
  };
}

// Waiting to be picked up, by game id. Kept only while the app is open, like the tile drafts on
// the Record hand screen.
const waiting = new Map<string, ScannedHand>();

export function sendScannedHand(gameId: string, hand: ScannedHand): void {
  waiting.set(gameId, hand);
}

/** The scanned hand for this game, if one is waiting. It's handed over once. */
export function takeScannedHand(gameId: string): ScannedHand | undefined {
  const hand = waiting.get(gameId);
  waiting.delete(gameId);
  return hand;
}
