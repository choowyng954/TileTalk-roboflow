// TileScan: what the tile recognition model found in a photo, turned into tiles in reading order,
// with anything doubtful flagged for the player to check before the tiles are used.

import { BONUS_TILES, maxCopies } from '../game/tiles';
import { tileCodeForLabel } from './labels';

/** One tile the model found. Roboflow gives the centre of the box, in pixels of the photo sent. */
export interface Detection {
  /** The model's class name, e.g. "9D". */
  label: string;
  /** 0 to 1. */
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * unsure: the model wasn't confident. unknown: a label the app doesn't know (see labels.ts).
 * tooMany: more copies of this tile than a set has; these are the least confident of them.
 */
export type TileFlag = 'unsure' | 'unknown' | 'tooMany';

export interface TileReading {
  /** App tile code, or null for a label the app doesn't know. */
  code: string | null;
  label: string;
  confidence: number;
}

export interface ScannedTile extends TileReading {
  box: { x: number; y: number; width: number; height: number };
  /** 0 is the top row of tiles in the photo. */
  row: number;
  flags: TileFlag[];
  /** Other things the model read in the same spot, most confident first. */
  alternatives: TileReading[];
}

export interface TileScan {
  /** Hand tiles: rows top to bottom, each row left to right. */
  tiles: ScannedTile[];
  /** Flowers and seasons, in the same order. */
  flowers: ScannedTile[];
  rowCount: number;
}

/** Below this confidence a tile is flagged as unsure. */
export const UNSURE_BELOW = 0.6;
/** Boxes overlapping more than this (intersection over union) are the same tile read twice. */
const SAME_TILE_OVERLAP = 0.5;
/** A tile whose centre is this many tile heights below the row's centre starts a new row. */
const NEW_ROW_GAP = 0.6;

type Box = Detection;

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
  const h = Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2);
  if (w <= 0 || h <= 0) return 0;
  const shared = w * h;
  return shared / (a.width * a.height + b.width * b.height - shared);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const readingOf = (d: Detection): TileReading => ({ code: tileCodeForLabel(d.label), label: d.label, confidence: d.confidence });

/**
 * Sorts the model's detections into rows and reading order, turns labels into tile codes and
 * flags what needs checking. Nothing is thrown away except a second reading of the same tile,
 * which is kept as an alternative.
 */
export function readDetections(detections: Detection[], unsureBelow = UNSURE_BELOW): TileScan {
  const valid = detections.filter(
    (d) => [d.x, d.y, d.width, d.height, d.confidence].every(Number.isFinite) && d.width > 0 && d.height > 0,
  );

  // The same tile read as two different tiles: keep the most confident reading.
  const kept: { d: Detection; alternatives: TileReading[] }[] = [];
  for (const d of [...valid].sort((a, b) => b.confidence - a.confidence)) {
    const same = kept.find((k) => overlap(k.d, d) > SAME_TILE_OVERLAP);
    if (!same) kept.push({ d, alternatives: [] });
    else if (d.label !== same.d.label && !same.alternatives.some((a) => a.label === d.label)) same.alternatives.push(readingOf(d));
  }
  if (kept.length === 0) return { tiles: [], flowers: [], rowCount: 0 };

  // Rows: top to bottom, a new row when a tile sits clearly below the current row.
  const tileHeight = median(kept.map((k) => k.d.height));
  const rows: (typeof kept)[] = [];
  let rowY = 0;
  for (const k of [...kept].sort((a, b) => a.d.y - b.d.y)) {
    const row = rows[rows.length - 1];
    if (!row || k.d.y - rowY > tileHeight * NEW_ROW_GAP) {
      rows.push([k]);
      rowY = k.d.y;
    } else {
      row.push(k);
      rowY = row.reduce((sum, r) => sum + r.d.y, 0) / row.length;
    }
  }

  const all: ScannedTile[] = rows.flatMap((row, i) =>
    [...row]
      .sort((a, b) => a.d.x - b.d.x)
      .map(({ d, alternatives }) => {
        const reading = readingOf(d);
        const flags: TileFlag[] = [];
        if (reading.code === null) flags.push('unknown');
        if (d.confidence < unsureBelow) flags.push('unsure');
        return { ...reading, box: { x: d.x, y: d.y, width: d.width, height: d.height }, row: i, flags, alternatives };
      }),
  );

  // More copies than a set has: flag the least confident extras.
  const byCode = new Map<string, ScannedTile[]>();
  for (const t of all) if (t.code) byCode.set(t.code, [...(byCode.get(t.code) ?? []), t]);
  for (const [code, copies] of byCode) {
    const extra = copies.length - maxCopies(code);
    if (extra > 0) [...copies].sort((a, b) => a.confidence - b.confidence).slice(0, extra).forEach((t) => t.flags.push('tooMany'));
  }

  const isBonus = (t: ScannedTile) => t.code !== null && BONUS_TILES.includes(t.code);
  return { tiles: all.filter((t) => !isBonus(t)), flowers: all.filter(isBonus), rowCount: rows.length };
}

/**
 * The tile codes to lay out in the tile calculator. Tiles the app can't use (an unknown label, or
 * one copy too many) are left out; the review shows them so the player can add the right tile.
 */
export function scanToHand(scan: TileScan): { tiles: string[]; flowers: string[] } {
  const usable = (list: ScannedTile[]) =>
    list.filter((t) => t.code !== null && !t.flags.includes('tooMany')).map((t) => t.code as string);
  return { tiles: usable(scan.tiles), flowers: usable(scan.flowers) };
}
